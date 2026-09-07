/**
 * Slowniki aplikacji - JEDNO zrodlo prawdy dla list wyboru.
 *
 * Backend uzywa ich do walidacji, frontend pobiera je endpointem GET /api/slowniki
 * i buduje z nich dropdowny. Dzieki temu dopisanie nowego klienta = zmiana w JEDNYM
 * miejscu, bez dotykania HTML-a i bez migracji bazy.
 */

// Dozwolone stany zadania. Kolejnosc = kolejnosc na liscie rozwijanej.
// UWAGA: te wartosci sa walidowane przez backend. Jesli usuniesz stan, ktory
// wystepuje juz w bazie, stare rekordy zostana - ale nie da sie ich ponownie zapisac
// z tym stanem. Bezpieczniej stany tylko dodawac.
const STANY = ['Plan', 'Czeka', 'W trakcie', 'Zrobione', 'Blok'];

// Stan nadawany nowo utworzonemu zadaniu.
const STAN_DOMYSLNY = 'Plan';

// Stan oznaczajacy zadanie zamkniete. Frontend trzyma takie zadania zawsze na dole
// tabeli, niezaleznie od wybranego sortowania - stad osobna stala, a nie wpisany
// na sztywno tekst w kilku miejscach.
const STAN_ZAKONCZONY = 'Zrobione';

/*
  Priorytety. Tablica obiektow, a nie mapa numer->etykieta, bo kolejnosc na liscie
  rozwijanej ma byc jawna i kontrolowana.

  W bazie trzymamy NUMER (kolumna priorytet INTEGER), a nie etykiete - dzieki temu
  sortowanie jest naturalne (0 < 1 < 2...), a zmiana nazwy "Srednie" na "Normalne"
  nie wymaga ruszania danych. Etykieta to warstwa prezentacji.
*/
const PRIORYTETY = [
  { numer: 0, etykieta: 'None' },
  { numer: 1, etykieta: 'Low' },
  { numer: 2, etykieta: 'Medium' },
  { numer: 3, etykieta: 'High' },
  { numer: 4, etykieta: 'Urgent' },
];

// Priorytet nadawany nowo utworzonemu zadaniu.
// UWAGA: ta sama wartosc jest wpisana na sztywno w migracji 2 (db/migracje.js)
// jako DEFAULT kolumny. Zmiana tutaj wplywa tylko na nowe rekordy tworzone przez API.
const PRIORYTET_DOMYSLNY = 2;

/*
  Obszary zycia - pole `obszar` w tabeli zadania (do migracji 6: `klient_kategoria`).

  Pole zmienilo znaczenie: bylo lista klientow, jest lista obszarow zycia z Notion.
  Nazwy zostaja PO ANGIELSKU, dokladnie tak jak w zrodle - dzieki temu import
  z Notion mapuje je 1:1, bez tablicy tlumaczen, ktora trzeba by utrzymywac.

  Celowo NIE jest walidowana twardo przez backend (patrz routes/zadania.js) -
  to lista podpowiedzi. Wartosc spoza niej nadal sie zapisze i pokaze
  z dopiskiem "(spoza listy)", wiec stare rekordy z nazwami klientow nie znikaja.
*/
/*
  ETYKIETY WYSWIETLANE dla wartosci, ktore siedza w bazie po polsku.

  Interfejs jest po angielsku, ale `zadania.stan` trzyma wartosci polskie w 527
  rekordach, a `obszar` w jednym przypadku ("Inne"). Zamiast migrowac dane,
  mapujemy je na etykiety - dokladnie tak, jak kolumna `stres` nazywa sie w bazie
  po staremu, a w interfejsie jest "Spokoj".

  DLACZEGO NIE MIGRACJA
  Wartosc stanu jest tez naglowkiem i trescia eksportu CSV, ktory musi dac sie
  wczytac z powrotem. Zmiana wartosci uniewazniloby 41 istniejacych kopii
  zapasowych - to ta sama awaria, ktora naprawialismy przy kopiach.

  Brak wpisu = wartosc pokazuje sie taka, jaka jest. Obszary sa juz po angielsku,
  wiec mapowanie ma dokladnie jedna pozycje.
*/
const ETYKIETY_STANOW = {
  Plan: 'Planned',
  Czeka: 'Waiting',
  'W trakcie': 'In progress',
  Zrobione: 'Done',
  Blok: 'Blocked',
};

const ETYKIETY_OBSZAROW = {
  Inne: 'Other',
};

const OBSZARY = [
  'Mindset',
  'Career',
  'Knowledge',
  'Creative',
  'Health',
  'Home',
  'Lifestyle',
  'Family',
  'Finances',
  'Fun/Relax',
  'Travel',
  'Inne',
];

// Wartosc zapasowa, gdy zrodlo nie podaje obszaru (uzywana przy imporcie).
const OBSZAR_ZAPASOWY = 'Inne';

/*
  NAWYKI PRZENIESIONE DO BAZY.

  Lista nawykow byla tu wczesniej jako stala tablica. Od migracji 4 mieszka
  w tabeli `nawyki_slownik`, bo ma dac sie edytowac z poziomu aplikacji
  (dodawanie, zmiana nazwy, usuwanie). Obsluguje ja routes/nawyki.js,
  a frontend pobiera ja przez GET /api/nawyki.

  Nie zostawiamy tu kopii listy - dwa zrodla prawdy predzej czy pozniej
  by sie rozjechaly. Zasiew 15 nazw (bez artefaktu "Untitled") jest wpisany
  wprost w migracji 4.
*/

/** Etykieta dla numeru priorytetu. Nieznany numer zwraca sam numer w nawiasach. */
function etykietaPriorytetu(numer) {
  const znaleziony = PRIORYTETY.find((p) => p.numer === numer);
  return znaleziony ? znaleziony.etykieta : `(${numer})`;
}

module.exports = {
  STANY,
  STAN_DOMYSLNY,
  STAN_ZAKONCZONY,
  PRIORYTETY,
  PRIORYTET_DOMYSLNY,
  etykietaPriorytetu,
  OBSZARY,
  OBSZAR_ZAPASOWY,
  ETYKIETY_STANOW,
  ETYKIETY_OBSZAROW,
};
