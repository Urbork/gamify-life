/**
 * REST API dla slownika nawykow (tabela `nawyki_slownik`).
 *
 *   GET    /api/nawyki       - wszystkie nazwy
 *   POST   /api/nawyki       - dodaje { nazwa }, odrzuca duplikat
 *   PATCH  /api/nawyki/:id   - zmienia nazwe I KASKADOWO poprawia wpisy dziennika
 *   DELETE /api/nawyki/:id   - usuwa TYLKO ze slownika, wpisow dziennika NIE rusza
 *
 * Slownik sluzy do budowania listy wyboru. Kolumna `dziennik.nawyki` zostaje
 * zwyklym tekstem z nazwami rozdzielonymi przecinkami - patrz komentarz
 * przy migracji 4 w db/migracje.js.
 */

const express = require('express');
const db = require('../db');

const router = express.Router();

// --- pomocnicze -----------------------------------------------------------

function blad(status, wiadomosc) {
  const e = new Error(wiadomosc);
  e.status = status;
  return e;
}

function idZParametru(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw blad(400, 'Niepoprawne id nawyku.');
  return id;
}

/** Sprowadza nazwe z requestu do postaci gotowej do zapisu albo rzuca bledem 400. */
function nazwaZZadania(req) {
  const nazwa = req.body && req.body.nazwa;
  if (typeof nazwa !== 'string' || nazwa.trim() === '') {
    throw blad(400, 'Nazwa nawyku nie może być pusta.');
  }

  const przycieta = nazwa.trim();

  /*
    Przecinek rozdziela nazwy w kolumnie `dziennik.nawyki`, wiec nazwa zawierajaca
    przecinek rozpadlaby sie na dwie przy pierwszym odczycie. Odrzucamy od razu,
    z czytelnym powodem, zamiast pozwolic na ciche uszkodzenie danych.
  */
  if (przycieta.includes(',')) {
    throw blad(400, 'Nazwa nawyku nie może zawierać przecinka — przecinek rozdziela nazwy w dzienniku.');
  }

  return przycieta;
}

/*
  Rozbija zawartosc kolumny `nawyki` na pojedyncze nazwy.
  Ta sama zasada co w public/js/reguly-dziennika.js: dzielimy po przecinku
  i przycinamy spacje, puste tokeny odrzucamy.
*/
function tokeny(tekst) {
  if (!tekst) return [];
  return tekst
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// --- zapytania SQL --------------------------------------------------------

const pobierzWszystkie = db.prepare('SELECT * FROM nawyki_slownik ORDER BY nazwa COLLATE NOCASE');
const pobierzJeden = db.prepare('SELECT * FROM nawyki_slownik WHERE id = ?');
// LOWER() nie radzi sobie z polskimi znakami, ale COLLATE NOCASE wystarcza
// do wychwycenia typowego duplikatu roznigo sie tylko wielkoscia liter.
const znajdzPoNazwie = db.prepare(
  'SELECT * FROM nawyki_slownik WHERE nazwa = ? COLLATE NOCASE'
);
const wstaw = db.prepare('INSERT INTO nawyki_slownik (nazwa) VALUES (?)');
const zmienNazwe = db.prepare('UPDATE nawyki_slownik SET nazwa = ? WHERE id = ?');
const usunNawyk = db.prepare('DELETE FROM nawyki_slownik WHERE id = ?');

const wpisyZNawykami = db.prepare(
  "SELECT id, nawyki FROM dziennik WHERE nawyki IS NOT NULL AND nawyki <> ''"
);
const ustawNawykiWpisu = db.prepare('UPDATE dziennik SET nawyki = ? WHERE id = ?');

// --- kaskadowa zmiana nazwy ----------------------------------------------

/*
  Podmienia nazwe nawyku we WSZYSTKICH wpisach dziennika.

  DLACZEGO NIE `UPDATE dziennik SET nawyki = REPLACE(nawyki, stara, nowa)`
  REPLACE dziala na PODCIAGACH, wiec:
    - zmiana "Water" -> "H2O" zepsulaby "Drink Water" na "Drink H2O",
    - zmiana "Drink Water" -> "Woda" uszkodzilaby "Drink Water Extra",
    - nazwa bedaca prefiksem innej rozjechalaby obie.

  Dlatego rozbijamy liste po przecinkach i porownujemy CALE tokeny.
  Odporne rowniez na nazwy zawierajace spacje i nawiasy, ktorych w danych
  jest sporo (np. "Duolingo (road to 3 years)", "Zapisać emocje (rano)").

  Porownanie jest DOKLADNE (po przycieciu spacji). Rozne wielkosci liter to inna
  nazwa - inaczej zmiana nazwy normalizowalaby przy okazji zapis historyczny,
  o co nikt nie prosil. Wykrywanie duplikatow przy dodawaniu dziala osobno
  i wielkosci liter NIE rozroznia.

  Zwraca liczbe zmienionych wpisow. Wiersze bez trafienia nie sa w ogole ruszane.
*/
function przemianujWeWpisach(staraNazwa, nowaNazwa) {
  let zmienionych = 0;

  for (const wpis of wpisyZNawykami.all()) {
    const lista = tokeny(wpis.nawyki);
    if (!lista.includes(staraNazwa)) continue; // brak trafienia - bez UPDATE

    const nowa = lista.map((t) => (t === staraNazwa ? nowaNazwa : t));
    ustawNawykiWpisu.run(nowa.join(', '), wpis.id);
    zmienionych++;
  }

  return zmienionych;
}

// --- trasy ----------------------------------------------------------------

router.get('/', (req, res) => {
  res.json(pobierzWszystkie.all());
});

router.post('/', (req, res) => {
  const nazwa = nazwaZZadania(req);

  const istniejacy = znajdzPoNazwie.get(nazwa);
  if (istniejacy) {
    throw blad(409, `Nawyk "${istniejacy.nazwa}" już istnieje na liście.`);
  }

  const wynik = wstaw.run(nazwa);
  res.status(201).json(pobierzJeden.get(wynik.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const id = idZParametru(req);
  const nawyk = pobierzJeden.get(id);
  if (!nawyk) throw blad(404, `Nie ma nawyku o id ${id}.`);

  const nowaNazwa = nazwaZZadania(req);

  // Zmiana wylacznie wielkosci liter jest dozwolona - to ten sam wpis slownika.
  const kolizja = znajdzPoNazwie.get(nowaNazwa);
  if (kolizja && kolizja.id !== id) {
    throw blad(409, `Nawyk "${kolizja.nazwa}" już istnieje na liście.`);
  }

  if (nowaNazwa === nawyk.nazwa) {
    return res.json({ nawyk, zaktualizowanychWpisow: 0 });
  }

  /*
    Slownik i wpisy dziennika zmieniaja sie w JEDNEJ transakcji: albo zmieni sie
    jedno i drugie, albo nic. Inaczej przerwanie w polowie zostawiloby slownik
    z nowa nazwa, a wpisy ze stara.
  */
  const zaktualizowanychWpisow = db.transaction(() => {
    zmienNazwe.run(nowaNazwa, id);
    return przemianujWeWpisach(nawyk.nazwa, nowaNazwa);
  })();

  res.json({ nawyk: pobierzJeden.get(id), zaktualizowanychWpisow });
});

router.delete('/:id', (req, res) => {
  const id = idZParametru(req);
  const nawyk = pobierzJeden.get(id);
  if (!nawyk) throw blad(404, `Nie ma nawyku o id ${id}.`);

  /*
    Usuwamy WYLACZNIE ze slownika. Kolumna `nawyki` we wpisach dziennika zostaje
    nietknieta - historia ma pozostac wierna temu, co bylo wtedy prawda.

    Skutek uboczny do zapamietania: nazwa znika z listy wyboru, wiec po tym nawyku
    nie da sie juz filtrowac, choc dalej widac go w tresci wpisow.
  */
  usunNawyk.run(id);
  res.status(204).end();
});

module.exports = router;
