/*
  Obsluga dat - wspolna dla calej aplikacji (zadania, w przyszlosci dziennik).

  W bazie trzymamy znacznik ISO 8601 w postaci 'YYYY-MM-DDTHH:MM'. Ten modul
  odpowiada za dwie rzeczy:

  1. znormalizujZnacznikCzasu - SCISLA normalizacja tego, co przychodzi przez API
     (frontend, curl). Przyjmuje waskie, przewidywalne warianty.
  2. parsujDateTolerancyjnie - LUZNY parser na potrzeby importu z pliku, gdzie
     data moze byc zapisana w kilku ludzkich formatach.

  Te dwa poziomy sa celowo rozdzielone: API ma byc scisle, import ma byc wyrozumialy.
*/

/** Czy rok-miesiac-dzien to istniejaca data? Odrzuca np. 2026-02-30. */
function istniejacyDzien(rok, miesiac, dzien) {
  const d = new Date(Date.UTC(rok, miesiac - 1, dzien));
  // Bez tej kontroli JS "poprawilby" 30 lutego na 2 marca zamiast zglosic blad.
  return d.getUTCFullYear() === rok && d.getUTCMonth() === miesiac - 1 && d.getUTCDate() === dzien;
}

/**
 * Sprowadza znacznik czasu do kanonicznej postaci YYYY-MM-DDTHH:MM
 * albo zwraca null, jesli wartosc jest niepoprawna.
 *
 * Przyjmowane warianty wejscia:
 *   YYYY-MM-DD           - sama data; godzina staje sie 00:00
 *   YYYY-MM-DDTHH:MM     - postac docelowa, wysylana przez <input type="datetime-local">
 *   YYYY-MM-DDTHH:MM:SS  - niektore przegladarki dokladaja sekundy; obcinamy je do minut
 *   (zamiast T dopuszczamy spacje)
 */
function znormalizujZnacznikCzasu(tekst) {
  const dopasowanie = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?$/.exec(tekst);
  if (!dopasowanie) return null;

  const [, rok, miesiac, dzien, godzina = '00', minuta = '00'] = dopasowanie;

  if (!istniejacyDzien(Number(rok), Number(miesiac), Number(dzien))) return null;
  if (Number(godzina) > 23 || Number(minuta) > 59) return null;

  return `${rok}-${miesiac}-${dzien}T${godzina}:${minuta}`;
}

// Angielskie nazwy miesiecy - Notion eksportuje daty wlasnie w tej postaci
// ("August 8, 2026"), niezaleznie od jezyka interfejsu.
const MIESIACE_ANGIELSKIE = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/** Sklada 'YYYY-MM-DD' z liczb albo zwraca null, gdy taki dzien nie istnieje. */
function zloz(rok, miesiac, dzien) {
  if (!istniejacyDzien(rok, miesiac, dzien)) return null;
  const dwie = (n) => String(n).padStart(2, '0');
  return `${rok}-${dwie(miesiac)}-${dwie(dzien)}`;
}

/*
  Formaty prob owane po kolei, az ktorys zadziala. Kolejnosc ma znaczenie:
  najpierw format naszej bazy, potem eksport Notion, na koncu zapis polski.

  Formaty sa rozlaczne (inne separatory i uklad), wiec kolejnosc nie tworzy
  pulapek w rodzaju 03.04.2026 raz czytanego jako marzec, raz jako kwiecien.
*/
const FORMATY = [
  {
    nazwa: 'YYYY-MM-DD',
    wzorzec: /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
    zloz: (m) => zloz(Number(m[1]), Number(m[2]), Number(m[3])),
  },
  {
    nazwa: 'Month D, YYYY',
    // przecinek opcjonalny, wielkosc liter nieistotna: "August 8, 2026", "august 8 2026"
    wzorzec: /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
    zloz: (m) => {
      const miesiac = MIESIACE_ANGIELSKIE[m[1].toLowerCase()];
      return miesiac ? zloz(Number(m[3]), miesiac, Number(m[2])) : null;
    },
  },
  {
    nazwa: 'DD.MM.YYYY',
    wzorzec: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
    zloz: (m) => zloz(Number(m[3]), Number(m[2]), Number(m[1])),
  },
];

/**
 * Tolerancyjny parser daty z pliku. Zwraca znacznik 'YYYY-MM-DDT00:00' albo null.
 *
 * Godzina jest zawsze 00:00 - pliki wejsciowe zawieraja same daty, a godzina
 * i tak nie wplywa na kolumny wyliczane w aplikacji.
 *
 * Pusta wartosc NIE jest tu obslugiwana - to zadanie wolajacego, bo pusta data
 * jest dopuszczalna i nie jest bledem (patrz lib/import.js).
 */
function parsujDateTolerancyjnie(tekst) {
  const wejscie = String(tekst).trim();

  for (const format of FORMATY) {
    const dopasowanie = format.wzorzec.exec(wejscie);
    if (!dopasowanie) continue;

    const data = format.zloz(dopasowanie);
    // Wzorzec pasowal, ale dzien nie istnieje (np. 31.02.2026) - to blad,
    // a nie powod, zeby probowac kolejnych formatow.
    return data === null ? null : `${data}T00:00`;
  }

  return null;
}

/** Nazwy formatow do komunikatow o bledzie. */
const NAZWY_FORMATOW = FORMATY.map((f) => f.nazwa);

module.exports = {
  istniejacyDzien,
  znormalizujZnacznikCzasu,
  parsujDateTolerancyjnie,
  NAZWY_FORMATOW,
};
