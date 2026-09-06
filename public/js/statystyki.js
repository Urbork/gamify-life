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
    stres: 'Spokój',
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

  /*
    Slowniki z /api/slowniki - trzymane w module, bo korzysta z nich kilka sekcji
    (opisy ocen w rozkladach, obszary w statystykach zadan). Wypelnia je start().
  */
  let slowniki = { oceny: {} };

  /*
    Wartosc oceny z opisem slownym i emoji: "3 😐 Przeciętny".

    Sama cyfra w rozkladzie nie mowi nic - "3" przy Spokoju i przy Nastroju znaczy
    co innego, a przy Spokoju skala zaczyna sie od zera. Opisy sa tam, gdzie
    zawsze: w config/mapowanie-ocen.js, wystawione przez /api/slowniki.
  */
  function opisOceny(pole, wartosc) {
    const skala = (slowniki.oceny && slowniki.oceny[pole]) || [];
    const poz = skala.find((o) => o.wartosc === wartosc);
    if (!poz) return String(wartosc);
    return `${wartosc} ${poz.emoji} ${poz.opis}`;
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

  function sekcjaZadan(s, zadania) {
    const sekcja = naglowekSekcji('zadania', 'Zadania', null);

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

    /*
      Terminowosc w rozbiciu na obszar i priorytet. Liczy sie WYLACZNIE z zadan
      majacych obie daty - bez terminu albo bez zakonczenia nie ma czego porownac,
      a doliczenie ich jako "na czas" zanizaloby odsetek spoznien tam, gdzie
      po prostu brakuje danych. Mianownik stoi obok procentu z tego samego powodu.
    */
    for (const [pole, etykieta, prog] of [
      ['obszar', 'obszaru', PROG_TERMINOWOSCI],
      ['priorytet', 'priorytetu', PROG_TERMINOWOSCI],
    ]) {
      const dane = regulyStatystyk.terminowoscWedlug(zadania, pole, prog);
      if (dane.length === 0) continue;

      sekcja.appendChild(el('h3', null, `Po terminie — według ${etykieta} (min. ${prog} zadań)`));
      sekcja.appendChild(
        tabela(
          [pole === 'obszar' ? 'Obszar' : 'Priorytet', 'Z obiema datami', 'Po terminie', 'Odsetek', ''],
          dane.map((g) => [
            pole === 'priorytet' ? etykietaPriorytetu(g.klucz) : g.klucz,
            String(g.zBadanych),
            String(g.poTerminie),
            procent(g.procent),
            slupek(g.procent),
          ]),
          [false, true, true, true, false]
        )
      );
    }

    const miesiace = regulyStatystyk.zadaniaWedlugMiesiecy(zadania);
    if (miesiace.length > 0) {
      const najwiecej = Math.max(...miesiace.map((m) => m.ile));
      sekcja.appendChild(el('h3', null, 'Ukończone według miesiąca'));
      sekcja.appendChild(
        tabela(
          ['Miesiąc', 'Ukończonych', ''],
          miesiace.map((m) => [m.miesiac, String(m.ile), slupek((100 * m.ile) / najwiecej)]),
          [false, true, false]
        )
      );
    }

    return sekcja;
  }

  const PROG_TERMINOWOSCI = 10;

  /** Priorytet jest liczba - etykiete bierzemy ze slownika, tak jak w tabeli zadan. */
  function etykietaPriorytetu(numer) {
    const poz = (slowniki.priorytety || []).find((p) => String(p.numer) === String(numer));
    return poz ? `${numer} — ${poz.etykieta}` : String(numer);
  }

  // ==========================================================================
  // Sekcje - wspolne elementy
  // ==========================================================================

  /*
    Kolejnosc sekcji = kolejnosc na stronie i w nawigacji kotwicowej.

    Ulozona od PYTAN NAJPROSTSZYCH do najbardziej wnioskowych: najpierw czy w ogole
    piszesz (konsekwencja), potem jak wyglada typowy tydzien, potem jak sie czujesz,
    a dopiero na koncu co z czym wspolwystepuje. Zadania sa nizej niz dziennik,
    bo dziennik ma 843 wpisy, a ukonczenia zadan potrafia miec 1 na miesiac -
    ladniejszy wykres nie znaczy wazniejszej informacji.
  */
  const SEKCJE = [
    { id: 'konsekwencja', tytul: 'Konsekwencja' },
    { id: 'tydzien', tytul: 'Rytm tygodnia' },
    { id: 'samopoczucie', tytul: 'Samopoczucie' },
    { id: 'wplyw', tytul: 'Co Ci służy' },
    { id: 'zadania', tytul: 'Zadania' },
    { id: 'postep', tytul: 'Postęp' },
  ];

  function naglowekSekcji(id, tytul, podtytul) {
    const sekcja = document.createElement('section');
    sekcja.id = id;
    sekcja.className = 'sekcja-statystyk';
    sekcja.appendChild(el('h2', null, tytul));
    if (podtytul) sekcja.appendChild(el('p', 'podstawa', podtytul));
    return sekcja;
  }

  function nawigacja() {
    const nav = el('nav', 'nawigacja-statystyk');
    nav.setAttribute('aria-label', 'Sekcje statystyk');
    for (const s of SEKCJE) {
      const a = document.createElement('a');
      a.href = '#' + s.id;
      a.textContent = s.tytul;
      nav.appendChild(a);
    }
    return nav;
  }

  /** Liczba z jawnym znakiem - do odchylen, gdzie kierunek jest cala trescia. */
  function zeZnakiem(wartosc, miejsc = 2) {
    if (wartosc === null || wartosc === undefined || Number.isNaN(wartosc)) return '—';
    return (wartosc > 0 ? '+' : '') + liczba(wartosc, miejsc);
  }

  // ==========================================================================
  // 1. Konsekwencja
  // ==========================================================================

  function sekcjaKonsekwencji(wpisy, statDziennika) {
    const s = naglowekSekcji('konsekwencja', 'Konsekwencja', 'Jak regularnie prowadzisz dziennik.');

    const serie = regulyStatystyk.serieDni(wpisy);
    const pok = regulyStatystyk.pokrycie(wpisy);

    const karty = el('div', 'karty');
    karty.append(
      karta('Wpisów łącznie', liczba(statDziennika.lacznie, 0), `${statDziennika.odDaty} → ${statDziennika.doDaty}`),
      karta(
        'Pokrycie',
        procent(pok.procent),
        `${liczba(pok.dniZWpisem, 0)} z ${liczba(pok.dniWZakresie, 0)} dni w zakresie`
      ),
      karta('Najdłuższa seria', `${liczba(serie.najdluzsza, 0)} dni`, `${serie.odDnia} → ${serie.doDnia}`),
      /*
        Seria "obecna" liczy sie od OSTATNIEGO wpisu, nie od dzisiaj - stad data
        w podstawie karty. Bez niej liczba klamalaby po kilku dniach przerwy.
      */
      karta('Seria na koniec', `${liczba(serie.obecna, 0)} dni`, `do ${serie.ostatniDzien}`)
    );
    s.appendChild(karty);

    s.appendChild(el('h3', null, 'Miesiące — wpisy i odsetek z refleksją'));
    s.appendChild(
      el(
        'p',
        'podstawa',
        'Refleksja = wypełnione co najmniej jedno z pól: ' +
          regulyStatystyk.POLA_REFLEKSYJNE.join(', ') +
          '.'
      )
    );
    s.appendChild(
      tabela(
        ['Miesiąc', 'Wpisów', 'Z refleksją', 'Odsetek', ''],
        statDziennika.miesiace.map((m) => [
          m.miesiac,
          String(m.wpisow),
          String(m.zRefleksja),
          procent(m.procent),
          slupek(m.procent),
        ]),
        [false, true, true, true, false]
      )
    );

    return s;
  }

  // ==========================================================================
  // 2. Rytm tygodnia
  // ==========================================================================

  function sekcjaTygodnia(wpisy) {
    const s = naglowekSekcji(
      'tydzien',
      'Rytm tygodnia',
      'Średnie w rozbiciu na dzień tygodnia. Weekend wyróżniony.'
    );

    const dni = regulyStatystyk.wedlugDniTygodnia(wpisy);

    const wiersze = dni.map((d) => {
      const komorki = [
        d.nazwa,
        String(d.wpisow),
        liczba(d.sen),
        liczba(d.jakosc_snu, 2),
        liczba(d.stres, 2),
        liczba(d.nastroj, 2),
        d.pobudka ?? '—',
      ];
      return { komorki, weekend: d.weekend };
    });

    const t = tabela(
      ['Dzień', 'Wpisów', 'Sen (h)', 'Jakość snu', 'Spokój', 'Nastrój', 'Pobudka'],
      wiersze.map((w) => w.komorki),
      [false, true, true, true, true, true, true]
    );
    // Wyroznienie weekendu robi klasa na wierszu, nie osobna tabela.
    [...t.querySelectorAll('tbody tr')].forEach((tr, i) => {
      if (wiersze[i].weekend) tr.className = 'weekend';
    });
    s.appendChild(t);

    return s;
  }

  // ==========================================================================
  // 3. Samopoczucie
  // ==========================================================================

  function sekcjaSamopoczucia(wpisy, s0) {
    const s = naglowekSekcji('samopoczucie', 'Samopoczucie', 'Oceny dzienne: średnie, rozkłady i trend.');

    const karty = el('div', 'karty');
    karty.appendChild(
      karta(
        'Sen — średnia',
        s0.sen.srednia === null ? '—' : liczba(s0.sen.srednia) + ' h',
        `min ${liczba(s0.sen.min, 0)} h, max ${liczba(s0.sen.max, 0)} h`
      )
    );
    karty.appendChild(
      karta(
        'Sen — wypełnienie',
        procent(s0.sen.procentWypelnienia),
        `${s0.sen.ile} z ${s0.lacznie} wpisów`
      )
    );
    s.appendChild(karty);

    /*
      Tabela srednich zostaje w calosci ze starego widoku - min, max i odsetek
      wypelnienia niosa informacje, ktorej sama srednia nie ma. Kolumna "Skala"
      mowi o zakresie (Spokoj ma 0-5, reszta 1-5); to fakt o skali, nie pulapka,
      dlatego kolumna, a nie baner.
    */
    s.appendChild(el('h3', null, 'Średnie'));
    s.appendChild(
      tabela(
        ['Ocena', 'Skala', 'Średnia', 'Min', 'Max', 'Wypełnionych'],
        s0.oceny.map((o) => [
          ETYKIETY_OCEN[o.pole],
          o.pole === 'stres' ? '0–5' : '1–5',
          liczba(o.srednia, 2),
          o.min === null ? '—' : String(o.min),
          o.max === null ? '—' : String(o.max),
          `${o.ile} (${procent(o.procentWypelnienia)})`,
        ]),
        [false, false, true, true, true, true]
      )
    );

    s.appendChild(el('h3', null, 'Trend miesięczny'));
    const oceny = ['jakosc_snu', 'stres', 'nastroj', 'intencjonalnosc'];
    const trend = regulyStatystyk.trendMiesieczny(wpisy, oceny);
    s.appendChild(
      tabela(
        ['Miesiąc', 'Wpisów', ...oceny.map((o) => ETYKIETY_OCEN[o])],
        trend.map((m) => [m.miesiac, String(m.wpisow), ...oceny.map((o) => liczba(m[o], 2))]),
        [false, true, true, true, true, true]
      )
    );

    s.appendChild(el('h3', null, 'Rozkład wartości'));
    for (const o of s0.oceny) {
      s.appendChild(
        el('h3', 'podnaglowek', ETYKIETY_OCEN[o.pole] + (o.pole === 'stres' ? ' — skala 0–5 (0 = skrajny stres)' : ''))
      );
      if (o.rozklad.length === 0) {
        s.appendChild(el('p', 'brak-danych', 'Brak wypełnionych wartości.'));
        continue;
      }
      const suma = o.rozklad.reduce((a, r) => a + r.ile, 0);
      s.appendChild(
        tabela(
          ['Wartość', 'Dni', 'Udział', ''],
          o.rozklad.map((r) => [
            opisOceny(o.pole, r.wartosc),
            String(r.ile),
            procent((100 * r.ile) / suma),
            slupek((100 * r.ile) / suma),
          ]),
          [false, true, true, false]
        )
      );
    }

    return s;
  }

  // ==========================================================================
  // 4. Co Ci sluzy
  // ==========================================================================

  const PROG_SLOWA = 20;
  const PROG_NAWYKI = 30;

  function tabelaWplywu(dane, pole) {
    const pozycje = [...dane.pozycje].sort(
      (a, b) => (b.oceny[pole].odchylenie ?? 0) - (a.oceny[pole].odchylenie ?? 0)
    );

    return tabela(
      ['Wartość', 'Dni', 'Spokój', 'Nastrój', 'Odchylenie'],
      pozycje.map((p) => [
        p.nazwa,
        String(p.wystapien),
        liczba(p.oceny.stres.srednia, 2),
        liczba(p.oceny.nastroj.srednia, 2),
        zeZnakiem(p.oceny[pole].odchylenie),
      ]),
      [false, true, true, true, true]
    );
  }

  function sekcjaWplywu(wpisy) {
    const s = naglowekSekcji('wplyw', 'Co Ci służy', null);

    /*
      OSTRZEZENIE STOI PRZED TABELAMI, nie pod nimi - czytane po liczbach byloby
      juz spoznione. Cala sekcja pokazuje WSPOLWYSTEPOWANIE: slowo "Difficult"
      nie obniza spokoju, tylko opisuje dzien, w ktorym spokoju bylo mniej.
      Kierunek przyczyny moze byc dowolny albo moze go nie byc wcale.
    */
    s.appendChild(
      el(
        'p',
        'uwaga-korelacja',
        'To współwystępowanie, nie przyczyna. Liczby mówią, jak wyglądały dni, ' +
          'w których dana wartość się pojawiła — nie co ją spowodowało ani co z niej wynika. ' +
          `Pokazujemy tylko wartości z co najmniej ${PROG_SLOWA} dniami (słowa) ` +
          `i ${PROG_NAWYKI} (nawyki); przy mniejszej liczbie średnia to pojedynczy dzień.`
      )
    );

    const slowa = regulyStatystyk.wplywWartosci(wpisy, 'trzy_slowa', ['stres', 'nastroj'], PROG_SLOWA);
    const nawyki = regulyStatystyk.wplywWartosci(wpisy, 'nawyki', ['stres', 'nastroj'], PROG_NAWYKI);

    s.appendChild(
      el(
        'p',
        'podstawa',
        `Twoje średnie: Spokój ${liczba(slowa.bazowe.stres, 2)}, Nastrój ${liczba(slowa.bazowe.nastroj, 2)}. ` +
          'Odchylenie liczy się względem nich.'
      )
    );

    s.appendChild(el('h3', null, `Słowa (min. ${PROG_SLOWA} dni) — według Spokoju`));
    if (slowa.pozycje.length === 0) {
      s.appendChild(el('p', 'brak-danych', 'Za mało danych.'));
    } else {
      s.appendChild(tabelaWplywu(slowa, 'stres'));
    }

    s.appendChild(el('h3', null, `Nawyki (min. ${PROG_NAWYKI} dni) — według Nastroju`));
    if (nawyki.pozycje.length === 0) {
      s.appendChild(el('p', 'brak-danych', 'Za mało danych.'));
    } else {
      s.appendChild(tabelaWplywu(nawyki, 'nastroj'));
    }

    return s;
  }

  // ==========================================================================
  // 6. Postep
  // ==========================================================================

  function sekcjaPostepu(wpisy, zadania) {
    const s = naglowekSekcji(
      'postep',
      'Postęp',
      'XP zdobyte w kolejnych miesiącach, w rozbiciu na źródła.'
    );

    const miesiace = regulyStatystyk.xpWedlugMiesiecy(wpisy, zadania);
    if (miesiace.length === 0) {
      s.appendChild(el('p', 'brak-danych', 'Brak danych.'));
      return s;
    }

    const najwiekszy = Math.max(...miesiace.map((m) => m.razem));
    s.appendChild(
      tabela(
        ['Miesiąc', 'Dziennik', 'Zadania', 'Razem', ''],
        miesiace.map((m) => [
          m.miesiac,
          liczba(m.dziennik, 0),
          liczba(m.zadania, 0),
          liczba(m.razem, 0),
          slupek(najwiekszy === 0 ? 0 : (100 * m.razem) / najwiekszy),
        ]),
        [false, true, true, true, false]
      )
    );

    return s;
  }

  // ==========================================================================
  // Start
  // ==========================================================================

  async function start() {
    try {
      const [zadania, wpisy, pobraneSlowniki] = await Promise.all([
        api.get('/api/zadania'),
        api.get('/api/dziennik'),
        api.get('/api/slowniki'),
      ]);
      slowniki = pobraneSlowniki;

      const statZadan = regulyStatystyk.statystykiZadan(zadania, slowniki);
      const statDziennika = regulyStatystyk.statystykiDziennika(wpisy);

      /*
        JEDNA LISTA, NIE DWIE.

        Spis tresci i kolejnosc sekcji na stronie bralyby sie z dwoch osobnych
        miejsc - a rownolegle listy w tym projekcie rozjezdzaja sie po cichu
        (numerDnia w trzech kopiach, licznik refleksji pod zla kolumna).
        Dlatego sekcje POWSTAJA Z tablicy SEKCJE: dopisanie pozycji tam i tylko tam
        dodaje zarowno link, jak i tresc, a pominiecie budowniczego jest bledem,
        ktory widac od razu.
      */
      const budowniczowie = {
        konsekwencja: () => sekcjaKonsekwencji(wpisy, statDziennika),
        tydzien: () => sekcjaTygodnia(wpisy),
        samopoczucie: () => sekcjaSamopoczucia(wpisy, statDziennika),
        wplyw: () => sekcjaWplywu(wpisy),
        zadania: () => sekcjaZadan(statZadan, zadania),
        postep: () => sekcjaPostepu(wpisy, zadania),
      };

      const brakujacy = SEKCJE.filter((s) => !budowniczowie[s.id]).map((s) => s.id);
      if (brakujacy.length > 0) {
        throw new Error(`Sekcje bez budowniczego: ${brakujacy.join(', ')}.`);
      }

      elTresc.replaceChildren(nawigacja(), ...SEKCJE.map((s) => budowniczowie[s.id]()));

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
