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
  { numer: 0, etykieta: 'Brak' },
  { numer: 1, etykieta: 'Niski' },
  { numer: 2, etykieta: 'Średni' },
  { numer: 3, etykieta: 'Wysoki' },
  { numer: 4, etykieta: 'Pilne' },
];

// Priorytet nadawany nowo utworzonemu zadaniu.
// UWAGA: ta sama wartosc jest wpisana na sztywno w migracji 2 (db/migracje.js)
// jako DEFAULT kolumny. Zmiana tutaj wplywa tylko na nowe rekordy tworzone przez API.
const PRIORYTET_DOMYSLNY = 2;

// Lista klientow / kategorii. Celowo NIE jest walidowana twardo przez backend
// (patrz routes/zadania.js) - to lista podpowiedzi. Dzieki temu dopisanie klienta
// tutaj wystarczy, a stare rekordy z nieaktualnymi wartosciami nadal dzialaja.
const KLIENCI = [
  'Alfaram',
  'Bieszczadzka Perełka',
  'Dmuchańce Krosno',
  'Forstal',
  'Kurihara Miho',
  'Laminex Composites',
  'London Royal Massage',
  'Nuva',
  'Oliwny Zakątek',
  'Shaggy Clean',
  'Shoelace',
  'Smokomoda',
  'Tomguard',
  'Rozwój / Kursy',
  'Prywatne',
  'Inne',
];

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
  KLIENCI,
};
