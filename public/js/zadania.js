/*
  Widok tabeli zadan: renderowanie, sortowanie, edycja inline, kolumny wyliczane, eksport CSV.

  ZASADA DZIALANIA
  - `zadania` to lokalna kopia tego, co jest w bazie (Map: id -> rekord).
    Dane pobieramy z API RAZ, przy starcie. Sortowanie i kolumny wyliczane licza sie
    tutaj, w przegladarce - serwer nie wie ani o kolejnosci, ani o eksporcie.
  - Kazda zmiana w komorce od razu leci PATCH-em na serwer. Odpowiedz serwera
    (czyli rzeczywisty stan wiersza w bazie) nadpisuje lokalna kopie.
  - Gdy zapis sie nie uda, komorka wraca do poprzedniej wartosci - tabela nigdy
    nie pokazuje czegos, czego nie ma w bazie.
  - Kolumny "Dni do terminu" i "Czas trwania" NIE sa zapisywane.

  Cala logika siedzi w IIFE, zeby nie zasmiecac globalnego zakresu -
  przyszly modul dziennika bedzie mogl uzyc tych samych nazw funkcji.
*/

(() => {
  'use strict';

  // Slowniki przyjda z serwera (GET /api/slowniki) - tu tylko wartosci awaryjne.
  let slowniki = {
    stany: [],
    stanDomyslny: 'Plan',
    stanZakonczony: 'Zrobione',
    priorytety: [],
    priorytetDomyslny: 2,
    klienci: [],
  };

  // Lokalna kopia stanu bazy. Zrodlo prawdy dla sortowania, kolumn wyliczanych,
  // eksportu i cofania nieudanych zmian.
  const zadania = new Map();

  // Aktualne sortowanie. Domyslnie: najblizsze terminy u gory.
  const sortowanie = { kolumna: 'termin', kierunek: 'rosnaco' };

  const elWiersze = document.getElementById('wiersze');
  const elNaglowki = document.getElementById('naglowki');
  const elStatus = document.getElementById('status');
  const elPodsumowanie = document.getElementById('podsumowanie');
  const elDodaj = document.getElementById('przycisk-dodaj');
  const elEksport = document.getElementById('przycisk-eksport');

  // Panel filtrow
  const elPanelFiltrow = document.getElementById('panel-filtrow');
  const elZnacznikFiltrow = document.getElementById('znacznik-filtrow');
  const elFiltrNazwa = document.getElementById('filtr-nazwa');
  const elFiltrStany = document.getElementById('filtr-stany');
  const elFiltrPriorytety = document.getElementById('filtr-priorytety');
  const elFiltrKlienci = document.getElementById('filtr-klienci');
  const elPresety = document.getElementById('presety-dat');
  const elFiltrOd = document.getElementById('filtr-od');
  const elFiltrDo = document.getElementById('filtr-do');
  const elWyczysc = document.getElementById('przycisk-wyczysc');

  // Dzisiejsza data wedlug SERWERA (GET /api/czas) - od niej licza sie presety zakresu.
  // Pobierana przy starcie i odswiezana po powrocie do karty.
  let dzisiajSerwera = null;

  // ==========================================================================
  // Czas
  // ==========================================================================

  /*
    Daty trzymamy jako znaczniki ISO 8601: 'YYYY-MM-DDTHH:MM' (dokladnie w tej postaci
    przyjmuje i zwraca je <input type="datetime-local">).

    WAZNE ROZROZNIENIE:
    - kolumny WYLICZANE ("Dni do terminu", "Czas trwania") licza w PELNYCH DNIACH
      KALENDARZOWYCH i godzine CALKOWICIE IGNORUJA - stad numerDnia() bierze same
      pierwsze 10 znakow. To swiadoma decyzja: godzina jest na razie dodatkowa
      informacja do zapisu i wyswietlenia, a logika wyliczen zostaje prosta;
    - SORTOWANIE uwzglednia godzine, bo przy dwoch zadaniach na ten sam dzien
      naturalne jest, zeby wczesniejsza godzina byla wyzej. To nie koliduje
      z powyzszym - dotyczy porzadkowania wierszy, a nie wartosci w kolumnach.
  */

  /*
    Arytmetyka dat i mechanika presetow zyja we WSPOLNYM module public/js/filtr-dat.js -
    korzysta z nich takze dziennik. Rozpakowanie do lokalnych stalych sprawia,
    ze wszystkie wywolania nizej wygladaja tak samo jak przed wydzieleniem.
  */
  const { dataPlusDni, dzisiajLokalnie: dzisiajISO } = filtrDat;

  /*
    Kolumny wyliczane, filtrowanie i sortowanie siedza w public/js/reguly-zadan.js -
    to czyste funkcje bez DOM, wiec da sie je przetestowac skryptem (npm run test:smoke).
    Ponizsze opakowania dokladaja biezacy stan widoku, dzieki czemu wszystkie
    wywolania nizej wygladaja tak samo jak przed wydzieleniem.
  */

  /** Kolumna wyliczana: ile PELNYCH DNI zostalo do terminu (ujemne = po terminie). */
  const dniDoTerminu = (z) => regulyZadan.dniDoTerminu(z, dzisiajISO());

  /** Kolumna wyliczana: ile PELNYCH DNI trwalo zadanie. Puste, gdy brakuje ktorejs z dat. */
  const czasTrwania = regulyZadan.czasTrwania;

  /** Etykieta slowna priorytetu. Numer spoza slownika pokazujemy w nawiasach. */
  function etykietaPriorytetu(numer) {
    const znaleziony = slowniki.priorytety.find((p) => p.numer === numer);
    return znaleziony ? znaleziony.etykieta : `(${numer})`;
  }

  // ==========================================================================
  // Filtrowanie
  // ==========================================================================

  /*
    Stan filtrow. Zbiory PUSTE oznaczaja "nie filtruj po tym polu" - to naturalne
    zachowanie listy checkboxow: nic nie zaznaczone = wszystko przechodzi.

    Wszystkie pola lacza sie przez ORAZ, a zaznaczenia w obrebie jednego pola
    przez LUB (zadanie musi miec jeden z wybranych stanow, jeden z wybranych
    priorytetow itd.).
  */
  const filtry = {
    nazwa: '',
    stany: new Set(),
    priorytety: new Set(), // liczby, nie teksty
    klienci: new Set(),
    od: '', // 'YYYY-MM-DD' albo '' = brak dolnej granicy
    do: '',
  };

  /*
    Presety zakresu dat skladamy z nazwanych klockow wspolnego modulu.
    Zadania maja dodatkowo "Dziś + jutro", ktorego dziennik nie potrzebuje -
    stad lista jest tutaj, a nie w module.
    Preset tylko wypelnia pola OD i DO - zadnego osobnego stanu nie trzymamy.
  */
  const P = filtrDat.PRESETY;
  const PRESETY_DAT = [P.WSZYSTKIE, P.DZIS, P.DZIS_JUTRO, P.TYDZIEN, P.MIESIAC];

  /**
   * Zadania spelniajace WSZYSTKIE aktywne filtry.
   * Reguly (w tym niuans pustego czas_zakonczenia) opisuje public/js/reguly-zadan.js.
   * @param {Array} lista domyslnie wszystkie zadania z lokalnej kopii.
   */
  function filtrowane(lista = [...zadania.values()]) {
    return regulyZadan.filtrowane(lista, filtry);
  }

  /** Ile pol filtrow jest aktywnych (do znacznika przy zwinietym panelu). */
  function ileAktywnychFiltrow() {
    return regulyZadan.ileAktywnych(filtry);
  }

  // ==========================================================================
  // Sortowanie
  // ==========================================================================

  /*
    Reguly sortowania (grupa "Zrobione" na dole, puste na koncu grupy, remisy po id)
    oraz definicje kolumn siedza w public/js/reguly-zadan.js.
  */

  /**
   * Zwraca zadania w kolejnosci wyswietlania.
   * @param {Array} lista domyslnie WSZYSTKIE zadania. Parametr istnieje po to,
   *   zeby posortowac podzbior do wyswietlenia, a eksport dalej wolal te funkcje
   *   na calosci.
   */
  function posortowane(lista = [...zadania.values()]) {
    return regulyZadan.posortowane(lista, sortowanie, slowniki, dzisiajISO());
  }

  /** Obsluga klikniecia w naglowek: ta sama kolumna = odwrocenie, nowa = od rosnaco. */
  function przelaczSortowanie(kolumna) {
    if (sortowanie.kolumna === kolumna) {
      sortowanie.kierunek = sortowanie.kierunek === 'rosnaco' ? 'malejaco' : 'rosnaco';
    } else {
      sortowanie.kolumna = kolumna;
      sortowanie.kierunek = 'rosnaco';
    }
    renderuj();
  }

  /** Zaznacza w naglowku aktywna kolumne i kierunek (strzalke dorysowuje CSS). */
  function odswiezNaglowki() {
    for (const th of elNaglowki.querySelectorAll('th[data-kolumna]')) {
      const aktywna = th.dataset.kolumna === sortowanie.kolumna;
      th.dataset.kierunek = aktywna ? sortowanie.kierunek : '';
      // aria-sort informuje czytniki ekranu o tym samym, co strzalka pokazuje wzrokowo.
      th.setAttribute(
        'aria-sort',
        aktywna ? (sortowanie.kierunek === 'rosnaco' ? 'ascending' : 'descending') : 'none'
      );
    }
  }

  // ==========================================================================
  // Budowanie komorek
  // ==========================================================================

  /** Komorka z numerem id - tylko do odczytu, ulatwia rozmowe o konkretnym wierszu. */
  function komorkaId(z) {
    const td = document.createElement('td');
    td.className = 'kol-id';
    td.textContent = z.id;
    return td;
  }

  /** Komorka tekstowa (contenteditable). Zapis przy opuszczeniu pola. */
  function komorkaTekst(z, pole, klasa) {
    const td = document.createElement('td');
    td.className = klasa;
    td.dataset.pole = pole;
    td.contentEditable = 'true';
    // textContent, nie innerHTML - tresc od uzytkownika nigdy nie jest traktowana jak HTML.
    td.textContent = z[pole] ?? '';

    td.addEventListener('blur', () => {
      const nowa = td.textContent.trim();
      const rekord = zadania.get(z.id);
      if (!rekord) return; // wiersz zdazyl zniknac (np. usuniety)
      if (nowa === (rekord[pole] ?? '')) return; // nic sie nie zmienilo
      zapisz(td.closest('tr'), pole, nowa);
    });

    // Enter konczy edycje zamiast wstawiac lamanie linii.
    td.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        td.blur();
      }
      if (e.key === 'Escape') {
        const rekord = zadania.get(z.id);
        td.textContent = rekord ? rekord[pole] ?? '' : '';
        td.blur();
      }
    });

    return td;
  }

  /**
   * Komorka z lista rozwijana.
   * @param {Array<{wartosc: *, etykieta: string}>} opcje pozycje listy w kolejnosci wyswietlania
   * @param {boolean} pusteDozwolone czy dopuszczamy brak wyboru (dotyczy klienta)
   */
  function komorkaSelect(z, pole, klasa, opcje, pusteDozwolone) {
    const td = document.createElement('td');
    td.className = klasa;
    td.dataset.pole = pole;

    const select = document.createElement('select');
    // ?? zamiast || - priorytet 0 jest wartoscia prawidlowa, a w JS jest falszywy.
    const wartosc = z[pole] ?? '';

    if (pusteDozwolone) select.appendChild(new Option('', ''));
    for (const o of opcje) select.appendChild(new Option(o.etykieta, o.wartosc));

    // Rekord moze zawierac wartosc spoza aktualnego slownika (np. klient usuniety
    // z listy w config/slowniki.js). Dopisujemy ja, zeby edycja innej kolumny
    // nie podmienila po cichu tej wartosci na pierwsza z listy.
    // Porownanie przez String, bo select.value zawsze jest tekstem (priorytet to liczba).
    if (wartosc !== '' && !opcje.some((o) => String(o.wartosc) === String(wartosc))) {
      select.appendChild(new Option(wartosc + ' (spoza listy)', wartosc));
    }

    select.value = wartosc;
    select.addEventListener('change', () => zapisz(td.closest('tr'), pole, select.value));

    td.appendChild(select);
    return td;
  }

  /**
   * Komorka z data i godzina.
   * <input type="datetime-local"> przyjmuje i zwraca dokladnie ten format,
   * ktory trzymamy w bazie ('YYYY-MM-DDTHH:MM'), wiec nie ma tu zadnej konwersji.
   */
  function komorkaZnacznikCzasu(z, pole) {
    const td = document.createElement('td');
    td.className = 'kol-data';
    td.dataset.pole = pole;

    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.value = z[pole] ?? '';
    input.addEventListener('change', () => zapisz(td.closest('tr'), pole, input.value));

    td.appendChild(input);
    return td;
  }

  /** Pusta komorka na wartosc wyliczana - wypelnia ja odswiezWyliczone(). */
  function komorkaWyliczona(nazwa) {
    const td = document.createElement('td');
    td.className = 'kol-liczba';
    td.dataset.wyliczane = nazwa;
    return td;
  }

  function komorkaUsun(z) {
    const td = document.createElement('td');
    td.className = 'kol-akcje';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'usun';
    btn.textContent = '×'; // znak "razy"
    btn.title = 'Usuń zadanie';
    btn.addEventListener('click', () => usunZadanie(z.id));

    td.appendChild(btn);
    return td;
  }

  // ==========================================================================
  // Renderowanie
  // ==========================================================================

  // Slowniki stanow i klientow przychodza jako zwykle listy tekstow, a select
  // oczekuje par {wartosc, etykieta} - tu je ujednolicamy.
  const jakoOpcje = (teksty) => teksty.map((t) => ({ wartosc: t, etykieta: t }));

  function zbudujWiersz(z) {
    const tr = document.createElement('tr');
    tr.dataset.id = z.id;
    tr.dataset.stan = z.stan; // wykorzystywane przez CSS (wyszarzenie "Zrobione" itd.)

    // KOLEJNOSC KOLUMN musi sie zgadzac z naglowkami w public/index.html
    // oraz z KOLUMNY_CSV nizej.
    tr.append(
      komorkaId(z),
      komorkaSelect(z, 'stan', 'kol-stan', jakoOpcje(slowniki.stany), false),
      komorkaTekst(z, 'nazwa', 'kol-nazwa'),
      komorkaSelect(
        z,
        'priorytet',
        'kol-priorytet',
        slowniki.priorytety.map((p) => ({ wartosc: p.numer, etykieta: p.etykieta })),
        false
      ),
      komorkaSelect(z, 'klient_kategoria', 'kol-klient', jakoOpcje(slowniki.klienci), true),
      komorkaZnacznikCzasu(z, 'start_zadania'),
      komorkaZnacznikCzasu(z, 'termin'),
      komorkaWyliczona('dni_do_terminu'),
      komorkaZnacznikCzasu(z, 'czas_zakonczenia'),
      komorkaWyliczona('czas_trwania')
    );
    tr.appendChild(komorkaUsun(z));

    odswiezWyliczone(tr);
    return tr;
  }

  /*
    Renderowanie przebudowuje CALA tresc tabeli od zera. To najprostszy sposob,
    zeby wynik zawsze zgadzal sie z regulami sortowania, ale ma dwa skutki uboczne,
    ktore trzeba obsluzyc:

    1. Przebudowa niszczy element, ktory ma fokus. Dlatego zapamietujemy, w ktorym
       wierszu i polu byl kursor, i wracamy tam po przebudowie.
    2. Przebudowa w trakcie pisania bylaby uciazliwa. Dlatego zapisz() wola renderuj()
       tylko wtedy, gdy edycja faktycznie zmienila KOLEJNOSC wierszy - w pozostalych
       przypadkach aktualizuje wiersz w miejscu (zaktualizujWiersz).
  */

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
   * (np. po zmianie stanu na taki, ktory jest odfiltrowany) - listy maja wtedy
   * rozne dlugosci.
   */
  function kolejnoscSieZmienila() {
    const oczekiwana = doWyswietlenia().map((z) => z.id);
    const obecna = [...elWiersze.children].map((tr) => Number(tr.dataset.id));
    return oczekiwana.length !== obecna.length || oczekiwana.some((id, i) => id !== obecna[i]);
  }

  /** Przelicza obie kolumny wyliczane dla jednego wiersza na podstawie lokalnej kopii danych. */
  function odswiezWyliczone(tr) {
    const z = zadania.get(Number(tr.dataset.id));
    if (!z) return;

    const doTerminu = dniDoTerminu(z);
    const tdTermin = tr.querySelector('[data-wyliczane="dni_do_terminu"]');
    tdTermin.textContent = doTerminu === null ? '' : doTerminu;
    // Czerwono tylko wtedy, gdy termin minal, a zadanie nie jest zrobione.
    tdTermin.classList.toggle(
      'po-terminie',
      doTerminu !== null && doTerminu < 0 && z.stan !== slowniki.stanZakonczony
    );

    const trwanie = czasTrwania(z);
    tr.querySelector('[data-wyliczane="czas_trwania"]').textContent =
      trwanie === null ? '' : trwanie;
  }

  /** Synchronizuje wiersz z lokalna kopia danych, bez przebudowy tabeli. */
  function zaktualizujWiersz(tr) {
    const z = zadania.get(Number(tr.dataset.id));
    if (!z) return;

    tr.dataset.stan = z.stan;

    for (const td of tr.querySelectorAll('[data-pole]')) {
      const kontrolka = td.querySelector('select, input');
      const element = kontrolka || td;
      // Pola, w ktorym ktos wlasnie pisze, nie ruszamy - nie chcemy zabrac mu tekstu
      // spod kursora, gdy w tle przyjdzie odpowiedz na wczesniejszy zapis.
      if (element === document.activeElement) continue;

      const wartosc = z[td.dataset.pole] ?? '';
      if (kontrolka) kontrolka.value = wartosc;
      else td.textContent = wartosc;
    }

    odswiezWyliczone(tr);
  }

  /** Ustawia w komorce wartosc z lokalnej kopii danych (uzywane po nieudanym zapisie). */
  function przywrocKomorke(tr, pole) {
    const z = zadania.get(Number(tr.dataset.id));
    const td = tr.querySelector(`[data-pole="${pole}"]`);
    if (!z || !td) return;

    const kontrolka = td.querySelector('select, input');
    if (kontrolka) kontrolka.value = z[pole] ?? '';
    else td.textContent = z[pole] ?? '';
  }

  /** Ustawia kursor w komorce tekstowej i zaznacza jej cala tresc. */
  function zaznaczTresc(td) {
    td.focus();
    const zakres = document.createRange();
    zakres.selectNodeContents(td);
    const zaznaczenie = window.getSelection();
    zaznaczenie.removeAllRanges();
    zaznaczenie.addRange(zakres);
  }

  // ==========================================================================
  // Operacje na danych
  // ==========================================================================

  /** Zapisuje jedno pole jednego zadania. Wywolywane z handlerow blur/change. */
  async function zapisz(tr, pole, wartosc) {
    const id = Number(tr.dataset.id);
    try {
      const zaktualizowane = await api.patch(`/api/zadania/${id}`, { [pole]: wartosc });
      zadania.set(id, zaktualizowane);
      tr.classList.remove('blad-zapisu');

      // Przebudowa tylko wtedy, gdy zmiana faktycznie przesuwa wiersze
      // (np. zmiana stanu na "Zrobione" albo edycja kolumny, po ktorej sortujemy).
      if (kolejnoscSieZmienila()) renderuj();
      else {
        zaktualizujWiersz(tr);
        odswiezPodsumowanie();
      }

      pokazStatus('zapisano', 'ok');
    } catch (e) {
      // Serwer odrzucil zmiane - pokazujemy jego komunikat i cofamy komorke,
      // zeby tabela zgadzala sie z baza.
      tr.classList.add('blad-zapisu');
      przywrocKomorke(tr, pole);
      pokazStatus(e.message, 'blad');
    }
  }

  async function dodajZadanie() {
    try {
      // Wartosci domyslne (nazwa, stan, priorytet, dzisiejsza data startu)
      // nadaje serwer - patrz routes/zadania.js.
      const nowe = await api.post('/api/zadania');
      zadania.set(nowe.id, nowe);
      renderuj();

      // Nowe zadanie nie ma terminu, wiec przy domyslnym sortowaniu laduje na koncu
      // aktywnych - trzeba je odnalezc, przewinac do niego i zaznaczyc nazwe zastepcza,
      // zeby pierwsze wpisane znaki ja nadpisaly.
      const tr = elWiersze.querySelector(`tr[data-id="${nowe.id}"]`);
      if (tr) {
        tr.scrollIntoView({ block: 'nearest' });
        zaznaczTresc(tr.querySelector('[data-pole="nazwa"]'));
      } else {
        // Zadanie powstalo w bazie, ale nie przechodzi przez aktywne filtry.
        // Bez tego komunikatu klikniecie "Dodaj" wygladaloby jak brak reakcji.
        pokazStatus('Dodano zadanie, ale ukrywają je filtry.', 'blad');
      }
    } catch (e) {
      pokazStatus(e.message, 'blad');
    }
  }

  async function usunZadanie(id) {
    const z = zadania.get(id);
    const etykieta = z && z.nazwa ? `„${z.nazwa}”` : `bez nazwy (#${id})`;
    if (!confirm(`Usunąć zadanie ${etykieta}? Tej operacji nie da się cofnąć.`)) return;

    try {
      await api.usun(`/api/zadania/${id}`);
      zadania.delete(id);
      renderuj();
      pokazStatus('usunięto', 'ok');
    } catch (e) {
      pokazStatus(e.message, 'blad');
    }
  }

  // ==========================================================================
  // Eksport CSV
  // ==========================================================================

  /*
    Naglowki pliku = nazwy kolumn z bazy plus kolumny wyliczane. Nazwy techniczne
    (a nie "Dni do terminu"), zeby plik dalo sie latwo wczytac skryptem albo do arkusza.

    Kolejnosc jest ta sama co w tabeli na ekranie. Priorytet wychodzi w DWOCH kolumnach:
    numer do sortowania i obliczen, etykieta do czytania przez czlowieka.
  */
  const KOLUMNY_CSV = [
    'stan',
    'nazwa',
    'priorytet',
    'priorytet_etykieta',
    'klient_kategoria',
    'start_zadania',
    'termin',
    'czas_zakonczenia',
    'dni_do_terminu',
    'czas_trwania_dni',
  ];

  function eksportujCsv() {
    // Celowo bierzemy WSZYSTKIE zadania z lokalnej kopii, a nie wiersze z DOM-u:
    // gdy w przyszlosci dojda filtry, eksport ma dalej obejmowac calosc,
    // zachowujac przy tym aktualna kolejnosc sortowania.
    const wszystkie = posortowane();

    if (wszystkie.length === 0) {
      pokazStatus('Nie ma czego eksportować.', 'blad');
      return;
    }

    const wiersze = wszystkie.map((z) => [
      z.stan,
      z.nazwa,
      z.priorytet,
      etykietaPriorytetu(z.priorytet),
      z.klient_kategoria,
      z.start_zadania,
      z.termin,
      z.czas_zakonczenia,
      // Obie kolumny wyliczane to MIGAWKA na moment eksportu - "dni do terminu"
      // liczy sie wzgledem dzisiejszej daty, wiec jutro ten sam plik wyszedlby inny.
      dniDoTerminu(z),
      czasTrwania(z),
    ]);

    csv.pobierz(`zadania-eksport-${dzisiajISO()}.csv`, KOLUMNY_CSV, wiersze);
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
    // Bledy zostaja na dluzej - warto je przeczytac.
    timerStatusu = setTimeout(
      () => {
        elStatus.textContent = '';
        elStatus.className = 'status';
      },
      typ === 'blad' ? 8000 : 1500
    );
  }

  function odswiezPodsumowanie() {
    const wszystkie = [...zadania.values()];
    if (wszystkie.length === 0) {
      elPodsumowanie.textContent = 'Brak zadań.';
      return;
    }

    const widoczne = filtrowane(wszystkie);

    // Rozbicie po stanach dotyczy tego, co widac - kolejnosc taka jak w slowniku,
    // stany bez zadan pomijamy.
    const licznik = slowniki.stany
      .map((s) => [s, widoczne.filter((z) => z.stan === s).length])
      .filter(([, ile]) => ile > 0)
      .map(([s, ile]) => `${s}: ${ile}`)
      .join(', ');

    elPodsumowanie.textContent =
      `Pokazano ${widoczne.length} z ${wszystkie.length} zadań` +
      (licznik ? ` (${licznik})` : '');
  }

  // ==========================================================================
  // Panel filtrow
  // ==========================================================================

  /**
   * Buduje liste checkboxow w podanym pojemniku.
   * @param {Array<{wartosc: *, etykieta: string}>} opcje
   * @param {Set} zbior zbior stanu filtrow, ktory ta lista modyfikuje
   */
  function zbudujCheckboxy(pojemnik, opcje, zbior) {
    pojemnik.replaceChildren(
      ...opcje.map((o) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';

        input.addEventListener('change', () => {
          // Do zbioru wklada my ORYGINALNA wartosc (liczbe dla priorytetu, tekst dla
          // stanu), a nie input.value, ktory zawsze bylby tekstem - inaczej
          // porownanie z rekordem z bazy nie trafialoby.
          if (input.checked) zbior.add(o.wartosc);
          else zbior.delete(o.wartosc);
          zastosujFiltry();
        });

        label.append(input, ' ' + o.etykieta);
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

  /** Podswietla preset, ktory odpowiada aktualnie wpisanemu zakresowi (jesli ktorys). */
  function odswiezPresety() {
    filtrDat.odswiezPrzyciski(elPresety, {
      od: filtry.od,
      do: filtry.do,
      dzisiaj: dzisiajSerwera,
    });
  }

  /** Przepisuje stan kontrolek do obiektu `filtry` i przerysowuje tabele. */
  function zastosujFiltry() {
    filtry.nazwa = elFiltrNazwa.value.trim().toLocaleLowerCase('pl');
    filtry.od = elFiltrOd.value;
    filtry.do = elFiltrDo.value;
    // Zbiory (stany, priorytety, klienci) sa aktualizowane na biezaco
    // przez handlery checkboxow.

    const ile = ileAktywnychFiltrow();
    elZnacznikFiltrow.textContent = ile > 0 ? ` — aktywne: ${ile}` : '';

    odswiezPresety();
    renderuj();
  }

  function wyczyscFiltry() {
    elFiltrNazwa.value = '';
    elFiltrOd.value = '';
    elFiltrDo.value = '';
    for (const input of elPanelFiltrow.querySelectorAll('input[type="checkbox"]')) {
      input.checked = false;
    }
    filtry.stany.clear();
    filtry.priorytety.clear();
    filtry.klienci.clear();
    zastosujFiltry();
  }

  /** Buduje zawartosc panelu filtrow ze slownikow. Wolane raz, po ich pobraniu. */
  function zbudujPanelFiltrow() {
    zbudujCheckboxy(elFiltrStany, jakoOpcje(slowniki.stany), filtry.stany);
    zbudujCheckboxy(
      elFiltrPriorytety,
      slowniki.priorytety.map((p) => ({ wartosc: p.numer, etykieta: p.etykieta })),
      filtry.priorytety
    );
    zbudujCheckboxy(elFiltrKlienci, jakoOpcje(slowniki.klienci), filtry.klienci);
    zbudujPresety();
    odswiezPresety();
  }

  // ==========================================================================
  // Start
  // ==========================================================================

  async function start() {
    try {
      // Slowniki musza byc PRZED budowaniem wierszy - z nich powstaja dropdowny
      // i checkboxy filtrow, a stanZakonczony decyduje o grupie w sortowaniu.
      const [pobraneSlowniki, czas, lista] = await Promise.all([
        api.get('/api/slowniki'),
        api.get('/api/czas'),
        api.get('/api/zadania'),
      ]);
      slowniki = pobraneSlowniki;
      dzisiajSerwera = czas.dzisiaj;

      zbudujPanelFiltrow();

      for (const z of lista) zadania.set(z.id, z);
      renderuj();
    } catch (e) {
      pokazStatus('Nie udało się wczytać danych: ' + e.message, 'blad');
    }
  }

  /**
   * Pobiera liste zadan od nowa i przerysowuje tabele.
   * Uzywane po operacjach, ktore zmieniaja dane hurtowo poza tym modulem -
   * dzis to import z CSV, w przyszlosci moze byc synchronizacja czy cofniecie zmian.
   */
  async function przeladujZadania() {
    try {
      const lista = await api.get('/api/zadania');
      zadania.clear();
      for (const z of lista) zadania.set(z.id, z);
      renderuj();
    } catch (e) {
      pokazStatus('Nie udało się odświeżyć listy: ' + e.message, 'blad');
    }
  }

  elDodaj.addEventListener('click', dodajZadanie);
  elEksport.addEventListener('click', eksportujCsv);
  elWyczysc.addEventListener('click', wyczyscFiltry);

  // 'input' zamiast 'change' - lista filtruje sie w trakcie pisania.
  elFiltrNazwa.addEventListener('input', zastosujFiltry);
  elFiltrOd.addEventListener('change', zastosujFiltry);
  elFiltrDo.addEventListener('change', zastosujFiltry);

  /*
    Inne moduly (public/js/csv-import.js) nie maja dostepu do wnetrza tego domkniecia,
    wiec o hurtowej zmianie danych informuja zdarzeniem na dokumencie.
    Luzne powiazanie: przyszly dziennik moze wyslac to samo zdarzenie.
  */
  document.addEventListener('dane-zadania-zmienione', przeladujZadania);

  // Jeden handler na cala glowke tabeli zamiast osobnego na kazdy naglowek.
  elNaglowki.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-kolumna]');
    if (th) przelaczSortowanie(th.dataset.kolumna);
  });

  // "Dni do terminu" zalezy od dzisiejszej daty, a karta potrafi byc otwarta przez
  // kilka dni. Po powrocie do karty przeliczamy kolumne, zeby nie pokazywala wczorajszych liczb.
  // Kolejnosc wierszy sie przez to nie zmienia - uplyw dnia przesuwa wszystkie terminy tak samo.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;

    for (const tr of elWiersze.children) odswiezWyliczone(tr);

    // Przy okazji odswiezamy date serwera - inaczej po nocy preset "Dziś"
    // wypelnialby pola wczorajsza data.
    try {
      const czas = await api.get('/api/czas');
      if (czas.dzisiaj !== dzisiajSerwera) {
        dzisiajSerwera = czas.dzisiaj;
        odswiezPresety();
      }
    } catch (e) {
      // Brak polaczenia nie jest tu powodem do alarmowania uzytkownika -
      // presety po prostu zostaja na dacie z ostatniego udanego pobrania.
    }
  });

  start();
})();
