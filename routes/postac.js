/**
 * Postac: XP, poziom, prestiz i waluta.
 *
 *   GET    /api/postac       - pelny stan, liczony NA ZYWO
 *   GET    /api/zakupy       - lista wydatkow
 *   POST   /api/zakupy       - dodaje { nazwa, koszt }, odrzuca gdy brak waluty
 *   DELETE /api/zakupy/:id   - cofa zakup (waluta wraca)
 *
 * GET /api/postac NICZEGO nie zapisuje - przelicza wszystko od zera przy kazdym
 * wywolaniu. Dzieki temu poprawienie starego zadania albo wpisu dziennika od razu
 * poprawia wynik historyczny, a cala dotychczasowa historia wlicza sie sama,
 * bez zadnego "aktywowania".
 *
 * Reguly naliczania siedza w lib/nagrody.js (czyste funkcje) - tutaj jest tylko
 * pobranie danych i warstwa HTTP.
 */

const express = require('express');
const db = require('../db');
const nagrody = require('../lib/nagrody');
const { STAN_ZAKONCZONY } = require('../config/slowniki');

const router = express.Router();

// --- pomocnicze -----------------------------------------------------------

function blad(status, wiadomosc) {
  const e = new Error(wiadomosc);
  e.status = status;
  return e;
}

function idZParametru(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw blad(400, 'Niepoprawne id zakupu.');
  return id;
}

// --- zapytania SQL --------------------------------------------------------

const wszystkieZadania = db.prepare('SELECT * FROM zadania');
const wszystkieWpisy = db.prepare('SELECT * FROM dziennik');

const wszystkieZakupy = db.prepare('SELECT * FROM zakupy ORDER BY data DESC, id DESC');
const pobierzZakup = db.prepare('SELECT * FROM zakupy WHERE id = ?');
const sumaKosztow = db.prepare('SELECT COALESCE(SUM(koszt), 0) AS suma FROM zakupy');
const wstawZakup = db.prepare('INSERT INTO zakupy (nazwa, koszt) VALUES (?, ?)');
const usunZakup = db.prepare('DELETE FROM zakupy WHERE id = ?');

/** Przelicza pelny stan postaci od zera. */
function stanPostaci() {
  return nagrody.policzPostac(
    wszystkieZadania.all(),
    wszystkieWpisy.all(),
    sumaKosztow.get().suma,
    STAN_ZAKONCZONY
  );
}

// --- trasy ----------------------------------------------------------------

router.get('/postac', (req, res) => {
  /*
    Do wyliczonego stanu dokladamy STALE, na ktorych sie opiera - strona Postaci
    pokazuje je obok rozbicia XP, zeby dalo sie odczytac, SKAD biora sie proporcje.
    Bez tego widac tylko, ze dziennik daje 70% XP, ale nie dlaczego.

    Sa tu tylko DO ODCZYTU. Zmiana ktorejkolwiek przelicza cala historie wstecz
    (podniesienie XP_ZA_POLE_REFLEKSYJNE z 10 na 20 przesuwa poziom z 74 na 17,
    bo przekracza prog prestizu), wiec nie jest to pokretlo do krecenia w locie.
    Wartosci zmienia sie w lib/nagrody.js i restartuje serwer.
  */
  res.json({ ...stanPostaci(), zasady: nagrody.STALE });
});

router.get('/zakupy', (req, res) => {
  res.json(wszystkieZakupy.all());
});

router.post('/zakupy', (req, res) => {
  const nazwa = req.body && req.body.nazwa;
  if (typeof nazwa !== 'string' || nazwa.trim() === '') {
    throw blad(400, 'Nazwa zakupu nie może być pusta.');
  }

  /*
    Zawezamy typ PRZED konwersja - Number('') i Number(null) daja 0,
    wiec bez tego "pusty koszt" przeszedlby jako darmowy zakup.
  */
  const surowy = req.body.koszt;
  const typPoprawny =
    typeof surowy === 'number' || (typeof surowy === 'string' && surowy.trim() !== '');
  const koszt = typPoprawny ? Number(surowy) : NaN;

  if (!Number.isInteger(koszt) || koszt <= 0) {
    throw blad(400, `Koszt musi być dodatnią liczbą całkowitą, otrzymano "${surowy}".`);
  }

  /*
    Kontrola salda liczona TUZ PRZED zapisem, na aktualnym stanie.
    Nie da sie wejsc na minus - to jedyna twarda regula systemu waluty.
  */
  const dostepna = stanPostaci().waluta_dostepna;
  if (koszt > dostepna) {
    throw blad(
      400,
      `Nie masz tylu monet: koszt ${koszt}, dostępne ${dostepna}. Brakuje ${koszt - dostepna}.`
    );
  }

  const wynik = wstawZakup.run(nazwa.trim(), koszt);
  res.status(201).json(pobierzZakup.get(wynik.lastInsertRowid));
});

router.delete('/zakupy/:id', (req, res) => {
  const id = idZParametru(req);
  // Cofniecie zakupu automatycznie zwraca walute - saldo liczy sie z sumy kosztow,
  // wiec usuniecie wiersza wystarczy, nie ma zadnego osobnego "zwrotu".
  const wynik = usunZakup.run(id);
  if (wynik.changes === 0) throw blad(404, `Nie ma zakupu o id ${id}.`);
  res.status(204).end();
});

module.exports = router;
