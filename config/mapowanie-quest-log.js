/**
 * Profil importu "notion-quest-log" - eksport bazy "Success Plan" z Notion.
 *
 * Plik zawiera DWA rodzaje rekordow w jednej tabeli, rozroznione kolumna `Type`:
 *   Type = "Project"  -> tabela `projekty`
 *   Type = "Task"     -> tabela `zadania`, podpiete do projektu przez `Upstream`
 *
 * Stad dwa podprofile ponizej. Silnik importu (lib/import.js) przepuszcza ten sam
 * plik dwa razy, za kazdym razem z innym mapowaniem i innym `filtrWierszy`.
 *
 * UWAGA: profil powstal na podstawie specyfikacji, a nie na podstawie samego pliku -
 * eksportu "Success Plan" nie bylo w projekcie w chwili pisania. Naglowki
 * i wartosci sa wiec ZALOZONE. Jesli import zglosi "W pliku brakuje kolumn: Name",
 * porownaj naglowki ponizej z pierwszym wierszem pliku - poprawka to jedna linijka.
 */

const { OBSZAR_ZAPASOWY } = require('./slowniki');

// --- slowniki wartosci ----------------------------------------------------

/*
  Statusy Notion -> nasze stany. Ta sama piatka obowiazuje projekty i zadania.
  Wartosc pusta i nieznana traktujemy jako "Plan" - rekord ma sie zaimportowac,
  a nie odpasc przez etykiete statusu.
*/
const STATUSY = {
  Backlog: 'Plan',
  'Ready to Start': 'Czeka',
  'In Progress': 'W trakcie',
  Complete: 'Zrobione',
  Blocked: 'Blok',
};

const STAN_ZAPASOWY = 'Plan';

/*
  "Impact" w Notion to piec poziomow wplywu; mapujemy je 1:1 na nasze piec
  poziomow priorytetu (0-4). Emoji sa czescia wartosci w zrodle.
*/
const IMPACT_NA_PRIORYTET = {
  'x10 High 🔺': 4,
  'x5 Semi-High': 3,
  'x2 Impact': 2,
  'x0.5 Semi-Low': 1,
  'x0.2 Low 🔻': 0,
};

const PRIORYTET_ZAPASOWY = 2;

const TRUDNOSCI = {
  '1 - Easy': 1,
  '2 - Moderate': 2,
  '3 - Hard': 3,
};

// --- transformacje --------------------------------------------------------

/** Status -> stan. Nieznana i pusta wartosc daje "Plan". */
function parsujStatus(tekst) {
  return STATUSY[String(tekst).trim()] ?? STAN_ZAPASOWY;
}

/** "x5 Semi-High" -> 3. Nieznana i pusta wartosc daje priorytet domyslny. */
function parsujImpact(tekst) {
  return IMPACT_NA_PRIORYTET[String(tekst).trim()] ?? PRIORYTET_ZAPASOWY;
}

/** "2 - Moderate" -> 2. Nieznana wartosc zostawia pole puste (zadanie nie liczy sie do XP). */
function parsujTrudnosc(tekst) {
  return TRUDNOSCI[String(tekst).trim()] ?? null;
}

/** "4.0" -> 4. Wartosc nieliczbowa zostawia pole puste. */
function parsujGodziny(tekst) {
  const n = Number(String(tekst).replace(',', '.').trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Obszar bierzemy 1:1 ze zrodla - nasza lista jest po angielsku wlasnie po to. */
function parsujObszar(tekst) {
  const wartosc = String(tekst).trim();
  return wartosc === '' ? OBSZAR_ZAPASOWY : wartosc;
}

/*
  Kolumna relacji `Upstream` -> NAZWA projektu nadrzednego.

  Notion eksportuje relacje w postaci "Nazwa (https://notion.so/...)" - tak bylo
  w kolumnie nawykow w eksporcie Daily Quests. Przyjmujemy OBA warianty:
  z URL-em i bez, bo formatu tego pliku nie dalo sie sprawdzic.

  Usuwamy wylacznie nawias zawierajacy URL, a nie "wszystko od pierwszego (" -
  nazwa projektu sama moze zawierac nawiasy.

  Przy wielu relacjach bierzemy PIERWSZA: zadanie nalezy do jednego projektu.
*/
function parsujUpstream(tekst) {
  const bezLinkow = String(tekst).replace(/\s*\(https?:\/\/[^)]*\)/g, '');
  const pierwsza = bezLinkow.split(',')[0].trim();
  return pierwsza === '' ? null : pierwsza;
}

/**
 * Klucz do dopasowywania projektu z zadaniem.
 * Bez rozrozniania wielkosci liter i bez skrajnych spacji - nazwy sa wpisywane
 * przez czlowieka, wiec roznica w wielkosci liter nie powinna zrywac relacji.
 */
function kluczNazwy(nazwa) {
  return String(nazwa ?? '').trim().toLocaleLowerCase('pl');
}

// --- podprofil: projekty --------------------------------------------------

const PROJEKTY = {
  mapowanie: {
    Name: 'nazwa',
    Status: 'status',
  },
  kolumnyWymagane: ['Name'],
  filtrWierszy: (surowy) => String(surowy.Type).trim() === 'Project',
  transformacje: {
    status: parsujStatus,
  },
  // Wartosc zapasowa PO zmapowaniu - patrz uzasadnienie przy podprofilu zadan.
  poWierszu: (rekord) => {
    if (rekord.status === null || rekord.status === undefined) rekord.status = STAN_ZAPASOWY;
  },
  waliduj: (rekord) =>
    rekord.nazwa && String(rekord.nazwa).trim() !== '' ? null : 'Pusta kolumna "Name".',
};

// --- podprofil: zadania ---------------------------------------------------

/*
  DLACZEGO "Do Date" -> termin, A NIE start_zadania

  W zrodlowym Notion kolumna "Due Date (Optional)" jest wypelniona tylko
  w 4 rekordach na 582, a faktyczna funkcje terminu pelnil "Do Date" -
  to po nim filtrowaly widoki.

  Gdyby "Do Date" trafil na start_zadania, pole `termin` zostaloby puste
  w niemal kazdym rekordzie. Mnoznik terminowosci (lib/nagrody.js) wymaga
  JEDNOCZESNIE terminu i daty zakonczenia, wiec dla wszystkich 468 ukonczonych
  zadan wynosilby neutralne x1 - cala mechanika premii i kary za termin
  bylaby martwa, a XP zaniżone wzgledem rzeczywistosci.

  "Due Date (Optional)" nadpisuje termin tam, gdzie jest wypelnione (te 4 rekordy) -
  jest bardziej konkretne niz "Do Date".

  UWAGA: nadpisania NIE da sie zrobic przez dwa naglowki wskazujace na to samo pole.
  Silnik przetwarza je po kolei i PUSTA data ustawia null, wiec puste
  "Due Date (Optional)" skasowaloby termin wziety z "Do Date" - a puste jest
  w 578 z 582 rekordow. Dlatego data opcjonalna trafia do pola tymczasowego,
  a wybor miedzy nimi robi hook `poWierszu` ponizej.

  `start_zadania` zostaje PUSTE - zrodlo nie ma odpowiednika.
*/
const ZADANIA = {
  mapowanie: {
    Name: 'nazwa',
    Status: 'stan',
    Area: 'obszar',
    'Difficulty Score': 'trudnosc',
    Impact: 'priorytet',
    'Time (Tasks Only)': 'czas_trwania_godziny',

    'Do Date': 'termin',
    'Closing Date': 'czas_zakonczenia',
    // Pole tymczasowe - rozstrzyga je hook `poWierszu`, patrz uzasadnienie wyzej.
    'Due Date (Optional)': '_terminOpcjonalny',

    // Nie trafia do bazy wprost - sluzy do odszukania projektu po nazwie.
    Upstream: '_upstream',
  },
  kolumnyWymagane: ['Name'],
  filtrWierszy: (surowy) => String(surowy.Type).trim() === 'Task',
  polaDatowe: ['termin', 'czas_zakonczenia', '_terminOpcjonalny'],
  /*
    "Due Date (Optional)" wygrywa z "Do Date", ale TYLKO gdy jest wypelnione.
    Pola tymczasowe (zaczynajace sie od _) nie trafiaja do bazy - INSERT
    w routes/import.js wymienia kolumny wprost.
  */
  poWierszu: (rekord) => {
    if (rekord._terminOpcjonalny) rekord.termin = rekord._terminOpcjonalny;

    // Uzupelnienie brakow - patrz komentarz wyzej.
    if (rekord.stan === null || rekord.stan === undefined) rekord.stan = STAN_ZAPASOWY;
    if (rekord.obszar === null || rekord.obszar === undefined) rekord.obszar = OBSZAR_ZAPASOWY;
    if (rekord.priorytet === null || rekord.priorytet === undefined) {
      rekord.priorytet = PRIORYTET_ZAPASOWY;
    }
  },
  transformacje: {
    stan: parsujStatus,
    obszar: parsujObszar,
    trudnosc: parsujTrudnosc,
    priorytet: parsujImpact,
    czas_trwania_godziny: parsujGodziny,
    _upstream: parsujUpstream,
  },
  /*
    WARTOSCI ZAPASOWE MUSZA BYC W `poWierszu`, A NIE W `wartosciDomyslne`.

    `wartosciDomyslne` ustawiaja pole PRZED mapowaniem, ale silnik przy pustej
    komorce zapisuje null (transformacja nie jest wtedy wolana) - i kasuje wartosc
    domyslna. Rekord z pusta kolumna "Impact" wychodzil wiec z priorytetem null,
    czego nie przyjmuje kolumna NOT NULL.

    Tutaj uzupelniamy braki juz PO zmapowaniu, wiec pusta komorka daje wartosc
    zapasowa, a wypelniona - swoja wlasna.
  */
  waliduj: (rekord) =>
    rekord.nazwa && String(rekord.nazwa).trim() !== '' ? null : 'Pusta kolumna "Name".',
};

/*
  Kolumny swiadomie pomijane - w wiekszosci formuly Notion, ktore u nas
  nie maja odpowiednika albo liczymy je sami (XP, waluta, postep).
  Lista sluzy temu, zeby podglad importu nie zasypywal ostrzezeniem
  "kolumny pominiete" dla rzeczy pomijanych CELOWO.
*/
const KOLUMNY_IGNOROWANE = [
  'Type',
  'EXP Multiplier',
  'Base EXP',
  'Base Gold',
  'Punctuality',
  'Reward',
  'Timeliness',
  '% Progress',
  'Days To Go',
  'Downstream',
  'Upstream Progress',
  'Target Quarter',
  'Sub-Type',
  'Tags',
  'Collaborators',
  'Focus',
  'Family Connection',
  'Research',
  'Target #',
  'Completed #',
];

module.exports = {
  PROJEKTY,
  ZADANIA,
  KOLUMNY_IGNOROWANE,
  kluczNazwy,
  // eksportowane do testow
  parsujStatus,
  parsujImpact,
  parsujTrudnosc,
  parsujGodziny,
  parsujUpstream,
  STATUSY,
  IMPACT_NA_PRIORYTET,
};
