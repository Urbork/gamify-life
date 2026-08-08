/**
 * Import zadan z pliku CSV - warstwa HTTP.
 *
 *   POST /api/import/:profil/podglad    - parsuje i sprawdza plik, NIC nie zapisuje (dry-run)
 *   POST /api/import/:profil/zatwierdz  - parsuje ten sam plik jeszcze raz i zapisuje wiersze
 *
 * :profil to jeden z kluczy obiektu PROFILE nizej (zadania, dziennik).
 * Oba endpointy przyjmuja JSON { tresc: "<zawartosc pliku CSV>" }.
 *
 * DLACZEGO ZATWIERDZENIE PRZESYLA PLIK PONOWNIE, A NIE GOTOWE WIERSZE Z PODGLADU
 * 1. Bezpieczenstwo: gdyby zapis przyjmowal sparsowane rekordy od klienta, mozna by
 *    tym kanalem wstawic do bazy cokolwiek, z pominieciem calej walidacji.
 * 2. Prostota: serwer nie trzyma zadnego stanu miedzy krokami - nie ma tokenow,
 *    wygasania podgladu ani sprzatania po porzuconych importach.
 * Parsowanie jest deterministyczne, wiec ten sam plik daje ten sam wynik.
 *
 * DLACZEGO NIE MA MULTERA ANI MULTIPART
 * Frontend czyta plik przez File.text() i wysyla jego tresc jako zwykly JSON.
 * Zadna dodatkowa zaleznosc nie jest potrzebna.
 */

const express = require('express');
const db = require('../db');
const { STANY } = require('../config/slowniki');
const { przygotujImport, BladPliku } = require('../lib/import');
const konfiguracja = require('../config/mapowanie-importu');
const dziennikProfil = require('../config/mapowanie-dziennika');

const router = express.Router();

/*
  Podniesiony limit TYLKO dla importu - domyslne 100kb Expressa nie mieszcza nawet
  sredniego eksportu z Notion (kilkaset kB to norma, pelny eksport potrafi miec kilka MB),
  a reszta API nie ma powodu przyjmowac megabajtowych cial zadan.

  20mb wybrane Z ZAPASEM, zeby kolejne, wieksze eksporty tez przechodzily bez
  wracania do tego pliku. Plik CSV to czysty tekst, wiec 20mb to okolice
  setek tysiecy wierszy - dla lokalnej aplikacji granica nieosiagalna w praktyce.

  Zeby ten limit dzialal, router MUSI byc zamontowany przed globalnym
  express.json() w server.js - patrz komentarz tam.
*/
router.use(express.json({ limit: '20mb' }));

const KONFIGURACJA_ZADAN = {
  mapowanie: konfiguracja.MAPOWANIE_KOLUMN,
  kolumnyWymagane: konfiguracja.KOLUMNY_WYMAGANE,
  kolumnyIgnorowane: konfiguracja.KOLUMNY_IGNOROWANE,
  polaDatowe: konfiguracja.POLA_DATOWE,
  wartosciDomyslne: konfiguracja.WARTOSCI_DOMYSLNE,

  /**
   * Walidacja wiersza specyficzna dla tabeli `zadania`.
   * Zwraca powod odrzucenia albo null, gdy wiersz jest w porzadku.
   * (Bledy formatu dat wychwytuje wczesniej lib/import.js.)
   */
  waliduj(rekord) {
    if (!rekord.nazwa || rekord.nazwa.trim() === '') {
      return 'Pusta nazwa zadania.';
    }

    // Porownanie DOKLADNE, z uwzglednieniem wielkosci liter - stan jest zamknieta
    // lista, od ktorej zaleza sortowanie i przyszle statystyki.
    if (!STANY.includes(rekord.stan)) {
      return `Nieznany stan "${rekord.stan ?? ''}". Dozwolone: ${STANY.join(', ')}.`;
    }

    // klient_kategoria CELOWO bez walidacji wobec slownika - tak samo jak przy
    // recznej edycji w tabeli. Wartosc spoza listy zostaje zaimportowana,
    // a w interfejsie pokaze sie z dopiskiem "(spoza listy)".
    return null;
  },
};

/** Wyciaga tresc pliku z ciala zadania albo rzuca bledem 400. */
function trescZZadania(req) {
  const tresc = req.body && req.body.tresc;
  if (typeof tresc !== 'string' || tresc.trim() === '') {
    const e = new Error('Brak treści pliku (oczekiwano pola "tresc" z zawartością CSV).');
    e.status = 400;
    throw e;
  }
  return tresc;
}

/** Uruchamia przygotowanie importu, zamieniajac blad calego pliku na status 400. */
function przygotuj(tresc, konfiguracjaProfilu) {
  try {
    return przygotujImport(tresc, konfiguracjaProfilu);
  } catch (e) {
    if (e instanceof BladPliku) {
      e.status = 400;
    }
    throw e;
  }
}

// Kolumny zapisu sa wypisane TUTAJ, w kodzie. Z pliku pochodza wylacznie wartosci -
// nazwa kolumny nigdy nie trafia do SQL-a z zewnatrz (ta sama zasada co whitelist w PATCH).
const wstawZadanie = db.prepare(`
  INSERT INTO zadania (nazwa, stan, klient_kategoria, priorytet, start_zadania, termin, czas_zakonczenia)
  VALUES (@nazwa, @stan, @klient_kategoria, @priorytet, @start_zadania, @termin, @czas_zakonczenia)
`);

// Cały import w jednej transakcji: albo wejda wszystkie poprawne wiersze, albo zaden.
const wstawWszystkie = db.transaction((wiersze) => {
  for (const { dane } of wiersze) {
    wstawZadanie.run({
      nazwa: dane.nazwa,
      stan: dane.stan,
      klient_kategoria: dane.klient_kategoria ?? null,
      priorytet: dane.priorytet,
      start_zadania: dane.start_zadania ?? null,
      termin: dane.termin ?? null,
      czas_zakonczenia: dane.czas_zakonczenia ?? null,
    });
  }
  return wiersze.length;
});

// --- profil dziennika -----------------------------------------------------

const KONFIGURACJA_DZIENNIKA = {
  mapowanie: dziennikProfil.MAPOWANIE_KOLUMN,
  kolumnyWymagane: dziennikProfil.KOLUMNY_WYMAGANE,
  kolumnyIgnorowane: dziennikProfil.KOLUMNY_IGNOROWANE,
  // Rozbieranie kolumn Notion na czesci - patrz config/mapowanie-dziennika.js.
  transformacje: dziennikProfil.TRANSFORMACJE,
  wartosciPuste: dziennikProfil.WARTOSCI_PUSTE,
  waliduj: dziennikProfil.waliduj,
};

const wstawWpis = db.prepare(`
  INSERT INTO dziennik (
    data, pobudka, godziny_snu, jakosc_snu, stres, nastroj, intencjonalnosc,
    trzy_slowa, nawyki, wdziecznosc, bledy, rozmowa,
    co_poszlo_dobrze, jutro_wazne, do_przemyslenia, sniadanie, obiad, kolacja
  ) VALUES (
    @data, @pobudka, @godziny_snu, @jakosc_snu, @stres, @nastroj, @intencjonalnosc,
    @trzy_slowa, @nawyki, @wdziecznosc, @bledy, @rozmowa,
    @co_poszlo_dobrze, @jutro_wazne, @do_przemyslenia, @sniadanie, @obiad, @kolacja
  )
`);

// Pola wypisane wprost - z pliku pochodza wylacznie wartosci, nigdy nazwy kolumn.
const POLA_DZIENNIKA = [
  'data',
  'pobudka',
  'godziny_snu',
  'jakosc_snu',
  'stres',
  'nastroj',
  'intencjonalnosc',
  'trzy_slowa',
  'nawyki',
  'wdziecznosc',
  'bledy',
  'rozmowa',
  'co_poszlo_dobrze',
  'jutro_wazne',
  'do_przemyslenia',
  'sniadanie',
  'obiad',
  'kolacja',
];

const wstawWszystkieWpisy = db.transaction((wiersze) => {
  for (const { dane } of wiersze) {
    const parametry = {};
    for (const pole of POLA_DZIENNIKA) parametry[pole] = dane[pole] ?? null;
    wstawWpis.run(parametry);
  }
  return wiersze.length;
});

// --- rejestr profili ------------------------------------------------------

/*
  Jeden router obsluguje WSZYSTKIE profile importu. To celowe: router jest juz
  zamontowany przed globalnym express.json() w server.js, wiec kazdy kolejny profil
  dziedziczy poprawna pozycje montowania automatycznie. Osobny router na profil
  oznaczalby kolejne miejsce, w ktorym mozna te kolejnosc pomylic - a objawem
  bledu jest ciche 413 przy wiekszym pliku.

  Dodanie profilu = jeden wpis ponizej + plik config/mapowanie-*.js.
*/
const PROFILE = {
  zadania: { konfiguracja: KONFIGURACJA_ZADAN, zapisz: wstawWszystkie },
  dziennik: { konfiguracja: KONFIGURACJA_DZIENNIKA, zapisz: wstawWszystkieWpisy },
};

/** Zwraca profil z URL-a albo rzuca bledem 404 z lista dostepnych. */
function profilZZadania(req) {
  const profil = PROFILE[req.params.profil];
  if (!profil) {
    const e = new Error(
      `Nieznany profil importu "${req.params.profil}". Dostępne: ${Object.keys(PROFILE).join(', ')}.`
    );
    e.status = 404;
    throw e;
  }
  return profil;
}

// --- trasy ----------------------------------------------------------------

router.post('/:profil/podglad', (req, res) => {
  const profil = profilZZadania(req);
  const wynik = przygotuj(trescZZadania(req), profil.konfiguracja);

  res.json({
    separator: wynik.separator,
    naglowki: wynik.naglowki,
    nieznaneKolumny: wynik.nieznaneKolumny,
    gotowych: wynik.gotowe.length,
    odrzuconych: wynik.odrzucone.length,
    gotowe: wynik.gotowe,
    odrzucone: wynik.odrzucone,
  });
});

router.post('/:profil/zatwierdz', (req, res) => {
  const profil = profilZZadania(req);
  const wynik = przygotuj(trescZZadania(req), profil.konfiguracja);

  if (wynik.gotowe.length === 0) {
    const e = new Error('Nie ma żadnego poprawnego wiersza do zaimportowania.');
    e.status = 400;
    throw e;
  }

  // Wiersze sa DOPISYWANE - nic istniejacego nie jest nadpisywane ani usuwane.
  const zaimportowano = profil.zapisz(wynik.gotowe);

  res.status(201).json({ zaimportowano, odrzuconych: wynik.odrzucone.length });
});

module.exports = router;
