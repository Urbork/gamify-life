/**
 * Migracje schematu bazy.
 *
 * JAK TO DZIALA
 * SQLite trzyma w pliku bazy licznik `PRAGMA user_version` (liczba calkowita, domyslnie 0).
 * Traktujemy go jako "ile migracji z ponizszej listy zostalo juz wykonanych".
 * Przy starcie serwera uruchamiamy tylko te migracje, ktorych jeszcze nie bylo,
 * kazda w transakcji, i podbijamy licznik.
 *
 * JAK DODAC ZMIANE W SCHEMACIE (np. przy dzienniku albo nowej kolumnie w zadaniach)
 * 1. Dopisz nowa funkcje NA KONCU tablicy MIGRACJE.
 * 2. Uruchom serwer - migracja wykona sie sama, raz.
 * NIGDY nie edytuj ani nie usuwaj migracji, ktora juz sie u Ciebie wykonala -
 * w Twojej bazie i tak jej nie cofniesz, a licznik przestanie sie zgadzac.
 */

/*
  UWAGA: ten modul CELOWO nie robi require('./index').
  To db/index.js wywoluje uruchomMigracje(db) tuz po otwarciu polaczenia i przekazuje
  je jako argument. Dzieki temu nie ma zaleznosci cyklicznej miedzy tymi plikami.
*/

/*
  W migracjach wartosci domyslne sa wpisane WPROST (np. 'Plan', 2), a nie brane
  ze stalych z config/slowniki.js. Migracja to zapis historii - ma znaczyc dokladnie
  to samo za dwa lata, nawet jesli slownik w miedzyczasie sie zmieni.
*/

const MIGRACJE = [
  // --- 1: tabela zadan ---------------------------------------------------
  (db) => {
    db.exec(`
      CREATE TABLE zadania (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        -- NOT NULL, ale z pustym stringiem jako domyslna wartoscia: przycisk
        -- "+ Dodaj zadanie" tworzy najpierw pusty wiersz, ktory dopiero wypelniasz.
        nazwa            TEXT NOT NULL DEFAULT '',
        stan             TEXT NOT NULL DEFAULT 'Plan',
        klient_kategoria TEXT,
        -- Daty trzymamy jako TEXT w formacie YYYY-MM-DD. SQLite nie ma typu DATE,
        -- a ten format sortuje sie leksykograficznie tak samo jak chronologicznie
        -- i wchodzi wprost do <input type="date">.
        start_zadania    TEXT,
        termin           TEXT,
        czas_zakonczenia TEXT,
        created_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      )
    `);

    // Indeksy pod najczestsze sortowania/filtry (przydadza sie przy statystykach).
    db.exec(`CREATE INDEX idx_zadania_termin ON zadania (termin)`);
    db.exec(`CREATE INDEX idx_zadania_stan ON zadania (stan)`);
  },

  // --- 2: priorytet + daty z godzina -------------------------------------
  (db) => {
    // Priorytet 0-4 (patrz PRIORYTETY w config/slowniki.js). SQLite pozwala dodac
    // kolumne NOT NULL, o ile ma wartosc domyslna - istniejace wiersze dostaja 2.
    db.exec(`ALTER TABLE zadania ADD COLUMN priorytet INTEGER NOT NULL DEFAULT 2`);

    /*
      Daty: YYYY-MM-DD  ->  YYYY-MM-DDTHH:MM (ISO 8601).

      Kolumny sa typu TEXT, wiec zmienia sie FORMAT DANYCH, a nie typ kolumny -
      przebudowa tabeli nie jest potrzebna, wystarczy UPDATE.

      Warunek length(...) = 10 sprawia, ze ruszamy wylacznie wartosci w starym
      formacie. Gdyby migracja przerwala sie w polowie (albo ktos uruchomil ja
      recznie drugi raz), 'T00:00' nie doklei sie po raz drugi.
    */
    for (const kolumna of ['start_zadania', 'termin', 'czas_zakonczenia']) {
      db.exec(`
        UPDATE zadania
           SET ${kolumna} = ${kolumna} || 'T00:00'
         WHERE ${kolumna} IS NOT NULL
           AND length(${kolumna}) = 10
      `);
    }
  },

  // --- 3: tabela dziennika -----------------------------------------------
  (db) => {
    db.exec(`
      CREATE TABLE dziennik (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,

        -- Data wpisu w formacie YYYY-MM-DD (bez godziny - wpis dotyczy calego dnia).
        -- CELOWO BEZ UNIQUE: jeden dzien moze miec wiecej niz jeden wpis, a import
        -- idzie w jednej transakcji, wiec pojedyncza kolizja wywalilaby caly plik.
        data             TEXT NOT NULL,

        pobudka          TEXT,     -- HH:MM
        godziny_snu      REAL,     -- REAL, bo sen bywa liczony w polowkach godzin
        jakosc_snu       INTEGER,  -- 1-5
        stres            INTEGER,  -- 0-5 (inna skala niz reszta - 0 = bardzo wysoki)
        nastroj          INTEGER,  -- 1-5
        intencjonalnosc  INTEGER,  -- 1-5

        trzy_slowa       TEXT,
        nawyki           TEXT,     -- nazwy oddzielone przecinkami

        wdziecznosc      TEXT,
        bledy            TEXT,
        rozmowa          TEXT,
        co_poszlo_dobrze TEXT,
        jutro_wazne      TEXT,
        do_przemyslenia  TEXT,

        sniadanie        TEXT,
        obiad            TEXT,
        kolacja          TEXT,

        created_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      )
    `);

    // Wpisy oglada sie i sortuje niemal wylacznie po dacie.
    db.exec(`CREATE INDEX idx_dziennik_data ON dziennik (data)`);
  },

  // --- 4: slownik nawykow ------------------------------------------------
  (db) => {
    /*
      Lista nawykow przenosi sie ze statycznej tablicy w config/slowniki.js
      do tabeli, zeby dalo sie ja edytowac z poziomu aplikacji.

      Kolumna `dziennik.nawyki` NADAL jest zwyklym tekstem z nazwami rozdzielonymi
      przecinkami - celowo nie robimy tabeli laczacej. Powod: wpisy maja prawo
      zawierac nazwy historyczne, ktorych juz nie ma w slowniku (usuniety nawyk
      nie znika z przeszlosci), a klucz obcy by to uniemozliwil.
    */
    db.exec(`
      CREATE TABLE nawyki_slownik (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        -- UNIQUE pilnuje, zeby nie dalo sie zalozyc dwoch pozycji o tej samej nazwie.
        -- Rozroznianie wielkosci liter obsluguje osobno routes/nawyki.js.
        nazwa TEXT NOT NULL UNIQUE
      )
    `);

    /*
      Zasiew: 15 nazw znalezionych w danych przy imporcie z Notion.

      NIE zasiewamy "Untitled" - to artefakt eksportu (jedno wystapienie),
      wiec przy okazji pozbywamy sie go z listy wyboru. Wpisy dziennika,
      ktore go zawieraja, zostaja nietkniete - historia ma byc wierna.

      Wartosci wpisane WPROST, nie brane z config/slowniki.js: migracja to zapis
      historii i ma znaczyc to samo za dwa lata, nawet gdy slownik sie zmieni.
    */
    const wstaw = db.prepare('INSERT INTO nawyki_slownik (nazwa) VALUES (?)');
    const NAZWY = [
      'Book or Movie',
      'Breathing Exercises',
      'Daily commit',
      'Drawing',
      'Drink Water',
      'Duolingo (road to 3 years)',
      'Exercise/Tai Chi/Swimming',
      'Go For A Walk',
      'Literalnie',
      'Proktis-M',
      'Sprawdzić Slack i Discord',
      'Vitamins',
      'Zapisać emocje (popołudnie)',
      'Zapisać emocje (rano)',
      'Zapisać emocje (wieczór)',
    ];
    for (const nazwa of NAZWY) wstaw.run(nazwa);
  },

  // --- 5: trudnosc i czas zadania + tabela zakupow -----------------------
  (db) => {
    /*
      Dwa nowe pola zadania, oba OPCJONALNE - stad brak NOT NULL i brak wartosci
      domyslnej. Zadanie bez nich jest poprawne, po prostu nie liczy sie do XP.

      `trudnosc` jest CALKOWICIE NIEZALEZNA od `priorytet`. Priorytet mowi,
      jak pilne jest zadanie (zarzadzanie), trudnosc - ile bylo warte (naliczanie XP).
      Oba zostaja.
    */
    db.exec(`ALTER TABLE zadania ADD COLUMN trudnosc INTEGER`);
    db.exec(`ALTER TABLE zadania ADD COLUMN czas_trwania_godziny REAL`);

    /*
      Zakupy to JEDYNA trwale zapisana czesc systemu nagrod.

      Cala reszta (XP, poziom, prestiz, waluta zarobiona) liczy sie NA ZYWO
      z zadan i wpisow dziennika, wiec poprawienie starego zadania automatycznie
      poprawia wynik historyczny. Wydawanie waluty jest zdarzeniem, ktorego
      nie da sie odtworzyc z niczego innego - dlatego tabela.
    */
    db.exec(`
      CREATE TABLE zakupy (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        nazwa TEXT NOT NULL,
        koszt INTEGER NOT NULL,
        data  TEXT NOT NULL DEFAULT (date('now', 'localtime'))
      )
    `);
  },

  // --- 6: obszar zamiast klienta + projekty ------------------------------
  (db) => {
    /*
      KOLEJNOSC KROKOW JEST WYMUSZONA:
      1. zmiana nazwy kolumny - zeby reszta tej migracji i wszystkie przyszle
         widzialy juz finalna nazwe;
      2. utworzenie tabeli `projekty`;
      3. dopiero potem kolumna z kluczem obcym - klucz nie moze wskazywac
         na tabele, ktora jeszcze nie istnieje.
    */

    /*
      Pole zmienia znaczenie: bylo lista klientow, jest lista obszarow zycia.
      RENAME COLUMN zachowuje dane, wiec stare wartosci (Alfaram, Nuva...)
      zostaja w bazie. Wobec nowej listy pokaza sie w interfejsie z dopiskiem
      "(spoza listy)" - pole nadal NIE jest walidowane scisle.
    */
    db.exec(`ALTER TABLE zadania RENAME COLUMN klient_kategoria TO obszar`);

    db.exec(`
      CREATE TABLE projekty (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        nazwa      TEXT NOT NULL,
        -- Te same piec wartosci co stan zadania - jedna skala dla obu poziomow.
        status     TEXT NOT NULL DEFAULT 'Plan',
        opis       TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      )
    `);

    /*
      ON DELETE SET NULL: usuniecie projektu ODPINA zadania, a nie kasuje ich.
      Zadanie jest bytem samodzielnym, projekt tylko kontenerem.

      Dziala pod dwoma warunkami, oba sa spelnione:
      - PRAGMA foreign_keys = ON przy kazdym polaczeniu (db/index.js),
      - ADD COLUMN z REFERENCES wymaga domyslnej wartosci NULL - nasza taka jest.
    */
    db.exec(`
      ALTER TABLE zadania
        ADD COLUMN projekt_id INTEGER REFERENCES projekty(id) ON DELETE SET NULL
    `);

    db.exec(`CREATE INDEX idx_zadania_projekt ON zadania (projekt_id)`);
  },

  // --- 7: tutaj dopisz kolejna migracje ----------------------------------
];

function uruchomMigracje(db) {
  const wykonane = db.pragma('user_version', { simple: true });

  if (wykonane > MIGRACJE.length) {
    // Baza jest nowsza niz kod - najczesciej po cofnieciu sie do starszej wersji projektu.
    throw new Error(
      `Baza jest w wersji ${wykonane}, a kod zna tylko ${MIGRACJE.length} migracji. ` +
        'Zaktualizuj kod projektu.'
    );
  }

  for (let i = wykonane; i < MIGRACJE.length; i++) {
    const numer = i + 1;
    // Transakcja: albo migracja przejdzie w calosci, albo baza zostanie nietknieta.
    db.transaction(() => {
      MIGRACJE[i](db);
      db.pragma(`user_version = ${numer}`);
    })();
    console.log(`[db] wykonano migracje ${numer}`);
  }
}

module.exports = { uruchomMigracje };
