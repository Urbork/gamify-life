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
const questLog = require('../config/mapowanie-quest-log');

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

    // obszar CELOWO bez walidacji wobec slownika - tak samo jak przy
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
  INSERT INTO zadania (nazwa, stan, obszar, priorytet, start_zadania, termin, czas_zakonczenia)
  VALUES (@nazwa, @stan, @obszar, @priorytet, @start_zadania, @termin, @czas_zakonczenia)
`);

// Cały import w jednej transakcji: albo wejda wszystkie poprawne wiersze, albo zaden.
const wstawWszystkie = db.transaction((wiersze) => {
  for (const { dane } of wiersze) {
    wstawZadanie.run({
      nazwa: dane.nazwa,
      stan: dane.stan,
      obszar: dane.obszar ?? null,
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

/*
  DEDUPLIKACJA PO DACIE.

  Import dziennika byl wylacznie dopisujacy, wiec powtorne wczytanie nakladajacego
  sie okresu duplikowalo wpisy - a XP liczy sie z kazdego wpisu osobno, wiec razem
  z duplikatami podwajalo sie tez punkty.

  `data` jest naturalnym kluczem wpisu (jeden dzien = jeden wpis), ale NIE ma na niej
  ograniczenia UNIQUE i to zostaje bez zmian: caly import idzie w jednej transakcji,
  wiec pojedyncza kolizja wywracalaby zapis w calosci zamiast go poprawic.
  Dopasowanie robimy wiec zapytaniem, a nie ograniczeniem schematu.

  Gdyby w bazie mimo wszystko byly dwa wpisy o tej samej dacie, bierzemy NAJSTARSZY
  (najnizsze id) - wybor jest arbitralny, ale musi byc powtarzalny, zeby podglad
  pokazywal to samo, co potem zrobi zapis.
*/
const znajdzWpisPoDacie = db.prepare('SELECT * FROM dziennik WHERE data = ? ORDER BY id LIMIT 1');

// Wszystko poza `data` - data jest kluczem dopasowania, wiec nie ma po co jej nadpisywac.
const POLA_AKTUALIZOWALNE = POLA_DZIENNIKA.filter((p) => p !== 'data');

/*
  Pola, ktore plik NAPRAWDE wypelnia.

  PUSTE POLE W PLIKU NIE KASUJE DANYCH. Miedzy eksportem a ponownym importem mozna
  cos dopisac recznie w aplikacji; gdyby import nadpisywal wszystkie kolumny,
  taki dopisek zniknalby bez sladu przy najblizszym wczytaniu pliku.

  Silnik importu zapisuje pusta komorke jako null, wiec wystarczy odsiac null,
  undefined i pusty tekst.
*/
function polaNiepuste(dane) {
  const wynik = {};
  for (const pole of POLA_AKTUALIZOWALNE) {
    const wartosc = dane[pole];
    if (wartosc === null || wartosc === undefined || wartosc === '') continue;
    wynik[pole] = wartosc;
  }
  return wynik;
}

/** Ktore z niepustych pol pliku faktycznie ZMIENIA wartosc juz zapisana. */
function polaDoZmiany(istniejacy, zmiany) {
  return Object.keys(zmiany).filter((pole) => (istniejacy[pole] ?? null) !== zmiany[pole]);
}

/*
  Podsumowanie dla PODGLADU - liczy to samo, co zrobi zapis, ale niczego nie zapisuje.

  Wiersze z tego samego pliku o tej samej dacie sa symulowane po kolei (pierwszy
  wstawia, kolejne aktualizuja), zeby podglad nie obiecywal wiecej nowych wpisow,
  niz naprawde powstanie.
*/
function podsumujDziennik(gotowe) {
  let nowych = 0;
  let doAktualizacji = 0;
  let polZmieni = 0;
  const symulacja = new Map();

  for (const { dane } of gotowe) {
    const istniejacy = symulacja.has(dane.data)
      ? symulacja.get(dane.data)
      : znajdzWpisPoDacie.get(dane.data);

    if (!istniejacy) {
      nowych++;
      symulacja.set(dane.data, { ...polaNiepuste(dane), data: dane.data });
      continue;
    }

    doAktualizacji++;
    const zmiany = polaNiepuste(dane);
    polZmieni += polaDoZmiany(istniejacy, zmiany).length;
    symulacja.set(dane.data, { ...istniejacy, ...zmiany });
  }

  return { nowych, doAktualizacji, polZmieni };
}

const wstawWszystkieWpisy = db.transaction((wiersze) => {
  let nowych = 0;
  let zaktualizowanych = 0;
  let zmienionychPol = 0;

  for (const { dane } of wiersze) {
    const istniejacy = znajdzWpisPoDacie.get(dane.data);

    if (!istniejacy) {
      const parametry = {};
      for (const pole of POLA_DZIENNIKA) parametry[pole] = dane[pole] ?? null;
      wstawWpis.run(parametry);
      nowych++;
      continue;
    }

    zaktualizowanych++;
    const zmiany = polaNiepuste(dane);
    const doZapisu = polaDoZmiany(istniejacy, zmiany);
    if (doZapisu.length === 0) continue; // wpis identyczny - nie ma czego zapisywac

    /*
      SET skladamy dynamicznie, bo kazdy wiersz wypelnia inny zestaw kolumn.
      Nazwy kolumn pochodza z POLA_AKTUALIZOWALNE, czyli z KODU - z pliku ida
      wylacznie wartosci, i to przez parametry. Ta sama zasada co whitelist w PATCH.
    */
    const set = doZapisu.map((pole) => `${pole} = @${pole}`).join(', ');
    db.prepare(`UPDATE dziennik SET ${set} WHERE id = @id`).run({ ...zmiany, id: istniejacy.id });
    zmienionychPol += doZapisu.length;
  }

  return { zaimportowano: nowych + zaktualizowanych, nowych, zaktualizowanych, zmienionychPol };
});

// --- profil quest-log (dwuprzebiegowy) ------------------------------------

const wstawProjekt = db.prepare('INSERT INTO projekty (nazwa, status) VALUES (@nazwa, @status)');
const wstawZadanieQL = db.prepare(`
  INSERT INTO zadania
    (nazwa, stan, obszar, priorytet, trudnosc, czas_trwania_godziny, termin, czas_zakonczenia, projekt_id)
  VALUES
    (@nazwa, @stan, @obszar, @priorytet, @trudnosc, @czas_trwania_godziny, @termin, @czas_zakonczenia, @projekt_id)
`);

/*
  Przygotowanie importu quest-log: DWA PRZEBIEGI po tym samym pliku.

  Przebieg 1 (Type = Project) i przebieg 2 (Type = Task) roznia sie mapowaniem,
  wiec silnik dostaje dwie konfiguracje. Rozdzielaniem wierszy zajmuje sie
  `filtrWierszy` w kazdym z podprofili.

  POWIAZANIE zadan z projektami idzie po NAZWIE, nie po id - w podgladzie projekty
  jeszcze nie istnieja w bazie, wiec nie maja id. Ten sam klucz (nazwa bez skrajnych
  spacji, bez rozrozniania wielkosci liter) sluzy potem przy zapisie.

  Brak dopasowania NIE jest bledem: zadanie wchodzi bez projektu, a licznik
  `bezDopasowania` pokazuje w podgladzie, ilu to dotyczy.
*/
function przygotujQuestLog(tresc) {
  const konfProjekty = { ...questLog.PROJEKTY, kolumnyIgnorowane: questLog.KOLUMNY_IGNOROWANE };
  const konfZadania = { ...questLog.ZADANIA, kolumnyIgnorowane: questLog.KOLUMNY_IGNOROWANE };

  const projekty = przygotuj(tresc, konfProjekty);
  const zadania = przygotuj(tresc, konfZadania);

  // Nazwy projektow z przebiegu 1 - po nich szukamy dopasowania w przebiegu 2.
  const nazwyProjektow = new Set(projekty.gotowe.map((p) => questLog.kluczNazwy(p.dane.nazwa)));

  let zPodpietymProjektem = 0;
  let bezDopasowania = 0;
  const nieznaneProjekty = new Set();

  for (const { dane } of zadania.gotowe) {
    const szukana = dane._upstream;
    if (!szukana) continue; // zadanie bez relacji - luzne, nie liczy sie jako brak dopasowania

    if (nazwyProjektow.has(questLog.kluczNazwy(szukana))) zPodpietymProjektem++;
    else {
      bezDopasowania++;
      nieznaneProjekty.add(szukana);
    }
  }

  return {
    // Pola wspolne dla wszystkich profili - podglad w przegladarce ich uzywa.
    separator: projekty.separator,
    naglowki: projekty.naglowki,
    nieznaneKolumny: zadania.nieznaneKolumny,
    gotowe: [...projekty.gotowe, ...zadania.gotowe],
    odrzucone: [...projekty.odrzucone, ...zadania.odrzucone].sort((a, b) => a.linia - b.linia),

    // Rozbicie specyficzne dla tego profilu.
    questLog: {
      projektow: projekty.gotowe.length,
      zadan: zadania.gotowe.length,
      zPodpietymProjektem,
      bezDopasowania,
      nieznaneProjekty: [...nieznaneProjekty].slice(0, 20),
    },

    // Zachowane osobno, bo zapis musi wstawic projekty PRZED zadaniami.
    _projekty: projekty.gotowe,
    _zadania: zadania.gotowe,
  };
}

/*
  Zapis quest-log. Kolejnosc jest istotna: najpierw projekty, zeby dostaly id,
  potem zadania, ktore te id podpinaja. Calosc w JEDNEJ transakcji - przerwanie
  w polowie nie zostawi zadan wskazujacych na nieistniejace projekty.
*/
const zapiszQuestLog = db.transaction((wynik) => {
  const idProjektu = new Map();

  for (const { dane } of wynik._projekty) {
    const id = wstawProjekt.run({ nazwa: dane.nazwa, status: dane.status }).lastInsertRowid;
    idProjektu.set(questLog.kluczNazwy(dane.nazwa), id);
  }

  for (const { dane } of wynik._zadania) {
    wstawZadanieQL.run({
      nazwa: dane.nazwa,
      stan: dane.stan,
      obszar: dane.obszar ?? null,
      priorytet: dane.priorytet,
      trudnosc: dane.trudnosc ?? null,
      czas_trwania_godziny: dane.czas_trwania_godziny ?? null,
      termin: dane.termin ?? null,
      czas_zakonczenia: dane.czas_zakonczenia ?? null,
      // Brak dopasowania -> zadanie luzne. Nie przerywamy importu.
      projekt_id: dane._upstream ? idProjektu.get(questLog.kluczNazwy(dane._upstream)) ?? null : null,
    });
  }

  return wynik._projekty.length + wynik._zadania.length;
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
/*
  Kazdy profil ma dwie funkcje:
    przygotuj(tresc) -> wynik   (parsowanie i sprawdzenie, NIC nie zapisuje)
    zapisz(wynik)    -> liczba  (zapis w transakcji)

  Wiekszosc profili to jedno przejscie przez plik, wiec `przygotuj` jest cienkim
  opakowaniem na silnik. Profil quest-log potrzebuje dwoch przebiegow i powiazania
  miedzy nimi, dlatego ma wlasna implementacje - patrz nizej.

  Dodanie profilu = jeden wpis ponizej + plik config/mapowanie-*.js.
*/
const PROFILE = {
  zadania: {
    przygotuj: (tresc) => przygotuj(tresc, KONFIGURACJA_ZADAN),
    zapisz: (wynik) => wstawWszystkie(wynik.gotowe),
  },
  dziennik: {
    /*
      Do zwyklego wyniku silnika dokladamy podsumowanie deduplikacji - podglad
      musi pokazac skale nadpisania ZANIM cokolwiek trafi do bazy.
    */
    przygotuj: (tresc) => {
      const wynik = przygotuj(tresc, KONFIGURACJA_DZIENNIKA);
      return { ...wynik, dziennik: podsumujDziennik(wynik.gotowe) };
    },
    zapisz: (wynik) => wstawWszystkieWpisy(wynik.gotowe),
  },
  'notion-quest-log': {
    przygotuj: przygotujQuestLog,
    zapisz: zapiszQuestLog,
  },
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
  const wynik = profil.przygotuj(trescZZadania(req));

  res.json({
    separator: wynik.separator,
    naglowki: wynik.naglowki,
    nieznaneKolumny: wynik.nieznaneKolumny,
    gotowych: wynik.gotowe.length,
    odrzuconych: wynik.odrzucone.length,
    gotowe: wynik.gotowe,
    odrzucone: wynik.odrzucone,
    // Obecne tylko dla profilu quest-log (dwa rodzaje rekordow w jednym pliku).
    questLog: wynik.questLog,
    // Obecne tylko dla profilu dziennika (deduplikacja po dacie).
    dziennik: wynik.dziennik,
  });
});

router.post('/:profil/zatwierdz', (req, res) => {
  const profil = profilZZadania(req);
  const wynik = profil.przygotuj(trescZZadania(req));

  if (wynik.gotowe.length === 0) {
    const e = new Error('Nie ma żadnego poprawnego wiersza do zaimportowania.');
    e.status = 400;
    throw e;
  }

  /*
    Wiekszosc profili tylko DOPISUJE i zwraca sama liczbe wierszy.
    Dziennik dodatkowo AKTUALIZUJE wpisy o istniejacej dacie, wiec zwraca rozbicie
    (nowe / zaktualizowane / zmienione pola) - stad dwa ksztalty odpowiedzi.
  */
  const wynikZapisu = profil.zapisz(wynik);
  const rozbicie = typeof wynikZapisu === 'number' ? null : wynikZapisu;

  res.status(201).json({
    zaimportowano: rozbicie ? rozbicie.zaimportowano : wynikZapisu,
    odrzuconych: wynik.odrzucone.length,
    dziennik: rozbicie,
  });
});

module.exports = router;
