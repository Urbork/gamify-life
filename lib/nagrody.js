/*
  Silnik naliczania XP, poziomow i waluty.

  ZASADA NACZELNA: wszystko liczy sie NA ZYWO z danych zrodlowych.
  Nie ma logu zdarzen, nie ma zapisanego "stanu XP". Dzieki temu poprawienie
  starego zadania albo wpisu dziennika automatycznie poprawia wynik historyczny -
  liczby zawsze odpowiadaja temu, co faktycznie jest w bazie.

  Jedynym wyjatkiem jest WYDAWANIE waluty (tabela `zakupy`): zakupu nie da sie
  odtworzyc z niczego innego, wiec musi byc zapisanym zdarzeniem.

  DLACZEGO TO MODUL SERWEROWY, A NIE public/js
  Frontend dostaje gotowe liczby z GET /api/postac i niczego nie przelicza,
  wiec silnik nie musi dzialac w przegladarce. To upraszcza testowanie:
  smoke test robi zwykle require() zamiast ladowania pliku w sandboksie vm
  (ta sztuczka jest potrzebna tylko dla plikow z public/js, ktore musza
  dzialac po obu stronach).

  Wszystkie funkcje sa CZYSTE: biora zwykle dane, zwracaja zwykle dane,
  nie dotykaja bazy ani HTTP. Kazda da sie przetestowac w izolacji.
*/

'use strict';

// --- stale --------------------------------------------------------------

const STALE = {
  PROG_POZIOMU: 50, // XP na jeden poziom
  POZIOMOW_DO_RESETU: 100, // po tylu poziomach licznik wraca do 1, a prestiz rosnie

  XP_ZA_UTWORZENIE_WPISU: 1, // za sam wpis, nawet gdy nie ma w nim ani jednego pola
  XP_ZA_POLE_WPISU: 1, // za kazde wypelnione pole tresci wpisu

  DNI_NA_PREMIE: 1, // taki zapas przed terminem daje mnoznik premiowy

  PUNKTY_NA_POZIOM: 2, // tyle punktow atrybutow daje kazdy zdobyty poziom
};

/*
  Trudnosc nie jest mnozona wprost - jest przelicznikiem godzin.

    XP zadania = godziny x MNOZNIKI_TRUDNOSCI[trudnosc]

  Dzieki temu godzina pracy trudnej wazy cztery razy tyle co godzina pracy latwej,
  a jednostka pozostaje czytelna: "ile godzin, przeliczonych na trudnosc".

  To osobna stala, a nie pole STALE, bo STALE trafia na strone Postaci jako plaska
  lista liczb z opisami - obiekt zagniezdzony nie mialby tam sensownej reprezentacji.
*/
const MNOZNIKI_TRUDNOSCI = { 1: 0.5, 2: 1, 3: 2 };

/*
  Pola refleksyjne - te same szesc, ktore liczy tabela miesieczna w statystykach.

  UWAGA: identyczna lista istnieje w public/js/reguly-statystyk.js (POLA_REFLEKSYJNE),
  bo tamta strona dziala w przegladarce i nie moze siegnac do lib/. Granica
  serwer-przegladarka wymusza kopie. Smoke test sprawdza, ze obie listy sa
  identyczne - gdyby ktos dopisal pole tylko w jednym miejscu, test to wychwyci.
*/
const POLA_REFLEKSYJNE = [
  'wdziecznosc',
  'bledy',
  'rozmowa',
  'co_poszlo_dobrze',
  'jutro_wazne',
  'do_przemyslenia',
];

// Wszystkie pola wpisu, ktorych wypelnienie oznacza, ze dzien "zostal opisany".
const POLA_TRESCI_WPISU = [
  ...POLA_REFLEKSYJNE,
  'pobudka',
  'godziny_snu',
  'jakosc_snu',
  'stres',
  'nastroj',
  'intencjonalnosc',
  'trzy_slowa',
  'nawyki',
  'sniadanie',
  'obiad',
  'kolacja',
];

// --- pomocnicze ---------------------------------------------------------

/** Pole jest wypelnione? Pusty tekst liczy sie jako BRAK (edycja inline zostawia ''). */
function wypelnione(w) {
  return w !== null && w !== undefined && String(w).trim() !== '';
}

const MS_W_DNIU = 86400000;

/**
 * Znacznik 'YYYY-MM-DD[THH:MM]' -> numer dnia. GODZINA JEST POMIJANA.
 * Ta sama zasada co w kolumnach wyliczanych i filtrach: liczymy pelne dni
 * kalendarzowe, wiec zakonczenie o 23:00 w dniu terminu to nadal ten sam dzien.
 */
function numerDnia(znacznik) {
  if (!wypelnione(znacznik)) return null;
  const czesci = String(znacznik).slice(0, 10).split('-').map(Number);
  if (czesci.length !== 3 || czesci.some(Number.isNaN)) return null;
  return Date.UTC(czesci[0], czesci[1] - 1, czesci[2]) / MS_W_DNIU;
}

// --- XP z zadan ---------------------------------------------------------

/**
 * Mnoznik za terminowosc.
 *
 *   zapas = dzien(termin) - dzien(zakonczenie)
 *
 *   zapas >= 1        -> 1.5  (skonczone najpozniej dzien przed terminem)
 *   zapas == 0        -> 1    (w dniu terminu)
 *   zapas < 0         -> 0.5  (po terminie)
 *   brak ktorejs daty -> 1    (neutralnie - nie karzemy za brak danych)
 *
 * UWAGA: "doba przed terminem" liczy sie w PELNYCH DNIACH KALENDARZOWYCH, tak jak
 * wszystkie inne porownania dat w projekcie (numerDnia obcina godzine). Zadanie
 * skonczone o 23:00 dzien przed terminem i o 01:00 tego samego dnia daja ten sam
 * wynik - liczy sie data, nie odstep w godzinach.
 */
function mnoznikTerminowosci(termin, czasZakonczenia) {
  const doTerminu = numerDnia(termin);
  const zakonczenie = numerDnia(czasZakonczenia);
  if (doTerminu === null || zakonczenie === null) return 1;

  const zapas = doTerminu - zakonczenie;
  if (zapas >= STALE.DNI_NA_PREMIE) return 1.5;
  if (zapas >= 0) return 1;
  return 0.5;
}

/**
 * XP z pojedynczego zadania.
 *
 * Liczy sie WYLACZNIE zadanie w stanie "Zrobione" i tylko wtedy, gdy ma
 * wypelnione OBA pola: trudnosc i czas_trwania_godziny. Bez nich nie ma z czego
 * liczyc - zwracamy 0 i flage `brakujaceDane`, zeby interfejs mogl pokazac
 * delikatna wskazowke zamiast milczec.
 *
 * @returns {{ xp: number, brakujaceDane: boolean }}
 */
function xpZadania(zadanie, stanZakonczony = 'Zrobione') {
  if (zadanie.stan !== stanZakonczony) return { xp: 0, brakujaceDane: false };

  const trudnosc = Number(zadanie.trudnosc);
  const godziny = Number(zadanie.czas_trwania_godziny);
  const przelicznik = MNOZNIKI_TRUDNOSCI[trudnosc];

  const maDane =
    wypelnione(zadanie.trudnosc) &&
    wypelnione(zadanie.czas_trwania_godziny) &&
    Number.isFinite(godziny) &&
    przelicznik !== undefined;

  if (!maDane) return { xp: 0, brakujaceDane: true };

  // max(1, ...) sprawia, ze nawet trywialne zadanie (0.2h, trudnosc 1) daje 1 XP -
  // skonczone zadanie nigdy nie jest warte zera.
  const bazowe = Math.max(1, Math.round(godziny * przelicznik));
  const mnoznik = mnoznikTerminowosci(zadanie.termin, zadanie.czas_zakonczenia);

  return { xp: Math.max(1, Math.round(bazowe * mnoznik)), brakujaceDane: false };
}

/** Suma XP ze wszystkich zadan. */
function xpZadan(zadania, stanZakonczony = 'Zrobione') {
  let suma = 0;
  for (const z of zadania) suma += xpZadania(z, stanZakonczony).xp;
  return suma;
}

// --- XP z dziennika -----------------------------------------------------

/** Ile z szesciu pol refleksyjnych jest wypelnionych w tym wpisie (0-6). */
function liczbaWypelnionychPol(wpis) {
  return POLA_REFLEKSYJNE.filter((pole) => wypelnione(wpis[pole])).length;
}

/** Nazwy odhaczonych nawykow - pole to tekst rozdzielony przecinkami. */
function nazwyNawykow(wpis) {
  if (!wypelnione(wpis.nawyki)) return [];
  return String(wpis.nawyki)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * XP za jeden wpis: punkt za samo zalozenie wpisu plus punkt za kazde wypelnione
 * pole tresci. Pusty wpis (sama data) daje 1 - zapisanie dnia tez jest czynnoscia.
 *
 * WSZYSTKIE POLA WAZA TYLE SAMO, lacznie z nawykami. Nawyki sa JEDNYM polem:
 * odhaczenie dziesieciu daje tyle co odhaczenie jednego. Wczesniej liczyly sie
 * po sztuce i przez to same odpowiadaly za ponad cwierc calego XP w bazie.
 *
 * Dzieki rownej wadze dzien ma TWARDY SUFIT: XP_ZA_UTWORZENIE_WPISU + tyle,
 * ile jest pol tresci. Poprzednia regula gorniej granicy nie miala.
 */
function xpWpisu(wpis) {
  const ile = POLA_TRESCI_WPISU.filter((pole) => wypelnione(wpis[pole])).length;
  return STALE.XP_ZA_UTWORZENIE_WPISU + STALE.XP_ZA_POLE_WPISU * ile;
}

/** Najwyzsze mozliwe XP z jednego dnia dziennika - komplet pol. */
function maksymalneXpWpisu() {
  return STALE.XP_ZA_UTWORZENIE_WPISU + STALE.XP_ZA_POLE_WPISU * POLA_TRESCI_WPISU.length;
}

/** Suma XP z calego dziennika. */
function xpDziennika(wpisy) {
  let suma = 0;
  for (const w of wpisy) suma += xpWpisu(w);
  return suma;
}

// --- poziomy i prestiz --------------------------------------------------

/**
 * Poziom, prestiz i ile brakuje do nastepnego poziomu.
 *
 * Po POZIOMOW_DO_RESETU poziomach licznik wraca do 1, a prestiz rosnie o 1 -
 * stad reszta z dzielenia przez pelen cykl.
 */
function poziomZXp(calkowiteXp) {
  const cyklXp = STALE.PROG_POZIOMU * STALE.POZIOMOW_DO_RESETU;

  const prestiz = Math.floor(calkowiteXp / cyklXp);
  const xpWCyklu = calkowiteXp % cyklXp;
  const poziom = Math.floor(xpWCyklu / STALE.PROG_POZIOMU) + 1;
  const xpDoNastepnego = STALE.PROG_POZIOMU - (xpWCyklu % STALE.PROG_POZIOMU);

  return { poziom, prestiz, xpWCyklu, xpDoNastepnego };
}

// --- atrybuty -----------------------------------------------------------

/**
 * Ile punktow atrybutow uzbieralo sie lacznie.
 *
 * Liczymy WSZYSTKIE zdobyte poziomy, a nie sam licznik na ekranie: po przekroczeniu
 * progu prestizu licznik wraca do 1, a dorobku to nie kasuje. Poziom 1 jest startowy,
 * wiec sam z siebie nie daje punktow - stad (poziom - 1).
 *
 * Wartosc jest WYLICZANA, nie zapisywana: gdy zmiana danych zrodlowych przesunie
 * poziom, pula punktow przesuwa sie razem z nim. Zapisane jest tylko to, jak punkty
 * zostaly ROZDANE.
 */
function punktyDoRozdania(prestiz, poziom) {
  const zdobytePoziomy = prestiz * STALE.POZIOMOW_DO_RESETU + (poziom - 1);
  return STALE.PUNKTY_NA_POZIOM * zdobytePoziomy;
}

// --- waluta -------------------------------------------------------------

/** Waluta zarobiona za cale XP. Polowa XP, zaokraglona w dol. */
function walutaZarobiona(calkowiteXp) {
  return Math.floor(calkowiteXp / 2);
}

// --- zlozenie calosci ---------------------------------------------------

/**
 * Pelny stan postaci.
 *
 * @param {Array} zadania       wszystkie zadania (filtrowanie po stanie w srodku)
 * @param {Array} wpisy         wszystkie wpisy dziennika
 * @param {number} walutaWydana suma kosztow z tabeli `zakupy`
 * @param {string} stanZakonczony nazwa stanu oznaczajacego zadanie zrobione
 */
function policzPostac(zadania, wpisy, walutaWydana = 0, stanZakonczony = 'Zrobione') {
  const zZadan = xpZadan(zadania, stanZakonczony);
  const zDziennika = xpDziennika(wpisy);

  const calkowiteXp = zZadan + zDziennika;
  const { poziom, prestiz, xpWCyklu, xpDoNastepnego } = poziomZXp(calkowiteXp);
  const zarobiona = walutaZarobiona(calkowiteXp);

  return {
    calkowite_xp: calkowiteXp,
    poziom,
    prestiz,
    xp_w_cyklu: xpWCyklu,
    xp_do_nastepnego_poziomu: xpDoNastepnego,
    prog_poziomu: STALE.PROG_POZIOMU,

    waluta_zarobiona: zarobiona,
    waluta_wydana: walutaWydana,
    waluta_dostepna: zarobiona - walutaWydana,

    /*
      Nawyki nie sa juz osobnym zrodlem - licza sie jak kazde inne pole wpisu,
      wiec rozbicie ma dwie pozycje zamiast trzech.
    */
    rozbicie: {
      zadania: zZadan,
      dziennik: zDziennika,
    },
  };
}

module.exports = {
  STALE,
  MNOZNIKI_TRUDNOSCI,
  POLA_TRESCI_WPISU,
  POLA_REFLEKSYJNE,
  wypelnione,
  /*
    numerDnia NIE jest uzywane poza tym modulem. Wystawiamy je wylacznie po to,
    zeby smoke test mogl porownac te implementacje z blizniacza z
    public/js/filtr-dat.js - granica serwer-przegladarka wymusza kopie,
    wiec pilnujemy jej testem (tak samo jak POLA_REFLEKSYJNE).
  */
  numerDnia,
  mnoznikTerminowosci,
  xpZadania,
  xpZadan,
  liczbaWypelnionychPol,
  nazwyNawykow,
  xpWpisu,
  maksymalneXpWpisu,
  xpDziennika,
  poziomZXp,
  punktyDoRozdania,
  walutaZarobiona,
  policzPostac,
};
