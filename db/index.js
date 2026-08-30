/**
 * Polaczenie z baza SQLite.
 *
 * better-sqlite3 jest SYNCHRONICZNE - kazde zapytanie zwraca wynik od razu,
 * bez callbackow i await. Dla lokalnej aplikacji jednouzytkownikowej to zaleta:
 * kod w routach czyta sie jak zwykle funkcje, nie ma wyscigow.
 *
 * Modul eksportuje jedna, wspolna instancje polaczenia (Node cache'uje moduly),
 * wiec kazdy modul (zadania, dziennik, projekty, statystyki, postac) robi po prostu:
 *   const db = require('../db');
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { uruchomMigracje } = require('./migracje');

/*
  Baza lezy w data/baza.db w folderze projektu - przezywa restart komputera.

  Zmienna srodowiskowa BAZA_DANYCH pozwala wskazac inny plik. Sluzy do tego,
  zeby smoke test (npm run test:smoke) uruchamial serwer na wlasnej, tymczasowej
  bazie i w zaden sposob nie dotykal prawdziwych danych. W normalnym uzyciu
  zmiennej sie nie ustawia.
*/
const SCIEZKA_BAZY = process.env.BAZA_DANYCH || path.join(__dirname, '..', 'data', 'baza.db');
const KATALOG_DANYCH = path.dirname(SCIEZKA_BAZY);

// Tworzymy katalog przy pierwszym uruchomieniu (recursive = nie wywala sie, gdy juz istnieje).
fs.mkdirSync(KATALOG_DANYCH, { recursive: true });

const db = new Database(SCIEZKA_BAZY);

// WAL = Write-Ahead Logging: szybszy zapis i odczyt rownolegly z zapisem.
// Efekt uboczny: obok baza.db pojawiaja sie pliki baza.db-wal i baza.db-shm. To normalne.
db.pragma('journal_mode = WAL');

// Klucze obce sa w SQLite domyslnie WYLACZONE i trzeba je wlaczac przy kazdym polaczeniu.
// Teraz jeszcze ich nie uzywamy, ale przydadza sie przy dzienniku (np. wpis -> zadanie).
db.pragma('foreign_keys = ON');

/*
  Migracje uruchamiamy TUTAJ, zaraz po otwarciu polaczenia, a nie w server.js.
  Powod jest praktyczny: moduly w routes/ przygotowuja swoje zapytania (db.prepare)
  juz na poziomie pliku, czyli w chwili require(). Gdyby migracje szly dopiero z server.js,
  wystarczylaby zla kolejnosc require, zeby serwer wstal z bledem "no such table".
  Tak schemat jest gotowy, zanim ktokolwiek dostanie do rak `db`.
*/
uruchomMigracje(db);

// Sciezke do pliku bazy mozna potem odczytac przez db.name (wlasciwosc better-sqlite3).
module.exports = db;
