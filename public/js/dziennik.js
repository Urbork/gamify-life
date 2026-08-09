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

  // Slownik nawykow z /api/slowniki - z niego powstaja checkboxy filtra.
  let nawykiSlownik = [];

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
    Kolumny przeszukiwane jednym polem "Szukaj". Sklejamy je i szukamy fragmentu -
    dzieki temu nie trzeba pamietac, w ktorej rubryce cos sie zapisalo.
  */
  const POLA_SZUKANIA = [
    'wdziecznosc',
    'bledy',
    'rozmowa',
    'co_poszlo_dobrze',
    'jutro_wazne',
    'do_przemyslenia',
    'trzy_slowa',
    'nawyki',
  ];

  /** Rozbija pole `nawyki` na pojedyncze nazwy. */
  function nazwyNawykow(w) {
    if (!w.nawyki) return [];
    return w.nawyki
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function pasujeSzukaj(w) {
    if (filtry.szukaj === '') return true;
    const tresc = POLA_SZUKANIA.map((p) => w[p] ?? '')
      .join(' \n ')
      .toLocaleLowerCase('pl');
    return tresc.includes(filtry.szukaj);
  }

  /*
    Dopasowanie po nawyku. Rozbijamy pole na nazwy i porownujemy DOKLADNIE,
    zamiast szukac fragmentu w calym tekscie.

    Powod: dzis zadna nazwa nie jest fragmentem innej, ale gole `includes`
    byloby mina na przyszlosc - wystarczyloby dopisac nawyk "Water" obok
    istniejacego "Drink Water", zeby filtr zaczal lapac oba naraz.
  */
  function pasujeNawyk(w) {
    if (filtry.nawyki.size === 0) return true;
    const nazwy = nazwyNawykow(w);
    return nazwy.some((n) => filtry.nawyki.has(n));
  }

  /*
    Zakres dat. Dziennik ma tylko JEDNO pole daty, wiec regula jest prosta:
    data wpisu musi miescic sie w [OD, DO]. Brak ktorejs granicy = zakres otwarty
    z tej strony. To swiadomie prostsze niz w zadaniach, gdzie sprawdzamy termin
    ORAZ okres aktywnosci - tam sa trzy pola datowe i dwa niezalezne warunki.
  */
  function pasujeZakresDat(w) {
    const od = filtrDat.numerDnia(filtry.od);
    const doDnia = filtrDat.numerDnia(filtry.do);
    if (od === null && doDnia === null) return true;

    const data = filtrDat.numerDnia(w.data);
    if (data === null) return false; // wpis bez daty nie miesci sie w zadnym zakresie

    return (od === null || data >= od) && (doDnia === null || data <= doDnia);
  }

  /** Wpisy spelniajace WSZYSTKIE aktywne filtry. */
  function filtrowane(lista = [...wpisy.values()]) {
    return lista.filter((w) => pasujeSzukaj(w) && pasujeNawyk(w) && pasujeZakresDat(w));
  }

  /** Ile pol filtrow jest aktywnych (do znacznika przy zwinietym panelu). */
  function ileAktywnychFiltrow() {
    return [filtry.szukaj !== '', filtry.nawyki.size > 0, filtry.od !== '' || filtry.do !== ''].filter(
      Boolean
    ).length;
  }

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
    odswiezPodsumowanie();
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
  // Panel filtrow
  // ==========================================================================

  function zbudujCheckboxyNawykow() {
    elFiltrNawyki.replaceChildren(
      ...nawykiSlownik.map((nazwa) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';

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
      // Slownik nawykow i data serwera musza byc PRZED zbudowaniem panelu filtrow.
      const [slowniki, czas, lista] = await Promise.all([
        api.get('/api/slowniki'),
        api.get('/api/czas'),
        api.get('/api/dziennik'),
      ]);
      nawykiSlownik = slowniki.nawyki ?? [];
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
