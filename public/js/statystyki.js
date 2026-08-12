/*
  Widok statystyk: pobranie danych i zbudowanie tabel.

  Wszystkie obliczenia siedza w public/js/reguly-statystyk.js - tutaj jest
  wylacznie budowanie DOM. Zadnych nowych endpointow: korzystamy z istniejacych
  GET /api/zadania, GET /api/dziennik i GET /api/slowniki.

  BEZ CACHE: strona liczy wszystko od nowa przy kazdym wejsciu. Dane zrodlowe
  sa jedyna prawda, wiec nie ma czego uniewazniac.
*/

(() => {
  'use strict';

  const elTresc = document.getElementById('tresc');
  const elStatus = document.getElementById('status');

  // Etykiety kolumn ocen - klucz z bazy nie nadaje sie na naglowek.
  const ETYKIETY_OCEN = {
    jakosc_snu: 'Jakość snu',
    stres: 'Stres',
    nastroj: 'Nastrój',
    intencjonalnosc: 'Intencjonalność',
  };

  // ==========================================================================
  // Formatowanie
  // ==========================================================================

  /** Liczba z jednym miejscem po przecinku albo kreska, gdy brak danych. */
  function liczba(wartosc, miejsc = 1) {
    if (wartosc === null || wartosc === undefined || Number.isNaN(wartosc)) return '—';
    return wartosc.toLocaleString('pl', {
      minimumFractionDigits: miejsc,
      maximumFractionDigits: miejsc,
    });
  }

  function procent(wartosc) {
    return wartosc === null || wartosc === undefined ? '—' : liczba(wartosc, 1) + '%';
  }

  // ==========================================================================
  // Budowanie elementow
  // ==========================================================================

  function el(tag, klasa, tekst) {
    const e = document.createElement(tag);
    if (klasa) e.className = klasa;
    // textContent, nie innerHTML - w danych sa nazwy klientow i tresci od uzytkownika.
    if (tekst !== undefined) e.textContent = tekst;
    return e;
  }

  /** Karta z pojedyncza liczba: etykieta, wartosc i (opcjonalnie) podstawa obliczenia. */
  function karta(etykieta, wartosc, podstawa) {
    const k = el('div', 'karta');
    k.append(el('span', 'etykieta', etykieta), el('span', 'liczba', wartosc));
    if (podstawa) k.append(el('span', 'podstawa', podstawa));
    return k;
  }

  /**
   * Prosta tabela.
   * @param {Array<string>} naglowki
   * @param {Array<Array>} wiersze komorka moze byc tekstem albo elementem DOM
   * @param {Array<boolean>} liczbowe ktore kolumny wyrownac do prawej
   */
  function tabela(naglowki, wiersze, liczbowe = []) {
    const t = el('table');

    const thead = el('thead');
    const trNag = el('tr');
    naglowki.forEach((n, i) => {
      const th = el('th', liczbowe[i] ? 'liczbowa' : null, n);
      trNag.appendChild(th);
    });
    thead.appendChild(trNag);

    const tbody = el('tbody');
    for (const wiersz of wiersze) {
      const tr = el('tr');
      wiersz.forEach((komorka, i) => {
        const td = el('td', liczbowe[i] ? 'liczbowa' : null);
        if (komorka instanceof Node) td.appendChild(komorka);
        else td.textContent = komorka;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }

    t.append(thead, tbody);
    return t;
  }

  /**
   * Slupek proporcjonalny (0-100%) - zwykly element o zadanej szerokosci, bez biblioteki.
   * Klasa "slupek", a NIE "pasek": ta druga nalezy do <header class="pasek">
   * na wszystkich stronach i uzycie jej tutaj rozjezdzalo naglowek.
   */
  function slupek(procentWartosc) {
    const tlo = el('span', 'slupek slupek-tlo');
    const wypelnienie = el('span', 'slupek');
    wypelnienie.style.width = `${Math.max(0, Math.min(100, procentWartosc))}%`;
    tlo.appendChild(wypelnienie);
    return tlo;
  }

  // ==========================================================================
  // Sekcja: zadania
  // ==========================================================================

  function sekcjaZadan(s) {
    const sekcja = document.createDocumentFragment();
    sekcja.appendChild(el('h2', null, 'Zadania'));

    if (s.lacznie === 0) {
      sekcja.appendChild(el('p', 'brak-danych', 'Brak zadań w bazie.'));
      return sekcja;
    }

    const karty = el('div', 'karty');
    karty.appendChild(karta('Zadań łącznie', String(s.lacznie)));

    karty.appendChild(
      karta(
        'Średni czas trwania',
        s.czasTrwania.srednia === null ? '—' : liczba(s.czasTrwania.srednia) + ' h',
        s.czasTrwania.ile > 0
          ? `z ${s.czasTrwania.ile} zadań z wpisanym czasem`
          : 'brak zadań z wpisanym czasem (h)'
      )
    );

    /*
      Procent NIGDY nie stoi sam - obok zawsze mianownik. Przy trzech zadaniach
      "33%" brzmi jak wniosek, a jest szumem.
    */
    const pt = s.poTerminie;
    karty.appendChild(
      karta(
        'Zakończone po terminie',
        pt.procent === null ? '—' : procent(pt.procent),
        pt.zBadanych === 0
          ? 'brak zadań z terminem i datą zakończenia'
          : `${pt.ile} z ${pt.zBadanych} zadań z obiema datami`
      )
    );
    sekcja.appendChild(karty);

    sekcja.appendChild(el('h3', null, 'Według stanu'));
    sekcja.appendChild(
      tabela(
        ['Stan', 'Zadań', 'Udział'],
        s.wgStanu.map((w) => [
          w.klucz,
          String(w.ile),
          procent((100 * w.ile) / s.lacznie),
        ]),
        [false, true, true]
      )
    );

    sekcja.appendChild(el('h3', null, 'Według obszaru'));
    sekcja.appendChild(
      tabela(
        ['Obszar', 'Zadań', 'Udział'],
        s.wgObszaru.map((w) => [
          w.klucz,
          String(w.ile),
          procent((100 * w.ile) / s.lacznie),
        ]),
        [false, true, true]
      )
    );

    return sekcja;
  }

  // ==========================================================================
  // Sekcja: dziennik
  // ==========================================================================

  function sekcjaDziennika(s) {
    const sekcja = document.createDocumentFragment();
    sekcja.appendChild(el('h2', null, 'Dziennik'));

    if (s.lacznie === 0) {
      sekcja.appendChild(el('p', 'brak-danych', 'Brak wpisów w bazie.'));
      return sekcja;
    }

    const karty = el('div', 'karty');
    karty.appendChild(karta('Wpisów łącznie', String(s.lacznie)));
    karty.appendChild(karta('Zakres dat', s.odDaty ?? '—', `do ${s.doDaty ?? '—'}`));
    karty.appendChild(
      karta(
        'Sen — średnia',
        s.sen.srednia === null ? '—' : liczba(s.sen.srednia) + ' h',
        `min ${liczba(s.sen.min, 0)} h, max ${liczba(s.sen.max, 0)} h`
      )
    );
    karty.appendChild(
      karta(
        'Sen — wypełnienie',
        procent(s.sen.procentWypelnienia),
        `${s.sen.ile} z ${s.lacznie} wpisów`
      )
    );
    sekcja.appendChild(karty);

    // --- oceny ---
    sekcja.appendChild(el('h3', null, 'Oceny — średnie'));

    /*
      Ostrzezenie o odwroconej skali stresu stoi PRZED tabela srednich,
      bo bez niego "stres 3,6" czyta sie jako wysoki, a znaczy raczej niski.
    */
    sekcja.appendChild(
      el(
        'p',
        'odwrocona-skala',
        'Uwaga: skala Stresu jest ODWRÓCONA względem pozostałych ocen — 0 = bardzo wysoki stres, 5 = brak stresu. ' +
          'Wyższa średnia Stresu oznacza więc SPOKOJNIEJSZY okres, a nie gorszy.'
      )
    );

    sekcja.appendChild(
      tabela(
        ['Ocena', 'Skala', 'Średnia', 'Min', 'Max', 'Wypełnionych'],
        s.oceny.map((o) => [
          ETYKIETY_OCEN[o.pole] + (o.pole === 'stres' ? '  ⚠' : ''),
          o.pole === 'stres' ? '0–5 (odwrócona)' : '1–5',
          liczba(o.srednia, 2),
          o.min === null ? '—' : String(o.min),
          o.max === null ? '—' : String(o.max),
          `${o.ile} (${procent(o.procentWypelnienia)})`,
        ]),
        [false, false, true, true, true, true]
      )
    );

    // --- rozklady ---
    sekcja.appendChild(el('h3', null, 'Oceny — rozkład wartości'));
    for (const o of s.oceny) {
      const naglowek =
        ETYKIETY_OCEN[o.pole] +
        (o.pole === 'stres' ? ' — skala odwrócona: 0 = bardzo wysoki stres, 5 = brak stresu' : '');
      sekcja.appendChild(el('h3', null, naglowek));

      if (o.rozklad.length === 0) {
        sekcja.appendChild(el('p', 'brak-danych', 'Brak wypełnionych wartości.'));
        continue;
      }

      const najwiecej = Math.max(...o.rozklad.map((r) => r.ile));
      sekcja.appendChild(
        tabela(
          ['Wartość', 'Wpisów', 'Udział', ''],
          o.rozklad.map((r) => [
            String(r.wartosc),
            String(r.ile),
            procent((100 * r.ile) / o.ile),
            slupek((100 * r.ile) / najwiecej),
          ]),
          [true, true, true, false]
        )
      );
    }

    // --- tabela miesieczna ---
    sekcja.appendChild(el('h3', null, 'Miesiące — wpisy i odsetek z refleksją'));
    sekcja.appendChild(
      el(
        'p',
        'podstawa',
        'Refleksja = wypełnione co najmniej jedno z pól: ' +
          regulyStatystyk.POLA_REFLEKSYJNE.join(', ') +
          '.'
      )
    );
    sekcja.appendChild(
      tabela(
        ['Miesiąc', 'Wpisów', 'Z refleksją', '%', ''],
        s.miesiace.map((m) => [
          m.miesiac,
          String(m.wpisow),
          String(m.zRefleksja),
          procent(m.procent),
          slupek(m.procent),
        ]),
        [false, true, true, true, false]
      )
    );

    return sekcja;
  }

  // ==========================================================================
  // Start
  // ==========================================================================

  async function start() {
    try {
      const [zadania, wpisy, slowniki] = await Promise.all([
        api.get('/api/zadania'),
        api.get('/api/dziennik'),
        api.get('/api/slowniki'),
      ]);

      const statZadan = regulyStatystyk.statystykiZadan(zadania, slowniki);
      const statDziennika = regulyStatystyk.statystykiDziennika(wpisy);

      elTresc.replaceChildren(sekcjaZadan(statZadan), sekcjaDziennika(statDziennika));

      elStatus.textContent = `przeliczono ${zadania.length} zadań i ${wpisy.length} wpisów`;
      elStatus.className = 'status ok';
    } catch (e) {
      elTresc.replaceChildren(el('p', 'brak-danych', 'Nie udało się wczytać danych.'));
      elStatus.textContent = e.message;
      elStatus.className = 'status blad';
    }
  }

  start();
})();
