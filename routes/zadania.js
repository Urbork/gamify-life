/**
 * REST API dla tabeli `zadania`.
 *
 *   GET    /api/zadania       - wszystkie zadania
 *   POST   /api/zadania       - nowy rekord z wartosciami domyslnymi, zwraca gotowy wiersz
 *   PATCH  /api/zadania/:id   - aktualizacja wybranych pol (edycja inline w tabeli)
 *   DELETE /api/zadania/:id   - usuniecie
 *
 * Kolumny wyliczane ("Dni do terminu", "Czas trwania") celowo NIE sa tu liczone
 * ani przechowywane - powstaja w przegladarce przy renderowaniu (public/js/zadania.js).
 */

const express = require('express');
const db = require('../db');
const { STANY, PRIORYTETY } = require('../config/slowniki');
// Normalizacja dat siedzi w lib/daty.js, bo korzysta z niej takze import z pliku.
const { znormalizujZnacznikCzasu } = require('../lib/daty');

const router = express.Router();

// Kolumny, ktore wolno zmieniac przez API. Whitelist, a nie blacklist:
// nic spoza tej listy nie trafi do zapytania SQL (id i created_at sa nietykalne).
// Kolejnosc odpowiada kolejnosci kolumn w tabeli na ekranie.
const POLA_EDYTOWALNE = [
  'stan',
  'nazwa',
  'priorytet',
  // trudnosc jest NIEZALEZNA od priorytetu: priorytet mowi jak pilne,
  // trudnosc - ile zadanie bylo warte przy naliczaniu XP.
  'trudnosc',
  'czas_trwania_godziny',
  'klient_kategoria',
  'start_zadania',
  'termin',
  'czas_zakonczenia',
];

// Pola przechowujace znacznik czasu ISO 8601 w postaci YYYY-MM-DDTHH:MM.
const POLA_CZASOWE = ['start_zadania', 'termin', 'czas_zakonczenia'];

const DOZWOLONE_PRIORYTETY = PRIORYTETY.map((p) => p.numer);

// Nazwa nadawana nowo dodanemu zadaniu. Pusty string tez jest dozwolony w bazie
// (kolumna ma DEFAULT ''), ale wiersz z nazwa zastepcza latwiej odnalezc wzrokiem.
const NAZWA_DOMYSLNA = 'Nowe zadanie';

// --- pomocnicze -----------------------------------------------------------

/** Blad z kodem HTTP - lapie go middleware bledow w server.js. */
function blad(status, wiadomosc) {
  const e = new Error(wiadomosc);
  e.status = status;
  return e;
}

/**
 * Sprowadza wartosc z requestu do postaci gotowej do zapisu w SQLite.
 * Rzuca bledem 400, jesli wartosc jest niepoprawna.
 */
function znormalizuj(pole, wartosc) {
  // Priorytet jest liczba, wiec ma wlasna sciezke - reszta funkcji operuje na tekstach.
  if (pole === 'priorytet') {
    /*
      Zawezamy typ PRZED konwersja, bo Number() jest zbyt uczynne:
      Number('') i Number(null) daja 0, a Number(true) daje 1 - wszystkie trzy
      wpadlyby na liste dozwolonych priorytetow jako poprawna wartosc.
      Priorytet nie ma stanu "pusty" - kazde zadanie ma jakis (domyslnie 2).
    */
    const typPoprawny =
      typeof wartosc === 'number' || (typeof wartosc === 'string' && wartosc.trim() !== '');
    const numer = typPoprawny ? Number(wartosc) : NaN;

    if (!Number.isInteger(numer) || !DOZWOLONE_PRIORYTETY.includes(numer)) {
      throw blad(
        400,
        `Niepoprawny priorytet "${wartosc}". Dozwolone: ${DOZWOLONE_PRIORYTETY.join(', ')}.`
      );
    }
    return numer;
  }

  /*
    Trudnosc i czas trwania sa OPCJONALNE - w odroznieniu od priorytetu wolno je
    wyczyscic. Puste pole oznacza po prostu, ze zadanie nie liczy sie do XP.
  */
  if (pole === 'trudnosc' || pole === 'czas_trwania_godziny') {
    if (wartosc === null || wartosc === undefined || wartosc === '') return null;

    // To samo zawezenie typu co wyzej: Number('') i Number(null) daja 0.
    const typPoprawny =
      typeof wartosc === 'number' || (typeof wartosc === 'string' && wartosc.trim() !== '');
    const liczba = typPoprawny ? Number(wartosc) : NaN;

    if (pole === 'trudnosc') {
      if (!Number.isInteger(liczba) || liczba < 1 || liczba > 3) {
        throw blad(400, `Trudność musi być liczbą całkowitą 1-3, otrzymano "${wartosc}".`);
      }
      return liczba;
    }

    // Czas trwania jest REAL - dopuszczamy ulamki godzin (0.5h itd.).
    if (!Number.isFinite(liczba) || liczba < 0) {
      throw blad(400, `Czas trwania musi być liczbą nieujemną, otrzymano "${wartosc}".`);
    }
    return liczba;
  }

  // Puste pole = brak wartosci = NULL w bazie (dotyczy dat i klienta).
  if (wartosc === null || wartosc === undefined || wartosc === '') {
    if (pole === 'nazwa') return '';
    if (pole === 'stan') throw blad(400, 'Pole "stan" nie moze byc puste.');
    return null;
  }

  if (typeof wartosc !== 'string') {
    throw blad(400, `Pole "${pole}" musi byc tekstem.`);
  }

  const tekst = wartosc.trim();
  if (tekst === '') return pole === 'nazwa' ? '' : null;

  if (POLA_CZASOWE.includes(pole)) {
    const znacznik = znormalizujZnacznikCzasu(tekst);
    if (!znacznik) {
      throw blad(
        400,
        `Pole "${pole}": oczekiwano znacznika czasu YYYY-MM-DDTHH:MM, otrzymano "${tekst}".`
      );
    }
    return znacznik;
  }

  // `stan` walidujemy twardo - to zamknieta lista, od ktorej zaleza przyszle statystyki.
  if (pole === 'stan' && !STANY.includes(tekst)) {
    throw blad(400, `Nieznany stan "${tekst}". Dozwolone: ${STANY.join(', ')}.`);
  }

  // `klient_kategoria` NIE jest walidowany wobec listy - to lista podpowiedzi,
  // a stare rekordy maja prawo zawierac wartosci, ktorych juz nie ma w slowniku.

  return tekst;
}

/** Zamienia :id z URL-a na liczbe albo rzuca bledem 400. */
function idZParametru(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw blad(400, 'Niepoprawne id zadania.');
  return id;
}

// --- zapytania SQL (przygotowane raz, potem tylko wykonywane) --------------

// Sortowanie dzieje sie w przegladarce (public/js/zadania.js), wiec z bazy bierzemy
// dane w najprostszej, przewidywalnej kolejnosci - po id.
const pobierzWszystkie = db.prepare('SELECT * FROM zadania ORDER BY id');
const pobierzJedno = db.prepare('SELECT * FROM zadania WHERE id = ?');
/*
  Nowe zadanie startuje "dzisiaj". Date wyznacza SQLite po stronie SERWERA
  (strftime z 'localtime'), a nie przegladarka - dzieki temu wynik nie zalezy od
  strefy czasowej ani od zegara komputera, z ktorego akurat korzystasz.
  Godzina to 00:00: data jest ustalona, konkretna pora to juz Twoja decyzja.
*/
const wstawNowe = db.prepare(`
  INSERT INTO zadania (nazwa, start_zadania)
  VALUES (?, strftime('%Y-%m-%dT00:00', 'now', 'localtime'))
`);
const usun = db.prepare('DELETE FROM zadania WHERE id = ?');

// --- trasy ----------------------------------------------------------------

router.get('/', (req, res) => {
  res.json(pobierzWszystkie.all());
});

router.post('/', (req, res) => {
  // Nowy wiersz dostaje nazwe zastepcza, stan i priorytet domyslny (z DEFAULT kolumny)
  // oraz dzisiejsza date startu. Reszte uzupelniasz w tabeli.
  // Frontend po dodaniu zaznacza nazwe, wiec pierwsze wpisane znaki ja nadpisuja.
  const wynik = wstawNowe.run(NAZWA_DOMYSLNA);
  res.status(201).json(pobierzJedno.get(wynik.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const id = idZParametru(req);

  if (!pobierzJedno.get(id)) throw blad(404, `Nie ma zadania o id ${id}.`);

  // Bierzemy z body tylko pola z whitelisty i normalizujemy ich wartosci.
  const doZapisu = {};
  for (const pole of POLA_EDYTOWALNE) {
    if (Object.prototype.hasOwnProperty.call(req.body, pole)) {
      doZapisu[pole] = znormalizuj(pole, req.body[pole]);
    }
  }

  const pola = Object.keys(doZapisu);
  if (pola.length === 0) throw blad(400, 'Brak pol do aktualizacji.');

  // Nazwy kolumn pochodza z whitelisty, wiec sklejenie ich w SQL jest bezpieczne.
  // Wartosci ida wylacznie przez parametry (@pole), nigdy przez konkatenacje.
  const przypisania = pola.map((p) => `${p} = @${p}`).join(', ');
  db.prepare(`UPDATE zadania SET ${przypisania} WHERE id = @id`).run({ ...doZapisu, id });

  res.json(pobierzJedno.get(id));
});

router.delete('/:id', (req, res) => {
  const id = idZParametru(req);
  const wynik = usun.run(id);
  if (wynik.changes === 0) throw blad(404, `Nie ma zadania o id ${id}.`);
  res.status(204).end();
});

module.exports = router;
