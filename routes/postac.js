/**
 * Postac: XP, poziom, prestiz, zloto i atrybuty.
 *
 *   GET    /api/postac            - pelny stan, liczony NA ZYWO
 *   PATCH  /api/atrybuty          - zapisuje CALE rozdanie punktow
 *   POST   /api/atrybuty/reset    - zeruje rozdanie
 *   GET    /api/zakupy            - lista wydatkow
 *   POST   /api/zakupy            - dodaje { nazwa, koszt }, odrzuca gdy brak zlota
 *   DELETE /api/zakupy/:id        - cofa zakup (zloto wraca)
 *
 * JEDYNY trwaly stan w tym module to tabela `zakupy` i tabela `atrybuty` - obie
 * trzymaja DECYZJE uzytkownika, ktorych nie da sie odtworzyc z niczego innego.
 * Cala reszta liczy sie od zera przy kazdym wywolaniu.
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
const { KLUCZE_ATRYBUTOW } = require('../config/atrybuty');

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

/** Przelicza pelny stan postaci od zera i dokleja zapisane rozdanie atrybutow. */
function stanPostaci() {
  const postac = nagrody.policzPostac(
    wszystkieZadania.all(),
    wszystkieWpisy.all(),
    sumaKosztow.get().suma,
    STAN_ZAKONCZONY
  );
  return { ...postac, ...stanAtrybutow(postac) };
}

// --- trasy ----------------------------------------------------------------

/*
  ATRYBUTY

  Punkty przychodza z poziomu (PUNKTY_NA_POZIOM za kazdy zdobyty), a poziom liczy
  sie na zywo z zadan i wpisow. Pula potrafi wiec ZMALEC - np. po poprawieniu
  starego zadania albo po zmianie stalych naliczania XP.

  Rozdanych punktow wtedy NIE RUSZAMY. Milczace obcinanie skasowaloby decyzje
  uzytkownika przy okazji zupelnie innej operacji; zamiast tego `wolne` schodzi
  ponizej zera, a interfejs pokazuje to wprost i proponuje reset. Zapis nowego
  rozdania i tak sie nie uda, dopoki suma przekracza pule - blokuje go walidacja
  w PATCH nizej.
*/
const wszystkieAtrybuty = db.prepare('SELECT nazwa, punkty FROM atrybuty');
const ustawAtrybut = db.prepare('UPDATE atrybuty SET punkty = ? WHERE nazwa = ?');

function stanAtrybutow(postac) {
  const punkty = Object.fromEntries(wszystkieAtrybuty.all().map((a) => [a.nazwa, a.punkty]));
  const lacznie = nagrody.punktyDoRozdania(postac.prestiz, postac.poziom);
  const rozdane = Object.values(punkty).reduce((a, b) => a + b, 0);

  return {
    atrybuty: punkty,
    punkty: { lacznie, rozdane, wolne: lacznie - rozdane },
  };
}

/*
  PATCH przyjmuje CALE rozdanie, a nie pojedyncze "+1".

  Powod jest taki sam jak przy imporcie dziennika: operacja calosciowa jest
  idempotentna. Dwa razy wyslane "+1" doda dwa punkty, dwa razy wyslane
  "sila: 7" zostawi siedem - a przy klikaniu w interfejsie powtorzenie zadania
  jest kwestia czasu.

  Klucze spoza slownika sa BLEDEM, a nie cichym pominieciem: literowka w nazwie
  atrybutu ma sie zglosic od razu, a nie zniknac bez sladu.
*/
router.patch('/atrybuty', (req, res) => {
  const cialo = req.body;
  if (!cialo || typeof cialo !== 'object' || Array.isArray(cialo)) {
    throw blad(400, 'Oczekiwano obiektu z punktami atrybutow.');
  }

  const nieznane = Object.keys(cialo).filter((k) => !KLUCZE_ATRYBUTOW.includes(k));
  if (nieznane.length > 0) {
    throw blad(400, `Nieznane atrybuty: ${nieznane.join(', ')}.`);
  }

  // Brakujace klucze zachowuja obecna wartosc - PATCH, nie PUT.
  const obecne = Object.fromEntries(wszystkieAtrybuty.all().map((a) => [a.nazwa, a.punkty]));
  const docelowe = { ...obecne };

  for (const [nazwa, wartosc] of Object.entries(cialo)) {
    const n = Number(wartosc);
    if (!Number.isInteger(n) || n < 0) {
      throw blad(400, `Atrybut "${nazwa}": oczekiwano liczby całkowitej nie mniejszej niż 0.`);
    }
    docelowe[nazwa] = n;
  }

  const postac = stanPostaci();
  const lacznie = nagrody.punktyDoRozdania(postac.prestiz, postac.poziom);
  const suma = Object.values(docelowe).reduce((a, b) => a + b, 0);

  if (suma > lacznie) {
    throw blad(400, `Do rozdania jest ${lacznie} punktów, a rozdzielono ${suma}.`);
  }

  // Transakcja: albo caly komplet, albo nic - inaczej nieudany zapis zostawilby
  // rozdanie w stanie posrednim, ktorego uzytkownik nigdy nie wybral.
  db.transaction(() => {
    for (const [nazwa, wartosc] of Object.entries(docelowe)) ustawAtrybut.run(wartosc, nazwa);
  })();

  res.json({ ...stanPostaci(), zasady: nagrody.STALE });
});

/*
  Reset to osobna trasa, a nie PATCH z samymi zerami.

  Roznica jest w intencji: reset ma dzialac ZAWSZE, takze wtedy, gdy pula zmalala
  i obecne rozdanie jest juz nieprawidlowe - a wlasnie wtedy PATCH odmowilby zapisu,
  bo walidacja patrzy na stan wysylany, nie na docelowy. Reset jest jedynym
  wyjsciem z tej sytuacji, wiec nie moze podlegac tej samej blokadzie.
*/
router.post('/atrybuty/reset', (req, res) => {
  db.transaction(() => {
    for (const nazwa of KLUCZE_ATRYBUTOW) ustawAtrybut.run(0, nazwa);
  })();

  res.json({ ...stanPostaci(), zasady: nagrody.STALE });
});

router.get('/postac', (req, res) => {
  /*
    Do wyliczonego stanu dokladamy STALE, na ktorych sie opiera - strona Postaci
    pokazuje je obok rozbicia XP, zeby dalo sie odczytac, SKAD biora sie proporcje.
    Bez tego widac tylko, ze dziennik daje wiekszosc XP, ale nie dlaczego.

    Sa tu tylko DO ODCZYTU. Zmiana ktorejkolwiek przelicza cala historie wstecz
    (i potrafi OBNIZYC poziom mimo wyzszego XP, gdy suma przeskoczy prog prestizu
    i licznik wroci do jedynki), wiec nie jest to pokretlo do krecenia w locie.
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
