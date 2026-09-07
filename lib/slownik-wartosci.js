/**
 * Fabryka routera dla SLOWNIKA WARTOSCI WIELOKROTNEGO WYBORU.
 *
 * W dzienniku sa dwa takie pola i dzialaja identycznie:
 *
 *   nawyki      <- slownik `nawyki_slownik`
 *   trzy_slowa  <- slownik `slowa_slownik`
 *
 * Oba trzymaja w kolumnie dziennika ZWYKLY TEKST z nazwami rozdzielonymi
 * przecinkami, a slownik sluzy wylacznie do zbudowania listy wyboru.
 *
 * DLACZEGO FABRYKA, A NIE DRUGI PLIK
 * Zanim powstal ten modul, cala ta logika byla w routes/nawyki.js. Dopisanie
 * drugiego pola przez skopiowanie pliku dalo by dwie implementacje tych samych
 * regul - a wtedy poprawka kaskadowej zmiany nazwy trafialaby do jednej z nich
 * i po cichu omijala druga. To ten sam wzorzec, ktory dal kiedys numerDnia
 * w trzech kopiach.
 *
 * NAZWY TABEL I KOLUMN POCHODZA Z KODU, nigdy z zadania HTTP - wolno je wiec
 * skleic w SQL. Z zewnatrz przychodza wylacznie wartosci, zawsze przez parametry.
 */

'use strict';

const express = require('express');

/**
 * @param {object} db          polaczenie better-sqlite3
 * @param {object} opcje
 * @param {string} opcje.tabela        nazwa tabeli slownika (np. 'nawyki_slownik')
 * @param {string} opcje.kolumnaWpisu  kolumna w tabeli `dziennik` (np. 'nawyki')
 * @param {string} opcje.mianownik     do komunikatow: 'Nawyk', 'Słowo'
 * @param {string} opcje.dopelniacz    do komunikatow: 'nawyku', 'słowa'
 */
function utworzRouterSlownika(db, opcje) {
  const { tabela, kolumnaWpisu, mianownik, dopelniacz } = opcje;
  const router = express.Router();

  // --- pomocnicze ---------------------------------------------------------

  function blad(status, wiadomosc) {
    const e = new Error(wiadomosc);
    e.status = status;
    return e;
  }

  function idZParametru(req) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw blad(400, `Invalid ${dopelniacz} id.`);
    return id;
  }

  /** Sprowadza nazwe z requestu do postaci gotowej do zapisu albo rzuca bledem 400. */
  function nazwaZZadania(req) {
    const nazwa = req.body && req.body.nazwa;
    if (typeof nazwa !== 'string' || nazwa.trim() === '') {
      throw blad(400, `The ${dopelniacz} name cannot be empty.`);
    }

    const przycieta = nazwa.trim();

    /*
      Przecinek rozdziela nazwy w kolumnie dziennika, wiec nazwa zawierajaca
      przecinek rozpadlaby sie na dwie przy pierwszym odczycie. Odrzucamy od razu,
      z czytelnym powodem, zamiast pozwolic na ciche uszkodzenie danych.
    */
    if (przycieta.includes(',')) {
      throw blad(
        400,
        `The ${dopelniacz} name cannot contain a comma — commas separate names in the journal.`
      );
    }

    return przycieta;
  }

  /*
    Rozbija zawartosc kolumny na pojedyncze nazwy.
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

  // --- zapytania SQL ------------------------------------------------------

  const pobierzWszystkie = db.prepare(`SELECT * FROM ${tabela} ORDER BY nazwa COLLATE NOCASE`);
  const pobierzJeden = db.prepare(`SELECT * FROM ${tabela} WHERE id = ?`);
  // LOWER() nie radzi sobie z polskimi znakami, ale COLLATE NOCASE wystarcza
  // do wychwycenia typowego duplikatu roznigo sie tylko wielkoscia liter.
  const znajdzPoNazwie = db.prepare(`SELECT * FROM ${tabela} WHERE nazwa = ? COLLATE NOCASE`);
  const wstaw = db.prepare(`INSERT INTO ${tabela} (nazwa) VALUES (?)`);
  const zmienNazwe = db.prepare(`UPDATE ${tabela} SET nazwa = ? WHERE id = ?`);
  const usunPozycje = db.prepare(`DELETE FROM ${tabela} WHERE id = ?`);

  const wpisyZWartosciami = db.prepare(
    `SELECT id, ${kolumnaWpisu} AS wartosci FROM dziennik
      WHERE ${kolumnaWpisu} IS NOT NULL AND ${kolumnaWpisu} <> ''`
  );
  const ustawWartosciWpisu = db.prepare(`UPDATE dziennik SET ${kolumnaWpisu} = ? WHERE id = ?`);

  // --- kaskadowa zmiana nazwy --------------------------------------------

  /*
    Podmienia nazwe we WSZYSTKICH wpisach dziennika.

    DLACZEGO NIE `UPDATE dziennik SET kolumna = REPLACE(kolumna, stara, nowa)`
    REPLACE dziala na PODCIAGACH, wiec:
      - zmiana "Water" -> "H2O" zepsulaby "Drink Water" na "Drink H2O",
      - zmiana "Drink Water" -> "Woda" uszkodzilaby "Drink Water Extra",
      - nazwa bedaca prefiksem innej rozjechalaby obie.

    Dlatego rozbijamy liste po przecinkach i porownujemy CALE tokeny.
    Odporne rowniez na nazwy zawierajace spacje i nawiasy, ktorych w danych
    jest sporo (np. "Duolingo (road to 3 years)", "Low Impact").

    Porownanie jest DOKLADNE (po przycieciu spacji). Rozne wielkosci liter to inna
    nazwa - inaczej zmiana nazwy normalizowalaby przy okazji zapis historyczny,
    o co nikt nie prosil. Wykrywanie duplikatow przy dodawaniu dziala osobno
    i wielkosci liter NIE rozroznia.

    Zwraca liczbe zmienionych wpisow. Wiersze bez trafienia nie sa w ogole ruszane.
  */
  function przemianujWeWpisach(staraNazwa, nowaNazwa) {
    let zmienionych = 0;

    for (const wpis of wpisyZWartosciami.all()) {
      const lista = tokeny(wpis.wartosci);
      if (!lista.includes(staraNazwa)) continue; // brak trafienia - bez UPDATE

      const nowa = lista.map((t) => (t === staraNazwa ? nowaNazwa : t));
      ustawWartosciWpisu.run(nowa.join(', '), wpis.id);
      zmienionych++;
    }

    return zmienionych;
  }

  // --- trasy --------------------------------------------------------------

  router.get('/', (req, res) => {
    res.json(pobierzWszystkie.all());
  });

  router.post('/', (req, res) => {
    const nazwa = nazwaZZadania(req);

    const istniejacy = znajdzPoNazwie.get(nazwa);
    if (istniejacy) {
      throw blad(409, `${mianownik} "${istniejacy.nazwa}" is already on the list.`);
    }

    const wynik = wstaw.run(nazwa);
    res.status(201).json(pobierzJeden.get(wynik.lastInsertRowid));
  });

  router.patch('/:id', (req, res) => {
    const id = idZParametru(req);
    const pozycja = pobierzJeden.get(id);
    if (!pozycja) throw blad(404, `There is no ${dopelniacz} with id ${id}.`);

    const nowaNazwa = nazwaZZadania(req);

    // Zmiana wylacznie wielkosci liter jest dozwolona - to ten sam wpis slownika.
    const kolizja = znajdzPoNazwie.get(nowaNazwa);
    if (kolizja && kolizja.id !== id) {
      throw blad(409, `${mianownik} "${kolizja.nazwa}" is already on the list.`);
    }

    if (nowaNazwa === pozycja.nazwa) {
      return res.json({ pozycja, nawyk: pozycja, zaktualizowanychWpisow: 0 });
    }

    /*
      Slownik i wpisy dziennika zmieniaja sie w JEDNEJ transakcji: albo zmieni sie
      jedno i drugie, albo nic. Inaczej przerwanie w polowie zostawiloby slownik
      z nowa nazwa, a wpisy ze stara.
    */
    const zaktualizowanychWpisow = db.transaction(() => {
      zmienNazwe.run(nowaNazwa, id);
      return przemianujWeWpisach(pozycja.nazwa, nowaNazwa);
    })();

    const po = pobierzJeden.get(id);
    /*
      `nawyk` zostaje obok `pozycja` wylacznie dla zgodnosci wstecz: tej nazwy
      uzywa juz interfejs nawykow i smoke test. Nowy kod czyta `pozycja`.
    */
    res.json({ pozycja: po, nawyk: po, zaktualizowanychWpisow });
  });

  router.delete('/:id', (req, res) => {
    const id = idZParametru(req);
    const pozycja = pobierzJeden.get(id);
    if (!pozycja) throw blad(404, `There is no ${dopelniacz} with id ${id}.`);

    /*
      Usuwamy WYLACZNIE ze slownika. Kolumna we wpisach dziennika zostaje
      nietknieta - historia ma pozostac wierna temu, co bylo wtedy prawda.

      Skutek uboczny do zapamietania: nazwa znika z listy wyboru, wiec po tej
      wartosci nie da sie juz filtrowac, choc dalej widac ja w tresci wpisow.
    */
    usunPozycje.run(id);
    res.status(204).end();
  });

  return router;
}

module.exports = { utworzRouterSlownika };
