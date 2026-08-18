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
    obszary: [],
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
  const elFiltrObszary = document.getElementById('filtr-obszary');
  const elFiltrProjekty = document.getElementById('filtr-projekty');
  const elPresety = document.getElementById('presety-dat');
  const elFiltrOd = document.getElementById('filtr-od');
  const elFiltrDo = document.getElementById('filtr-do');
  const elWyczysc = document.getElementById('przycisk-wyczysc');
  const elFiltrTerminDo = document.getElementById('filtr-termin-do');
  const elTrybObszary = document.getElementById('tryb-obszary');
  const elTrybProjekty = document.getElementById('tryb-projekty');
  const elOgraniczenie = document.getElementById('ograniczenie-widoku');
  const elOgraniczenieTekst = document.getElementById('ograniczenie-tekst');
  const elPokazWszystkie = document.getElementById('przycisk-pokaz-wszystkie');

  /*
    Powyzej tylu zadan widok startuje ograniczony do aktywnych. Ponizej - pokazuje
    wszystko, bo przy krotkiej liscie ograniczenie nic nie przyspiesza, a filtr
    zaznaczony na starcie bez powodu tylko dezorientuje.
  */
  const PROG_OGRANICZENIA_WIDOKU = 100;

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


  /** Etykieta slowna priorytetu. Numer spoza slownika pokazujemy w nawiasach. */
  function etykietaPriorytetu(numer) {
    const znaleziony = slowniki.priorytety.find((p) => p.numer === numer);
    return znaleziony ? znaleziony.etykieta : `(${numer})`;
  }

  /*
    Lista projektow z GET /api/projekty. Zadanie moze nie miec projektu
    (opcja pusta w dropdownie) - projekt jest kontenerem, nie wymogiem.
  */
  let projekty = [];

  /** Opcje dropdownu projektu: id jako wartosc, nazwa jako etykieta. */
  function opcjeProjektow() {
    return projekty.map((p) => ({ wartosc: p.id, etykieta: p.nazwa }));
  }

  /** Nazwa projektu po id - do eksportu CSV, gdzie samo id nic nie mowi. */
  function nazwaProjektu(id) {
    if (id === null || id === undefined) return null;
    const p = projekty.find((x) => x.id === id);
    return p ? p.nazwa : `(projekt ${id})`;
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
    obszary: new Set(),
    projekty: new Set(),
    /*
      Tryb dzialania list Obszar i Projekt: 'uwzglednij' albo 'wyklucz'.
      Regule opisuje pasujeZbior w public/js/reguly-zadan.js.
    */
    obszaryTryb: 'uwzglednij',
    projektyTryb: 'uwzglednij',
    // Gorna granica TERMINU - podstawa domyslnego widoku. Bez dolnej granicy,
    // wiec zadania po terminie zostaja widoczne (patrz pasujeTerminDo).
    terminDo: '',
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

  /** Czy znacznik niesie godzine? Pusta wartosc traktujemy jak calodzienna. */
  function maGodzine(wartosc) {
    return typeof wartosc === 'string' && wartosc.includes('T');
  }

  /*
    Komorka z data.

    Pole dobiera sie do WARTOSCI, a nie odwrotnie:
      'YYYY-MM-DD'       -> <input type="date">           (zadanie calodzienne)
      'YYYY-MM-DDTHH:MM' -> <input type="datetime-local"> (konkretna godzina)

    Oba typy pol przyjmuja i zwracaja dokladnie ten format, ktory trzymamy
    w bazie, wiec nie ma tu zadnej konwersji.

    Obok stoi przelacznik z ikona zegara: dodaje godzine (T00:00) albo ja obcina.
    Zapis idzie ta sama sciezka co kazda inna edycja, wiec serwer normalizuje
    wartosc i odrzuca bledna tak samo jak zwykle.
  */
  function komorkaZnacznikCzasu(z, pole) {
    const td = document.createElement('td');
    td.className = 'kol-data';
    td.dataset.pole = pole;

    const wartosc = z[pole] ?? '';
    const zGodzina = maGodzine(wartosc);

    const input = document.createElement('input');
    input.type = zGodzina ? 'datetime-local' : 'date';
    input.value = wartosc;
    input.addEventListener('change', () => zapisz(td.closest('tr'), pole, input.value));

    const przelacznik = document.createElement('button');
    przelacznik.type = 'button';
    przelacznik.className = 'przelacznik-godziny';
    przelacznik.textContent = '🕑';
    przelacznik.title = zGodzina ? 'Usuń godzinę (całodzienne)' : 'Dodaj godzinę';
    /*
      Puste pole nie ma czego przelaczac - bez daty godzina nie ma sensu,
      a doklejenie 'T00:00' do pustki daloby wartosc niepoprawna.
    */
    przelacznik.disabled = input.value === '';

    przelacznik.addEventListener('click', () => {
      const teraz = input.value;
      if (teraz === '') return;
      // Dodanie godziny ustawia polnoc, usuniecie obcina do samej daty.
      const nowa = maGodzine(teraz) ? teraz.slice(0, 10) : `${teraz}T00:00`;
      zapisz(td.closest('tr'), pole, nowa);
    });

    td.append(input, przelacznik);
    return td;
  }

  /*
    Trudnosc: 1-3, opcjonalna. Etykiety slowne, bo sama cyfra nic nie mowi.
    Wartosci sa krotka, zamknieta lista, wiec wystarcza staly zestaw w kodzie -
    inaczej niz stany czy klienci, ktore mieszkaja w slownikach.
  */
  const TRUDNOSCI = [
    { wartosc: 1, etykieta: '1 Łatwe' },
    { wartosc: 2, etykieta: '2 Średnie' },
    { wartosc: 3, etykieta: '3 Trudne' },
  ];

  /** Komorka z recznie wpisywanym czasem trwania w godzinach (liczy sie do XP). */
  function komorkaGodzin(z) {
    const td = document.createElement('td');
    td.className = 'kol-godziny';
    td.dataset.pole = 'czas_trwania_godziny';

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.5'; // polgodziny to najczestsza jednostka przy szacowaniu
    input.value = z.czas_trwania_godziny ?? '';
    input.addEventListener('change', () =>
      zapisz(td.closest('tr'), 'czas_trwania_godziny', input.value)
    );

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

  function komorkaAkcji(z) {
    const td = document.createElement('td');
    td.className = 'kol-akcje';

    const duplikuj = document.createElement('button');
    duplikuj.type = 'button';
    duplikuj.className = 'duplikuj';
    duplikuj.textContent = '⧉'; // dwa nalozone prostokaty
    duplikuj.title = 'Duplikuj zadanie (kopia dostaje stan "Plan", bez daty zakończenia)';
    duplikuj.addEventListener('click', () => duplikujZadanie(z.id));

    const usun = document.createElement('button');
    usun.type = 'button';
    usun.className = 'usun';
    usun.textContent = '×'; // znak "razy"
    usun.title = 'Usuń zadanie';
    usun.addEventListener('click', () => usunZadanie(z.id));

    td.append(duplikuj, usun);
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
      komorkaSelect(
        z,
        'trudnosc',
        'kol-trudnosc',
        TRUDNOSCI,
        true // trudnosc jest opcjonalna - wolno ja zostawic pusta
      ),
      komorkaGodzin(z),
      komorkaSelect(z, 'obszar', 'kol-obszar', jakoOpcje(slowniki.obszary), true),
      komorkaSelect(z, 'projekt_id', 'kol-projekt', opcjeProjektow(), true),
      komorkaZnacznikCzasu(z, 'start_zadania'),
      komorkaZnacznikCzasu(z, 'termin'),
      komorkaWyliczona('dni_do_terminu'),
      komorkaZnacznikCzasu(z, 'czas_zakonczenia')
    );
    tr.appendChild(komorkaAkcji(z));

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
    odswiezOgraniczenie();
  }

  /*
    Baner o ograniczonym widoku.

    Pokazuje sie tylko wtedy, gdy filtr stanu naprawde chowa zrobione zadania -
    czyli w widoku domyslnym. Gdy uzytkownik sam zaznaczy "Zrobione" albo wyczysci
    filtry, baner znika, bo nie ma juz o czym informowac.

    Przycisk wola wyczyscFiltry(), a nie samo odznaczenie stanow: etykieta obiecuje
    "wszystkie", wiec musi zdjac rowniez pozostale filtry, inaczej klikniecie
    pokazaloby mniej, niz zapowiada liczba w nawiasie.
  */
  function odswiezOgraniczenie() {
    const wszystkie = [...zadania.values()];
    const widoczne = filtrowane(wszystkie).length;
    const ukryte = wszystkie.length - widoczne;

    /*
      Baner opisuje OBA warunki widoku domyslnego, ale wymienia tylko te, ktore
      sa naprawde wlaczone - po recznej zmianie filtrow ma nadal mowic prawde.
    */
    const powody = [];
    if (filtry.stany.size > 0 && !filtry.stany.has(slowniki.stanZakonczony)) {
      powody.push('aktywnych');
    }
    if (filtry.terminDo) powody.push(`z terminem do ${filtry.terminDo}`);

    elOgraniczenie.hidden = ukryte === 0 || powody.length === 0;
    if (elOgraniczenie.hidden) return;

    elOgraniczenieTekst.textContent =
      `Widok ograniczony do zadań ${powody.join(' i ')} — ukryto ${ukryte}. ` +
      'Zadania po terminie i bez terminu pozostają widoczne. ';
    elPokazWszystkie.textContent = `Pokaż wszystkie (${wszystkie.length})`;
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

  /** Przelicza kolumne wyliczana i znacznik brakujacych danych do XP. */
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

    odswiezWskazowkeXp(tr, z);
  }

  /*
    Delikatna wskazowka: zadanie jest zrobione, ale bez trudnosci albo czasu
    nie da sie policzyc XP, wiec przepada. Zolty znacznik (nie czerwony - to nie blad,
    zapis sie udal) na obu komorkach, ktore trzeba uzupelnic.

    Sam wynik XP liczy serwer (lib/nagrody.js) i pokazuje strona Postać - tutaj
    celowo NIE powtarzamy silnika, zeby nie mial dwoch implementacji.
  */
  function odswiezWskazowkeXp(tr, z) {
    const zrobione = z.stan === slowniki.stanZakonczony;
    const brakuje = !regulyZadan.maDaneDoXp(z);
    const pokaz = zrobione && brakuje;

    for (const pole of ['trudnosc', 'czas_trwania_godziny']) {
      const td = tr.querySelector(`[data-pole="${pole}"]`);
      if (!td) continue;

      td.classList.toggle('brak-danych-xp', pokaz);
      if (pokaz) td.title = 'Uzupełnij trudność i czas, by policzyć XP za to zadanie.';
      else td.removeAttribute('title');
    }
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

      /*
        Komorka daty moze wymagac INNEGO TYPU pola niz ma teraz - po przelaczeniu
        zegarem 'YYYY-MM-DD' zamienia sie w 'YYYY-MM-DDTHH:MM' albo odwrotnie.
        Samo podstawienie wartosci by nie zadzialalo: <input type="date"> odrzuca
        wartosc z godzina i wyzerowalby sie po cichu. Dlatego w takim wypadku
        budujemy komorke od nowa.
      */
      if (td.classList.contains('kol-data')) {
        if (kontrolka && kontrolka.type !== (maGodzine(wartosc) ? 'datetime-local' : 'date')) {
          td.replaceWith(komorkaZnacznikCzasu(z, td.dataset.pole));
          continue;
        }
      }

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

    const wartosc = z[pole] ?? '';
    const kontrolka = td.querySelector('select, input');

    // Jak w zaktualizujWiersz: przy dacie moze sie zmienic TYP pola, a nie tylko wartosc.
    if (
      td.classList.contains('kol-data') &&
      kontrolka &&
      kontrolka.type !== (maGodzine(wartosc) ? 'datetime-local' : 'date')
    ) {
      td.replaceWith(komorkaZnacznikCzasu(z, pole));
      return;
    }

    if (kontrolka) kontrolka.value = wartosc;
    else td.textContent = wartosc;
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

  /*
    Wspolne zakonczenie dodawania i duplikowania: wstaw rekord do lokalnej kopii,
    przerysuj tabele, odszukaj nowy wiersz i zaznacz w nim nazwe, zeby pierwsze
    wpisane znaki ja nadpisaly.

    Nowy wiersz moze NIE BYC widoczny - domyslny widok pokazuje tylko aktywne
    zadania, a filtry moga odsiac takze kopie. Bez komunikatu klikniecie
    wygladaloby wtedy jak brak reakcji.
  */
  function pokazNowyWiersz(nowe, komunikatGdyUkryte) {
    zadania.set(nowe.id, nowe);
    renderuj();

    const tr = elWiersze.querySelector(`tr[data-id="${nowe.id}"]`);
    if (!tr) {
      pokazStatus(komunikatGdyUkryte, 'blad');
      return false;
    }

    tr.scrollIntoView({ block: 'nearest' });
    zaznaczTresc(tr.querySelector('[data-pole="nazwa"]'));
    return true;
  }

  async function dodajZadanie() {
    try {
      // Wartosci domyslne (nazwa, stan, priorytet, dzisiejszy termin)
      // nadaje serwer - patrz routes/zadania.js.
      const nowe = await api.post('/api/zadania');
      pokazNowyWiersz(nowe, 'Dodano zadanie, ale ukrywają je filtry.');
    } catch (e) {
      pokazStatus(e.message, 'blad');
    }
  }

  /*
    Duplikat robi SERWER jednym zapytaniem (POST /api/zadania/:id/duplikuj).
    Przegladarka nie sklada kopii sama z POST + PATCH, bo wtedy regula "kopia nie
    dziedziczy stanu ani daty zakonczenia" bylaby tylko umowa po tej stronie -
    a od niej zalezy, czy kopia nie doliczy XP za niewykonana prace.
  */
  async function duplikujZadanie(id) {
    try {
      const kopia = await api.post(`/api/zadania/${id}/duplikuj`);
      // Komunikat o sukcesie tylko wtedy, gdy kopie widac - inaczej nadpisalby
      // ostrzezenie o tym, ze ukrywaja ja filtry.
      if (pokazNowyWiersz(kopia, 'Utworzono kopię, ale ukrywają ją filtry.')) {
        pokazStatus('utworzono kopię', 'ok');
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
    'trudnosc',
    'czas_trwania_godziny',
    'obszar',
    'projekt',
    'start_zadania',
    'termin',
    'czas_zakonczenia',
    'dni_do_terminu',
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
      z.trudnosc,
      z.czas_trwania_godziny,
      z.obszar,
      nazwaProjektu(z.projekt_id),
      z.start_zadania,
      z.termin,
      z.czas_zakonczenia,
      // Kolumna wyliczana to MIGAWKA na moment eksportu - "dni do terminu"
      // liczy sie wzgledem dzisiejszej daty, wiec jutro ten sam plik wyszedlby inny.
      dniDoTerminu(z),
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
        /*
          Stan pola bierzemy ZE ZBIORU, a nie zostawiamy pustego.

          Bez tej linijki przebudowa checkboxow (po imporcie projektow albo przy
          starcie z domyslnym ograniczeniem widoku) rysowala je odznaczone, mimo ze
          zbior filtrow byl niepusty - interfejs pokazywal wtedy co innego,
          niz naprawde odsiewalo filtrowanie.
        */
        input.checked = zbior.has(o.wartosc);

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
  /** Wybrany tryb ('uwzglednij' / 'wyklucz') z pary przyciskow radio. */
  function odczytajTryb(pojemnik) {
    const wybrany = pojemnik.querySelector('input[type="radio"]:checked');
    return wybrany ? wybrany.value : 'uwzglednij';
  }

  function zastosujFiltry() {
    filtry.nazwa = elFiltrNazwa.value.trim().toLocaleLowerCase('pl');
    filtry.terminDo = elFiltrTerminDo.value;
    filtry.obszaryTryb = odczytajTryb(elTrybObszary);
    filtry.projektyTryb = odczytajTryb(elTrybProjekty);
    filtry.od = elFiltrOd.value;
    filtry.do = elFiltrDo.value;
    // Zbiory (stany, priorytety, obszary, projekty) sa aktualizowane na biezaco
    // przez handlery checkboxow.

    const ile = ileAktywnychFiltrow();
    elZnacznikFiltrow.textContent = ile > 0 ? ` — aktywne: ${ile}` : '';

    odswiezPresety();
    renderuj();
  }

  function wyczyscFiltry() {
    elFiltrNazwa.value = '';
    elFiltrTerminDo.value = '';
    elFiltrOd.value = '';
    elFiltrDo.value = '';
    for (const input of elPanelFiltrow.querySelectorAll('input[type="checkbox"]')) {
      input.checked = false;
    }
    // Tryby wracaja do "uwzglednij" - inaczej po wyczyszczeniu zostalby
    // przelacznik w pozycji "wyklucz" bez zaznaczonej ani jednej wartosci.
    for (const pojemnik of [elTrybObszary, elTrybProjekty]) {
      pojemnik.querySelector('input[value="uwzglednij"]').checked = true;
    }
    filtry.stany.clear();
    filtry.priorytety.clear();
    filtry.obszary.clear();
    filtry.projekty.clear();
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
    zbudujCheckboxy(elFiltrObszary, jakoOpcje(slowniki.obszary), filtry.obszary);
    zbudujCheckboxy(
      elFiltrProjekty,
      projekty.map((p) => ({ wartosc: p.id, etykieta: p.nazwa })),
      filtry.projekty
    );
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
      const [pobraneSlowniki, pobraneProjekty, czas, lista] = await Promise.all([
        api.get('/api/slowniki'),
        api.get('/api/projekty'),
        api.get('/api/czas'),
        api.get('/api/zadania'),
      ]);
      slowniki = pobraneSlowniki;
      // Projekty musza byc przed budowaniem wierszy - z nich powstaje dropdown.
      projekty = pobraneProjekty;
      dzisiajSerwera = czas.dzisiaj;

      /*
        DOMYSLNE OGRANICZENIE WIDOKU - musi byc PRZED zbudujPanelFiltrow(),
        bo checkboxy biora stan zaznaczenia z tego zbioru.

        Przy 537 zadaniach pelna tabela to ~37 000 elementow <option> i ~290 ms
        na kazde przerysowanie (a renderuj() leci przy kazdym nacisnieciu klawisza
        w filtrze nazwy). Sam odsiew i sortowanie zajmuja ponizej 1 ms - caly koszt
        siedzi w budowaniu DOM, wiec jedyne, co pomaga, to mniej wierszy.

        Zbior zostaje pusty, gdy zadan jest malo: przy kilkunastu wierszach
        ograniczenie nic nie daje, a filtr na starcie tylko myli.
      */
      if (lista.length > PROG_OGRANICZENIA_WIDOKU) {
        for (const stan of regulyZadan.domyslneStany(slowniki)) filtry.stany.add(stan);
        // Druga polowa domyslnego widoku: termin nie dalej niz dzisiaj + 7 dni.
        // Pole jest widoczne w panelu, wiec od razu wiadomo, co odsiewa.
        elFiltrTerminDo.value = regulyZadan.domyslnyTerminDo(dzisiajSerwera);
      }

      zbudujPanelFiltrow();

      for (const z of lista) zadania.set(z.id, z);

      /*
        Start idzie przez zastosujFiltry(), a nie prosto przez renderuj():
        to ono przepisuje pola formularza do obiektu `filtry` i odswieza znacznik
        przy zwinietym panelu. Przy domyslnym ograniczeniu widoku ma to znaczenie -
        inaczej odsiew dzialalby, ale zwiniety panel twierdzilby, ze filtrow nie ma.
      */
      zastosujFiltry();
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

  /**
   * Pobiera projekty od nowa: odswieza dropdown w kolumnie Projekt i liste
   * w filtrach. Potrzebne, bo profil importu "notion-quest-log" tworzy projekty
   * razem z zadaniami - bez tego nowy projekt bylby w bazie, ale nie do wybrania,
   * a zadanie do niego przypisane pokazywaloby puste pole az do odswiezenia strony.
   *
   * Zaznaczenia w filtrze przezywaja przebudowe, bo zbudujCheckboxy ustawia
   * `checked` ze zbioru filtry.projekty, a nie zostawia pol pustych.
   */
  async function przeladujProjekty() {
    try {
      projekty = await api.get('/api/projekty');
      zbudujCheckboxy(
        elFiltrProjekty,
        projekty.map((p) => ({ wartosc: p.id, etykieta: p.nazwa })),
        filtry.projekty
      );
      renderuj();
    } catch (e) {
      pokazStatus('Nie udało się odświeżyć projektów: ' + e.message, 'blad');
    }
  }

  elDodaj.addEventListener('click', dodajZadanie);
  elEksport.addEventListener('click', eksportujCsv);
  elWyczysc.addEventListener('click', wyczyscFiltry);
  elPokazWszystkie.addEventListener('click', wyczyscFiltry);

  // 'input' zamiast 'change' - lista filtruje sie w trakcie pisania.
  elFiltrNazwa.addEventListener('input', zastosujFiltry);
  elFiltrOd.addEventListener('change', zastosujFiltry);
  elFiltrDo.addEventListener('change', zastosujFiltry);
  elFiltrTerminDo.addEventListener('change', zastosujFiltry);
  // Jeden handler na pojemnik zamiast osobnego na kazdy radio.
  elTrybObszary.addEventListener('change', zastosujFiltry);
  elTrybProjekty.addEventListener('change', zastosujFiltry);

  /*
    Inne moduly (public/js/csv-import.js) nie maja dostepu do wnetrza tego domkniecia,
    wiec o hurtowej zmianie danych informuja zdarzeniem na dokumencie.
    Luzne powiazanie: przyszly dziennik moze wyslac to samo zdarzenie.
  */
  document.addEventListener('dane-zadania-zmienione', przeladujZadania);
  document.addEventListener('dane-projekty-zmienione', przeladujProjekty);

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
