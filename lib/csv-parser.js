/*
  Parser CSV - generyczny, bez zadnej wiedzy o zadaniach.
  Para do public/js/csv.js, ktory CSV zapisuje; ten go czyta.

  DLACZEGO WLASNY, A NIE BIBLIOTEKA
  Poprawny czytnik wg RFC 4180 to jedna maszyna stanow ponizej. Biblioteka
  (csv-parse, papaparse) dolozylaby zaleznosc z wlasnym drzewem zaleznosci do
  lokalnej aplikacji jednoosobowej, w ktorej zapis CSV juz mamy napisany recznie.
  Tak obie strony tej samej pary sa spojne i w calosci testowalne.

  CO OBSLUGUJE
  - cudzyslowy, w tym "" jako cudzyslow w tresci
  - separatory, znaki nowej linii i cudzyslowy WEWNATRZ pol w cudzyslowach
  - konce linii CRLF i LF
  - BOM na poczatku pliku
  - separator , albo ; albo tabulator (wykrywany automatycznie)
  - numery linii w pliku, poprawne takze gdy pole zawiera lamanie linii
*/

const SEPARATORY = [',', ';', '\t'];

/**
 * Wykrywa separator, liczac jego wystapienia w pierwszej linii POZA cudzyslowami.
 * Notion eksportuje przecinkami, ale polski Excel zapisuje srednikami - plik
 * z obu zrodel ma sie dac wczytac bez przelaczania czegokolwiek w kodzie.
 */
function wykryjSeparator(tekst) {
  const pierwszaLinia = tekst.split('\n', 1)[0];

  let najlepszy = ',';
  let najwiecej = 0;

  for (const separator of SEPARATORY) {
    let ile = 0;
    let wCudzyslowie = false;

    for (const znak of pierwszaLinia) {
      if (znak === '"') wCudzyslowie = !wCudzyslowie;
      else if (znak === separator && !wCudzyslowie) ile++;
    }

    if (ile > najwiecej) {
      najwiecej = ile;
      najlepszy = separator;
    }
  }

  return najlepszy;
}

/**
 * Rozbija tekst CSV na wiersze komorek.
 * @returns {{separator: string, wiersze: Array<{komorki: string[], linia: number}>}}
 *   `linia` to numer linii w PLIKU, na ktorej wiersz sie zaczyna (liczac od 1).
 */
function parsuj(tekst) {
  // BOM (U+FEFF) trafia na poczatek pliku m.in. z Excela i z naszego wlasnego eksportu.
  // Bez usuniecia skleilby sie z pierwszym naglowkiem i zadne mapowanie by nie trafilo.
  const tresc = tekst.charCodeAt(0) === 0xfeff ? tekst.slice(1) : tekst;

  const separator = wykryjSeparator(tresc);
  const wiersze = [];

  let komorki = [];
  let pole = '';
  let wCudzyslowie = false;
  let linia = 1;
  let liniaWiersza = 1;

  const zakonczWiersz = () => {
    komorki.push(pole);
    wiersze.push({ komorki, linia: liniaWiersza });
    komorki = [];
    pole = '';
  };

  for (let i = 0; i < tresc.length; i++) {
    const znak = tresc[i];

    if (wCudzyslowie) {
      if (znak === '"') {
        // "" w srodku pola w cudzyslowach oznacza jeden znak cudzyslowu.
        if (tresc[i + 1] === '"') {
          pole += '"';
          i++;
        } else {
          wCudzyslowie = false;
        }
      } else if (znak === '\r') {
        // CRLF wewnatrz pola normalizujemy do samego LF.
      } else {
        if (znak === '\n') linia++; // lamanie linii W POLU tez przesuwa numer linii
        pole += znak;
      }
      continue;
    }

    if (znak === '"') {
      wCudzyslowie = true;
    } else if (znak === separator) {
      komorki.push(pole);
      pole = '';
    } else if (znak === '\r') {
      // czesc CRLF - wiersz zamknie dopiero \n
    } else if (znak === '\n') {
      zakonczWiersz();
      linia++;
      liniaWiersza = linia;
    } else {
      pole += znak;
    }
  }

  // Ostatni wiersz, jesli plik nie konczy sie znakiem nowej linii.
  // Warunek chroni przed doklejeniem pustego wiersza po koncowym \n.
  if (pole !== '' || komorki.length > 0) zakonczWiersz();

  return { separator, wiersze };
}

/**
 * Parsuje CSV i zamienia go na rekordy: obiekty naglowek -> wartosc.
 *
 * Naglowki i wartosci sa przycinane ze spacji (wiodacych i koncowych) - w eksportach
 * czesto zostaja przypadkowe spacje po separatorze, a mapowanie ma byc na nie odporne.
 * Wiersze calkowicie puste sa pomijane (typowa pusta linia na koncu pliku).
 *
 * @returns {{separator: string, naglowki: string[], rekordy: Array<{dane: object, linia: number}>}}
 */
function doRekordow(tekst) {
  const { separator, wiersze } = parsuj(tekst);

  if (wiersze.length === 0) {
    return { separator, naglowki: [], rekordy: [] };
  }

  const naglowki = wiersze[0].komorki.map((h) => h.trim());

  const rekordy = wiersze
    .slice(1)
    .filter((w) => w.komorki.some((k) => k.trim() !== ''))
    .map((w) => {
      const dane = {};
      naglowki.forEach((naglowek, i) => {
        // Wiersz krotszy od naglowka = brakujace komorki traktujemy jak puste.
        dane[naglowek] = (w.komorki[i] ?? '').trim();
      });
      return { dane, linia: w.linia };
    });

  return { separator, naglowki, rekordy };
}

module.exports = { parsuj, doRekordow, wykryjSeparator };
