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
    { pole: 'nawyki', typ: 'tekst', klasa: 'kol-tekst-szeroki' },
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

  // Pola liczbowe sortuja sie liczbowo, reszta tekstowo.
  const POLA_LICZBOWE = new Set([
    'id',
    'godziny_snu',
    'jakosc_snu',
    'stres',
    'nastroj',
    'intencjonalnosc',
  ]);

  // ==========================================================================
  // Sortowanie
  // ==========================================================================

  /*
    Puste wartosci zawsze na koncu, takze przy sortowaniu malejaco - ta sama zasada
    co w tabeli zadan. Wpis bez oceny nie jest ani najlepszy, ani najgorszy.
    Remisy rozstrzyga id, zeby kolejnosc byla powtarzalna.
  */
  function pusta(w) {
    return w === null || w === undefined || w === '';
  }

  function posortowane(lista = [...wpisy.values()]) {
    const { kolumna, kierunek } = sortowanie;

    return [...lista].sort((a, b) => {
      const wa = a[kolumna];
      const wb = b[kolumna];

      const pustaA = pusta(wa);
      const pustaB = pusta(wb);
      if (pustaA && pustaB) return a.id - b.id;
      if (pustaA) return 1; // przed odwroceniem kierunku, wiec go nie dotyczy
      if (pustaB) return -1;

      let wynik;
      if (POLA_LICZBOWE.has(kolumna)) wynik = wa - wb;
      // Data w formacie YYYY-MM-DD i godzina HH:MM maja stala szerokosc,
      // wiec kolejnosc alfabetyczna = kolejnosc chronologiczna.
      else if (kolumna === 'data' || kolumna === 'pobudka') wynik = wa < wb ? -1 : wa > wb ? 1 : 0;
      else wynik = String(wa).localeCompare(String(wb), 'pl');

      if (wynik === 0) return a.id - b.id;
      return kierunek === 'malejaco' ? -wynik : wynik;
    });
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

  /** Komorka z ocena - lista rozwijana, bo skale sa krotkie i zamkniete. */
  function komorkaOcena(w, kolumna) {
    const td = document.createElement('td');
    td.className = kolumna.klasa;
    td.dataset.pole = kolumna.pole;

    const select = document.createElement('select');
    select.appendChild(new Option('', '')); // brak oceny jest dozwolony
    for (let i = kolumna.min; i <= kolumna.max; i++) select.appendChild(new Option(i, i));

    // ?? zamiast || - ocena 0 (stres "bardzo wysoki") jest w JS falszywa.
    select.value = w[kolumna.pole] ?? '';
    select.addEventListener('change', () => zapisz(td.closest('tr'), kolumna.pole, select.value));

    td.appendChild(select);
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
      default:
        return komorkaTekst(w, kolumna);
    }
  }

  // ==========================================================================
  // Renderowanie
  // ==========================================================================

  function zbudujWiersz(w) {
    const tr = document.createElement('tr');
    tr.dataset.id = w.id;

    tr.appendChild(komorkaId(w));
    for (const kolumna of KOLUMNY) tr.appendChild(komorkaDla(w, kolumna));
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

  function renderuj() {
    const fokus = zapamietajFokus();
    elWiersze.replaceChildren(...posortowane().map(zbudujWiersz));
    odtworzFokus(fokus);
    odswiezNaglowki();
    odswiezPodsumowanie();
  }

  function kolejnoscSieZmienila() {
    const oczekiwana = posortowane().map((w) => w.id);
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

      if (kolejnoscSieZmienila()) renderuj();
      else zaktualizujWiersz(tr);

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
    const t = new Date();
    const dwie = (n) => String(n).padStart(2, '0');
    const dzis = `${t.getFullYear()}-${dwie(t.getMonth() + 1)}-${dwie(t.getDate())}`;

    csv.pobierz(`dziennik-eksport-${dzis}.csv`, naglowki, wiersze);
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

    const daty = wszystkie.map((w) => w.data).filter(Boolean).sort();
    const zakres = daty.length > 0 ? ` (od ${daty[0]} do ${daty[daty.length - 1]})` : '';
    elPodsumowanie.textContent = `Wpisów: ${wszystkie.length}${zakres}`;
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
      await wczytaj();
    } catch (e) {
      pokazStatus('Nie udało się wczytać danych: ' + e.message, 'blad');
    }
  }

  elDodaj.addEventListener('click', dodajWpis);
  elEksport.addEventListener('click', eksportujCsv);

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
