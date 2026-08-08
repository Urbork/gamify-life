/*
  Silnik importu z CSV - generyczny, bez wiedzy o zadaniach.

  Wszystko, co specyficzne dla konkretnej tabeli (jakie naglowki, ktore pola sa
  datami, co czyni wiersz poprawnym), przychodzi w KONFIGURACJI. Dzieki temu
  przyszly dziennik zaimportuje sie tym samym kodem, podajac wlasny
  config/mapowanie-*.js i wlasna funkcje walidujaca.

  Modul niczego nie zapisuje do bazy - zwraca tylko rozdzielone listy
  "gotowe" i "odrzucone". Zapis nalezy do warstwy HTTP (routes/import.js),
  co pozwala uzyc dokladnie tego samego wyniku raz do podgladu, raz do zapisu.
*/

const { doRekordow } = require('./csv-parser');
const { parsujDateTolerancyjnie, NAZWY_FORMATOW } = require('./daty');

/**
 * @typedef {object} KonfiguracjaImportu
 * @property {Object<string,string>} mapowanie        naglowek w pliku -> pole docelowe
 * @property {string[]} kolumnyWymagane               naglowki, bez ktorych plik jest odrzucany
 * @property {string[]} [kolumnyIgnorowane]           naglowki swiadomie pomijane
 * @property {string[]} [polaDatowe]                  pola przepuszczane przez parser dat
 * @property {Object<string,function>} [transformacje] pole -> funkcja (surowa) => wartosc|null
 * @property {string[]} [wartosciPuste]               teksty znaczace "brak wartosci" (np. 'null')
 * @property {object}   [wartosciDomyslne]            dopisywane do kazdego wiersza
 * @property {(rekord: object, surowy: object) => string|null} [waliduj]
 *           zwraca powod odrzucenia albo null; dostaje tez SUROWY wiersz z pliku,
 *           zeby moc podac w komunikacie wartosc, ktora nie przeszla
 */

/**
 * Blad dotyczacy CALEGO pliku (nie pojedynczego wiersza).
 * routes/import.js zamienia go na odpowiedz 400.
 */
class BladPliku extends Error {}

/**
 * Parsuje i sprawdza plik CSV, NIC nie zapisujac.
 *
 * @param {string} tresc surowa zawartosc pliku
 * @param {KonfiguracjaImportu} konfiguracja
 * @returns {{
 *   separator: string,
 *   naglowki: string[],
 *   nieznaneKolumny: string[],
 *   gotowe: Array<{linia: number, dane: object}>,
 *   odrzucone: Array<{linia: number, nazwa: string, powod: string}>
 * }}
 */
function przygotujImport(tresc, konfiguracja) {
  const {
    mapowanie,
    kolumnyWymagane = [],
    kolumnyIgnorowane = [],
    polaDatowe = [],
    // Domyslnie puste, wiec profile, ktore ich nie podaja (np. zadania),
    // zachowuja sie dokladnie tak jak przed dodaniem tych dwoch opcji.
    transformacje = {},
    wartosciPuste = [],
    wartosciDomyslne = {},
    waliduj = () => null,
  } = konfiguracja;

  const { separator, naglowki, rekordy } = doRekordow(tresc);

  if (naglowki.length === 0) {
    throw new BladPliku('Plik jest pusty albo nie zawiera wiersza nagłówków.');
  }

  // Brak wymaganej kolumny przerywa caly import - patrz komentarz przy
  // KOLUMNY_WYMAGANE w config/mapowanie-importu.js.
  const brakujace = kolumnyWymagane.filter((k) => !naglowki.includes(k));
  if (brakujace.length > 0) {
    throw new BladPliku(
      `W pliku brakuje kolumn: ${brakujace.join(', ')}. ` +
        `Znalezione nagłówki: ${naglowki.join(', ')}.`
    );
  }

  // Kolumny, ktorych ani nie mapujemy, ani swiadomie nie ignorujemy.
  // Nie sa bledem - raportujemy je, zeby bylo widac, ze czegos nie wczytujemy.
  const nieznaneKolumny = naglowki.filter(
    (h) => h !== '' && !(h in mapowanie) && !kolumnyIgnorowane.includes(h)
  );

  // Kolumna, z ktorej bierzemy etykiete odrzuconego wiersza (pierwsza wymagana,
  // czyli w praktyce nazwa) - zeby w raporcie bylo widac, o ktory wiersz chodzi.
  const kolumnaEtykiety = kolumnyWymagane[0] ?? naglowki[0];

  const gotowe = [];
  const odrzucone = [];

  for (const { dane, linia } of rekordy) {
    const etykieta = dane[kolumnaEtykiety] ?? '';
    let powod = null;
    const docelowy = { ...wartosciDomyslne };

    for (const [naglowek, pole] of Object.entries(mapowanie)) {
      // Kolumny nieobecnej w pliku po prostu nie ma - pole zostaje niewypelnione.
      if (!(naglowek in dane)) continue;

      /*
        Wartosci uznawane za "brak danych" sprowadzamy do pustego tekstu JESZCZE PRZED
        jakimkolwiek przetwarzaniem. Eksporty Notion potrafia wpisywac literalne "null"
        w niewypelnione pola tekstowe (w tym pliku ponad 900 razy) - bez tego kroku
        trafiloby ono do bazy jako tresc wpisu.
      */
      const wartosc = wartosciPuste.includes(dane[naglowek]) ? '' : dane[naglowek];

      /*
        Transformacja per pole - punkt rozszerzenia dla profili takich jak dziennik,
        gdzie kolumna wymaga rozebrania na czesci (godzina z "DD/MM/YYYY H:MM (GMT+X)",
        cyfra z "4 - A ⭐️⭐️⭐️⭐️", nazwy nawykow bez URL-i).

        KONTRAKT: funkcja zwraca wartosc albo null, gdzie null znaczy BRAK WARTOSCI,
        a nie blad. Wynika to z tego, ze w dzienniku wymagana jest tylko data, a reszta
        pol bywa puste masowo. O tym, czy wiersz jest poprawny, decyduje waliduj().
      */
      if (transformacje[pole]) {
        docelowy[pole] = wartosc === '' ? null : transformacje[pole](wartosc);
        continue;
      }

      if (polaDatowe.includes(pole)) {
        // Pusta data jest DOZWOLONA i nie jest bledem.
        if (wartosc === '') {
          docelowy[pole] = null;
          continue;
        }

        const znacznik = parsujDateTolerancyjnie(wartosc);
        if (znacznik === null) {
          powod = `Kolumna "${naglowek}": nierozpoznany format daty "${wartosc}". Obsługiwane: ${NAZWY_FORMATOW.join(', ')}.`;
          break;
        }
        docelowy[pole] = znacznik;
        continue;
      }

      docelowy[pole] = wartosc === '' ? null : wartosc;
    }

    // Walidacja specyficzna dla tabeli - dopiero gdy daty sie sparsowaly.
    // Dostaje takze surowy wiersz, zeby moc zacytowac w komunikacie wartosc z pliku.
    if (powod === null) powod = waliduj(docelowy, dane);

    if (powod === null) gotowe.push({ linia, dane: docelowy });
    else odrzucone.push({ linia, nazwa: etykieta, powod });
  }

  return { separator, naglowki, nieznaneKolumny, gotowe, odrzucone };
}

module.exports = { przygotujImport, BladPliku };
