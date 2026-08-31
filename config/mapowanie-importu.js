/**
 * Mapowanie kolumn pliku CSV na pola tabeli `zadania`.
 *
 * Ten sam wzorzec co config/slowniki.js: konfiguracja w jednym miejscu, kod jej nie zna.
 * Plik jest opisany pod domyslny eksport z Notion, ale NIC tu nie jest zaszyte pod Notion -
 * zeby obsluzyc inne zrodlo, wystarczy dopisac wpisy ponizej.
 */

const { PRIORYTET_DOMYSLNY } = require('./slowniki');

/*
  naglowek w pliku -> kolumna w bazie

  Dopasowanie jest DOKLADNE (z dokladnoscia do wielkosci liter), ale odporne na
  wiodace i koncowe spacje oraz na BOM - jedno i drugie usuwa lib/csv-parser.js.

  Kilka naglowkow moze wskazywac na to samo pole. Jesli zechcesz wczytywac takze
  wlasny eksport z tej aplikacji (ma naglowki techniczne: nazwa, stan, ...),
  dopisz po prostu kolejne wpisy: 'nazwa': 'nazwa', 'stan': 'stan' itd.
*/
const MAPOWANIE_KOLUMN = {
  'Nazwa zadania': 'nazwa',
  Stan: 'stan',
  // Kolumna zachowuje historyczny naglowek, ale trafia juz do pola `obszar`
  // (migracja 6 zmienila nazwe kolumny i znaczenie pola).
  'Klient / Kategoria': 'obszar',
  Obszar: 'obszar',
  'Start zadania': 'start_zadania',
  Termin: 'termin',
  'Czas zakończenia': 'czas_zakonczenia',

  /*
    Kolumny obecne we WLASNEJ kopii zapasowej (scripts/backup.js). Bez nich
    odtworzenie z kopii gubilo priorytet, trudnosc i czas trwania, czyli komplet
    danych potrzebnych do naliczenia XP.
  */
  Priorytet: 'priorytet',
  Trudność: 'trudnosc',
  'Czas trwania (h)': 'czas_trwania_godziny',
};

/*
  Kolumny swiadomie POMIJANE. W pliku to formuly, a aplikacja liczy te wartosci
  sama przy renderowaniu i nie przechowuje ich w bazie.
  Lista sluzy tylko temu, zeby nie raportowac ich jako "nieznane kolumny".
*/
/*
  Kolumny swiadomie POMIJANE przy imporcie.

  'Priorytet (opis)' i 'Projekt' pochodza z wlasnej kopii zapasowej i sa tam
  DLA CZLOWIEKA. Opis priorytetu wynika z numeru obok, a projekt zapisany nazwa
  wymagalby rozwiazywania relacji po tekscie - do wiernego odtworzenia relacji
  sluzy migawka baza-*.db, nie CSV (patrz komentarz przy migawkaBazy).
*/
const KOLUMNY_IGNOROWANE = [
  'Dni do terminu',
  'Czas trwania (dni)',
  'Priorytet (opis)',
  'Projekt',
];

/*
  Naglowki, bez ktorych plik nie ma sensu. Ich brak przerywa caly import
  (a nie pojedynczy wiersz) - lepiej powiedziec od razu "to nie ten plik",
  niz odrzucic wszystkie wiersze po kolei z tym samym powodem.
*/
const KOLUMNY_WYMAGANE = ['Nazwa zadania', 'Stan'];

// Pola, ktore maja przejsc przez tolerancyjny parser dat (lib/daty.js).
const POLA_DATOWE = ['start_zadania', 'termin', 'czas_zakonczenia'];

/*
  Wartosci dopisywane do kazdego importowanego wiersza, bo plik ich nie zawiera.
  Priorytet bierzemy z tej samej stalej co przy recznym dodawaniu zadania,
  zeby "domyslny priorytet" znaczyl w calej aplikacji jedno i to samo.
*/
const WARTOSCI_DOMYSLNE = {
  priorytet: PRIORYTET_DOMYSLNY,
};

module.exports = {
  MAPOWANIE_KOLUMN,
  KOLUMNY_IGNOROWANE,
  KOLUMNY_WYMAGANE,
  POLA_DATOWE,
  WARTOSCI_DOMYSLNE,
};
