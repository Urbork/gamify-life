/**
 * REST API dla tabeli `dziennik`.
 *
 *   GET    /api/dziennik       - wszystkie wpisy
 *   POST   /api/dziennik       - nowy wpis (data = dzisiaj wg serwera)
 *   PATCH  /api/dziennik/:id   - aktualizacja wybranych pol (edycja inline w tabeli)
 *   DELETE /api/dziennik/:id   - usuniecie
 *
 * Ten sam wzorzec co routes/zadania.js: whitelist kolumn, normalizacja wartosci,
 * bledy z kodem HTTP lapane przez wspolny middleware w server.js.
 */

const express = require('express');
const db = require('../db');

const router = express.Router();

/*
  WAZNE: ten router jest montowany w server.js PRZED globalnym express.json(),
  dlatego musi mieć wlasny parser ciala. Gdyby go tu zabraklo, req.body byloby
  undefined i kazdy PATCH konczylby sie bledem.

  Limit 1mb zamiast domyslnych 100kb: wpis dziennika to kilkanascie pol tekstowych,
  a pojedyncza refleksja potrafi byc dluga. Import ma swoj wlasny, znacznie wyzszy
  limit w routes/import.js.
*/
router.use(express.json({ limit: '1mb' }));

// Kolumny, ktore wolno zmieniac przez API. Whitelist, a nie blacklist:
// nic spoza tej listy nie trafi do zapytania SQL (id i created_at sa nietykalne).
const POLA_EDYTOWALNE = [
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
  Pola liczbowe i ich dozwolone zakresy.
  Uwaga na `stres`: skala zaczyna sie od 0 (0 = bardzo wysoki stres, 5 = brak stresu),
  inaczej niz pozostale oceny 1-5. Tak jest w zrodle i tego nie zmieniamy.
*/
const ZAKRESY = {
  jakosc_snu: { min: 1, max: 5, calkowite: true },
  stres: { min: 0, max: 5, calkowite: true },
  nastroj: { min: 1, max: 5, calkowite: true },
  intencjonalnosc: { min: 1, max: 5, calkowite: true },
  godziny_snu: { min: 0, max: 24, calkowite: false },
};

// --- pomocnicze -----------------------------------------------------------

/** Blad z kodem HTTP - lapie go middleware bledow w server.js. */
function blad(status, wiadomosc) {
  const e = new Error(wiadomosc);
  e.status = status;
  return e;
}

/** Czy rok-miesiac-dzien to istniejaca data? Odrzuca np. 2026-02-30. */
function poprawnaData(tekst) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tekst);
  if (!m) return false;
  const [rok, miesiac, dzien] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(rok, miesiac - 1, dzien));
  return d.getUTCFullYear() === rok && d.getUTCMonth() === miesiac - 1 && d.getUTCDate() === dzien;
}

/**
 * Sprowadza wartosc z requestu do postaci gotowej do zapisu w SQLite.
 * Rzuca bledem 400, jesli wartosc jest niepoprawna.
 */
function znormalizuj(pole, wartosc) {
  // Pola liczbowe maja wlasna sciezke - reszta funkcji operuje na tekstach.
  if (pole in ZAKRESY) {
    // Puste = wyczyszczenie oceny. Wpis bez ocen jest normalny.
    if (wartosc === null || wartosc === undefined || wartosc === '') return null;

    /*
      Zawezamy typ PRZED konwersja, bo Number() jest zbyt uczynne:
      Number(null) i Number('') daja 0, Number(true) daje 1 - wszystkie trzy
      zmiescilyby sie w dozwolonym zakresie jako "poprawna" ocena.
    */
    const typPoprawny =
      typeof wartosc === 'number' || (typeof wartosc === 'string' && wartosc.trim() !== '');
    const liczba = typPoprawny ? Number(wartosc) : NaN;

    const { min, max, calkowite } = ZAKRESY[pole];
    const wZakresie = Number.isFinite(liczba) && liczba >= min && liczba <= max;
    if (!wZakresie || (calkowite && !Number.isInteger(liczba))) {
      throw blad(
        400,
        `Pole "${pole}": oczekiwano liczby ${calkowite ? 'całkowitej ' : ''}z zakresu ${min}-${max}, otrzymano "${wartosc}".`
      );
    }
    return liczba;
  }

  // Puste pole = brak wartosci = NULL w bazie.
  if (wartosc === null || wartosc === undefined || wartosc === '') {
    if (pole === 'data') throw blad(400, 'Pole "data" nie może być puste.');
    return null;
  }

  if (typeof wartosc !== 'string') {
    throw blad(400, `Pole "${pole}" musi być tekstem.`);
  }

  const tekst = wartosc.trim();
  if (tekst === '') {
    if (pole === 'data') throw blad(400, 'Pole "data" nie może być puste.');
    return null;
  }

  if (pole === 'data' && !poprawnaData(tekst)) {
    throw blad(400, `Pole "data": oczekiwano daty w formacie YYYY-MM-DD, otrzymano "${tekst}".`);
  }

  if (pole === 'pobudka' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(tekst)) {
    throw blad(400, `Pole "pobudka": oczekiwano godziny w formacie HH:MM, otrzymano "${tekst}".`);
  }

  return tekst;
}

/** Zamienia :id z URL-a na liczbe albo rzuca bledem 400. */
function idZParametru(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw blad(400, 'Niepoprawne id wpisu.');
  return id;
}

// --- zapytania SQL (przygotowane raz, potem tylko wykonywane) --------------

// Sortowanie dzieje sie w przegladarce, wiec z bazy bierzemy dane w kolejnosci id.
const pobierzWszystkie = db.prepare('SELECT * FROM dziennik ORDER BY id');
const pobierzJeden = db.prepare('SELECT * FROM dziennik WHERE id = ?');
// Nowy wpis dotyczy dnia dzisiejszego - date wyznacza SERWER, tak samo jak przy zadaniach.
const wstawNowy = db.prepare(
  `INSERT INTO dziennik (data) VALUES (strftime('%Y-%m-%d', 'now', 'localtime'))`
);
const usun = db.prepare('DELETE FROM dziennik WHERE id = ?');

// --- trasy ----------------------------------------------------------------

router.get('/', (req, res) => {
  res.json(pobierzWszystkie.all());
});

router.post('/', (req, res) => {
  const wynik = wstawNowy.run();
  res.status(201).json(pobierzJeden.get(wynik.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const id = idZParametru(req);

  if (!pobierzJeden.get(id)) throw blad(404, `Nie ma wpisu o id ${id}.`);

  // Bierzemy z body tylko pola z whitelisty i normalizujemy ich wartosci.
  const doZapisu = {};
  for (const pole of POLA_EDYTOWALNE) {
    if (Object.prototype.hasOwnProperty.call(req.body, pole)) {
      doZapisu[pole] = znormalizuj(pole, req.body[pole]);
    }
  }

  const pola = Object.keys(doZapisu);
  if (pola.length === 0) throw blad(400, 'Brak pól do aktualizacji.');

  // Nazwy kolumn pochodza z whitelisty, wiec sklejenie ich w SQL jest bezpieczne.
  // Wartosci ida wylacznie przez parametry (@pole), nigdy przez konkatenacje.
  const przypisania = pola.map((p) => `${p} = @${p}`).join(', ');
  db.prepare(`UPDATE dziennik SET ${przypisania} WHERE id = @id`).run({ ...doZapisu, id });

  res.json(pobierzJeden.get(id));
});

router.delete('/:id', (req, res) => {
  const id = idZParametru(req);
  const wynik = usun.run(id);
  if (wynik.changes === 0) throw blad(404, `Nie ma wpisu o id ${id}.`);
  res.status(204).end();
});

module.exports = router;
