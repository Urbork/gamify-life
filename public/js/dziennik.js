/*
  Widok tabeli dziennika: renderowanie, sortowanie, edycja inline, eksport CSV.

  Ten sam wzorzec co public/js/zadania.js:
  - `wpisy` to lokalna kopia bazy (Map: id -> rekord), pobierana raz przy starcie;
  - kazda zmiana w komorce leci PATCH-em, a odpowiedz serwera nadpisuje kopie;
  - nieudany zapis cofa komorke, zeby tabela nigdy nie pokazywala czegos,
    czego nie ma w bazie;
  - przebudowa tabeli tylko wtedy, gdy zmiana faktycznie przesuwa wiersze.
*/

(() => {
  'use strict';

  // Lokalna kopia stanu bazy.
  const wpisy = new Map();

  // Domyslnie najnowszy wpis u gory - dziennik czyta sie od konca.
  const sortowanie = { kolumna: 'data', kierunek: 'malejaco' };

  const elWiersze = document.getElementById('wiersze');
  const elNaglowki = document.getElementById('naglowki');
  const elStatus = document.getElementById('status');
  const elPodsumowanie = document.getElementById('podsumowanie');
  const elDodaj = document.getElementById('przycisk-dodaj');
  const elEksport = document.getElementById('przycisk-eksport');

  // Panel filtrow
  const elPanelFiltrow = document.getElementById('panel-filtrow');
  const elZnacznikFiltrow = document.getElementById('znacznik-filtrow');
  const elFiltrSzukaj = document.getElementById('filtr-szukaj');
  const elFiltrNawyki = document.getElementById('filtr-nawyki');
  const elPresety = document.getElementById('presety-dat');
  const elFiltrOd = document.getElementById('filtr-od');
  const elFiltrDo = document.getElementById('filtr-do');
  const elWyczysc = document.getElementById('przycisk-wyczysc');

  // Slowniki z /api/slowniki - stad biora sie opisy ocen (plakietki w dropdownach).
  let slowniki = { oceny: {} };

  /*
    Slownik nawykow z GET /api/nawyki - [{ id, nazwa }].
    Od migracji 4 mieszka w bazie i jest edytowalny z panelu, wiec po kazdej
    zmianie trzeba go przeladowac I przebudowac zarowno panel, jak i filtr.
  */
  let nawykiSlownik = [];

  // Panel nawykow
  const elPanelNawykow = document.getElementById('panel-nawykow');
  const elListaNawykow = document.getElementById('lista-nawykow');
  const elNowyNawyk = document.getElementById('nowy-nawyk');
  const elDodajNawyk = document.getElementById('dodaj-nawyk');
  const elZamknijNawyki = document.getElementById('zamknij-nawyki');

  // Komorka, dla ktorej panel jest aktualnie otwarty (null = panel zamkniety).
  let komorkaPanelu = null;

  // Dzisiejsza data wedlug SERWERA (GET /api/czas) - od niej licza sie presety.
  let dzisiajSerwera = null;

  // ==========================================================================
  // Definicje kolumn
  // ==========================================================================

  /*
    Jedno miejsce opisujace wszystkie kolumny: typ kontrolki, klasa CSS i zakres.
    Z tego powstaja i wiersze tabeli, i kolumny eksportu CSV - dzieki temu
    dodanie pola do dziennika to jeden wpis tutaj plus migracja i whitelist w routes.

    Kolejnosc MUSI sie zgadzac z naglowkami w public/dziennik.html.
  */
  const KOLUMNY = [
    { pole: 'data', typ: 'data', klasa: 'kol-dzien' },
    { pole: 'pobudka', typ: 'godzina', klasa: 'kol-godzina' },
    { pole: 'godziny_snu', typ: 'liczba', klasa: 'kol-ocena', min: 0, max: 24, krok: 0.5 },
    { pole: 'jakosc_snu', typ: 'ocena', klasa: 'kol-ocena', min: 1, max: 5 },
    // Stres ma skale od 0 (0 = bardzo wysoki, 5 = brak stresu) - inaczej niz reszta.
    { pole: 'stres', typ: 'ocena', klasa: 'kol-ocena', min: 0, max: 5 },
    { pole: 'nastroj', typ: 'ocena', klasa: 'kol-ocena', min: 1, max: 5 },
    { pole: 'intencjonalnosc', typ: 'ocena', klasa: 'kol-ocena', min: 1, max: 5 },
    { pole: 'trzy_slowa', typ: 'tekst', klasa: 'kol-tekst' },
    { pole: 'nawyki', typ: 'nawyki', klasa: 'kol-tekst-szeroki' },
    { pole: 'wdziecznosc', typ: 'tekst', klasa: 'kol-tekst' },
    { pole: 'bledy', typ: 'tekst', klasa: 'kol-tekst' },
    { pole: 'rozmowa', typ: 'tekst', klasa: 'kol-tekst' },
    { pole: 'co_poszlo_dobrze', typ: 'tekst', klasa: 'kol-tekst' },
    { pole: 'jutro_wazne', typ: 'tekst', klasa: 'kol-tekst' },
    { pole: 'do_przemyslenia', typ: 'tekst', klasa: 'kol-tekst' },
    { pole: 'sniadanie', typ: 'tekst', klasa: 'kol-tekst' },
    { pole: 'obiad', typ: 'tekst', klasa: 'kol-tekst' },
    { pole: 'kolacja', typ: 'tekst', klasa: 'kol-tekst' },
  ];

  // ==========================================================================
  // Filtrowanie
  // ==========================================================================

  /*
    Stan filtrow. Pusty zbior nawykow oznacza "nie filtruj po nawyku" - to naturalne
    zachowanie listy checkboxow: nic nie zaznaczone = wszystko przechodzi.
    Wszystkie pola lacza sie przez ORAZ, zaznaczenia w obrebie nawykow przez LUB.
  */
  const filtry = {
    szukaj: '',
    nawyki: new Set(),
    od: '', // 'YYYY-MM-DD' albo '' = brak dolnej granicy
    do: '',
  };

  // Dziennik nie potrzebuje presetu "Dziś + jutro" - wpisy dotycza dni, ktore juz byly.
  const P = filtrDat.PRESETY;
  const PRESETY_DAT = [P.WSZYSTKIE, P.DZIS, P.TYDZIEN, P.MIESIAC];

  /*
    Predykaty filtrow siedza w public/js/reguly-dziennika.js - to czyste funkcje
    bez DOM, wiec da sie je przetestowac skryptem (npm run test:smoke).
  */

  /** Wpisy spelniajace WSZYSTKIE aktywne filtry. */
  function filtrowane(lista = [...wpisy.values()]) {
    return regulyDziennika.filtrowane(lista, filtry);
  }

  /** Ile pol filtrow jest aktywnych (do znacznika przy zwinietym panelu). */
  function ileAktywnychFiltrow() {
    return regulyDziennika.ileAktywnych(filtry);
  }

  // ==========================================================================
  // Sortowanie
  // ==========================================================================

  /*
    Reguly (puste na koncu takze przy malejaco, remisy po id) siedza
    w public/js/reguly-dziennika.js.
  */
  function posortowane(lista = [...wpisy.values()]) {
    return regulyDziennika.posortowane(lista, sortowanie);
  }

  function przelaczSortowanie(kolumna) {
    if (sortowanie.kolumna === kolumna) {
      sortowanie.kierunek = sortowanie.kierunek === 'rosnaco' ? 'malejaco' : 'rosnaco';
    } else {
      sortowanie.kolumna = kolumna;
      // Daty domyslnie od najnowszej, reszta od najmniejszej.
      sortowanie.kierunek = kolumna === 'data' ? 'malejaco' : 'rosnaco';
    }
    renderuj();
  }

  function odswiezNaglowki() {
    for (const th of elNaglowki.querySelectorAll('th[data-kolumna]')) {
      const aktywna = th.dataset.kolumna === sortowanie.kolumna;
      th.dataset.kierunek = aktywna ? sortowanie.kierunek : '';
      th.setAttribute(
        'aria-sort',
        aktywna ? (sortowanie.kierunek === 'rosnaco' ? 'ascending' : 'descending') : 'none'
      );
    }
  }

  // ==========================================================================
  // Budowanie komorek
  // ==========================================================================

  function komorkaId(w) {
    const td = document.createElement('td');
    td.className = 'kol-id';
    td.textContent = w.id;
    return td;
  }

  /** Komorka tekstowa (contenteditable). Zapis przy opuszczeniu pola. */
  function komorkaTekst(w, kolumna) {
    const td = document.createElement('td');
    td.className = kolumna.klasa;
    td.dataset.pole = kolumna.pole;
    td.contentEditable = 'true';
    // textContent, nie innerHTML - tresc od uzytkownika nigdy nie jest HTML-em.
    td.textContent = w[kolumna.pole] ?? '';

    td.addEventListener('blur', () => {
      const nowa = td.textContent.trim();
      const rekord = wpisy.get(w.id);
      if (!rekord) return;
      if (nowa === (rekord[kolumna.pole] ?? '')) return;
      zapisz(td.closest('tr'), kolumna.pole, nowa);
    });

    td.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        td.blur();
      }
      if (e.key === 'Escape') {
        const rekord = wpisy.get(w.id);
        td.textContent = rekord ? rekord[kolumna.pole] ?? '' : '';
        td.blur();
      }
    });

    return td;
  }

  /** Komorka z kontrolka (data / godzina / liczba). */
  function komorkaInput(w, kolumna, typInput) {
    const td = document.createElement('td');
    td.className = kolumna.klasa;
    td.dataset.pole = kolumna.pole;

    const input = document.createElement('input');
    input.type = typInput;
    if (kolumna.min !== undefined) input.min = kolumna.min;
    if (kolumna.max !== undefined) input.max = kolumna.max;
    if (kolumna.krok !== undefined) input.step = kolumna.krok;
    input.value = w[kolumna.pole] ?? '';

    input.addEventListener('change', () => zapisz(td.closest('tr'), kolumna.pole, input.value));

    td.appendChild(input);
    return td;
  }

  /**
   * Komorka z ocena - lista rozwijana z plakietka "liczba emoji opis".
   *
   * ZAPISYWANA WARTOSC TO NADAL SAMA LICZBA. Emoji i opis sa wylacznie etykieta
   * opcji; kolumny w bazie zostaja INTEGER-ami, wiec statystyki i sortowanie
   * dzialaja bez zmian. Opisy przychodza z /api/slowniki (config/mapowanie-ocen.js).
   *
   * Przy stresie opis slowny jest szczegolnie potrzebny - skala jest odwrocona
   * (0 = bardzo wysoki stres), wiec sama cyfra latwo myli.
   */
  function komorkaOcena(w, kolumna) {
    const td = document.createElement('td');
    td.className = kolumna.klasa;
    td.dataset.pole = kolumna.pole;

    const select = document.createElement('select');
    select.className = 'plakietka';
    select.appendChild(new Option('', '')); // brak oceny jest dozwolony, nie wymuszamy wyboru

    const opisy = (slowniki.oceny && slowniki.oceny[kolumna.pole]) || null;
    if (opisy) {
      for (const o of opisy) {
        select.appendChild(new Option(`${o.wartosc} ${o.emoji} ${o.opis}`, o.wartosc));
      }
    } else {
      // Zapasowo gole liczby - gdyby mapowanie nie doszlo, komorka ma dalej dzialac.
      for (let i = kolumna.min; i <= kolumna.max; i++) select.appendChild(new Option(i, i));
    }

    // ?? zamiast || - ocena 0 (stres "bardzo wysoki") jest w JS falszywa.
    const wartosc = w[kolumna.pole] ?? '';

    // Wartosc spoza mapowania (np. po recznej zmianie w bazie) dopisujemy,
    // zeby edycja innej kolumny nie podmienila jej po cichu.
    if (wartosc !== '' && !select.querySelector(`option[value="${wartosc}"]`)) {
      select.appendChild(new Option(`${wartosc} (spoza skali)`, wartosc));
    }

    select.value = wartosc;
    select.addEventListener('change', () => zapisz(td.closest('tr'), kolumna.pole, select.value));

    td.appendChild(select);
    return td;
  }

  /**
   * Komorka z nawykami - klikniecie otwiera panel wyboru wielokrotnego.
   *
   * Celowo NIE jest to pole tekstowe: lista jest zamknieta i edytowalna ze slownika,
   * a reczne wpisywanie nazw rozjezdzaloby sie z nim przy pierwszej literowce.
   */
  function komorkaNawykow(w, kolumna) {
    const td = document.createElement('td');
    td.className = kolumna.klasa + ' komorka-nawykow';
    td.dataset.pole = kolumna.pole;
    td.tabIndex = 0; // dostepna z klawiatury
    td.title = 'Kliknij, aby wybrać nawyki';
    td.textContent = w[kolumna.pole] ?? '';

    const otworz = () => otworzPanelNawykow(td);
    td.addEventListener('click', otworz);
    td.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        otworz();
      }
    });

    return td;
  }

  function komorkaUsun(w) {
    const td = document.createElement('td');
    td.className = 'kol-akcje';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'usun';
    btn.textContent = '×';
    btn.title = 'Usuń wpis';
    btn.addEventListener('click', () => usunWpis(w.id));

    td.appendChild(btn);
    return td;
  }

  function komorkaDla(w, kolumna) {
    switch (kolumna.typ) {
      case 'data':
        return komorkaInput(w, kolumna, 'date');
      case 'godzina':
        return komorkaInput(w, kolumna, 'time');
      case 'liczba':
        return komorkaInput(w, kolumna, 'number');
      case 'ocena':
        return komorkaOcena(w, kolumna);
      case 'nawyki':
        return komorkaNawykow(w, kolumna);
      default:
        return komorkaTekst(w, kolumna);
    }
  }

  // ==========================================================================
  // Renderowanie
  // ==========================================================================

  /*
    Licznik "4/6" - ile z szesciu pol refleksyjnych ma tresc.
    Informacyjny, tylko do odczytu; te same pola licza sie do XP na stronie Postać.
    Liste pol bierzemy z reguly-statystyk.js, zeby nie definiowac jej tu drugi raz.
  */
  function komorkaRefleksji(w) {
    const td = document.createElement('td');
    td.className = 'kol-refleksje';
    td.dataset.wyliczane = 'refleksje';

    const pola = regulyStatystyk.POLA_REFLEKSYJNE;
    const ile = pola.filter((p) => regulyStatystyk.wypelnione(w[p])).length;

    td.textContent = `${ile}/${pola.length}`;
    td.title = `Wypełnione pola refleksyjne: ${ile} z ${pola.length}`;
    return td;
  }

  function zbudujWiersz(w) {
    const tr = document.createElement('tr');
    tr.dataset.id = w.id;

    tr.appendChild(komorkaId(w));
    for (const kolumna of KOLUMNY) tr.appendChild(komorkaDla(w, kolumna));
    tr.appendChild(komorkaRefleksji(w));
    tr.appendChild(komorkaUsun(w));

    return tr;
  }

  // Zapamietanie i odtworzenie fokusu wokol przebudowy tabeli - inaczej Tab
  // miedzy komorkami gubilby sie, gdy w tle przyjdzie odpowiedz serwera.
  function zapamietajFokus() {
    const el = document.activeElement;
    if (!el || !elWiersze.contains(el)) return null;
    const tr = el.closest('tr');
    const td = el.closest('td');
    if (!tr || !td || !td.dataset.pole) return null;
    return { id: tr.dataset.id, pole: td.dataset.pole };
  }

  function odtworzFokus(zapamietany) {
    if (!zapamietany) return;
    const td = elWiersze.querySelector(
      `tr[data-id="${zapamietany.id}"] [data-pole="${zapamietany.pole}"]`
    );
    if (!td) return;
    (td.querySelector('select, input') || td).focus();
  }

  /*
    Potok wyswietlania: najpierw odsiew, potem porzadkowanie.
    Eksport CSV CELOWO go nie uzywa - wola posortowane() bez argumentu, czyli
    na calym zbiorze, zeby filtry nie okrajaly eksportowanego pliku.
  */
  function doWyswietlenia() {
    return posortowane(filtrowane());
  }

  function renderuj() {
    const fokus = zapamietajFokus();
    elWiersze.replaceChildren(...doWyswietlenia().map(zbudujWiersz));
    odtworzFokus(fokus);
    odswiezNaglowki();
    odswiezDuplikatyDat();
    odswiezPodsumowanie();
  }

  /*
    MIEKKIE ostrzezenie o duplikacie daty.

    Kolumna `data` nie ma w bazie ograniczenia UNIQUE i to jest zamierzone -
    jeden dzien moze miec wiecej niz jeden wpis. Dlatego to UWAGA, a nie blad:
    zapis przechodzi normalnie, zmienia sie wylacznie wyglad komorki.

    Sprawdzamy WYLACZNIE lokalna kopie danych (`wpisy`) - zadnego zapytania do serwera.

    Przebiegamy po WSZYSTKICH wierszach, a nie tylko po edytowanym. Wymog
    "znika, gdy duplikat przestaje istniec" tego wymaga: gdy wpis A odsunie sie
    od daty wpisu B, to wlasnie B przestaje byc duplikatem. Sprawdzenie samego A
    zostawiloby przy B ostrzezenie na zawsze.
  */
  function odswiezDuplikatyDat() {
    // data -> lista id wszystkich wpisow z ta data (takze tych ukrytych przez filtry,
    // bo duplikat jest duplikatem niezaleznie od tego, co akurat widac na ekranie).
    const wgDaty = new Map();
    for (const w of wpisy.values()) {
      if (!w.data) continue;
      if (!wgDaty.has(w.data)) wgDaty.set(w.data, []);
      wgDaty.get(w.data).push(w.id);
    }

    for (const tr of elWiersze.children) {
      const td = tr.querySelector('[data-pole="data"]');
      if (!td) continue;

      const id = Number(tr.dataset.id);
      const w = wpisy.get(id);
      const inne = w && w.data ? (wgDaty.get(w.data) || []).filter((x) => x !== id) : [];

      td.classList.toggle('duplikat-daty', inne.length > 0);

      if (inne.length > 0) {
        const ktore = inne.length === 1 ? `id ${inne[0]}` : `id: ${inne.join(', ')}`;
        td.title = `Uwaga: inny wpis już ma tę datę (${ktore}). To dozwolone — zapis się udał.`;
      } else {
        td.removeAttribute('title');
      }
    }
  }

  /**
   * Czy zawartosc tabeli rozni sie od tej, ktora powinna byc?
   * Wychwytuje nie tylko zmiane kolejnosci, ale i wypadniecie wiersza z filtra
   * (np. po edycji daty poza wybrany zakres) - listy maja wtedy rozne dlugosci.
   */
  function kolejnoscSieZmienila() {
    const oczekiwana = doWyswietlenia().map((w) => w.id);
    const obecna = [...elWiersze.children].map((tr) => Number(tr.dataset.id));
    return oczekiwana.length !== obecna.length || oczekiwana.some((id, i) => id !== obecna[i]);
  }

  /** Synchronizuje wiersz z lokalna kopia danych, bez przebudowy tabeli. */
  function zaktualizujWiersz(tr) {
    const w = wpisy.get(Number(tr.dataset.id));
    if (!w) return;

    for (const td of tr.querySelectorAll('[data-pole]')) {
      const kontrolka = td.querySelector('select, input');
      const element = kontrolka || td;
      // Pola, w ktorym ktos wlasnie pisze, nie ruszamy.
      if (element === document.activeElement) continue;

      const wartosc = w[td.dataset.pole] ?? '';
      if (kontrolka) kontrolka.value = wartosc;
      else td.textContent = wartosc;
    }

    // Licznik refleksji zalezy od tresci pol, wiec musi sie przeliczyc po zapisie.
    const tdRefleksje = tr.querySelector('[data-wyliczane="refleksje"]');
    if (tdRefleksje) tdRefleksje.replaceWith(komorkaRefleksji(w));
  }

  function przywrocKomorke(tr, pole) {
    const w = wpisy.get(Number(tr.dataset.id));
    const td = tr.querySelector(`[data-pole="${pole}"]`);
    if (!w || !td) return;

    const kontrolka = td.querySelector('select, input');
    if (kontrolka) kontrolka.value = w[pole] ?? '';
    else td.textContent = w[pole] ?? '';
  }

  // ==========================================================================
  // Operacje na danych
  // ==========================================================================

  async function zapisz(tr, pole, wartosc) {
    const id = Number(tr.dataset.id);
    try {
      const zaktualizowany = await api.patch(`/api/dziennik/${id}`, { [pole]: wartosc });
      wpisy.set(id, zaktualizowany);
      tr.classList.remove('blad-zapisu');

      if (kolejnoscSieZmienila()) {
        renderuj(); // renderuj() samo odswieza znaczniki duplikatow
      } else {
        zaktualizujWiersz(tr);
        // Sciezka bez przebudowy tabeli - znaczniki trzeba przeliczyc osobno.
        odswiezDuplikatyDat();
      }

      pokazStatus('zapisano', 'ok');
    } catch (e) {
      tr.classList.add('blad-zapisu');
      przywrocKomorke(tr, pole);
      pokazStatus(e.message, 'blad');
    }
  }

  async function dodajWpis() {
    try {
      // Date dzisiejsza nadaje serwer - patrz routes/dziennik.js.
      const nowy = await api.post('/api/dziennik');
      wpisy.set(nowy.id, nowy);
      renderuj();

      const tr = elWiersze.querySelector(`tr[data-id="${nowy.id}"]`);
      if (tr) {
        tr.scrollIntoView({ block: 'nearest' });
        tr.querySelector('[data-pole="pobudka"] input').focus();
      }
    } catch (e) {
      pokazStatus(e.message, 'blad');
    }
  }

  async function usunWpis(id) {
    const w = wpisy.get(id);
    const etykieta = w && w.data ? `z ${w.data}` : `#${id}`;
    if (!confirm(`Usunąć wpis ${etykieta}? Tej operacji nie da się cofnąć.`)) return;

    try {
      await api.usun(`/api/dziennik/${id}`);
      wpisy.delete(id);
      renderuj();
      pokazStatus('usunięto', 'ok');
    } catch (e) {
      pokazStatus(e.message, 'blad');
    }
  }

  // ==========================================================================
  // Eksport CSV
  // ==========================================================================

  function eksportujCsv() {
    const wszystkie = posortowane();
    if (wszystkie.length === 0) {
      pokazStatus('Nie ma czego eksportować.', 'blad');
      return;
    }

    const naglowki = KOLUMNY.map((k) => k.pole);
    const wiersze = wszystkie.map((w) => KOLUMNY.map((k) => w[k.pole]));

    // Data w nazwie pliku wg zegara przegladarki - tak samo jak przy eksporcie zadan.
    csv.pobierz(`dziennik-eksport-${filtrDat.dzisiajLokalnie()}.csv`, naglowki, wiersze);
    pokazStatus(`wyeksportowano ${wszystkie.length}`, 'ok');
  }

  // ==========================================================================
  // Interfejs pomocniczy
  // ==========================================================================

  let timerStatusu = null;

  function pokazStatus(tekst, typ) {
    elStatus.textContent = tekst;
    elStatus.className = 'status ' + (typ || '');
    clearTimeout(timerStatusu);
    timerStatusu = setTimeout(
      () => {
        elStatus.textContent = '';
        elStatus.className = 'status';
      },
      typ === 'blad' ? 8000 : 1500
    );
  }

  function odswiezPodsumowanie() {
    const wszystkie = [...wpisy.values()];
    if (wszystkie.length === 0) {
      elPodsumowanie.textContent = 'Brak wpisów.';
      return;
    }

    const widoczne = filtrowane(wszystkie);
    const daty = widoczne
      .map((w) => w.data)
      .filter(Boolean)
      .sort();
    const zakres = daty.length > 0 ? ` (od ${daty[0]} do ${daty[daty.length - 1]})` : '';

    elPodsumowanie.textContent = `Pokazano ${widoczne.length} z ${wszystkie.length} wpisów${zakres}`;
  }

  // ==========================================================================
  // Panel nawykow
  // ==========================================================================

  /** Rozbija zawartosc komorki na pojedyncze nazwy - ta sama zasada co na serwerze. */
  const tokenyNawykow = (tekst) =>
    (tekst || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  /** Zapisuje nowa liste nawykow dla wiersza, do ktorego nalezy otwarty panel. */
  async function zapiszNawyki(nazwy) {
    if (!komorkaPanelu) return;
    const tr = komorkaPanelu.closest('tr');
    await zapisz(tr, 'nawyki', nazwy.join(', '));

    /*
      Po zapisie wiersz mogl zostac przebudowany (renderuj()), a wtedy stara
      referencja do komorki wskazuje element wyrzucony z dokumentu.
      Odnajdujemy komorke po id wiersza i przestawiamy panel na nia.
    */
    const id = tr.dataset.id;
    komorkaPanelu =
      document.querySelector(`#wiersze tr[data-id="${id}"] [data-pole="nawyki"]`) || null;

    if (!komorkaPanelu) zamknijPanelNawykow(); // wiersz wypadl z filtra
    else zbudujListeNawykow();
  }

  /*
    Buduje liste pozycji w panelu.

    KLUCZOWE: pokazujemy nie tylko slownik, ale takze nazwy obecne w TYM wierszu,
    a nieobecne w slowniku - czyli nawyki usuniete oraz historyczne (np. "Untitled").
    Gdyby ich tu nie bylo, zapis skladany z samych zaznaczonych checkboxow
    wykasowalby je po cichu przy pierwszej edycji wiersza.
  */
  function zbudujListeNawykow() {
    if (!komorkaPanelu) return;

    const obecne = tokenyNawykow(komorkaPanelu.textContent);
    const wSlowniku = new Set(nawykiSlownik.map((n) => n.nazwa));
    const spozaListy = obecne.filter((n) => !wSlowniku.has(n));

    const pozycje = [
      ...nawykiSlownik.map((n) => ({ ...n, spoza: false })),
      ...spozaListy.map((nazwa) => ({ id: null, nazwa, spoza: true })),
    ];

    elListaNawykow.replaceChildren(
      ...pozycje.map((poz) => zbudujPozycjeNawyku(poz, obecne.includes(poz.nazwa)))
    );
  }

  function zbudujPozycjeNawyku(poz, zaznaczony) {
    const wiersz = document.createElement('div');
    wiersz.className = 'pozycja-nawyku';

    const etykieta = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = zaznaczony;

    checkbox.addEventListener('change', () => {
      const obecne = tokenyNawykow(komorkaPanelu.textContent);
      /*
        Zachowujemy ISTNIEJACA kolejnosc nazw w wierszu, a nowo zaznaczona
        dopisujemy na koncu. Przebudowa w kolejnosci slownika przestawialaby
        dane, o ktorych zmiane nikt nie prosil.
      */
      const nowe = checkbox.checked
        ? obecne.includes(poz.nazwa)
          ? obecne
          : [...obecne, poz.nazwa]
        : obecne.filter((n) => n !== poz.nazwa);

      zapiszNawyki(nowe);
    });

    etykieta.append(checkbox, ' ' + poz.nazwa);
    if (poz.spoza) {
      const znacznik = document.createElement('span');
      znacznik.className = 'spoza-listy';
      znacznik.textContent = ' (spoza listy)';
      znacznik.title =
        'Ta nazwa jest w tym wpisie, ale nie ma jej już w słowniku. Odznaczenie usunie ją z wpisu.';
      etykieta.appendChild(znacznik);
    }
    wiersz.appendChild(etykieta);

    // Pozycji spoza slownika nie da sie przemianowac ani usunac - nie ma czego.
    if (!poz.spoza) {
      const akcje = document.createElement('span');
      akcje.className = 'akcje-nawyku';

      const zmien = document.createElement('button');
      zmien.type = 'button';
      zmien.textContent = '✏️';
      zmien.title = 'Zmień nazwę';
      zmien.addEventListener('click', () => zmienNazweNawyku(poz));

      const usun = document.createElement('button');
      usun.type = 'button';
      usun.textContent = '🗑️';
      usun.title = 'Usuń z listy wyboru';
      usun.addEventListener('click', () => usunNawykZeSlownika(poz));

      akcje.append(zmien, usun);
      wiersz.appendChild(akcje);
    }

    return wiersz;
  }

  async function zmienNazweNawyku(poz) {
    const nowa = prompt(`Nowa nazwa dla „${poz.nazwa}":`, poz.nazwa);
    if (nowa === null || nowa.trim() === '' || nowa.trim() === poz.nazwa) return;

    try {
      const wynik = await api.patch(`/api/nawyki/${poz.id}`, { nazwa: nowa.trim() });
      await przeladujNawykiIWidok();
      pokazStatus(
        `zmieniono nazwę, zaktualizowano wpisów: ${wynik.zaktualizowanychWpisow}`,
        'ok'
      );
    } catch (e) {
      pokazStatus(e.message, 'blad');
    }
  }

  async function usunNawykZeSlownika(poz) {
    const potwierdzenie =
      `Usunąć „${poz.nazwa}" z listy wyboru?\n\n` +
      'Istniejące wpisy dziennika ZOSTANĄ nietknięte — nazwa zniknie tylko z listy, ' +
      'więc nie będzie już można po niej filtrować.';
    if (!confirm(potwierdzenie)) return;

    try {
      await api.usun(`/api/nawyki/${poz.id}`);
      await przeladujNawykiIWidok();
      pokazStatus('usunięto z listy wyboru', 'ok');
    } catch (e) {
      pokazStatus(e.message, 'blad');
    }
  }

  async function dodajNawyk() {
    const nazwa = elNowyNawyk.value.trim();
    if (nazwa === '') return;

    try {
      await api.post('/api/nawyki', { nazwa });
      elNowyNawyk.value = '';
      await przeladujNawykiIWidok();
      pokazStatus('dodano nawyk', 'ok');
    } catch (e) {
      pokazStatus(e.message, 'blad');
    }
  }

  /** Po kazdej zmianie slownika: pobierz od nowa i odswiez OBA miejsca, ktore go uzywaja. */
  async function przeladujNawykiIWidok() {
    nawykiSlownik = await api.get('/api/nawyki');
    zbudujCheckboxyNawykow(); // filtr nad tabela
    zbudujListeNawykow(); // otwarty panel
    renderuj(); // komorki moga pokazywac zmieniona nazwe
  }

  function otworzPanelNawykow(td) {
    komorkaPanelu = td;
    zbudujListeNawykow();
    elPanelNawykow.hidden = false;

    // Pozycjonowanie przy komorce, ze wzgledu na przewijanie strony.
    const r = td.getBoundingClientRect();
    const gora = window.scrollY + r.bottom + 2;
    const lewo = Math.min(
      window.scrollX + r.left,
      window.scrollX + document.documentElement.clientWidth - elPanelNawykow.offsetWidth - 8
    );
    elPanelNawykow.style.top = `${gora}px`;
    elPanelNawykow.style.left = `${Math.max(8, lewo)}px`;
  }

  function zamknijPanelNawykow() {
    elPanelNawykow.hidden = true;
    komorkaPanelu = null;
  }

  // ==========================================================================
  // Panel filtrow
  // ==========================================================================

  function zbudujCheckboxyNawykow() {
    /*
      Slownik moze sie zmienic w trakcie pracy (panel nawykow), a w filtrze moga
      byc juz zaznaczone nazwy. Przepisujemy stan zaznaczen, zeby przebudowa listy
      nie kasowala aktywnego filtra. Nazwy usuniete ze slownika znikaja takze
      z filtra - po nich nie da sie juz filtrowac.
    */
    const zaznaczone = new Set(filtry.nawyki);
    filtry.nawyki.clear();

    elFiltrNawyki.replaceChildren(
      ...nawykiSlownik.map(({ nazwa }) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = zaznaczone.has(nazwa);
        if (input.checked) filtry.nawyki.add(nazwa);

        input.addEventListener('change', () => {
          if (input.checked) filtry.nawyki.add(nazwa);
          else filtry.nawyki.delete(nazwa);
          zastosujFiltry();
        });

        label.append(input, ' ' + nazwa);
        return label;
      })
    );
  }

  function zbudujPresety() {
    // Zakres liczy sie od DZISIAJ WEDLUG SERWERA - stad funkcja, a nie wartosc:
    // data moze sie odswiezyc po powrocie do karty nastepnego dnia.
    filtrDat.zbudujPrzyciski(
      elPresety,
      PRESETY_DAT,
      (zakres) => {
        elFiltrOd.value = zakres.od;
        elFiltrDo.value = zakres.do;
        zastosujFiltry();
      },
      () => dzisiajSerwera
    );
  }

  function odswiezPresety() {
    filtrDat.odswiezPrzyciski(elPresety, {
      od: filtry.od,
      do: filtry.do,
      dzisiaj: dzisiajSerwera,
    });
  }

  /** Przepisuje stan kontrolek do obiektu `filtry` i przerysowuje tabele. */
  function zastosujFiltry() {
    filtry.szukaj = elFiltrSzukaj.value.trim().toLocaleLowerCase('pl');
    filtry.od = elFiltrOd.value;
    filtry.do = elFiltrDo.value;
    // Zbior nawykow aktualizuja na biezaco handlery checkboxow.

    const ile = ileAktywnychFiltrow();
    elZnacznikFiltrow.textContent = ile > 0 ? ` — aktywne: ${ile}` : '';

    odswiezPresety();
    renderuj();
  }

  function wyczyscFiltry() {
    elFiltrSzukaj.value = '';
    elFiltrOd.value = '';
    elFiltrDo.value = '';
    for (const input of elPanelFiltrow.querySelectorAll('input[type="checkbox"]')) {
      input.checked = false;
    }
    filtry.nawyki.clear();
    zastosujFiltry();
  }

  // ==========================================================================
  // Start
  // ==========================================================================

  async function wczytaj() {
    const lista = await api.get('/api/dziennik');
    wpisy.clear();
    for (const w of lista) wpisy.set(w.id, w);
    renderuj();
  }

  async function start() {
    try {
      // Slowniki, nawyki i data serwera musza byc PRZED zbudowaniem tabeli i filtrow:
      // z opisow ocen powstaja plakietki, a z nawykow checkboxy filtra.
      const [pobraneSlowniki, pobraneNawyki, czas, lista] = await Promise.all([
        api.get('/api/slowniki'),
        api.get('/api/nawyki'),
        api.get('/api/czas'),
        api.get('/api/dziennik'),
      ]);
      slowniki = pobraneSlowniki;
      nawykiSlownik = pobraneNawyki;
      dzisiajSerwera = czas.dzisiaj;

      zbudujCheckboxyNawykow();
      zbudujPresety();
      odswiezPresety();

      wpisy.clear();
      for (const w of lista) wpisy.set(w.id, w);
      renderuj();
    } catch (e) {
      pokazStatus('Nie udało się wczytać danych: ' + e.message, 'blad');
    }
  }

  elDodaj.addEventListener('click', dodajWpis);
  elEksport.addEventListener('click', eksportujCsv);
  elWyczysc.addEventListener('click', wyczyscFiltry);

  // 'input' zamiast 'change' - lista filtruje sie w trakcie pisania.
  elFiltrSzukaj.addEventListener('input', zastosujFiltry);
  elFiltrOd.addEventListener('change', zastosujFiltry);
  elFiltrDo.addEventListener('change', zastosujFiltry);

  // --- panel nawykow ---
  elZamknijNawyki.addEventListener('click', zamknijPanelNawykow);
  elDodajNawyk.addEventListener('click', dodajNawyk);
  elNowyNawyk.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') dodajNawyk();
  });

  // Klikniecie poza panelem go zamyka. Klikniecie w komorke nawykow obslugujemy
  // osobno (otwiera panel dla innego wiersza), wiec je tu pomijamy.
  document.addEventListener('mousedown', (e) => {
    if (elPanelNawykow.hidden) return;
    if (elPanelNawykow.contains(e.target)) return;
    if (e.target.closest('.komorka-nawykow')) return;
    zamknijPanelNawykow();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !elPanelNawykow.hidden) zamknijPanelNawykow();
  });

  elNaglowki.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-kolumna]');
    if (th) przelaczSortowanie(th.dataset.kolumna);
  });

  // Import zyje w osobnym module (public/js/csv-import.js) i po zapisie
  // wysyla to zdarzenie. Nazwa zawiera profil, wiec strona zadan go nie lapie.
  document.addEventListener('dane-dziennik-zmienione', () => {
    wczytaj().catch((e) => pokazStatus('Nie udało się odświeżyć: ' + e.message, 'blad'));
  });

  start();
})();
