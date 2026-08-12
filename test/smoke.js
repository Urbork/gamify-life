/*
  Smoke test - formalizacja sprawdzen, ktore wczesniej robilo sie recznie przy kazdej zmianie.

  URUCHOMIENIE:  npm run test:smoke

  CO SPRAWDZA
  1. Zadania:  presety zakresu dat, sortowanie po kazdej kolumnie w obu kierunkach
               (z regula "Zrobione zawsze na dole"), kolumny wyliczane.
  2. Dziennik: filtr nawyku, szukanie tekstowe (w tym wielkosc liter), wlasny zakres dat.
  3. Import:   oba profile odrzucaja te same wiersze z tymi samymi powodami (regresja).
  4. Endpointy: limit rozmiaru zadania - test KOLEJNOSCI middleware w server.js.

  IZOLACJA DANYCH
  Skrypt NIE dotyka data/baza.db. Tworzy wlasny plik w katalogu tymczasowym systemu,
  uruchamia na nim serwer jako osobny proces (BAZA_DANYCH + PORT), a na koniec kasuje
  plik razem z dziennikami WAL. Nawet przerwany w polowie nie zostawi sladu w danych.

  DLACZEGO OSOBNY PROCES SERWERA, A NIE WYWOLANIA FUNKCJI
  Sprawdzenie limitu 413 dotyczy kolejnosci middleware w Expressie. Ma sens wylacznie
  wtedy, gdy zadanie przechodzi przez prawdziwy stos HTTP - wywolanie funkcji routera
  ominelo by dokladnie to, co testujemy.

  DLACZEGO REGULY LADUJA SIE PRZEZ vm
  Filtrowanie i sortowanie to kod przegladarki (public/js/reguly-*.js). Ladujemy go
  w sandboksie dokladnie tak, jak robi to przegladarka kolejnymi <script>. Dzieki temu
  test sprawdza TEN SAM kod, ktory wykonuje aplikacja - a nie jego kopie, ktora
  przechodzilaby takze wtedy, gdy aplikacja jest zepsuta.
*/

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const KATALOG_PROJEKTU = path.join(__dirname, '..');
const PORT = 3999;
const BAZA = path.join(os.tmpdir(), `gamify-smoke-${process.pid}.db`);

// --- raportowanie ---------------------------------------------------------

let zaliczone = 0;
let oblane = 0;

function sprawdz(opis, warunek, szczegoly) {
  if (warunek) {
    zaliczone++;
    console.log(`  PASS  ${opis}`);
  } else {
    oblane++;
    console.log(`  FAIL  ${opis}`);
    if (szczegoly !== undefined) console.log(`        ${szczegoly}`);
  }
}

/** Porownanie tablic - najczestszy ksztalt asercji w tym pliku. */
function sprawdzListe(opis, otrzymane, oczekiwane) {
  const a = JSON.stringify(otrzymane);
  const b = JSON.stringify(oczekiwane);
  sprawdz(opis, a === b, `oczekiwano ${b}, otrzymano ${a}`);
}

function sekcja(tytul) {
  console.log(`\n${tytul}`);
}

// --- daty testowe ---------------------------------------------------------

const MS_W_DNIU = 86400000;
const dwie = (n) => String(n).padStart(2, '0');

const t = new Date();
const DZIS = `${t.getFullYear()}-${dwie(t.getMonth() + 1)}-${dwie(t.getDate())}`;

function numerDnia(iso) {
  const [r, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(r, m - 1, d) / MS_W_DNIU;
}

/*
  WSZYSTKIE daty w zestawie testowym musza byc liczone WZGLEDEM DZISIAJ.

  Data wpisana na sztywno sprawia, ze test przechodzi albo nie w zaleznosci od dnia,
  w ktorym go uruchomisz - a test, ktory czasem pada bez powodu, uczy ignorowania
  czerwonych wynikow. (Tak sie tu juz raz zdarzylo: zadanie G mialo zaszyte
  2026-08-10, wiec do 9 sierpnia "zaczynalo sie jutro", a od 10 sierpnia "dzisiaj",
  i asercja presetu "Dziś" zmienila wynik z dnia na dzien.)
*/

/** Data przesunieta o n dni wzgledem dzisiaj, jako znacznik 'YYYY-MM-DDT00:00'. */
function dzien(n) {
  return dzienOGodzinie(n, '00:00');
}

/** To samo, ale z podana godzina - do przypadkow granicznych wokol polnocy. */
function dzienOGodzinie(n, godzina) {
  const data = new Date((numerDnia(DZIS) + n) * MS_W_DNIU).toISOString().slice(0, 10);
  return `${data}T${godzina}`;
}

// --- reguly z przegladarki ------------------------------------------------

/** Laduje pliki public/js w jednym sandboksie, tak jak robi to przegladarka. */
function zaladujReguly() {
  const sandbox = { console };
  vm.createContext(sandbox);

  for (const plik of [
    'filtr-dat.js',
    'reguly-zadan.js',
    'reguly-dziennika.js',
    'reguly-statystyk.js',
  ]) {
    const kod = fs.readFileSync(path.join(KATALOG_PROJEKTU, 'public', 'js', plik), 'utf8');
    vm.runInContext(kod, sandbox, { filename: plik });
  }

  /*
    Moduly deklaruja sie przez `const`, ktore trafia do zakresu leksykalnego kontekstu,
    a NIE staje sie wlasciwoscia obiektu sandboksu (tak samo jak w przegladarce
    top-level `const` nie ladue na `window`). Dlatego wyciagamy je wyrazeniem
    wykonanym w tym samym kontekscie.
  */
  return vm.runInContext(
    '({ filtrDat, regulyZadan, regulyDziennika, regulyStatystyk })',
    sandbox
  );
}

// --- serwer ---------------------------------------------------------------

const B = `http://localhost:${PORT}`;

async function zapytaj(metoda, sciezka, cialo) {
  const opcje = { method: metoda, headers: {} };
  if (cialo !== undefined) {
    opcje.headers['Content-Type'] = 'application/json';
    opcje.body = JSON.stringify(cialo);
  }
  const odp = await fetch(B + sciezka, opcje);
  const tresc = odp.status === 204 ? null : await odp.json().catch(() => null);
  return { status: odp.status, tresc };
}

function uruchomSerwer() {
  const proces = spawn(process.execPath, ['server.js'], {
    cwd: KATALOG_PROJEKTU,
    env: { ...process.env, BAZA_DANYCH: BAZA, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logi = '';
  proces.stdout.on('data', (d) => (logi += d));
  proces.stderr.on('data', (d) => (logi += d));
  proces.on('exit', (kod) => {
    if (kod !== 0 && kod !== null) console.error('Serwer zakonczyl sie kodem', kod, '\n', logi);
  });

  return proces;
}

/** Czeka, az serwer zacznie odpowiadac. Rzuca po ~10 s, zeby test nie wisial w nieskonczonosc. */
async function poczekajNaSerwer() {
  for (let i = 0; i < 100; i++) {
    try {
      const odp = await fetch(`${B}/api/czas`);
      if (odp.ok) return;
    } catch (e) {
      /* jeszcze nie nasluchuje */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Serwer testowy nie wystartowal w 10 sekund.');
}

/*
  Sprzatanie musi POCZEKAC, az proces serwera naprawde sie zakonczy.
  Dopoki zyje, Windows trzyma plik bazy otwarty i kasowanie konczy sie EPERM.
*/
async function posprzataj(proces) {
  if (proces && proces.exitCode === null) {
    await new Promise((resolve) => {
      proces.once('exit', resolve);
      proces.kill();
      // Gdyby proces nie zareagowal, nie blokujemy sprzatania w nieskonczonosc.
      setTimeout(resolve, 3000);
    });
  }

  // WAL zostawia obok bazy jeszcze dwa pliki - kasujemy komplet.
  // maxRetries radzi sobie z chwilowym trzymaniem uchwytu przez system.
  for (const plik of [BAZA, `${BAZA}-wal`, `${BAZA}-shm`]) {
    try {
      fs.rmSync(plik, { force: true, maxRetries: 10, retryDelay: 100 });
    } catch (e) {
      console.error(`Nie udalo sie usunac pliku testowego ${plik}: ${e.message}`);
    }
  }
}

// --- dane testowe ---------------------------------------------------------

/*
  Zadania. Uwaga na pulapke: POST /api/zadania nadaje start_zadania = dzisiaj,
  wiec KAZDE nowe zadanie lapaloby sie do zakresu przez warunek aktywnosci.
  Dlatego kazdy rekord ma wszystkie trzy pola dat ustawione JAWNIE (start_zadania: ''
  tam, gdzie ma go nie byc) - inaczej liczby dla presetow nic by nie znaczyly.
*/
const ZADANIA = [
  { nazwa: 'A termin dzis', stan: 'Plan', priorytet: 3, termin: dzien(0), start_zadania: '' },
  { nazwa: 'B termin jutro', stan: 'Czeka', priorytet: 1, termin: dzien(1), start_zadania: '' },
  { nazwa: 'C termin za 5 dni', stan: 'W trakcie', priorytet: 2, termin: dzien(5), start_zadania: '' },
  { nazwa: 'D termin za 20 dni', stan: 'Blok', priorytet: 4, termin: dzien(20), start_zadania: '' },
  // Zrobione, z kompletem danych do XP: trudnosc 2 x 2h = 4 XP, termin dzis = mnoznik 1.
  {
    nazwa: 'E zrobione dzis',
    stan: 'Zrobione',
    priorytet: 2,
    termin: dzien(0),
    start_zadania: '',
    trudnosc: 2,
    czas_trwania_godziny: 2,
  },
  { nazwa: 'F bez zadnych dat', stan: 'Plan', priorytet: 0, start_zadania: '' },
  /*
    Para godzin przez polnoc: 23:59 -> 00:01 to niecale 25 godzin, ale DWA dni kalendarzowe.
    Start JUTRO (nie dzis), zeby zadanie bylo poza presetem "Dziś", a weszlo dopiero
    do "Dziś + jutro" - to sprawdza niezaleznosc warunku aktywnosci od warunku terminu.
    Daty licza sie wzgledem dzisiaj, wiec wynik nie zalezy od dnia uruchomienia testu.
  */
  {
    nazwa: 'G trwanie przez polnoc',
    stan: 'Plan',
    priorytet: 2,
    start_zadania: dzienOGodzinie(1, '23:59'),
    czas_zakonczenia: dzienOGodzinie(3, '00:01'),
    termin: '',
    // Czas wpisany recznie - nie ma juz zwiazku z roznica dat powyzej.
    czas_trwania_godziny: 4,
  },
];

const WPISY = [
  { data: '2024-03-05', nawyki: 'Drink Water, Drawing', wdziecznosc: 'Spokojny poranek' },
  { data: '2024-03-15', nawyki: 'Vitamins', bledy: 'Rozmowa z KAROLINĄ poszła źle' },
  { data: '2024-03-25', nawyki: 'Drawing, Vitamins', rozmowa: 'Długa rozmowa z karoliną' },
  { data: '2024-06-10', nawyki: 'Drink Water', sniadanie: 'kawa i kanapki' },
  { data: '2025-01-20', nawyki: '', do_przemyslenia: 'Co dalej?' },
];

// --- testy ----------------------------------------------------------------

async function testujZadania(reguly, slowniki) {
  sekcja('ZADANIA');

  const { tresc: lista } = await zapytaj('GET', '/api/zadania');
  const nazwy = (l) => l.map((z) => z.nazwa);
  const pustyFiltr = () => ({
    nazwa: '',
    stany: new Set(),
    priorytety: new Set(),
    obszary: new Set(),
    projekty: new Set(),
    od: '',
    do: '',
  });

  sprawdz(`zestaw testowy zaladowany (${lista.length} zadan)`, lista.length === ZADANIA.length);

  // --- kolumny wyliczane ---
  const znajdz = (n) => lista.find((z) => z.nazwa === n);
  sprawdz(
    'Dni do terminu: termin dzisiaj -> 0',
    reguly.regulyZadan.dniDoTerminu(znajdz('A termin dzis'), DZIS) === 0
  );
  sprawdz(
    'Dni do terminu: termin za 5 dni -> 5',
    reguly.regulyZadan.dniDoTerminu(znajdz('C termin za 5 dni'), DZIS) === 5
  );
  sprawdz(
    'Dni do terminu: brak terminu -> null',
    reguly.regulyZadan.dniDoTerminu(znajdz('F bez zadnych dat'), DZIS) === null
  );
  /*
    Kolumna "Czas trwania (dni)" liczona z roznicy dat zostala USUNIETA -
    zastapilo ja reczne pole `czas_trwania_godziny`. Zamiast niej sprawdzamy
    wskaznik kompletnosci danych do XP.
  */
  sprawdz(
    'maDaneDoXp: komplet trudnosci i czasu -> true',
    reguly.regulyZadan.maDaneDoXp({ trudnosc: 2, czas_trwania_godziny: 1.5 }) === true
  );
  sprawdz(
    'maDaneDoXp: brak czasu -> false',
    reguly.regulyZadan.maDaneDoXp({ trudnosc: 2 }) === false
  );
  sprawdz(
    'maDaneDoXp: trudnosc 0 nie jest "brakiem" tylko wartoscia spoza zakresu',
    reguly.regulyZadan.maDaneDoXp({ trudnosc: 0, czas_trwania_godziny: 1 }) === true
  );

  // --- presety zakresu dat ---
  const P = reguly.filtrDat.PRESETY;
  const przezPreset = (preset) => {
    const zakres = reguly.filtrDat.zakresPresetu(DZIS, preset.dni);
    const filtry = { ...pustyFiltr(), od: zakres.od, do: zakres.do };
    return nazwy(reguly.regulyZadan.filtrowane(lista, filtry)).sort();
  };

  /*
    UWAGA na zadanie G: ma start 2026-08-10 i koniec 2026-08-12, ale ZADNEGO terminu.
    Nie lapie sie wiec przez warunek a), tylko przez b) - okres jego aktywnosci
    nachodzi na kazdy zakres siegajacy 10 sierpnia lub dalej. W presecie "Dziś"
    go nie ma (start jest jutro), w szerszych juz tak. To celowy przypadek testowy
    na niezaleznosc obu warunkow.
  */
  sprawdzListe('preset "Dziś" (G jeszcze sie nie zaczelo)', przezPreset(P.DZIS), [
    'A termin dzis',
    'E zrobione dzis',
  ]);
  sprawdzListe('preset "Dziś + jutro" (G wchodzi przez okres aktywnosci)', przezPreset(P.DZIS_JUTRO), [
    'A termin dzis',
    'B termin jutro',
    'E zrobione dzis',
    'G trwanie przez polnoc',
  ]);
  sprawdzListe('preset "7 dni"', przezPreset(P.TYDZIEN), [
    'A termin dzis',
    'B termin jutro',
    'C termin za 5 dni',
    'E zrobione dzis',
    'G trwanie przez polnoc',
  ]);
  sprawdzListe('preset "30 dni"', przezPreset(P.MIESIAC), [
    'A termin dzis',
    'B termin jutro',
    'C termin za 5 dni',
    'D termin za 20 dni',
    'E zrobione dzis',
    'G trwanie przez polnoc',
  ]);
  sprawdz(
    'preset "Wszystkie" nie filtruje (takze zadanie bez dat)',
    przezPreset(P.WSZYSTKIE).length === ZADANIA.length
  );
  sprawdz(
    'zadanie bez zadnej z trzech dat nigdy nie wpada w zakres',
    !przezPreset(P.MIESIAC).includes('F bez zadnych dat')
  );

  // --- sortowanie ---
  const posortuj = (kolumna, kierunek) =>
    nazwy(reguly.regulyZadan.posortowane(lista, { kolumna, kierunek }, slowniki, DZIS));

  const KOLUMNY = [
    'id',
    'stan',
    'nazwa',
    'priorytet',
    'obszar',
    'start_zadania',
    'termin',
    'dni_do_terminu',
    'czas_zakonczenia',
    'trudnosc',
    'czas_trwania_godziny',
  ];

  let regulaGrupyTrzyma = true;
  for (const kolumna of KOLUMNY) {
    for (const kierunek of ['rosnaco', 'malejaco']) {
      const wynik = posortuj(kolumna, kierunek);
      if (wynik[wynik.length - 1] !== 'E zrobione dzis') {
        regulaGrupyTrzyma = false;
        console.log(`        ${kolumna}/${kierunek}: ${JSON.stringify(wynik)}`);
      }
    }
  }
  sprawdz(
    `"Zrobione" zawsze na dole - ${KOLUMNY.length} kolumn x 2 kierunki`,
    regulaGrupyTrzyma
  );

  sprawdzListe('sortowanie po nazwie rosnaco', posortuj('nazwa', 'rosnaco'), [
    'A termin dzis',
    'B termin jutro',
    'C termin za 5 dni',
    'D termin za 20 dni',
    'F bez zadnych dat',
    'G trwanie przez polnoc',
    'E zrobione dzis',
  ]);
  sprawdzListe('sortowanie po priorytecie malejaco', posortuj('priorytet', 'malejaco'), [
    'D termin za 20 dni',
    'A termin dzis',
    'C termin za 5 dni',
    'G trwanie przez polnoc',
    'B termin jutro',
    'F bez zadnych dat',
    'E zrobione dzis',
  ]);
  sprawdz(
    'stan sortuje sie wg slownika, nie alfabetycznie (Plan przed Czeka)',
    posortuj('stan', 'rosnaco')[0].startsWith('A') || posortuj('stan', 'rosnaco')[0].startsWith('F')
  );

  // puste na koncu grupy TAKZE przy malejaco
  const terminMalejaco = posortuj('termin', 'malejaco');
  sprawdz(
    'puste terminy na koncu takze przy sortowaniu malejaco',
    terminMalejaco.slice(-3, -1).every((n) => n.startsWith('F') || n.startsWith('G')),
    JSON.stringify(terminMalejaco)
  );

  // --- filtry pozostalych pol ---
  sprawdzListe(
    'filtr nazwy: fragment, wielkosc liter nieistotna',
    nazwy(reguly.regulyZadan.filtrowane(lista, { ...pustyFiltr(), nazwa: 'termin za' })).sort(),
    ['C termin za 5 dni', 'D termin za 20 dni']
  );
  sprawdz(
    'filtr stanu (LUB w obrebie pola)',
    reguly.regulyZadan.filtrowane(lista, {
      ...pustyFiltr(),
      stany: new Set(['Plan', 'Blok']),
    }).length === 4
  );
  sprawdz(
    'filtr priorytetu 0 dziala (zero nie jest traktowane jak brak)',
    reguly.regulyZadan.filtrowane(lista, { ...pustyFiltr(), priorytety: new Set([0]) }).length === 1
  );
}

async function testujDziennik(reguly) {
  sekcja('DZIENNIK');

  const { tresc: lista } = await zapytaj('GET', '/api/dziennik');
  const pustyFiltr = () => ({ szukaj: '', nawyki: new Set(), od: '', do: '' });
  const daty = (l) => l.map((w) => w.data).sort();

  sprawdz(`zestaw testowy zaladowany (${lista.length} wpisow)`, lista.length === WPISY.length);

  sprawdzListe(
    'filtr nawyku: Drawing',
    daty(reguly.regulyDziennika.filtrowane(lista, { ...pustyFiltr(), nawyki: new Set(['Drawing']) })),
    ['2024-03-05', '2024-03-25']
  );
  sprawdzListe(
    'filtr nawyku: Drawing LUB Vitamins',
    daty(
      reguly.regulyDziennika.filtrowane(lista, {
        ...pustyFiltr(),
        nawyki: new Set(['Drawing', 'Vitamins']),
      })
    ),
    ['2024-03-05', '2024-03-15', '2024-03-25']
  );
  sprawdz(
    'filtr nawyku porownuje CALE nazwy, nie fragmenty ("Water" nie lapie "Drink Water")',
    reguly.regulyDziennika.filtrowane(lista, { ...pustyFiltr(), nawyki: new Set(['Water']) })
      .length === 0
  );

  const szukaj = (tekst) =>
    daty(
      reguly.regulyDziennika.filtrowane(lista, {
        ...pustyFiltr(),
        szukaj: tekst.toLocaleLowerCase('pl'),
      })
    );
  /*
    Szukamy rdzenia "karolin", bo w danych wystepuje odmiana "Karoliną" (narzednik).
    Dopasowanie jest zwyklym fragmentem tekstu, bez sprowadzania do formy podstawowej -
    "karolina" NIE znalazloby "karoliną" i tak ma byc.
  */
  sprawdzListe('szukanie tekstowe: "karolin"', szukaj('karolin'), ['2024-03-15', '2024-03-25']);
  sprawdzListe('szukanie tekstowe: "KAROLIN" (wielkosc liter nieistotna)', szukaj('KAROLIN'), [
    '2024-03-15',
    '2024-03-25',
  ]);
  sprawdz(
    'szukanie to zwykly fragment, bez odmiany ("karolina" nie znajdzie "karoliną")',
    szukaj('karolina').length === 0
  );
  sprawdz(
    'szukanie NIE obejmuje posilkow (sniadanie/obiad/kolacja) - zgodnie ze specyfikacja',
    szukaj('kawa').length === 0
  );

  sprawdzListe(
    'wlasny zakres dat: marzec 2024',
    daty(
      reguly.regulyDziennika.filtrowane(lista, {
        ...pustyFiltr(),
        od: '2024-03-01',
        do: '2024-03-31',
      })
    ),
    ['2024-03-05', '2024-03-15', '2024-03-25']
  );
  sprawdz(
    'zakres otwarty z jednej strony (tylko OD)',
    reguly.regulyDziennika.filtrowane(lista, { ...pustyFiltr(), od: '2024-06-01' }).length === 2
  );

  sprawdzListe(
    'sortowanie po dacie malejaco (domyslne w dzienniku)',
    reguly.regulyDziennika
      .posortowane(lista, { kolumna: 'data', kierunek: 'malejaco' })
      .map((w) => w.data),
    ['2025-01-20', '2024-06-10', '2024-03-25', '2024-03-15', '2024-03-05']
  );
}

async function testujStatystyki(reguly) {
  sekcja('STATYSTYKI');

  const { tresc: zadania } = await zapytaj('GET', '/api/zadania');
  const { tresc: wpisy } = await zapytaj('GET', '/api/dziennik');
  const { tresc: slowniki } = await zapytaj('GET', '/api/slowniki');

  const sz = reguly.regulyStatystyk.statystykiZadan(zadania, slowniki);
  const sd = reguly.regulyStatystyk.statystykiDziennika(wpisy);

  // --- zadania ---
  sprawdz('liczba zadan lacznie', sz.lacznie === ZADANIA.length);
  sprawdz(
    'suma zadan wg stanu = liczba wszystkich',
    sz.wgStanu.reduce((a, s) => a + s.ile, 0) === ZADANIA.length,
    JSON.stringify(sz.wgStanu)
  );
  sprawdz(
    'suma zadan wg obszaru = liczba wszystkich (z pozycja "(brak)")',
    sz.wgObszaru.reduce((a, s) => a + s.ile, 0) === ZADANIA.length
  );

  /*
    Sredni czas trwania liczy sie teraz z RECZNEGO pola `czas_trwania_godziny`
    (w GODZINACH), a nie z roznicy dat. W zestawie maja je dwa zadania: 2h i 4h.
  */
  sprawdz(
    'sredni czas trwania w godzinach, tylko z zadan z wpisanym czasem',
    sz.czasTrwania.ile === 2 && sz.czasTrwania.srednia === 3,
    JSON.stringify(sz.czasTrwania)
  );

  /*
    Zadne zadanie w zestawie nie ma JEDNOCZESNIE terminu i daty zakonczenia
    (G ma daty, ale nie ma terminu), wiec mianownik jest zerowy,
    a procent MUSI byc null - nie NaN i nie 0.
  */
  sprawdz(
    'po terminie: pusty mianownik daje procent null, nie NaN',
    sz.poTerminie.zBadanych === 0 && sz.poTerminie.procent === null,
    JSON.stringify(sz.poTerminie)
  );

  // Sztuczny zestaw pod sam wskaznik "po terminie" - liczony na dniach kalendarzowych.
  const proba = [
    // zakonczone dzien po terminie -> PO TERMINIE
    { termin: '2026-03-10T09:00', czas_zakonczenia: '2026-03-11T09:00' },
    // zakonczone tego samego dnia, ale pozniejsza godzina -> NA CZAS (liczymy dni)
    { termin: '2026-03-10T09:00', czas_zakonczenia: '2026-03-10T23:00' },
    // zakonczone przed terminem -> NA CZAS
    { termin: '2026-03-10T09:00', czas_zakonczenia: '2026-03-01T09:00' },
    // brak jednej z dat -> POZA mianownikiem
    { termin: '2026-03-10T09:00', czas_zakonczenia: null },
    { termin: null, czas_zakonczenia: '2026-03-10T09:00' },
  ];
  const wynikProby = reguly.regulyStatystyk.poTerminie(proba);
  sprawdz(
    'po terminie: mianownik to tylko rekordy z OBIEMA datami (3 z 5)',
    wynikProby.zBadanych === 3,
    JSON.stringify(wynikProby)
  );
  sprawdz(
    'po terminie: 1 z 3 spoznione (33,3%)',
    wynikProby.ile === 1 && Math.round(wynikProby.procent) === 33,
    JSON.stringify(wynikProby)
  );
  sprawdz(
    'po terminie: zakonczenie o 23:00 w dniu terminu to NIE spoznienie (porownanie na dniach)',
    wynikProby.ile === 1
  );

  // --- dziennik ---
  sprawdz('liczba wpisow dziennika', sd.lacznie === WPISY.length);
  sprawdz('zakres dat od najstarszego do najnowszego', sd.odDaty === '2024-03-05' && sd.doDaty === '2025-01-20');

  /*
    Tabela miesieczna. W zestawie: 2024-03 ma 3 wpisy (wszystkie z refleksja),
    2024-06 ma 1 wpis bez refleksji (samo sniadanie - to NIE jest pole refleksyjne),
    2025-01 ma 1 wpis z refleksja.
  */
  sprawdzListe(
    'miesiace w kolejnosci chronologicznej',
    sd.miesiace.map((m) => m.miesiac),
    ['2024-03', '2024-06', '2025-01']
  );
  sprawdzListe(
    'liczba wpisow w miesiacach',
    sd.miesiace.map((m) => m.wpisow),
    [3, 1, 1]
  );
  sprawdzListe(
    'wpisy z refleksja w miesiacach (sniadanie NIE liczy sie jako refleksja)',
    sd.miesiace.map((m) => m.zRefleksja),
    [3, 0, 1]
  );
  sprawdzListe(
    'odsetek refleksji w miesiacach',
    sd.miesiace.map((m) => Math.round(m.procent)),
    [100, 0, 100]
  );
  sprawdz(
    'miesiace bez wpisow nie pojawiaja sie w tabeli',
    !sd.miesiace.some((m) => m.miesiac === '2024-04')
  );

  // Pole wypelnione pustym tekstem musi liczyc sie jako BRAK refleksji.
  sprawdz(
    'pusty tekst w polu refleksyjnym liczy sie jako brak',
    reguly.regulyStatystyk.maRefleksje({ wdziecznosc: '   ', bledy: null }) === false
  );
  sprawdz(
    'wypelnione choc jedno pole refleksyjne wystarczy',
    reguly.regulyStatystyk.maRefleksje({ wdziecznosc: null, do_przemyslenia: 'cos' }) === true
  );

  // Srednie pomijaja braki i raportuja, z ilu rekordow policzone.
  const ocenaStresu = sd.oceny.find((o) => o.pole === 'stres');
  sprawdz('oceny obejmuja wszystkie cztery skale', sd.oceny.length === 4);
  sprawdz(
    'srednia raportuje liczbe rekordow, na ktorych sie opiera',
    typeof ocenaStresu.ile === 'number'
  );
  const sr = reguly.regulyStatystyk.srednia(
    [{ x: 2 }, { x: 4 }, { x: null }, { x: undefined }],
    'x'
  );
  sprawdz(
    'srednia pomija braki: [2,4,null,undefined] -> 3 z 2 rekordow',
    sr.srednia === 3 && sr.ile === 2 && sr.min === 2 && sr.max === 4,
    JSON.stringify(sr)
  );
  sprawdz(
    'srednia z pustej listy -> null, nie NaN',
    reguly.regulyStatystyk.srednia([], 'x').srednia === null
  );
}

async function testujSilnikXp() {
  sekcja('SILNIK XP (lib/nagrody.js, w izolacji)');

  /*
    Silnik jest zwyklym modulem serwerowym, wiec testujemy go przez require(),
    bez sandboksu vm. Ta sztuczka jest potrzebna tylko dla plikow z public/js,
    ktore musza dzialac takze w przegladarce.

    Wszystkie funkcje sa czyste, wiec karmimy je syntetycznymi przypadkami
    brzegowymi - bez bazy, bez HTTP.
  */
  const nagrody = require('../lib/nagrody');
  const zrobione = (o) => nagrody.xpZadania({ stan: 'Zrobione', ...o }).xp;

  // --- XP zadania ---
  sprawdz(
    'trywialne zadanie daje 1 XP, nigdy 0',
    zrobione({ trudnosc: 1, czas_trwania_godziny: 0.1 }) === 1
  );
  sprawdz(
    'trudnosc 3 x 4h = 12 XP (bez dat, mnoznik 1)',
    zrobione({ trudnosc: 3, czas_trwania_godziny: 4 }) === 12
  );
  sprawdz(
    'zadanie nie-Zrobione daje 0 XP',
    nagrody.xpZadania({ stan: 'Plan', trudnosc: 3, czas_trwania_godziny: 4 }).xp === 0
  );
  sprawdz(
    'brak trudnosci: 0 XP i flaga brakujaceDane',
    nagrody.xpZadania({ stan: 'Zrobione', czas_trwania_godziny: 4 }).brakujaceDane === true
  );
  sprawdz(
    'niedokonczone zadanie bez danych NIE jest oznaczone jako brakujace',
    nagrody.xpZadania({ stan: 'Plan' }).brakujaceDane === false
  );

  // --- trzy progi terminowosci ---
  const zDatami = (termin, koniec) =>
    zrobione({ trudnosc: 3, czas_trwania_godziny: 4, termin, czas_zakonczenia: koniec });

  sprawdz('mnoznik x1.5: zapas 5 dni -> 18 XP', zDatami('2026-03-10', '2026-03-05') === 18);
  sprawdz(
    'mnoznik x1.5: granica DOKLADNIE 3 dni zapasu -> 18 XP',
    zDatami('2026-03-10', '2026-03-07') === 18
  );
  sprawdz('mnoznik x1: zapas 2 dni -> 12 XP', zDatami('2026-03-10', '2026-03-08') === 12);
  sprawdz('mnoznik x1: ten sam dzien -> 12 XP', zDatami('2026-03-10', '2026-03-10') === 12);
  sprawdz(
    'mnoznik x1: godzina nie psuje - 23:00 w dniu terminu to nadal na czas',
    zDatami('2026-03-10T09:00', '2026-03-10T23:00') === 12
  );
  sprawdz('mnoznik x0.5: dzien po terminie -> 6 XP', zDatami('2026-03-10', '2026-03-11') === 6);
  sprawdz(
    'mnoznik x1 gdy brakuje ktorejs z dat',
    zDatami('2026-03-10', null) === 12 && zDatami(null, '2026-03-11') === 12
  );
  sprawdz(
    'dolny limit dziala takze po zmniejszeniu przez x0.5',
    zrobione({
      trudnosc: 1,
      czas_trwania_godziny: 0.1,
      termin: '2026-03-10',
      czas_zakonczenia: '2026-03-11',
    }) === 1
  );

  // --- dziennik ---
  sprawdz('pusty wpis nie daje XP', nagrody.xpWpisu({ data: '2026-01-01' }) === 0);
  sprawdz('wpis z jednym polem refleksyjnym: 5 + 10 = 15', nagrody.xpWpisu({ wdziecznosc: 'x' }) === 15);
  sprawdz(
    'wpis z kompletem szesciu pol: 5 + 60 = 65',
    nagrody.xpWpisu(Object.fromEntries(nagrody.POLA_REFLEKSYJNE.map((k) => [k, 'x']))) === 65
  );
  sprawdz(
    'wpis bez refleksji, ale z trescia (samo sniadanie): 5 XP',
    nagrody.xpWpisu({ sniadanie: 'kawa' }) === 5
  );
  sprawdz('trzy nawyki: 3 x 3 = 9 XP', nagrody.xpNawykow({ nawyki: 'A, B, C' }) === 9);
  sprawdz(
    'licznik pol refleksyjnych 4/6',
    nagrody.liczbaWypelnionychPol({ wdziecznosc: 'a', bledy: 'b', rozmowa: 'c', jutro_wazne: 'd' }) === 4
  );
  sprawdz(
    'pusty tekst nie liczy sie jako wypelnione pole',
    nagrody.liczbaWypelnionychPol({ wdziecznosc: '   ' }) === 0
  );

  // --- poziomy i prestiz ---
  const p = nagrody.poziomZXp;
  sprawdz('0 XP -> poziom 1, prestiz 0, do nastepnego 500', p(0).poziom === 1 && p(0).prestiz === 0 && p(0).xpDoNastepnego === 500);
  sprawdz('499 XP -> nadal poziom 1, brakuje 1 XP', p(499).poziom === 1 && p(499).xpDoNastepnego === 1);
  sprawdz('DOKLADNIE 500 XP -> poziom 2', p(500).poziom === 2 && p(500).prestiz === 0);
  sprawdz('49999 XP -> poziom 100, prestiz 0', p(49999).poziom === 100 && p(49999).prestiz === 0);
  sprawdz(
    'DOKLADNIE 50000 XP -> reset: prestiz 1, poziom 1',
    p(50000).prestiz === 1 && p(50000).poziom === 1
  );
  sprawdz('50500 XP -> prestiz 1, poziom 2', p(50500).prestiz === 1 && p(50500).poziom === 2);

  // --- waluta ---
  sprawdz('waluta to polowa XP zaokraglona w dol', nagrody.walutaZarobiona(101) === 50);

  const stan = nagrody.policzPostac(
    [{ stan: 'Zrobione', trudnosc: 3, czas_trwania_godziny: 4 }],
    [{ wdziecznosc: 'x', nawyki: 'A, B' }],
    3
  );
  sprawdz(
    'rozbicie zrodel: zadania 12, dziennik 15, nawyki 6',
    stan.rozbicie.zadania === 12 && stan.rozbicie.dziennik === 15 && stan.rozbicie.nawyki === 6,
    JSON.stringify(stan.rozbicie)
  );
  sprawdz(
    'suma 33 XP, waluta 16 - 3 wydane = 13',
    stan.calkowite_xp === 33 && stan.waluta_dostepna === 13,
    JSON.stringify({ xp: stan.calkowite_xp, waluta: stan.waluta_dostepna })
  );

  /*
    Lista pol refleksyjnych istnieje w DWOCH miejscach: lib/nagrody.js (serwer)
    i public/js/reguly-statystyk.js (przegladarka, licznik "4/6" i tabela miesieczna).
    Granica serwer-przegladarka wymusza kopie, wiec pilnujemy jej testem.
  */
  const reguly = zaladujReguly();
  sprawdzListe(
    'lista pol refleksyjnych identyczna po stronie serwera i przegladarki',
    nagrody.POLA_REFLEKSYJNE,
    reguly.regulyStatystyk.POLA_REFLEKSYJNE
  );
}

async function testujPostac() {
  sekcja('POSTAĆ I ZAKUPY (przez HTTP)');

  const { status, tresc: postac } = await zapytaj('GET', '/api/postac');
  sprawdz('GET /api/postac odpowiada 200', status === 200);
  sprawdz(
    'odpowiedz zawiera komplet pol',
    ['calkowite_xp', 'poziom', 'prestiz', 'xp_do_nastepnego_poziomu', 'waluta_dostepna', 'rozbicie']
      .every((k) => postac[k] !== undefined),
    JSON.stringify(Object.keys(postac))
  );
  sprawdz(
    'rozbicie sumuje sie do calkowitego XP',
    postac.rozbicie.zadania + postac.rozbicie.nawyki + postac.rozbicie.dziennik ===
      postac.calkowite_xp,
    JSON.stringify(postac.rozbicie) + ' vs ' + postac.calkowite_xp
  );

  // --- zakupy ---
  sprawdz('lista zakupow startuje pusta', (await zapytaj('GET', '/api/zakupy')).tresc.length === 0);

  const dostepna = postac.waluta_dostepna;
  sprawdz(
    'zakup ponad stan konta jest ODRZUCONY',
    (await zapytaj('POST', '/api/zakupy', { nazwa: 'za drogie', koszt: dostepna + 1 })).status === 400
  );
  sprawdz(
    'koszt zerowy i ujemny odrzucone',
    (await zapytaj('POST', '/api/zakupy', { nazwa: 'darmowe', koszt: 0 })).status === 400 &&
      (await zapytaj('POST', '/api/zakupy', { nazwa: 'ujemne', koszt: -5 })).status === 400
  );
  sprawdz(
    'pusta nazwa odrzucona',
    (await zapytaj('POST', '/api/zakupy', { nazwa: '  ', koszt: 1 })).status === 400
  );

  const { status: statusZakupu, tresc: zakup } = await zapytaj('POST', '/api/zakupy', {
    nazwa: 'nagroda testowa',
    koszt: 2,
  });
  sprawdz('zakup w ramach salda przechodzi', statusZakupu === 201 && zakup.koszt === 2);

  const { tresc: poZakupie } = await zapytaj('GET', '/api/postac');
  sprawdz(
    'waluta dostepna spadla o koszt zakupu',
    poZakupie.waluta_dostepna === dostepna - 2,
    `${poZakupie.waluta_dostepna} vs ${dostepna - 2}`
  );
  sprawdz(
    'XP NIE zmienia sie przy wydawaniu waluty',
    poZakupie.calkowite_xp === postac.calkowite_xp
  );

  sprawdz(
    'DELETE cofa zakup',
    (await zapytaj('DELETE', `/api/zakupy/${zakup.id}`)).status === 204
  );
  const { tresc: poCofnieciu } = await zapytaj('GET', '/api/postac');
  sprawdz(
    'waluta wraca po cofnieciu zakupu',
    poCofnieciu.waluta_dostepna === dostepna,
    `${poCofnieciu.waluta_dostepna} vs ${dostepna}`
  );

  /*
    Retroaktywnosc: XP liczy sie NA ZYWO, wiec zmiana starego zadania
    natychmiast zmienia wynik - bez zadnego przeliczania czy "aktywowania".
  */
  const { tresc: zadania } = await zapytaj('GET', '/api/zadania');
  const doZmiany = zadania.find((z) => z.nazwa === 'A termin dzis');
  await zapytaj('PATCH', `/api/zadania/${doZmiany.id}`, {
    stan: 'Zrobione',
    trudnosc: 3,
    czas_trwania_godziny: 10,
  });

  const { tresc: poEdycji } = await zapytaj('GET', '/api/postac');
  sprawdz(
    'edycja starego zadania od razu podnosi XP (liczenie na zywo)',
    poEdycji.calkowite_xp > postac.calkowite_xp,
    `${poEdycji.calkowite_xp} vs ${postac.calkowite_xp}`
  );

  // Przywracamy zestaw testowy do stanu wyjsciowego.
  await zapytaj('PATCH', `/api/zadania/${doZmiany.id}`, {
    stan: 'Plan',
    trudnosc: '',
    czas_trwania_godziny: '',
  });
}

async function testujNawyki() {
  sekcja('SŁOWNIK NAWYKÓW');

  const { status, tresc: slownik } = await zapytaj('GET', '/api/nawyki');
  sprawdz('GET /api/nawyki odpowiada 200', status === 200);
  sprawdz(
    'migracja zasiala 15 nazw',
    slownik.length === 15,
    `otrzymano ${slownik.length}`
  );
  sprawdz(
    '"Untitled" NIE zostal zasiany (artefakt eksportu)',
    !slownik.some((n) => n.nazwa === 'Untitled')
  );

  // --- duplikaty ---
  sprawdz(
    'POST odrzuca duplikat identyczny',
    (await zapytaj('POST', '/api/nawyki', { nazwa: 'Vitamins' })).status === 409
  );
  sprawdz(
    'POST odrzuca duplikat rozniacy sie wielkoscia liter',
    (await zapytaj('POST', '/api/nawyki', { nazwa: 'vitamins' })).status === 409
  );
  sprawdz(
    'POST odrzuca pusta nazwe',
    (await zapytaj('POST', '/api/nawyki', { nazwa: '   ' })).status === 400
  );
  sprawdz(
    'POST odrzuca nazwe z przecinkiem (rozdziela nazwy w dzienniku)',
    (await zapytaj('POST', '/api/nawyki', { nazwa: 'A, B' })).status === 400
  );

  /*
    KASKADOWA ZMIANA NAZWY - dopasowanie CALEGO tokenu, nie podciagu.

    Pulapki w zestawie ponizej:
      - "Water" jest fragmentem "Drink Water",
      - "Drink Water" jest prefiksem "Drink Water Extra",
      - nazwa z nawiasami i spacjami musi przezyc bez zmian.
    Podmiana przez REPLACE() na podciagach uszkodzilaby wszystkie trzy.
  */
  const { tresc: nowy } = await zapytaj('POST', '/api/nawyki', { nazwa: 'Water' });

  const wpisyTestowe = [
    'Drink Water, Vitamins',
    'Water',
    'Drink Water Extra, Drawing',
    'Duolingo (road to 3 years), Water',
  ];
  const idWpisow = [];
  for (const nawyki of wpisyTestowe) {
    const { tresc } = await zapytaj('POST', '/api/dziennik');
    await zapytaj('PATCH', `/api/dziennik/${tresc.id}`, { nawyki });
    idWpisow.push(tresc.id);
  }

  const { tresc: wynik } = await zapytaj('PATCH', `/api/nawyki/${nowy.id}`, { nazwa: 'H2O' });

  const { tresc: poZmianie } = await zapytaj('GET', '/api/dziennik');
  const nawykiWpisu = (id) => poZmianie.find((w) => w.id === id).nawyki;

  sprawdz(
    'kaskada zmienila tylko wpisy z DOKLADNYM tokenem (2 z 4)',
    wynik.zaktualizowanychWpisow === 2,
    `zaktualizowano ${wynik.zaktualizowanychWpisow}`
  );
  sprawdz(
    '"Drink Water" nietkniete przy zmianie "Water" (fragment innej nazwy)',
    nawykiWpisu(idWpisow[0]) === 'Drink Water, Vitamins',
    nawykiWpisu(idWpisow[0])
  );
  sprawdz(
    'samodzielne "Water" zmienione na "H2O"',
    nawykiWpisu(idWpisow[1]) === 'H2O',
    nawykiWpisu(idWpisow[1])
  );
  sprawdz(
    '"Drink Water Extra" nietkniete (prefiks)',
    nawykiWpisu(idWpisow[2]) === 'Drink Water Extra, Drawing',
    nawykiWpisu(idWpisow[2])
  );
  sprawdz(
    'nazwa z nawiasami zachowana, token obok podmieniony',
    nawykiWpisu(idWpisow[3]) === 'Duolingo (road to 3 years), H2O',
    nawykiWpisu(idWpisow[3])
  );

  sprawdz(
    'PATCH odrzuca zmiane na nazwe juz istniejaca',
    (await zapytaj('PATCH', `/api/nawyki/${nowy.id}`, { nazwa: 'Drawing' })).status === 409
  );

  /*
    DELETE usuwa TYLKO ze slownika. Wpisy dziennika zachowuja nazwe historyczna -
    historia ma pozostac wierna temu, co bylo wtedy prawda.
  */
  const przedUsunieciem = nawykiWpisu(idWpisow[1]);
  sprawdz(
    'DELETE /api/nawyki/:id odpowiada 204',
    (await zapytaj('DELETE', `/api/nawyki/${nowy.id}`)).status === 204
  );

  const { tresc: poUsunieciu } = await zapytaj('GET', '/api/nawyki');
  sprawdz('nazwa znika ze slownika', !poUsunieciu.some((n) => n.nazwa === 'H2O'));

  const { tresc: wpisyPoUsunieciu } = await zapytaj('GET', '/api/dziennik');
  sprawdz(
    'DELETE NIE rusza wpisow dziennika - nazwa historyczna zostaje',
    wpisyPoUsunieciu.find((w) => w.id === idWpisow[1]).nawyki === przedUsunieciem,
    wpisyPoUsunieciu.find((w) => w.id === idWpisow[1]).nawyki
  );

  // --- opisy ocen ---
  const { tresc: slowniki } = await zapytaj('GET', '/api/slowniki');
  sprawdz(
    '/api/slowniki wystawia opisy wszystkich czterech ocen',
    ['jakosc_snu', 'stres', 'nastroj', 'intencjonalnosc'].every(
      (p) => Array.isArray(slowniki.oceny[p]) && slowniki.oceny[p].length > 0
    )
  );
  sprawdz(
    'skala stresu ma 6 stopni i zaczyna sie od 5 (odwrocona)',
    slowniki.oceny.stres.length === 6 && slowniki.oceny.stres[0].wartosc === 5,
    JSON.stringify(slowniki.oceny.stres.map((o) => o.wartosc))
  );
  sprawdz(
    'lista nawykow NIE jest juz w /api/slowniki (mieszka w bazie)',
    slowniki.nawyki === undefined
  );
}

async function testujProjekty() {
  sekcja('PROJEKTY');

  const { status, tresc: puste } = await zapytaj('GET', '/api/projekty');
  sprawdz('GET /api/projekty odpowiada 200', status === 200);
  sprawdz('lista startuje pusta', puste.length === 0);

  const { tresc: projekt } = await zapytaj('POST', '/api/projekty');
  await zapytaj('PATCH', `/api/projekty/${projekt.id}`, {
    nazwa: 'Projekt testowy',
    status: 'W trakcie',
    opis: 'opis',
  });

  sprawdz(
    'PATCH odrzuca status spoza slownika',
    (await zapytaj('PATCH', `/api/projekty/${projekt.id}`, { status: 'Nieznany' })).status === 400
  );

  // Podpinamy dwa zadania, jedno konczymy - licznik ma pokazac 1/2.
  const { tresc: zadania } = await zapytaj('GET', '/api/zadania');
  const [a, b] = zadania;
  await zapytaj('PATCH', `/api/zadania/${a.id}`, { projekt_id: projekt.id, stan: 'Zrobione' });
  await zapytaj('PATCH', `/api/zadania/${b.id}`, { projekt_id: projekt.id, stan: 'Plan' });

  const { tresc: zLicznikiem } = await zapytaj('GET', '/api/projekty');
  const p = zLicznikiem.find((x) => x.id === projekt.id);
  sprawdz(
    'GET zwraca licznik zadan: 1 ukonczone z 2',
    p.zadan_lacznie === 2 && p.zadan_ukonczonych === 1,
    JSON.stringify({ lacznie: p.zadan_lacznie, ukonczonych: p.zadan_ukonczonych })
  );

  sprawdz(
    'PATCH zadania odrzuca nieistniejacy projekt',
    (await zapytaj('PATCH', `/api/zadania/${a.id}`, { projekt_id: 999999 })).status === 400
  );

  /*
    KLUCZOWE: usuniecie projektu ma ODPIAC zadania, a nie je skasowac.
    Realizuje to ON DELETE SET NULL z migracji 6.
  */
  const przedUsunieciem = (await zapytaj('GET', '/api/zadania')).tresc.length;
  sprawdz(
    'DELETE /api/projekty/:id odpowiada 204',
    (await zapytaj('DELETE', `/api/projekty/${projekt.id}`)).status === 204
  );

  const { tresc: poUsunieciu } = await zapytaj('GET', '/api/zadania');
  sprawdz(
    'usuniecie projektu NIE kasuje zadan',
    poUsunieciu.length === przedUsunieciem,
    `${poUsunieciu.length} vs ${przedUsunieciem}`
  );
  sprawdz(
    'usuniecie projektu ODPINA zadania (projekt_id = null)',
    poUsunieciu.filter((z) => z.projekt_id !== null).length === 0,
    JSON.stringify(poUsunieciu.map((z) => z.projekt_id))
  );

  // Przywracamy zestaw testowy.
  for (const z of [a, b]) {
    await zapytaj('PATCH', `/api/zadania/${z.id}`, { stan: z.stan });
  }
}

async function testujQuestLog() {
  sekcja('IMPORT quest-log (dwuprzebiegowy)');

  const questLog = require('../config/mapowanie-quest-log');

  // --- mapowania wartosci, w izolacji ---
  sprawdzListe(
    'statusy Notion -> nasze stany',
    ['Backlog', 'Ready to Start', 'In Progress', 'Complete', 'Blocked', ''].map(
      questLog.parsujStatus
    ),
    ['Plan', 'Czeka', 'W trakcie', 'Zrobione', 'Blok', 'Plan']
  );
  sprawdzListe(
    'Impact -> priorytet (piec poziomow + puste)',
    ['x10 High 🔺', 'x5 Semi-High', 'x2 Impact', 'x0.5 Semi-Low', 'x0.2 Low 🔻', ''].map(
      questLog.parsujImpact
    ),
    [4, 3, 2, 1, 0, 2]
  );
  sprawdzListe(
    'Difficulty Score -> trudnosc',
    ['1 - Easy', '2 - Moderate', '3 - Hard', ''].map(questLog.parsujTrudnosc),
    [1, 2, 3, null]
  );
  sprawdz('"4.0" -> 4 godziny', questLog.parsujGodziny('4.0') === 4);
  sprawdz('wartosc nieliczbowa -> brak godzin', questLog.parsujGodziny('brak') === null);

  sprawdz(
    'Upstream z URL-em -> sama nazwa',
    questLog.parsujUpstream('Nauka hiszpanskiego (https://notion.so/abc)') === 'Nauka hiszpanskiego'
  );
  sprawdz(
    'Upstream bez URL-a tez dziala',
    questLog.parsujUpstream('Nauka hiszpanskiego') === 'Nauka hiszpanskiego'
  );
  sprawdz(
    'przy wielu relacjach bierzemy pierwsza',
    questLog.parsujUpstream('Projekt A (https://x/1), Projekt B (https://x/2)') === 'Projekt A'
  );

  // --- dwuprzebiegowy import przez HTTP ---
  const csv = [
    'Name,Type,Status,Area,Difficulty Score,Impact,Time (Tasks Only),Do Date,Closing Date,Due Date (Optional),Upstream',
    'Remont kuchni,Project,In Progress,,,,,,,,',
    'Nauka hiszpanskiego,Project,Backlog,,,,,,,,',
    'Kupic plytki,Task,Complete,Home,2 - Moderate,x5 Semi-High,4.0,2026-03-10,2026-03-05,,Remont kuchni (https://notion.so/1)',
    'Lekcja 1,Task,In Progress,Knowledge,1 - Easy,x0.2 Low 🔻,1.5,2026-04-01,,,Nauka hiszpanskiego',
    'Zadanie sierotka,Task,Backlog,Career,3 - Hard,x10 High 🔺,2,2026-05-01,,,Projekt ktorego nie ma',
    'Zadanie luzne,Task,Backlog,,,,,,,,',
    'Z nadpisanym terminem,Task,Complete,Health,1 - Easy,x2 Impact,1,2026-06-01,2026-06-02,2026-06-15,',
    ',Task,Backlog,,,,,,,,',
  ].join('\r\n');

  const { status, tresc } = await zapytaj('POST', '/api/import/notion-quest-log/podglad', {
    tresc: csv,
  });
  sprawdz('podglad quest-log odpowiada 200', status === 200);
  sprawdz(
    'podglad rozdziela projekty i zadania',
    tresc.questLog.projektow === 2 && tresc.questLog.zadan === 5,
    JSON.stringify(tresc.questLog)
  );
  sprawdz(
    'wiersz bez "Name" odrzucony (1 sztuka)',
    tresc.odrzuconych === 1,
    JSON.stringify(tresc.odrzucone)
  );
  sprawdz(
    'podglad liczy zadania z podpietym projektem i bez dopasowania',
    tresc.questLog.zPodpietymProjektem === 2 && tresc.questLog.bezDopasowania === 1,
    JSON.stringify(tresc.questLog)
  );
  sprawdzListe(
    'brak dopasowania jest INFORMACJA - podaje nazwe nieznanego projektu',
    tresc.questLog.nieznaneProjekty,
    ['Projekt ktorego nie ma']
  );

  // --- zapis ---
  const przedProjektow = (await zapytaj('GET', '/api/projekty')).tresc.length;
  const przedZadan = (await zapytaj('GET', '/api/zadania')).tresc.length;

  const zapis = await zapytaj('POST', '/api/import/notion-quest-log/zatwierdz', { tresc: csv });
  sprawdz('zatwierdzenie odpowiada 201', zapis.status === 201);
  sprawdz('zaimportowano 2 projekty + 5 zadan', zapis.tresc.zaimportowano === 7);

  const { tresc: projekty } = await zapytaj('GET', '/api/projekty');
  const { tresc: zadania } = await zapytaj('GET', '/api/zadania');
  sprawdz('projekty dopisane', projekty.length === przedProjektow + 2);
  sprawdz('zadania dopisane', zadania.length === przedZadan + 5);

  const remont = projekty.find((p) => p.nazwa === 'Remont kuchni');
  sprawdz('status projektu zmapowany: In Progress -> W trakcie', remont.status === 'W trakcie');

  const plytki = zadania.find((z) => z.nazwa === 'Kupic plytki');
  sprawdz(
    'zadanie podpiete do projektu po nazwie z Upstream',
    plytki.projekt_id === remont.id,
    `${plytki.projekt_id} vs ${remont.id}`
  );
  sprawdz('Area -> obszar 1:1', plytki.obszar === 'Home');
  sprawdz('Impact x5 Semi-High -> priorytet 3', plytki.priorytet === 3);
  sprawdz('Difficulty 2 - Moderate -> trudnosc 2', plytki.trudnosc === 2);
  sprawdz('Time 4.0 -> 4 godziny', plytki.czas_trwania_godziny === 4);
  sprawdz(
    'Do Date -> termin (a NIE start_zadania)',
    plytki.termin === '2026-03-10T00:00' && plytki.start_zadania === null,
    JSON.stringify({ termin: plytki.termin, start: plytki.start_zadania })
  );
  sprawdz('Closing Date -> czas_zakonczenia', plytki.czas_zakonczenia === '2026-03-05T00:00');

  const nadpisany = zadania.find((z) => z.nazwa === 'Z nadpisanym terminem');
  sprawdz(
    'Due Date (Optional) NADPISUJE termin z Do Date',
    nadpisany.termin === '2026-06-15T00:00',
    nadpisany.termin
  );

  const sierotka = zadania.find((z) => z.nazwa === 'Zadanie sierotka');
  sprawdz(
    'brak dopasowania Upstream -> zadanie wchodzi BEZ projektu, nie jest odrzucane',
    sierotka !== undefined && sierotka.projekt_id === null
  );

  const luzne = zadania.find((z) => z.nazwa === 'Zadanie luzne');
  sprawdz('puste Area -> obszar zapasowy "Inne"', luzne.obszar === 'Inne');
  sprawdz('pusty Impact -> priorytet 2', luzne.priorytet === 2);
  sprawdz('pusty Status -> stan "Plan"', luzne.stan === 'Plan');

  // Sprzatanie: usuwamy zaimportowane projekty i zadania.
  for (const p of projekty) await zapytaj('DELETE', `/api/projekty/${p.id}`);
  for (const z of zadania.slice(przedZadan)) await zapytaj('DELETE', `/api/zadania/${z.id}`);
}

async function testujImport() {
  sekcja('IMPORT (regresja odrzucen)');

  const csvZadan = [
    'Nazwa zadania,Stan,Klient / Kategoria,Start zadania,Termin,Czas zakończenia',
    'Poprawne zadanie,Plan,Alfaram,"August 3, 2026",2026-08-20,',
    ',Plan,Nuva,,,',
    'Zly stan,zrobione,Nuva,,,',
    'Zla data,Plan,Nuva,"Augus 8, 2026",,',
  ].join('\r\n');

  const { status, tresc } = await zapytaj('POST', '/api/import/zadania/podglad', { tresc: csvZadan });
  sprawdz('podglad importu zadan odpowiada 200', status === 200);
  sprawdz('zadania: 1 wiersz gotowy, 3 odrzucone', tresc.gotowych === 1 && tresc.odrzuconych === 3);
  sprawdzListe(
    'zadania: numery odrzuconych linii',
    tresc.odrzucone.map((o) => o.linia),
    [3, 4, 5]
  );
  sprawdz(
    'zadania: powod "pusta nazwa"',
    tresc.odrzucone[0].powod.includes('Pusta nazwa'),
    tresc.odrzucone[0].powod
  );
  sprawdz(
    'zadania: powod "nieznany stan" (wielkosc liter ma znaczenie)',
    tresc.odrzucone[1].powod.includes('Nieznany stan "zrobione"'),
    tresc.odrzucone[1].powod
  );
  sprawdz(
    'zadania: powod "nierozpoznany format daty"',
    tresc.odrzucone[2].powod.includes('nierozpoznany format daty'),
    tresc.odrzucone[2].powod
  );

  const csvDziennika = [
    'Name,🙌 Reported Wake Up Time,💤 # of hours sleep,⭐ Sleep Quality,⭐ Habits,🙏 Grateful For',
    '"@March 2, 2024",02/03/2024 7:30 (GMT+1),8,4 - A,"Drink Water (https://x.pl/a), Duolingo (road to 3 years) (https://x.pl/b)",Spokój',
    '"@August 22, 2025 @",,,,,',
    '"@",,,,,',
    '"@March 4, 2024",,,,,null',
  ].join('\r\n');

  const wynik = await zapytaj('POST', '/api/import/dziennik/podglad', { tresc: csvDziennika });
  sprawdz('podglad importu dziennika odpowiada 200', wynik.status === 200);
  sprawdz(
    'dziennik: 2 wiersze gotowe, 2 odrzucone (uszkodzone "Name")',
    wynik.tresc.gotowych === 2 && wynik.tresc.odrzuconych === 2,
    JSON.stringify({ g: wynik.tresc.gotowych, o: wynik.tresc.odrzuconych })
  );
  sprawdz(
    'dziennik: powod odrzucenia wskazuje kolumne "Name"',
    wynik.tresc.odrzucone.every((o) => o.powod.includes('Name')),
    JSON.stringify(wynik.tresc.odrzucone.map((o) => o.powod))
  );

  const pierwszy = wynik.tresc.gotowe[0].dane;
  sprawdz('dziennik: "@March 2, 2024" -> 2024-03-02', pierwszy.data === '2024-03-02', pierwszy.data);
  sprawdz(
    'dziennik: godzina jednocyfrowa "7:30" -> "07:30"',
    pierwszy.pobudka === '07:30',
    pierwszy.pobudka
  );
  sprawdz('dziennik: "4 - A" -> 4', pierwszy.jakosc_snu === 4, String(pierwszy.jakosc_snu));
  sprawdz(
    'dziennik: nawyki bez URL-i, z zachowaniem nawiasow w nazwie',
    pierwszy.nawyki === 'Drink Water, Duolingo (road to 3 years)',
    pierwszy.nawyki
  );
  sprawdz(
    'dziennik: literalne "null" traktowane jak brak wartosci',
    wynik.tresc.gotowe[1].dane.wdziecznosc === null,
    JSON.stringify(wynik.tresc.gotowe[1].dane.wdziecznosc)
  );
}

async function testujLimityCiala() {
  sekcja('ENDPOINTY (kolejnosc middleware)');

  // 300 kB - trzykrotnie ponad domyslny limit 100kb Expressa.
  const duzyTekst = 'x'.repeat(300 * 1024);

  const { tresc: zadania } = await zapytaj('GET', '/api/zadania');
  const { tresc: wpisy } = await zapytaj('GET', '/api/dziennik');

  const zadanie = await zapytaj('PATCH', `/api/zadania/${zadania[0].id}`, { nazwa: duzyTekst });
  sprawdz(
    'PATCH /api/zadania/:id z cialem 300 kB -> 413 (globalny parser, ciasny limit)',
    zadanie.status === 413,
    `otrzymano ${zadanie.status}`
  );

  const wpis = await zapytaj('PATCH', `/api/dziennik/${wpisy[0].id}`, { wdziecznosc: duzyTekst });
  sprawdz(
    'PATCH /api/dziennik/:id z tym samym cialem -> 200 (wlasny parser, przed globalnym)',
    wpis.status === 200,
    `otrzymano ${wpis.status}`
  );

  // Bez tego testu kontrolnego powyzsze nic by nie znaczylo: gdyby globalny limit
  // byl rozluznony, oba zadania przeszlyby i nie wykrylibysmy zlej kolejnosci.
  const duzyCsv =
    'Nazwa zadania,Stan\r\n' +
    Array.from({ length: 3000 }, (_, i) => `Zadanie ${i} z opisem wydluzajacym plik,Plan`).join(
      '\r\n'
    );
  const imp = await zapytaj('POST', '/api/import/zadania/podglad', { tresc: duzyCsv });
  sprawdz(
    'POST /api/import/... z plikiem ~130 kB -> 200 (limit 20 MB)',
    imp.status === 200,
    `otrzymano ${imp.status}`
  );
}

// --- przebieg -------------------------------------------------------------

async function main() {
  console.log('Smoke test - baza testowa:', BAZA);

  let serwer = null;
  try {
    serwer = uruchomSerwer();
    await poczekajNaSerwer();

    const { tresc: slowniki } = await zapytaj('GET', '/api/slowniki');
    const reguly = zaladujReguly();

    // Zasilanie znanym zestawem przez API - te same sciezki, ktorych uzywa aplikacja.
    for (const z of ZADANIA) {
      const { tresc } = await zapytaj('POST', '/api/zadania');
      await zapytaj('PATCH', `/api/zadania/${tresc.id}`, z);
    }
    for (const w of WPISY) {
      const { tresc } = await zapytaj('POST', '/api/dziennik');
      await zapytaj('PATCH', `/api/dziennik/${tresc.id}`, w);
    }

    await testujZadania(reguly, slowniki);
    await testujDziennik(reguly);
    await testujStatystyki(reguly);
    await testujSilnikXp();
    await testujPostac();
    await testujProjekty();
    await testujQuestLog();
    await testujNawyki();
    await testujImport();
    await testujLimityCiala();
  } catch (e) {
    oblane++;
    console.error('\nBLAD KRYTYCZNY:', e.message);
    console.error(e.stack);
  } finally {
    await posprzataj(serwer);
  }

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`Zaliczone: ${zaliczone}   Oblane: ${oblane}`);
  console.log(oblane === 0 ? 'WYNIK: PASS' : 'WYNIK: FAIL');
  process.exit(oblane === 0 ? 0 : 1);
}

main();
