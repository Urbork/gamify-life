/**
 * REST API dla tabeli `projekty`.
 *
 *   GET    /api/projekty       - wszystkie projekty wraz z licznikiem zadan
 *   POST   /api/projekty       - nowy projekt z wartosciami domyslnymi
 *   PATCH  /api/projekty/:id   - aktualizacja wybranych pol (edycja inline)
 *   DELETE /api/projekty/:id   - usuniecie; zadania zostaja, tylko sie ODPINAJA
 *
 * Ten sam wzorzec co routes/zadania.js: whitelist kolumn, normalizacja wartosci,
 * bledy z kodem HTTP lapane przez wspolny middleware w server.js.
 *
 * Projekt jest KONTENEREM - sam z siebie nie daje XP. Punkty licza sie wylacznie
 * z zadan, wpisow dziennika i nawykow (lib/nagrody.js).
 */

const express = require('express');
const db = require('../db');
const { STANY, STAN_DOMYSLNY, STAN_ZAKONCZONY } = require('../config/slowniki');

const router = express.Router();

// Whitelist - nic spoza tej listy nie trafi do SQL (id i created_at sa nietykalne).
const POLA_EDYTOWALNE = ['nazwa', 'status', 'opis'];

const NAZWA_DOMYSLNA = 'Nowy projekt';

// --- pomocnicze -----------------------------------------------------------

function blad(status, wiadomosc) {
  const e = new Error(wiadomosc);
  e.status = status;
  return e;
}

function idZParametru(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw blad(400, 'Niepoprawne id projektu.');
  return id;
}

function znormalizuj(pole, wartosc) {
  if (wartosc === null || wartosc === undefined || wartosc === '') {
    if (pole === 'nazwa') return '';
    if (pole === 'status') throw blad(400, 'Pole "status" nie może być puste.');
    return null;
  }

  if (typeof wartosc !== 'string') throw blad(400, `Pole "${pole}" musi być tekstem.`);

  const tekst = wartosc.trim();
  if (tekst === '') return pole === 'nazwa' ? '' : null;

  // Status projektu korzysta z TEJ SAMEJ zamknietej listy co stan zadania -
  // jedna skala na obu poziomach, wiec walidacja tez jest twarda.
  if (pole === 'status' && !STANY.includes(tekst)) {
    throw blad(400, `Nieznany status "${tekst}". Dozwolone: ${STANY.join(', ')}.`);
  }

  return tekst;
}

// --- zapytania SQL --------------------------------------------------------

/*
  Lista projektow wraz z licznikiem zadan.

  Liczniki liczone JEDNYM zapytaniem z LEFT JOIN, a nie osobnym zapytaniem
  na projekt - inaczej przy kilkudziesieciu projektach robilaby sie lawina
  zapytan (problem N+1).

  LEFT JOIN, nie INNER: projekt bez zadan ma sie pokazac z wynikiem 0/0.
*/
const pobierzWszystkie = db.prepare(`
  SELECT
    p.*,
    COUNT(z.id)                                        AS zadan_lacznie,
    COALESCE(SUM(CASE WHEN z.stan = ? THEN 1 ELSE 0 END), 0) AS zadan_ukonczonych
  FROM projekty p
  LEFT JOIN zadania z ON z.projekt_id = p.id
  GROUP BY p.id
  ORDER BY p.id
`);

const pobierzJeden = db.prepare('SELECT * FROM projekty WHERE id = ?');
const wstawNowy = db.prepare('INSERT INTO projekty (nazwa, status) VALUES (?, ?)');
const usunProjekt = db.prepare('DELETE FROM projekty WHERE id = ?');

// --- trasy ----------------------------------------------------------------

router.get('/', (req, res) => {
  res.json(pobierzWszystkie.all(STAN_ZAKONCZONY));
});

router.post('/', (req, res) => {
  const wynik = wstawNowy.run(NAZWA_DOMYSLNA, STAN_DOMYSLNY);
  res.status(201).json(pobierzJeden.get(wynik.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const id = idZParametru(req);
  if (!pobierzJeden.get(id)) throw blad(404, `Nie ma projektu o id ${id}.`);

  const doZapisu = {};
  for (const pole of POLA_EDYTOWALNE) {
    if (Object.prototype.hasOwnProperty.call(req.body, pole)) {
      doZapisu[pole] = znormalizuj(pole, req.body[pole]);
    }
  }

  const pola = Object.keys(doZapisu);
  if (pola.length === 0) throw blad(400, 'Brak pól do aktualizacji.');

  // Nazwy kolumn z whitelisty, wartosci wylacznie przez parametry.
  const przypisania = pola.map((p) => `${p} = @${p}`).join(', ');
  db.prepare(`UPDATE projekty SET ${przypisania} WHERE id = @id`).run({ ...doZapisu, id });

  res.json(pobierzJeden.get(id));
});

router.delete('/:id', (req, res) => {
  const id = idZParametru(req);
  const projekt = pobierzJeden.get(id);
  if (!projekt) throw blad(404, `Nie ma projektu o id ${id}.`);

  /*
    Zadania NIE sa kasowane. Klucz obcy ma ON DELETE SET NULL (migracja 6),
    wiec baza sama wyzeruje `projekt_id` w powiazanych zadaniach - zostaja
    jako zadania luzne. Zadanie jest bytem samodzielnym, projekt tylko kontenerem.
  */
  usunProjekt.run(id);
  res.status(204).end();
});

module.exports = router;
