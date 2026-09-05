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

/** To samo, ale jako SAMA data 'YYYY-MM-DD' - w tej postaci dzialaja pola zakresu. */
function dzienISO(n) {
  return dzien(n).slice(0, 10);
}

/** To samo, ale z podana godzina - do przypadkow granicznych wokol polnocy. */
function dzienOGodzinie(n, godzina) {
  const data = new Date((numerDnia(DZIS) + n) * MS_W_DNIU).toISOString().slice(0, 10);
  return `${data}T${godzina}`;
}

// --- reguly z przegladarki ------------------------------------------------

/** Laduje pliki public/js w jednym sandboksie, tak jak robi to przegladarka. */
function zaladujReguly() {
  /*
    motyw.js dotyka DOM i localStorage juz przy starcie (ustawia motyw przed
    pierwszym malowaniem), wiec sandbox dostaje minimalne atrapy. Testujemy
    z niego wylacznie czysta funkcje rozstrzygnij().
  */
  const sandbox = {
    console,
    document: {
      documentElement: { dataset: {} },
      addEventListener() {},
      getElementById: () => null,
    },
    window: { matchMedia: null },
    localStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    },
  };
  vm.createContext(sandbox);

  for (const plik of [
    'motyw.js',
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
    '({ motyw, filtrDat, regulyZadan, regulyDziennika, regulyStatystyk })',
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
  /*
    Termin czyscimy JAWNIE. Nowy rekord dostaje od serwera termin na dzisiaj,
    wiec "bez zadnych dat" trzeba teraz wymusic - samo pominiecie pola zostawiloby
    wartosc domyslna i zadanie wchodziloby w presety zakresu dat.
  */
  { nazwa: 'F bez zadnych dat', stan: 'Plan', priorytet: 0, start_zadania: '', termin: '' },
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

  /*
    KIERUNEK PRESETOW.

    Zadania opisuja przyszlosc (termin), wiec licza W PRZOD. Dziennik opisuje
    przeszlosc - wpisu z jutra po prostu nie ma - wiec ma warianty liczace WSTECZ.
    Wczesniej dziennik uzywal presetow zadaniowych i pokazywal najwyzej dzisiejszy
    wpis, czyli filtr byl bezuzyteczny.

    Obie postacie obejmuja DZISIAJ i licza tyle samo pelnych dni kalendarzowych.
  */
  const zakres = (preset) => reguly.filtrDat.zakresPresetu(DZIS, preset.dni, Boolean(preset.wstecz));

  sprawdzListe(
    'preset zadaniowy "7 dni" liczy W PRZOD: dzis .. dzis+6',
    [DZIS, dzienISO(6)],
    [zakres(P.TYDZIEN).od, zakres(P.TYDZIEN).do]
  );
  sprawdzListe(
    'preset dziennika "7 dni" liczy WSTECZ: dzis-6 .. dzis',
    [dzienISO(-6), DZIS],
    [zakres(P.OSTATNIE_7_DNI).od, zakres(P.OSTATNIE_7_DNI).do]
  );
  sprawdzListe(
    'preset dziennika "30 dni" liczy WSTECZ: dzis-29 .. dzis',
    [dzienISO(-29), DZIS],
    [zakres(P.OSTATNIE_30_DNI).od, zakres(P.OSTATNIE_30_DNI).do]
  );

  // "Dziś" jest kierunkowo neutralny - jeden dzien to ten sam zakres w obie strony.
  sprawdzListe(
    'preset "Dziś" daje ten sam zakres niezaleznie od kierunku',
    [DZIS, DZIS],
    [
      reguly.filtrDat.zakresPresetu(DZIS, 1, false).od,
      reguly.filtrDat.zakresPresetu(DZIS, 1, true).od,
    ]
  );

  /*
    Kontrola regresji: zadania NIE MOGA zaczac liczyc wstecz. Gdyby ktos przestawil
    kierunek globalnie zamiast dodac warianty, ta asercja peknie.
  */
  sprawdz(
    'presety zadaniowe nadal nie maja kierunku wstecznego',
    [P.DZIS, P.DZIS_JUTRO, P.TYDZIEN, P.MIESIAC].every((x) => !x.wstecz)
  );
  sprawdz(
    '"Wszystkie" czysci oba pola niezaleznie od kierunku',
    reguly.filtrDat.zakresPresetu(DZIS, null, true).od === '' &&
      reguly.filtrDat.zakresPresetu(DZIS, null, true).do === ''
  );
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
  /*
    XP zadania = godziny x przelicznik trudnosci (1 -> 0.5, 2 -> 1, 3 -> 2).
    Trudnosc nie mnozy sie wprost, tylko wazy godziny - stad 4h przy trudnosci 3
    to 8 XP, a nie 12.
  */
  sprawdz(
    'trudnosc 3 (x2) x 4h = 8 XP (bez dat, mnoznik terminowosci 1)',
    zrobione({ trudnosc: 3, czas_trwania_godziny: 4 }) === 8
  );
  sprawdzListe(
    'przeliczniki trudnosci: 1h przy kazdej z trzech trudnosci',
    [1, 2, 3].map((t) => zrobione({ trudnosc: t, czas_trwania_godziny: 2 })),
    [1, 2, 4]
  );
  sprawdz(
    'trudnosc spoza slownika: 0 XP i flaga brakujaceDane',
    nagrody.xpZadania({ stan: 'Zrobione', trudnosc: 7, czas_trwania_godziny: 4 })
      .brakujaceDane === true
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

  // Premia nalezy sie od JEDNEGO dnia zapasu (dawniej od trzech). Baza: 8 XP.
  sprawdz('mnoznik x1.5: zapas 5 dni -> 12 XP', zDatami('2026-03-10', '2026-03-05') === 12);
  sprawdz(
    'mnoznik x1.5: granica DOKLADNIE 1 dzien zapasu -> 12 XP',
    zDatami('2026-03-10', '2026-03-09') === 12
  );
  sprawdz('mnoznik x1: ten sam dzien -> 8 XP', zDatami('2026-03-10', '2026-03-10') === 8);
  sprawdz(
    'mnoznik x1: godzina nie psuje - 23:00 w dniu terminu to nadal na czas',
    zDatami('2026-03-10T09:00', '2026-03-10T23:00') === 8
  );
  /*
    REGRESJA: "doba przed terminem" liczy sie w pelnych dniach kalendarzowych.
    Zakonczenie o 01:00 dzien przed terminem dzieli od niego mniej niz 24 godziny
    zegarowe, a mimo to ma dostac premie - inaczej wynik zalezalby od pory dnia.
  */
  sprawdz(
    'mnoznik x1.5 liczy DNI, nie godziny: 23:00 -> 01:00 nastepnego dnia to premia',
    zDatami('2026-03-10T01:00', '2026-03-09T23:00') === 12
  );
  sprawdz('mnoznik x0.5: dzien po terminie -> 4 XP', zDatami('2026-03-10', '2026-03-11') === 4);
  sprawdz(
    'mnoznik x1 gdy brakuje ktorejs z dat',
    zDatami('2026-03-10', null) === 8 && zDatami(null, '2026-03-11') === 8
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

  // --- dziennik: 1 XP za wpis + 1 XP za kazde wypelnione pole tresci ---
  sprawdz('pusty wpis daje 1 XP za samo zalozenie', nagrody.xpWpisu({ data: '2026-01-01' }) === 1);
  sprawdz('wpis z jednym polem: 1 + 1 = 2 XP', nagrody.xpWpisu({ wdziecznosc: 'x' }) === 2);
  sprawdz(
    'wpis z kompletem szesciu pol refleksyjnych: 1 + 6 = 7 XP',
    nagrody.xpWpisu(Object.fromEntries(nagrody.POLA_REFLEKSYJNE.map((k) => [k, 'x']))) === 7
  );
  sprawdz(
    'kazde pole wazy tyle samo - samo sniadanie tez 2 XP',
    nagrody.xpWpisu({ sniadanie: 'kawa' }) === 2
  );
  /*
    REGRESJA: nawyki sa JEDNYM polem. Wczesniej liczyly sie po sztuce (3 XP kazdy)
    i same odpowiadaly za ponad cwierc XP w bazie - dziesiec odhaczonych nawykow
    wazylo wiecej niz caly komplet refleksji.
  */
  sprawdz(
    'nawyki to jedno pole: trzy odhaczone waza tyle co jeden',
    nagrody.xpWpisu({ nawyki: 'A, B, C' }) === 2 && nagrody.xpWpisu({ nawyki: 'A' }) === 2
  );
  /*
    Sufit dnia. Liczba bierze sie z dlugosci POLA_TRESCI_WPISU, wiec asercja pilnuje
    takze tego, ze dopisanie pola do dziennika swiadomie podnosi maksimum.
  */
  const kompletWpisu = Object.fromEntries(nagrody.POLA_TRESCI_WPISU.map((k) => [k, 'x']));
  sprawdz(
    'maksimum z jednego dnia to 18 XP (1 + 17 pol tresci)',
    nagrody.maksymalneXpWpisu() === 18 && nagrody.xpWpisu(kompletWpisu) === 18,
    `max=${nagrody.maksymalneXpWpisu()}, komplet=${nagrody.xpWpisu(kompletWpisu)}`
  );
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
  sprawdz(
    '0 XP -> poziom 1, prestiz 0, do nastepnego 50',
    p(0).poziom === 1 && p(0).prestiz === 0 && p(0).xpDoNastepnego === 50
  );
  sprawdz('49 XP -> nadal poziom 1, brakuje 1 XP', p(49).poziom === 1 && p(49).xpDoNastepnego === 1);
  sprawdz('DOKLADNIE 50 XP -> poziom 2', p(50).poziom === 2 && p(50).prestiz === 0);
  sprawdz('4999 XP -> poziom 100, prestiz 0', p(4999).poziom === 100 && p(4999).prestiz === 0);
  sprawdz(
    'DOKLADNIE 5000 XP -> reset: prestiz 1, poziom 1',
    p(5000).prestiz === 1 && p(5000).poziom === 1
  );
  sprawdz('5050 XP -> prestiz 1, poziom 2', p(5050).prestiz === 1 && p(5050).poziom === 2);
  /*
    KALIBRACJA: rok codziennych wpisow wypelnionych w polowie (9 XP) plus zadanie
    2h o sredniej trudnosci (2 XP) ma dac mniej wiecej jeden prestiz. Asercja pilnuje,
    zeby zmiana stalych nie rozjechala sie po cichu z zalozeniem, pod ktore powstaly.
  */
  const rocznieXp = 365 * (9 + 2);
  const cyklPrestizu = nagrody.STALE.PROG_POZIOMU * nagrody.STALE.POZIOMOW_DO_RESETU;
  sprawdz(
    'rok umiarkowanego uzywania miesci sie w 0.7-1.2 prestizu',
    rocznieXp / cyklPrestizu >= 0.7 && rocznieXp / cyklPrestizu <= 1.2,
    `${rocznieXp} XP / ${cyklPrestizu} = ${(rocznieXp / cyklPrestizu).toFixed(2)} prestizu`
  );

  // --- waluta ---
  sprawdz('waluta to polowa XP zaokraglona w dol', nagrody.walutaZarobiona(101) === 50);

  const stan = nagrody.policzPostac(
    [{ stan: 'Zrobione', trudnosc: 3, czas_trwania_godziny: 4 }],
    [{ wdziecznosc: 'x', nawyki: 'A, B' }],
    3
  );
  sprawdz(
    'rozbicie ma dwa zrodla: zadania 8, dziennik 3 (wpis + wdziecznosc + nawyki)',
    stan.rozbicie.zadania === 8 &&
      stan.rozbicie.dziennik === 3 &&
      stan.rozbicie.nawyki === undefined,
    JSON.stringify(stan.rozbicie)
  );
  sprawdz(
    'suma 11 XP, waluta 5 - 3 wydane = 2',
    stan.calkowite_xp === 11 && stan.waluta_dostepna === 2,
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
  /*
    numerDnia rowniez istnieje w DWOCH kopiach: lib/nagrody.js (serwer, XP)
    i public/js/filtr-dat.js (przegladarka, kolumny wyliczane i filtry).

    To funkcja, na ktorej stoi KAZDE porownanie dat w projekcie - zasada pelnych
    dni kalendarzowych, 'Dni do terminu', zakresy, pasujeTerminDo, mnoznik
    terminowosci. Rozjazd miedzy kopiami bylby calkowicie cichy: serwer liczylby
    XP inaczej, niz przegladarka pokazuje dni do terminu, i nic by tego nie zlapalo.

    Karmimy obie TYM SAMYM zestawem i porownujemy wyniki parami. Zestaw obejmuje
    takze wartosci puste i niepoprawne, bo wlasnie tam obie implementacje roznia
    sie kodem (wypelnione() kontra proste !znacznik) i najlatwiej o rozjazd.

    Wejscia NIE-TEKSTOWE sa poza zakresem: obie funkcje sa opisane jako
    przyjmujace znacznik tekstowy, a filtr-dat wola .slice() bez konwersji.
  */
  const WEJSCIA_DAT = [
    '2026-08-16',
    '2026-08-16T00:00',
    '2026-08-16T23:59',
    '2024-02-29',
    '2024-03-02T13:25',
    '1999-12-31',
    '',
    '   ',
    'kiedys w przyszlosci',
    '2026-08',
    null,
    undefined,
  ];
  sprawdzListe(
    'numerDnia daje te same wyniki po stronie serwera i przegladarki',
    WEJSCIA_DAT.map((w) => nagrody.numerDnia(w)),
    WEJSCIA_DAT.map((w) => reguly.filtrDat.numerDnia(w))
  );

  /*
    Trzecia kopia zyje w tym pliku (funkcja numerDnia u gory) i sluzy do budowania
    dat testowych. Jest CELOWO wezsza - nie ma zadnego zabezpieczenia przed pusta
    wartoscia, bo fixture'y zawsze podaja poprawna date. Porownujemy ja wiec tylko
    na poprawnych datach; gdyby rozjechala sie arytmetyka dni, zestaw testowy
    liczylby sie wzgledem innego 'dzisiaj' niz aplikacja.
  */
  const POPRAWNE_DATY = WEJSCIA_DAT.filter((w) => typeof w === 'string' && w.includes('-') && w.length >= 10);
  sprawdzListe(
    'numerDnia z tego pliku zgadza sie z produkcyjnym na poprawnych datach',
    POPRAWNE_DATY.map((w) => nagrody.numerDnia(w)),
    POPRAWNE_DATY.map((w) => numerDnia(w))
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
  /*
    Suma po WSZYSTKICH pozycjach rozbicia, a nie po wypisanych z nazwy - inaczej
    dodanie zrodla XP bez dopisania go tutaj przechodziloby niezauwazone.
  */
  sprawdz(
    'rozbicie sumuje sie do calkowitego XP',
    Object.values(postac.rozbicie).reduce((a, b) => a + b, 0) === postac.calkowite_xp,
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

/*
  Parser dat z pliku. lib/daty.js jest czystym modulem serwerowym, wiec - podobnie
  jak lib/nagrody.js - wystarczy zwykly require(), bez vm i bez wstawania serwera.

  Formaty z ukosnikami i zakres ze strzalka trafily tu po weryfikacji profilu
  quest-log na PRAWDZIWYM eksporcie "Success Plan" - specyfikacja, z ktorej profil
  powstal, nie wspominala ani o jednym, ani o drugim.
*/
/*
  Domyslne ograniczenie widoku.

  Powod jest wydajnosciowy: przy 537 zadaniach tabela buduje ~37 000 elementow
  <option> (piec list rozwijanych na wiersz) i przerysowanie kosztuje ~290 ms,
  a leci ono przy KAZDYM nacisnieciu klawisza w filtrze nazwy. Sam odsiew
  i sortowanie zajmuja ponizej 1 ms - caly koszt to budowanie DOM.

  Testujemy DWIE rzeczy, bo obie latwo zepsuc niezaleznie:
  1. ze widok domyslny naprawde odsiewa zakonczone,
  2. ze eksport, backup i XP nadal widza PELNY zbior - to zasada obowiazujaca
     od poczatku projektu i ograniczenie widoku nie ma prawa jej naruszyc.
*/
/*
  Zadania calodzienne: kolumny czasowe trzymaja ALBO 'YYYY-MM-DD', ALBO
  'YYYY-MM-DDTHH:MM'. Migracji nie bylo - kolumny sa tekstowe - wiec jedynym
  straznikiem formatu jest normalizacja w API i to, ze wszystkie obliczenia
  porownuja pelne dni kalendarzowe.
*/
/*
  PLAKIETKI POL ZADAN (config/plakietki-zadan.js).

  Plakietki sa DRUGA lista obok slownika, wiec grozi im rozjazd - dokladnie ten,
  ktory w audycie dal martwe wpisy 'Sub-Type' i 'Research' na liscie kolumn
  ignorowanych. Roznica jest taka, ze tam rozjazd byl cichy, a tu pekna asercje.

  Sprawdzamy OBA kierunki: wartosc slownika bez plakietki i plakietka bez wartosci.
*/
/*
  MOTYW JASNY / CIEMNY.

  Testujemy czysta funkcje rozstrzygajaca - reszta modulu to DOM i localStorage.
  To ona decyduje, czy wybor uzytkownika bierze gore nad ustawieniem systemu.
*/
/*
  ZASADY NALICZANIA XP wystawiane na stronie Postaci (tylko do odczytu).

  Opisy zyja w public/js/postac.js, a wartosci w lib/nagrody.js - to DWIE listy
  obok siebie, wiec grozi im rozjazd. Ten sam wzorzec co przy plakietkach:
  sprawdzamy OBA kierunki, bo dopisanie stalej bez opisu jest rownie ciche
  jak opis wskazujacy na stala, ktorej juz nie ma.
*/
/*
  KOPIA ZAPASOWA - format musi byc ODCZYTYWALNY Z POWROTEM.

  Kopia zadan miala wczesniej naglowki nazwane jak kolumny bazy ('stan', 'nazwa'),
  przez co import odrzucal wlasny plik bledem 'brakuje kolumn: Nazwa zadania, Stan'.
  Kopia, ktorej nie da sie wczytac, nie jest kopia zapasowa - stad te asercje.
*/
async function testujFormatKopii() {
  sekcja('FORMAT KOPII ZAPASOWEJ');

  const backup = fs.readFileSync(path.join(KATALOG_PROJEKTU, 'scripts', 'backup.js'), 'utf8');
  const mapowanie = require('../config/mapowanie-importu');

  /*
    Naglowki wyciagamy z KODU skryptu, a nie z pliku w backups/ - katalog jest
    gitignorowany i moze nie istniec na swiezym klonie.
  */
  const blok = backup.slice(backup.indexOf('const naglowki = ['));
  const naglowkiZadan = [...blok.slice(0, blok.indexOf(']')).matchAll(/'([^']+)'/g)].map((m) => m[1]);

  sprawdz(
    'kopia zadan ma komplet kolumn wymaganych przez import',
    mapowanie.KOLUMNY_WYMAGANE.every((k) => naglowkiZadan.includes(k)),
    'naglowki: ' + JSON.stringify(naglowkiZadan)
  );

  /*
    Kazdy naglowek kopii musi byc albo mapowany, albo swiadomie ignorowany.
    Inaczej odtwarzanie po cichu gubiloby kolumne, a podglad zasypywalby
    ostrzezeniem 'kolumny pominiete'.
  */
  const nieobsluzone = naglowkiZadan.filter(
    (h) => !(h in mapowanie.MAPOWANIE_KOLUMN) && !mapowanie.KOLUMNY_IGNOROWANE.includes(h)
  );
  sprawdzListe('kazdy naglowek kopii jest mapowany albo ignorowany', [], nieobsluzone);

  // Pola decydujace o XP musza przetrwac odtworzenie.
  for (const pole of ['priorytet', 'trudnosc', 'czas_trwania_godziny']) {
    sprawdz(
      'kopia niesie pole do XP: ' + pole,
      Object.values(mapowanie.MAPOWANIE_KOLUMN).includes(pole),
      JSON.stringify(Object.values(mapowanie.MAPOWANIE_KOLUMN))
    );
  }

  /*
    Skrypt musi obejmowac WSZYSTKIE tabele. Wczesniej zapisywal tylko zadania
    i dziennik, wiec projekty, zakupy i slownik nawykow nie istnialy w zadnej kopii.
  */
  for (const tabela of ['projekty', 'zakupy', 'nawyki_slownik']) {
    sprawdz('kopia obejmuje tabele ' + tabela, backup.includes(tabela), 'brak w scripts/backup.js');
  }
  sprawdz(
    'kopia zawiera migawke calej bazy (VACUUM INTO)',
    backup.includes('VACUUM INTO'),
    'brak migawki - odtworzenie relacji nie byloby mozliwe'
  );
}

async function testujZasadyXp() {
  sekcja('ZASADY NALICZANIA XP');

  const { tresc } = await zapytaj('GET', '/api/postac');
  const nagrody = require('../lib/nagrody');

  sprawdz(
    '/api/postac wystawia zasady naliczania',
    tresc.zasady && typeof tresc.zasady === 'object',
    JSON.stringify(tresc.zasady)
  );
  sprawdzListe(
    'wystawione zasady to dokladnie STALE z lib/nagrody.js',
    Object.keys(nagrody.STALE).sort(),
    Object.keys(tresc.zasady).sort()
  );

  // Opisy z interfejsu - wyciagamy je z pliku, bo postac.js dotyka DOM przy starcie.
  const kod = fs.readFileSync(path.join(KATALOG_PROJEKTU, 'public', 'js', 'postac.js'), 'utf8');
  const blok = kod.slice(kod.indexOf('const OPISY_ZASAD = {'));
  // Bez wyrazenia regularnego - wystarczy odczytac nazwy kluczy z linii.
  const opisy = blok
    .slice(0, blok.indexOf('};'))
    .split(String.fromCharCode(10))
    .map((l) => l.trim())
    .filter((l) => l.includes(':') && !l.startsWith('const'))
    .map((l) => l.slice(0, l.indexOf(':')).trim());

  sprawdzListe(
    'kazda stala ma opis w interfejsie',
    [],
    Object.keys(nagrody.STALE).filter((k) => !opisy.includes(k))
  );
  sprawdzListe(
    'zaden opis nie wskazuje na nieistniejaca stala',
    [],
    opisy.filter((k) => !(k in nagrody.STALE))
  );

  /*
    REGRESJA: zasady sa TYLKO DO ODCZYTU. Gdyby ktos dorobil zapis, ten test
    przypomni, ze zmiana stalej przelicza cala historie wstecz.
  */
  const proba = await zapytaj('PATCH', '/api/postac', { zasady: { PROG_POZIOMU: 1 } });
  sprawdz(
    'nie ma endpointu do zmiany zasad (PATCH /api/postac)',
    proba.status === 404 || proba.status === 405,
    'status: ' + proba.status
  );
}

async function testujMotyw(reguly) {
  sekcja('MOTYW JASNY / CIEMNY');

  const { rozstrzygnij, WYBORY } = reguly.motyw;

  sprawdzListe('trzy stany wyboru, systemowy jako pierwszy', ['system', 'jasny', 'ciemny'], WYBORY);

  /*
    Wybor RECZNY ma pierwszenstwo nad systemem - w obie strony. To sedno
    przelacznika: uzytkownik z jasnym systemem musi moc obejrzec motyw ciemny.
  */
  sprawdzListe(
    'wybor reczny wygrywa z ustawieniem systemu',
    ['jasny', 'jasny', 'ciemny', 'ciemny'],
    [
      rozstrzygnij('jasny', false),
      rozstrzygnij('jasny', true),
      rozstrzygnij('ciemny', false),
      rozstrzygnij('ciemny', true),
    ]
  );

  sprawdzListe(
    'wybor systemowy idzie za systemem',
    ['jasny', 'ciemny'],
    [rozstrzygnij('system', false), rozstrzygnij('system', true)]
  );

  /*
    Nieznana wartosc (recznie zepsuty localStorage, starsza wersja aplikacji)
    ma dawac motyw systemowy, a nie pusty atrybut albo wyjatek.
  */
  sprawdzListe(
    'nieznany wybor zachowuje sie jak systemowy',
    ['jasny', 'ciemny'],
    [rozstrzygnij('cokolwiek', false), rozstrzygnij(undefined, true)]
  );
}

async function testujPlakietkiZadan() {
  sekcja('PLAKIETKI POL ZADAN');

  const plakietki = require('../config/plakietki-zadan');
  const slowniki = require('../config/slowniki');

  // --- kierunek 1: kazda wartosc slownika ma plakietke ---
  sprawdzListe(
    'kazdy stan ze slownika ma plakietke',
    [],
    slowniki.STANY.filter((s) => !plakietki.STANY[s])
  );
  sprawdzListe(
    'kazdy obszar ze slownika ma plakietke',
    [],
    slowniki.OBSZARY.filter((o) => !plakietki.OBSZARY[o])
  );
  sprawdzListe(
    'kazdy priorytet ze slownika ma plakietke',
    [],
    slowniki.PRIORYTETY.filter((p) => !plakietki.PRIORYTETY[p.numer]).map((p) => p.numer)
  );

  // --- kierunek 2: zadna plakietka nie wisi w prozni ---
  sprawdzListe(
    'zadna plakietka stanu nie wskazuje na nieistniejacy stan',
    [],
    Object.keys(plakietki.STANY).filter((s) => !slowniki.STANY.includes(s))
  );
  sprawdzListe(
    'zadna plakietka obszaru nie wskazuje na nieistniejacy obszar',
    [],
    Object.keys(plakietki.OBSZARY).filter((o) => !slowniki.OBSZARY.includes(o))
  );
  sprawdzListe(
    'zadna plakietka priorytetu nie wskazuje na nieistniejacy numer',
    [],
    Object.keys(plakietki.PRIORYTETY).filter(
      (n) => !slowniki.PRIORYTETY.some((p) => String(p.numer) === n)
    )
  );

  /*
    PRIORYTET 0 ma wlasna asercje, bo zero jest w JS wartoscia falszywa i juz raz
    bylo w tym projekcie zrodlem bledu (znikalo z interfejsu przy uzyciu ||).
  */
  sprawdz(
    'priorytet 0 ma plakietke (zero nie jest traktowane jak brak)',
    plakietki.PRIORYTETY[0] === '⚪',
    JSON.stringify(plakietki.PRIORYTETY[0])
  );

  // --- trudnosc: komplet 1-3, bez luk i bez duplikatow ---
  sprawdzListe(
    'trudnosc ma wartosci 1-3 w kolejnosci',
    [1, 2, 3],
    plakietki.TRUDNOSCI.map((t) => t.wartosc)
  );
  sprawdz(
    'kazda trudnosc ma emoji i opis',
    plakietki.TRUDNOSCI.every((t) => t.emoji && t.opis),
    JSON.stringify(plakietki.TRUDNOSCI)
  );

  // --- higiena: brak duplikatow emoji w obrebie jednego pola ---
  for (const [nazwa, wartosci] of [
    ['stanow', Object.values(plakietki.STANY)],
    ['obszarow', Object.values(plakietki.OBSZARY)],
    ['priorytetow', Object.values(plakietki.PRIORYTETY)],
    ['trudnosci', plakietki.TRUDNOSCI.map((t) => t.emoji)],
  ]) {
    sprawdz(
      'plakietki ' + nazwa + ' sa rozne (emoji rozroznia wartosci)',
      new Set(wartosci).size === wartosci.length,
      JSON.stringify(wartosci)
    );
  }

  // --- wystawienie przez API ---
  const { tresc } = await zapytaj('GET', '/api/slowniki');
  sprawdz(
    '/api/slowniki wystawia plakietki wszystkich czterech pol',
    ['TRUDNOSCI', 'PRIORYTETY', 'STANY', 'OBSZARY'].every((k) => tresc.plakietkiZadan[k]),
    JSON.stringify(Object.keys(tresc.plakietkiZadan || {}))
  );

  /*
    REGRESJA: w bazie ma ladowac SUROWA wartosc, nie etykieta z emoji.
    To jedyna asercja, ktora chroni przed tym, ze ktos zacznie zapisywac etykiete.
  */
  const { tresc: nowe } = await zapytaj('POST', '/api/zadania');
  await zapytaj('PATCH', `/api/zadania/${nowe.id}`, {
    stan: 'W trakcie',
    obszar: 'Health',
    priorytet: 4,
    trudnosc: 2,
  });
  const { tresc: zapisane } = await zapytaj('GET', '/api/zadania');
  const rekord = zapisane.find((z) => z.id === nowe.id);
  sprawdzListe(
    'w bazie zapisana jest surowa wartosc, bez emoji',
    ['W trakcie', 'Health', 4, 2],
    [rekord.stan, rekord.obszar, rekord.priorytet, rekord.trudnosc]
  );
  await zapytaj('DELETE', `/api/zadania/${nowe.id}`);
}

/*
  Kolejnosc komorek wiersza kontra kolejnosc naglowkow w dzienniku.

  REGRESJA: licznik "Refleksje" byl doklejany na koniec wiersza, a w naglowkach stoi
  zaraz za "Do przemyslenia". Liczba komorek sie zgadzala (21 = 21), wiec zadna kontrola
  liczaca kolumny tego nie widziala - przesuniete bylo tylko UPORZADKOWANIE, przez co
  wartosc sniadania ladowala pod naglowkiem "Refleksje", a licznik pod "Kolacja".

  Dlatego ta asercja porownuje SEKWENCJE, a nie dlugosci. Zrodlem prawdy jest HTML
  (naglowki) i public/js/dziennik.js (kolejnosc budowania komorek) - czyli dokladnie
  te dwie listy, ktore moga sie rozjechac niezaleznie od siebie.
*/
async function testujAtrybuty() {
  sekcja('ATRYBUTY POSTACI');

  const nagrody = require('../lib/nagrody');
  const { KLUCZE_ATRYBUTOW } = require('../config/atrybuty');

  // --- reguła puli, w izolacji ---
  sprawdz(
    'poziom 1 bez prestizu nie daje jeszcze punktow',
    nagrody.punktyDoRozdania(0, 1) === 0
  );
  sprawdz(
    'kazdy poziom daje PUNKTY_NA_POZIOM punktow',
    nagrody.punktyDoRozdania(0, 11) === 10 * nagrody.STALE.PUNKTY_NA_POZIOM
  );
  /*
    REGRESJA: prestiz zeruje LICZNIK poziomu, ale nie dorobek. Gdyby pula liczyla
    sie z samego `poziom`, przekroczenie progu prestizu odebraloby setke poziomow
    punktow naraz - i to w chwili, ktora ma byc nagroda.
  */
  sprawdz(
    'prestiz nie kasuje puli: prestiz 1 + poziom 1 > prestiz 0 + poziom 100',
    nagrody.punktyDoRozdania(1, 1) > nagrody.punktyDoRozdania(0, 100),
    `${nagrody.punktyDoRozdania(1, 1)} vs ${nagrody.punktyDoRozdania(0, 100)}`
  );

  // --- wystawienie definicji ---
  const { tresc: slowniki } = await zapytaj('GET', '/api/slowniki');
  sprawdzListe(
    '/api/slowniki wystawia atrybuty w kolejnosci z konfiguracji',
    KLUCZE_ATRYBUTOW,
    (slowniki.atrybuty || []).map((a) => a.klucz)
  );
  sprawdz(
    'kazdy atrybut ma etykiete, emoji i opis',
    (slowniki.atrybuty || []).every((a) => a.etykieta && a.emoji && a.opis),
    JSON.stringify(slowniki.atrybuty)
  );

  // --- stan poczatkowy ---
  const { tresc: start } = await zapytaj('GET', '/api/postac');
  sprawdzListe(
    'GET /api/postac zwraca komplet atrybutow',
    KLUCZE_ATRYBUTOW,
    Object.keys(start.atrybuty || {}).sort(
      (a, b) => KLUCZE_ATRYBUTOW.indexOf(a) - KLUCZE_ATRYBUTOW.indexOf(b)
    )
  );
  sprawdz(
    'pula zgadza sie z regula policzona w izolacji',
    start.punkty.lacznie === nagrody.punktyDoRozdania(start.prestiz, start.poziom),
    JSON.stringify(start.punkty)
  );
  sprawdz(
    'wolne = lacznie - rozdane',
    start.punkty.wolne === start.punkty.lacznie - start.punkty.rozdane,
    JSON.stringify(start.punkty)
  );

  /*
    Reszta testu potrzebuje puli, z ktorej da sie rozdac kilka punktow. Baza testowa
    startuje pusta, wiec dokladamy zadan, dopoki postac nie uzbiera dosc poziomow.
    Zadania sa tanszym zrodlem XP niz wpisy (jedno daje do 20 XP, wpis do 18),
    a przy okazji nie zaburzaja testow dziennika.
  */
  const POTRZEBNE_PUNKTY = 6;
  const idDoSprzatniecia = [];
  while ((await zapytaj('GET', '/api/postac')).tresc.punkty.lacznie < POTRZEBNE_PUNKTY) {
    const { tresc: zadanie } = await zapytaj('POST', '/api/zadania');
    await zapytaj('PATCH', `/api/zadania/${zadanie.id}`, {
      stan: 'Zrobione',
      trudnosc: 3,
      czas_trwania_godziny: 10,
    });
    idDoSprzatniecia.push(zadanie.id);
    if (idDoSprzatniecia.length > 50) break; // zabezpieczenie przed petla bez konca
  }

  const { tresc: zPula } = await zapytaj('GET', '/api/postac');
  sprawdz(
    'udalo sie uzbierac pule do rozdania',
    zPula.punkty.lacznie >= POTRZEBNE_PUNKTY,
    JSON.stringify(zPula.punkty)
  );

  // --- zapis ---
  const zapis = await zapytaj('PATCH', '/api/atrybuty', { sila: 3 });
  sprawdz('PATCH zapisuje punkty', zapis.status === 200 && zapis.tresc.atrybuty.sila === 3, `status ${zapis.status}`);
  sprawdz(
    'PATCH przelicza rozdane i wolne',
    zapis.tresc.punkty.rozdane === 3 && zapis.tresc.punkty.wolne === zapis.tresc.punkty.lacznie - 3,
    JSON.stringify(zapis.tresc.punkty)
  );

  /*
    PATCH, a nie PUT: klucze pominiete w ciele maja ZOSTAC bez zmian. Gdyby
    brakujace pole zerowalo atrybut, zapis jednego suwaka kasowalby dwa pozostale.
  */
  const czesciowy = await zapytaj('PATCH', '/api/atrybuty', { zrecznosc: 2 });
  sprawdz(
    'PATCH nie rusza atrybutow, ktorych nie ma w ciele',
    czesciowy.tresc.atrybuty.sila === 3 && czesciowy.tresc.atrybuty.zrecznosc === 2,
    JSON.stringify(czesciowy.tresc.atrybuty)
  );

  /*
    Operacja calosciowa jest IDEMPOTENTNA - to jest powod, dla ktorego API przyjmuje
    docelowa wartosc zamiast "+1". Powtorzone zadanie nie moze dolozyc punktu.
  */
  const powtorka = await zapytaj('PATCH', '/api/atrybuty', { sila: 3 });
  sprawdz(
    'powtorzony ten sam PATCH niczego nie dokłada',
    powtorka.tresc.atrybuty.sila === 3 && powtorka.tresc.punkty.rozdane === 5,
    JSON.stringify(powtorka.tresc.punkty)
  );

  // --- walidacja ---
  const ponadPule = await zapytaj('PATCH', '/api/atrybuty', {
    sila: zPula.punkty.lacznie + 1,
  });
  sprawdz(
    'rozdanie ponad pule odrzucone (400)',
    ponadPule.status === 400,
    `status ${ponadPule.status}: ${ponadPule.tresc && ponadPule.tresc.blad}`
  );

  const ujemny = await zapytaj('PATCH', '/api/atrybuty', { sila: -1 });
  sprawdz('ujemna wartosc odrzucona (400)', ujemny.status === 400, `status ${ujemny.status}`);

  const ulamek = await zapytaj('PATCH', '/api/atrybuty', { sila: 1.5 });
  sprawdz('ulamek odrzucony (400)', ulamek.status === 400, `status ${ulamek.status}`);

  const nieznany = await zapytaj('PATCH', '/api/atrybuty', { charyzma: 1 });
  sprawdz(
    'nieznany atrybut odrzucony (400), a nie po cichu pominiety',
    nieznany.status === 400,
    `status ${nieznany.status}`
  );

  const poBledach = await zapytaj('GET', '/api/postac');
  sprawdz(
    'zaden odrzucony zapis nie zmienil stanu',
    poBledach.tresc.atrybuty.sila === 3 && poBledach.tresc.atrybuty.zrecznosc === 2,
    JSON.stringify(poBledach.tresc.atrybuty)
  );

  // --- reset ---
  const reset = await zapytaj('POST', '/api/atrybuty/reset', {});
  sprawdz(
    'reset zeruje wszystkie atrybuty',
    KLUCZE_ATRYBUTOW.every((k) => reset.tresc.atrybuty[k] === 0) &&
      reset.tresc.punkty.rozdane === 0,
    JSON.stringify(reset.tresc.atrybuty)
  );
  sprawdz(
    'po resecie wolne wracaja do pelnej puli',
    reset.tresc.punkty.wolne === reset.tresc.punkty.lacznie,
    JSON.stringify(reset.tresc.punkty)
  );

  // Sprzatamy po sobie - kolejne testy licza zadania i nie moga zastac naszych.
  for (const id of idDoSprzatniecia) await zapytaj('DELETE', `/api/zadania/${id}`);
}

async function testujKolejnoscKolumnDziennika() {
  sekcja('DZIENNIK: KOLEJNOSC KOLUMN KONTRA NAGLOWKI');

  const html = fs.readFileSync(path.join(KATALOG_PROJEKTU, 'public', 'dziennik.html'), 'utf8');
  const thead = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
  // Filtr odsiewa sam znacznik <thead>, ktory tez zaczyna sie od "<th".
  const naglowki = thead
    .split('<th')
    .filter((k) => k.startsWith(' ') || k.startsWith('>'))
    .map((k) => {
      const kolumna = /data-kolumna="([^"]+)"/.exec(k);
      if (kolumna) return kolumna[1];
      const tekst = />([^<]*)</.exec(k);
      const opis = tekst ? tekst[1].trim() : '';
      return opis ? '(' + opis + ')' : '(akcje)';
    });

  const js = fs.readFileSync(path.join(KATALOG_PROJEKTU, 'public', 'js', 'dziennik.js'), 'utf8');
  const poczatek = js.indexOf('const KOLUMNY = [');
  const blok = js.slice(poczatek, js.indexOf('];', poczatek));
  const pola = [...blok.matchAll(/pole: '([^']+)'/g)].map((m) => m[1]);
  const przedRefleksjami = /const POLE_PRZED_REFLEKSJAMI = '([^']+)'/.exec(js);

  sprawdz(
    'POLE_PRZED_REFLEKSJAMI istnieje i wskazuje pole z KOLUMNY',
    przedRefleksjami !== null && pola.includes(przedRefleksjami[1]),
    String(przedRefleksjami && przedRefleksjami[1])
  );

  const komorki = ['id'];
  for (const pole of pola) {
    komorki.push(pole);
    if (przedRefleksjami && pole === przedRefleksjami[1]) komorki.push('(Refleksje)');
  }
  komorki.push('(akcje)');

  sprawdzListe('kolejnosc komorek wiersza zgadza sie z naglowkami', komorki, naglowki);
}

async function testujDatyCalodzienne(reguly) {
  sekcja('DATY CALODZIENNE I DOMYSLNY TERMIN');

  const { znormalizujZnacznikCzasu } = require('../lib/daty');
  const { regulyZadan, filtrDat } = reguly;

  // --- normalizacja: obie postacie sa kanoniczne ---
  sprawdz(
    'sama data ZOSTAJE bez godziny (calodzienne)',
    znormalizujZnacznikCzasu('2026-08-16') === '2026-08-16'
  );
  sprawdz(
    'data z godzina zostaje z godzina',
    znormalizujZnacznikCzasu('2026-08-16T14:30') === '2026-08-16T14:30'
  );
  sprawdz(
    'sekundy z przegladarki sa obcinane do minut',
    znormalizujZnacznikCzasu('2026-08-16T14:30:59') === '2026-08-16T14:30'
  );
  sprawdz('spacja zamiast T tez dziala', znormalizujZnacznikCzasu('2026-08-16 14:30') === '2026-08-16T14:30');
  sprawdz('nieistniejacy dzien odrzucony', znormalizujZnacznikCzasu('2026-02-30') === null);
  sprawdz('godzina 24:00 odrzucona', znormalizujZnacznikCzasu('2026-08-16T24:00') === null);

  /*
    Porownania MUSZA dawac ten sam wynik dla obu postaci - to jest sedno decyzji,
    ze godzina nie wplywa na obliczenia. Gdyby ktos zaczal porownywac znaczniki
    jako pelne teksty, te asercje pekna.
  */
  /*
    KOTWICA: 20681 to liczba dni od 1970-01-01 do 2026-08-16.

    Bez niej asercja porownywalaby funkcje sama ze soba (numerDnia(a) === numerDnia(b))
    i przeszlaby rowniez dla implementacji zwracajacej stala - np. zawsze null.
    Trzecia wartosc (dzien pozniej) dokłada dowod, ze to naprawde licznik dni,
    a nie dowolna funkcja dajaca dwa razy ten sam wynik.
  */
  sprawdzListe(
    'numerDnia: obie postacie daja ten sam, konkretny numer dnia',
    [20681, 20681, 20682],
    [
      filtrDat.numerDnia('2026-08-16'),
      filtrDat.numerDnia('2026-08-16T23:59'),
      filtrDat.numerDnia('2026-08-17'),
    ]
  );
  sprawdz(
    'Dni do terminu: termin calodzienny liczy sie jak z godzina',
    regulyZadan.dniDoTerminu({ termin: '2026-08-20' }, '2026-08-16') === 4 &&
      regulyZadan.dniDoTerminu({ termin: '2026-08-20T23:59' }, '2026-08-16') === 4
  );

  // Mnoznik terminowosci (XP) - zakonczenie o 23:00 w dniu terminu to NADAL na czas.
  const { mnoznikTerminowosci } = require('../lib/nagrody');
  /*
    KOTWICA jak wyzej: wczesniej obie strony porownania wolaly te sama funkcje,
    wiec mnoznik zwracajacy zawsze 1 - czyli martwa mechanika premii i kary
    za termin - przeszedlby ten test. Trzeci przypadek (po terminie -> 0.5) jest
    tu po to, zeby stala 1 nie mogla sie przemknac.
  */
  sprawdzListe(
    'mnoznik terminowosci: obie postacie terminu daja 1, przekroczenie daje 0.5',
    [1, 1, 0.5],
    [
      mnoznikTerminowosci('2026-08-16', '2026-08-16T23:00'),
      mnoznikTerminowosci('2026-08-16T00:00', '2026-08-16T23:00'),
      mnoznikTerminowosci('2026-08-16', '2026-08-20'),
    ]
  );

  // --- domyslny termin przez HTTP ---
  const { tresc: nowe } = await zapytaj('POST', '/api/zadania');
  const dzisDlaSerwera = (await zapytaj('GET', '/api/czas')).tresc.dzisiaj;

  sprawdz(
    'nowy rekord ma termin = dzisiaj, BEZ godziny',
    nowe.termin === dzisDlaSerwera,
    `termin: ${JSON.stringify(nowe.termin)}, dzisiaj: ${dzisDlaSerwera}`
  );
  sprawdz(
    'nowy rekord ma PUSTY start_zadania',
    nowe.start_zadania === null,
    `start_zadania: ${JSON.stringify(nowe.start_zadania)}`
  );

  // Zapis obu postaci przez API, tam i z powrotem.
  const zGodzina = await zapytaj('PATCH', `/api/zadania/${nowe.id}`, { termin: '2026-08-16T09:15' });
  sprawdz('PATCH zapisuje postac z godzina', zGodzina.tresc.termin === '2026-08-16T09:15');

  const bezGodziny = await zapytaj('PATCH', `/api/zadania/${nowe.id}`, { termin: '2026-08-16' });
  sprawdz(
    'PATCH zapisuje postac calodzienna (godzina nie doklei sie sama)',
    bezGodziny.tresc.termin === '2026-08-16',
    `termin: ${JSON.stringify(bezGodziny.tresc.termin)}`
  );

  await zapytaj('DELETE', `/api/zadania/${nowe.id}`);
}

/*
  Duplikowanie zadania. Najwazniejsza asercja dotyczy tego, czego kopia NIE
  dziedziczy: stan "Zrobione" wraz z data zamkniecia doliczylby XP za prace,
  ktorej nikt nie wykonal.
*/
async function testujDuplikowanie() {
  sekcja('DUPLIKOWANIE ZADANIA');

  const { tresc: zrodlo } = await zapytaj('POST', '/api/zadania');
  await zapytaj('PATCH', `/api/zadania/${zrodlo.id}`, {
    nazwa: 'Zadanie do skopiowania',
    stan: 'Zrobione',
    obszar: 'Career',
    priorytet: 4,
    trudnosc: 3,
    czas_trwania_godziny: 2.5,
    termin: '2026-08-20',
    start_zadania: '2026-08-18T08:00',
    czas_zakonczenia: '2026-08-19T17:00',
  });

  const odpowiedz = await zapytaj('POST', `/api/zadania/${zrodlo.id}/duplikuj`);
  sprawdz('duplikowanie odpowiada 201', odpowiedz.status === 201, JSON.stringify(odpowiedz.tresc));
  const kopia = odpowiedz.tresc;

  sprawdz('kopia to NOWY rekord', kopia.id !== zrodlo.id);
  sprawdz('nazwa dostaje dopisek " (kopia)"', kopia.nazwa === 'Zadanie do skopiowania (kopia)');

  sprawdzListe(
    'skopiowane: obszar, priorytet, trudnosc, czas, termin, start',
    ['Career', 4, 3, 2.5, '2026-08-20', '2026-08-18T08:00'],
    [
      kopia.obszar,
      kopia.priorytet,
      kopia.trudnosc,
      kopia.czas_trwania_godziny,
      kopia.termin,
      kopia.start_zadania,
    ]
  );

  /*
    Te dwie asercje pilnuja regulу, dla ktorej duplikat robi serwer, a nie przegladarka.
  */
  sprawdz('kopia NIE dziedziczy stanu - dostaje "Plan"', kopia.stan === 'Plan', `stan: ${kopia.stan}`);
  sprawdz(
    'kopia NIE dziedziczy czasu zakonczenia',
    kopia.czas_zakonczenia === null,
    `czas_zakonczenia: ${JSON.stringify(kopia.czas_zakonczenia)}`
  );

  // Skoro kopia nie jest zakonczona, nie ma prawa dolozyc XP za zadania.
  const przed = (await zapytaj('GET', '/api/postac')).tresc.rozbicie.zadania;
  const { tresc: druga } = await zapytaj('POST', `/api/zadania/${zrodlo.id}/duplikuj`);
  const po = (await zapytaj('GET', '/api/postac')).tresc.rozbicie.zadania;
  sprawdz('kopia nie dolicza XP za niewykonana prace', po === przed, `przed: ${przed}, po: ${po}`);

  sprawdz(
    'duplikowanie nieistniejacego zadania -> 404',
    (await zapytaj('POST', '/api/zadania/999999/duplikuj')).status === 404
  );

  for (const id of [zrodlo.id, kopia.id, druga.id]) {
    await zapytaj('DELETE', `/api/zadania/${id}`);
  }
}

async function testujDomyslneOgraniczenie(reguly) {
  sekcja('DOMYSLNE OGRANICZENIE WIDOKU');

  const { regulyZadan } = reguly;
  const slownikiTestowe = {
    stany: ['Plan', 'Czeka', 'W trakcie', 'Zrobione', 'Blok'],
    stanZakonczony: 'Zrobione',
  };

  sprawdzListe(
    'widok domyslny to wszystkie stany poza zakonczonym',
    ['Plan', 'Czeka', 'W trakcie', 'Blok'],
    regulyZadan.domyslneStany(slownikiTestowe)
  );

  /*
    Lista jest WYLICZANA ze slownika, nie wpisana na sztywno - dopisanie stanu
    w config/slowniki.js ma od razu wchodzic do widoku domyslnego, bez ruszania
    kodu strony. Gdyby ktos zamienil to na stala liste, ta asercja pekniе.
  */
  sprawdzListe(
    'nowy stan ze slownika wchodzi do widoku domyslnego sam',
    ['Plan', 'Odlozone'],
    regulyZadan.domyslneStany({ stany: ['Plan', 'Odlozone', 'Zrobione'], stanZakonczony: 'Zrobione' })
  );

  // Odsiew liczony PRAWDZIWA funkcja filtrujaca, a nie powtorzona logika testu.
  const zadaniaTestowe = [
    { id: 1, nazwa: 'aktywne', stan: 'Plan' },
    { id: 2, nazwa: 'zrobione', stan: 'Zrobione' },
    { id: 3, nazwa: 'w toku', stan: 'W trakcie' },
  ];
  const filtryDomyslne = {
    nazwa: '',
    od: '',
    do: '',
    stany: new Set(regulyZadan.domyslneStany(slownikiTestowe)),
    priorytety: new Set(),
    obszary: new Set(),
    projekty: new Set(),
  };
  sprawdzListe(
    'widok domyslny chowa zakonczone, reszte zostawia',
    [1, 3],
    regulyZadan.filtrowane(zadaniaTestowe, filtryDomyslne, null).map((z) => z.id)
  );

  /*
    DRUGA POLOWA WIDOKU DOMYSLNEGO: termin nie dalej niz dzisiaj + 7 dni.

    Zakres jest OTWARTY Z LEWEJ - to najwazniejsza wlasnosc tej reguly.
    Ukrycie zaleglosci byloby gorsze niz problem, ktory widok domyslny rozwiazuje,
    wiec zadanie po terminie MUSI zostac widoczne.
  */
  const DZIS_T = '2026-08-16';
  sprawdz(
    'domyslna granica terminu to dzisiaj + 7 dni',
    regulyZadan.domyslnyTerminDo(DZIS_T) === '2026-08-23',
    regulyZadan.domyslnyTerminDo(DZIS_T)
  );

  const granica = { terminDo: regulyZadan.domyslnyTerminDo(DZIS_T) };
  sprawdzListe(
    'termin: dawno po terminie / wczoraj / dzis / za 7 dni / za 8 dni',
    [true, true, true, true, false],
    [
      { termin: '2024-01-01' },
      { termin: '2026-08-15' },
      { termin: DZIS_T },
      { termin: '2026-08-23' },
      { termin: '2026-08-24' },
    ].map((z) => regulyZadan.pasujeTerminDo(z, granica))
  );
  sprawdz(
    'zadanie BEZ terminu zostaje widoczne',
    regulyZadan.pasujeTerminDo({ termin: null }, granica) === true
  );
  sprawdz(
    'pusta granica = brak filtra',
    regulyZadan.pasujeTerminDo({ termin: '2099-01-01' }, { terminDo: '' }) === true
  );
  sprawdz(
    'godzina w terminie nie zmienia wyniku na granicy',
    regulyZadan.pasujeTerminDo({ termin: '2026-08-23T23:59' }, granica) === true
  );

  // Pelny widok domyslny: oba warunki naraz, na jednym zestawie danych.
  const zestaw = [
    { id: 10, stan: 'Plan', termin: '2024-01-01' }, // dawno po terminie
    { id: 11, stan: 'Plan', termin: DZIS_T },
    { id: 12, stan: 'Plan', termin: '2026-12-31' }, // odlegly termin
    { id: 13, stan: 'Plan', termin: null }, // bez terminu
    { id: 14, stan: 'Zrobione', termin: DZIS_T }, // zakonczone
  ];
  const filtryPelne = { ...filtryDomyslne, terminDo: regulyZadan.domyslnyTerminDo(DZIS_T) };
  sprawdzListe(
    'widok domyslny: przeterminowane i bez terminu zostaja, odlegle i zrobione znikaja',
    [10, 11, 13],
    regulyZadan.filtrowane(zestaw, filtryPelne).map((z) => z.id)
  );

  /*
    FILTRY WYKLUCZAJACE (Obszar i Projekt).

    Przy 41 projektach zaznaczenie 40, zeby ukryc jeden, jest bezuzyteczne -
    stad tryb "wyklucz". Tryb jest JEDEN dla calej listy, wiec wartosc nie moze
    byc jednoczesnie zaznaczona i wykluczona.
  */
  const zProjektami = [
    { id: 20, obszar: 'Career', projekt_id: 1 },
    { id: 21, obszar: 'Health', projekt_id: 2 },
    { id: 22, obszar: null, projekt_id: null },
  ];
  const bezFiltrow = {
    nazwa: '',
    od: '',
    do: '',
    terminDo: '',
    stany: new Set(),
    priorytety: new Set(),
    obszary: new Set(),
    projekty: new Set(),
  };

  sprawdzListe(
    'obszar w trybie "uwzglednij" zostawia tylko zaznaczone',
    [20],
    regulyZadan
      .filtrowane(zProjektami, { ...bezFiltrow, obszary: new Set(['Career']) })
      .map((z) => z.id)
  );
  sprawdzListe(
    'obszar w trybie "wyklucz" zostawia wszystko OPROCZ zaznaczonych',
    [21, 22],
    regulyZadan
      .filtrowane(zProjektami, {
        ...bezFiltrow,
        obszary: new Set(['Career']),
        obszaryTryb: 'wyklucz',
      })
      .map((z) => z.id)
  );
  sprawdzListe(
    'projekt w trybie "wyklucz" - ukrycie jednego z wielu',
    [21, 22],
    regulyZadan
      .filtrowane(zProjektami, { ...bezFiltrow, projekty: new Set([1]), projektyTryb: 'wyklucz' })
      .map((z) => z.id)
  );

  /*
    Pusty zbior znaczy "brak filtra" w OBU trybach. Bez tego przelaczenie na
    "wyklucz" przed zaznaczeniem czegokolwiek chowaloby cala tabele.
  */
  sprawdz(
    'tryb "wyklucz" z pustym zbiorem nie chowa niczego',
    regulyZadan.filtrowane(zProjektami, { ...bezFiltrow, obszaryTryb: 'wyklucz' }).length === 3
  );

  // Zadanie bez obszaru (null) przy wykluczaniu konkretnej wartosci zostaje.
  sprawdz(
    'zadanie bez obszaru przechodzi przez wykluczenie innej wartosci',
    regulyZadan.pasujeZbior(null, new Set(['Career']), 'wyklucz') === true
  );
  /*
    LICZNIK AKTYWNYCH FILTROW (znacznik ' - aktywne: N' przy zwinietym panelu).

    ileAktywnych trzeba recznie rozszerzac przy KAZDYM nowym polu filtra - i nic
    poza tym testem tego nie pilnuje. Pominiecie jest ciche i uderza dokladnie
    w mechanizm, ktory ma zapobiegac wrazeniu zgubionych danych: zwiniety panel
    twierdzilby, ze filtrow nie ma, mimo ze tabela jest odsiana.

    Ostatnia asercja wylicza pola obiektu filtrow na podstawie widoku domyslnego
    i porownuje z liczba pol, ktore licznik zna. Gdy dojdzie nowe pole filtrujace,
    a ileAktywnych o nim nie bedzie wiedzialo, ta asercja peknie.
  */
  const pustyFiltrPelny = () => ({
    nazwa: '',
    od: '',
    do: '',
    terminDo: '',
    stany: new Set(),
    priorytety: new Set(),
    obszary: new Set(),
    projekty: new Set(),
  });

  sprawdz('brak filtrow -> licznik 0', regulyZadan.ileAktywnych(pustyFiltrPelny()) === 0);

  /*
    ZAMROZONE "DNI DO TERMINU".

    Dla zadania ZAMKNIETEGO kolumna liczy termin - czas_zakonczenia (wartosc stala),
    a nie termin - dzisiaj. Wczesniej rosla w nieskonczonosc i nie niosla informacji.
    Po zmianie pokazuje TE SAMA wielkosc, na ktorej opiera sie mnoznikTerminowosci.
  */
  const DZIS_Z = '2026-08-16';
  sprawdzListe(
    'zadanie otwarte liczy wzgledem DZISIAJ, zamkniete wzgledem ZAKONCZENIA',
    [4, 2, -3, null],
    [
      regulyZadan.dniDoTerminu({ termin: '2026-08-20' }, DZIS_Z),
      regulyZadan.dniDoTerminu({ termin: '2026-08-20', czas_zakonczenia: '2026-08-18' }, DZIS_Z),
      regulyZadan.dniDoTerminu({ termin: '2026-08-20', czas_zakonczenia: '2026-08-23' }, DZIS_Z),
      regulyZadan.dniDoTerminu({ termin: null, czas_zakonczenia: '2026-08-23' }, DZIS_Z),
    ]
  );

  /*
    Sedno zmiany: wartosc zamrozona NIE ZALEZY od tego, kiedy patrzymy.
    Ta sama para dat, dwa rozne "dzisiaj" - wynik musi byc identyczny.
  */
  const zamkniete = { termin: '2026-08-20', czas_zakonczenia: '2026-08-18' };
  sprawdz(
    'wartosc zamrozona nie zmienia sie wraz z uplywem czasu',
    regulyZadan.dniDoTerminu(zamkniete, '2026-08-16') ===
      regulyZadan.dniDoTerminu(zamkniete, '2027-12-31'),
    `${regulyZadan.dniDoTerminu(zamkniete, '2026-08-16')} vs ${regulyZadan.dniDoTerminu(zamkniete, '2027-12-31')}`
  );

  // Kontrola przeciwna: wartosc BIEZACA ma sie zmieniac z uplywem czasu.
  const otwarte = { termin: '2026-08-20' };
  sprawdz(
    'wartosc biezaca ZALEZY od dzisiaj (inaczej test wyzej nic nie dowodzi)',
    regulyZadan.dniDoTerminu(otwarte, '2026-08-16') !==
      regulyZadan.dniDoTerminu(otwarte, '2026-08-19')
  );

  sprawdzListe(
    'znacznik zamrozenia: tylko gdy sa OBIE daty',
    [true, false, false, false],
    [
      regulyZadan.dniDoTerminuZamrozone({ termin: '2026-08-20', czas_zakonczenia: '2026-08-18' }),
      regulyZadan.dniDoTerminuZamrozone({ termin: '2026-08-20' }),
      regulyZadan.dniDoTerminuZamrozone({ czas_zakonczenia: '2026-08-18' }),
      regulyZadan.dniDoTerminuZamrozone({}),
    ]
  );

  /*
    ROZDZIELENIE DWOCH OGRANICZEN WIDOKU.

    Zdjecie granicy terminu NIE MOZE odslonic zadan zrobionych - to dwa niezalezne
    warunki i przycisk banera zdejmuje tylko pierwszy.
  */
  const zestawDwa = [
    { id: 30, stan: 'Plan', termin: DZIS_Z },
    { id: 31, stan: 'Plan', termin: '2026-12-31' },
    { id: 32, stan: 'Zrobione', termin: DZIS_Z },
    { id: 33, stan: 'Zrobione', termin: '2026-12-31' },
  ];
  const filtryObaWarunki = {
    ...pustyFiltrPelny(),
    stany: new Set(regulyZadan.domyslneStany(slownikiTestowe)),
    terminDo: regulyZadan.domyslnyTerminDo(DZIS_Z),
  };
  sprawdzListe(
    'oba ograniczenia razem: tylko aktywne w oknie terminu',
    [30],
    regulyZadan.filtrowane(zestawDwa, filtryObaWarunki).map((z) => z.id)
  );
  sprawdzListe(
    'po zdjeciu granicy terminu zrobione NADAL sa ukryte',
    [30, 31],
    regulyZadan.filtrowane(zestawDwa, { ...filtryObaWarunki, terminDo: '' }).map((z) => z.id)
  );
  /*
    WYJATEK OD FILTROW dla nowo utworzonych i zduplikowanych zadan.

    Bez niego kopia zadania zrobionego albo zadanie z odleglym terminem znikalo
    natychmiast po powstaniu - zostawal komunikat i nic wiecej.
  */
  const wymuszone = new Set([31, 33]);
  const przefiltrowane = regulyZadan.filtrowane(zestawDwa, filtryObaWarunki);
  sprawdzListe(
    'wymuszone zadania dochodza do wyniku mimo filtrow',
    [30, 31, 33],
    regulyZadan.zWymuszonymi(przefiltrowane, zestawDwa, wymuszone).map((z) => z.id)
  );
  sprawdz(
    'pusty zbior wymuszonych nie zmienia wyniku',
    regulyZadan.zWymuszonymi(przefiltrowane, zestawDwa, new Set()) === przefiltrowane
  );
  sprawdzListe(
    'zadanie pasujace do filtrow NIE jest dublowane',
    [30],
    regulyZadan.zWymuszonymi(przefiltrowane, zestawDwa, new Set([30])).map((z) => z.id)
  );
  /*
    Wyjatek NIE ZMIENIA filtrow - to samo wywolanie filtrowane() musi dawac
    dalej ten sam wynik, inaczej wymuszenie zaczeloby po cichu poszerzac widok.
  */
  sprawdzListe(
    'wymuszenie nie zmienia samego filtrowania',
    [30],
    regulyZadan.filtrowane(zestawDwa, filtryObaWarunki).map((z) => z.id)
  );

  sprawdzListe(
    'dopiero zdjecie filtra stanu odslania zrobione',
    [30, 31, 32, 33],
    regulyZadan
      .filtrowane(zestawDwa, { ...filtryObaWarunki, terminDo: '', stany: new Set() })
      .map((z) => z.id)
  );

  sprawdzListe(
    'kazde pole filtra z osobna podbija licznik o 1',
    [1, 1, 1, 1, 1, 1, 1],
    [
      { ...pustyFiltrPelny(), nazwa: 'raport' },
      { ...pustyFiltrPelny(), stany: new Set(['Plan']) },
      { ...pustyFiltrPelny(), priorytety: new Set([2]) },
      { ...pustyFiltrPelny(), obszary: new Set(['Career']) },
      { ...pustyFiltrPelny(), projekty: new Set([1]) },
      { ...pustyFiltrPelny(), terminDo: '2026-08-23' },
      { ...pustyFiltrPelny(), od: '2026-08-01' },
    ].map(regulyZadan.ileAktywnych)
  );

  // Zakres dat to JEDNO pole filtra, mimo dwoch pol formularza (od i do).
  sprawdz(
    'od i do licza sie razem jako jeden filtr',
    regulyZadan.ileAktywnych({ ...pustyFiltrPelny(), od: '2026-08-01', do: '2026-08-31' }) === 1
  );

  sprawdz(
    'widok domyslny to dokladnie 2 aktywne filtry (stan + termin)',
    regulyZadan.ileAktywnych({
      ...pustyFiltrPelny(),
      stany: new Set(regulyZadan.domyslneStany(slownikiTestowe)),
      terminDo: regulyZadan.domyslnyTerminDo(DZIS_T),
    }) === 2
  );

  /*
    Tryb wykluczania NIE jest osobnym filtrem - odsiew i tak wynika z niepustego
    zbioru, wiec liczenie go drugi raz zawyzaloby znacznik.
  */
  sprawdz(
    'sam tryb wykluczania, bez zaznaczen, nie jest aktywnym filtrem',
    regulyZadan.ileAktywnych({ ...pustyFiltrPelny(), obszaryTryb: 'wyklucz' }) === 0
  );

  /*
    PELNY ZBIOR MIMO OGRANICZONEGO WIDOKU.

    Eksport CSV i backup czytaja dane niezaleznie od filtrow (eksport wola
    posortowane() bez argumentu, backup idzie prosto do bazy zapytaniem
    "SELECT * FROM zadania ORDER BY id"), a XP liczy serwer w routes/postac.js.
    Wspolnym warunkiem jest to, ze GET /api/zadania nie ogranicza niczego
    po stronie serwera - gdyby ktos "pomogl" wydajnosci, dodajac tam LIMIT
    albo domyslny filtr, ucielby jednoczesnie eksport, backup i XP.
  */
  const wszystkie = (await zapytaj('GET', '/api/zadania')).tresc;
  const zakonczone = wszystkie.filter((z) => z.stan === 'Zrobione');
  sprawdz(
    'GET /api/zadania zwraca takze zadania zakonczone (zrodlo eksportu i backupu)',
    zakonczone.length > 0,
    `zakonczonych: ${zakonczone.length} z ${wszystkie.length}`
  );

  /*
    Ta sama zasada wobec NOWEGO warunku widoku domyslnego: zadanie z odleglym
    terminem znika z tabeli, ale ma zostac w zbiorze, z ktorego licza sie eksport,
    kopia zapasowa i XP. Sprawdzamy to na jednym zestawie danych naraz, zeby
    porownanie bylo jednoznaczne, a nie na dwoch niezaleznych pomiarach.
  */
  const { tresc: odlegle } = await zapytaj('POST', '/api/zadania');
  await zapytaj('PATCH', `/api/zadania/${odlegle.id}`, {
    nazwa: 'Termin za rok',
    termin: '2099-01-01',
  });

  const dzisiajSerwera = (await zapytaj('GET', '/api/czas')).tresc.dzisiaj;
  const pelnyZbior = (await zapytaj('GET', '/api/zadania')).tresc;
  const widokDomyslny = regulyZadan.filtrowane(pelnyZbior, {
    ...filtryDomyslne,
    terminDo: regulyZadan.domyslnyTerminDo(dzisiajSerwera),
  });

  sprawdz(
    'zadanie z odleglym terminem znika z widoku domyslnego',
    !widokDomyslny.some((z) => z.id === odlegle.id)
  );
  sprawdz(
    'to samo zadanie JEST w pelnym zbiorze (eksport, backup, XP)',
    pelnyZbior.some((z) => z.id === odlegle.id),
    `widok: ${widokDomyslny.length}, pelny zbior: ${pelnyZbior.length}`
  );

  await zapytaj('DELETE', `/api/zadania/${odlegle.id}`);

  // XP musi rosnac od zadania ZAKONCZONEGO, czyli takiego, ktorego widok domyslny nie pokazuje.
  const przed = (await zapytaj('GET', '/api/postac')).tresc;
  const nowe = await zapytaj('POST', '/api/zadania', { nazwa: 'XP z ukrytego zadania' });
  await zapytaj('PATCH', `/api/zadania/${nowe.tresc.id}`, {
    stan: 'Zrobione',
    trudnosc: 3,
    czas_trwania_godziny: 2,
    czas_zakonczenia: dzienOGodzinie(0, '12:00'),
  });
  const po = (await zapytaj('GET', '/api/postac')).tresc;

  sprawdz(
    'XP liczy zadania ukryte w widoku domyslnym',
    po.calkowite_xp > przed.calkowite_xp,
    `przed: ${przed.calkowite_xp}, po: ${po.calkowite_xp}`
  );

  await zapytaj('DELETE', `/api/zadania/${nowe.tresc.id}`);
}

async function testujParserDat() {
  sekcja('PARSER DAT (lib/daty.js, w izolacji)');

  const { parsujDateTolerancyjnie } = require('../lib/daty');

  // --- formaty znane wczesniej: nie moga sie zepsuc po dolozeniu ukosnikow ---
  sprawdzListe(
    'formaty bez godziny daja wartosc CALODZIENNA (bez czesci T)',
    ['2026-08-13', '2026-08-08', '2026-08-13'],
    ['2026-08-13', 'August 8, 2026', '13.08.2026'].map(parsujDateTolerancyjnie)
  );

  // --- nowy format 1: sama data z ukosnikami (377x w kolumnie Do Date) ---
  sprawdz(
    'DD/MM/YYYY -> dzien jest pierwszy, nie miesiac',
    parsujDateTolerancyjnie('29/02/2024') === '2024-02-29'
  );
  sprawdz(
    'DD/MM/YYYY: dzien powyzej 12 nie jest czytany jako miesiac',
    parsujDateTolerancyjnie('19/10/2024') === '2024-10-19'
  );

  /*
    Nowy format 2: data z godzina i strefa (477x w Closing Date, 175x w Do Date).
    Strefe pomijamy, godzine ZACHOWUJEMY bez przeliczania - inaczej czesc wpisow
    przesunelaby sie na sasiedni dzien.
  */
  sprawdz(
    'DD/MM/YYYY HH:MM (GMT+X) -> godzina zachowana, strefa pominieta',
    parsujDateTolerancyjnie('02/03/2024 13:25 (GMT+1)') === '2024-03-02T13:25'
  );
  sprawdz(
    'godzina jednocyfrowa "9:00" -> "09:00"',
    parsujDateTolerancyjnie('24/08/2024 9:00 (GMT+2)') === '2024-08-24T09:00'
  );
  sprawdz(
    'GMT+2 czytane tak samo jak GMT+1 (bez przesuwania godziny)',
    parsujDateTolerancyjnie('28/05/2024 13:00 (GMT+2)') === '2024-05-28T13:00'
  );

  /*
    Zakres dat z Notion (strzalka U+2192): bierzemy date POCZATKOWA.
    Ciecie jest po samym znaku strzalki, wiec dziala dla obu wariantow -
    z godzinami i bez - niezaleznie od tego, ile takich zakresow bedzie dalej.
  */
  sprawdz(
    'zakres "data → data" -> data poczatkowa',
    parsujDateTolerancyjnie('19/10/2024 → 20/10/2024') === '2024-10-19'
  );
  sprawdz(
    'zakres z godzinami i strefami -> poczatek wraz z godzina',
    parsujDateTolerancyjnie('04/08/2024 14:00 (GMT+2) → 07/08/2024 13:00 (GMT+2)') ===
      '2024-08-04T14:00'
  );

  /*
    SPOJNOSC CALODZIENNOSCI: postac wyniku idzie za zrodlem.

    Plik podajacy sam dzien opisuje zadanie CALODZIENNE, a nie zaplanowane
    na polnoc - i tak wlasnie ma sie zapisac. Gdyby ktos przywrocil doklejanie
    'T00:00', kolumna renderowalaby pole daty z godzina dla kazdego zaimportowanego
    rekordu, mimo ze w zrodle godziny nie bylo.
  */
  sprawdzListe(
    'zrodlo bez godziny -> calodzienne, zrodlo z godzina -> z godzina',
    [false, false, false, true, true],
    [
      '29/02/2024',
      'August 8, 2026',
      '19/10/2024 → 20/10/2024',
      '02/03/2024 13:25 (GMT+1)',
      '04/08/2024 14:00 (GMT+2) → 07/08/2024 13:00 (GMT+2)',
    ].map((w) => parsujDateTolerancyjnie(w).includes('T'))
  );

  /*
    Godzina 00:00 PODANA WPROST w zrodle zostaje godzina. To nie jest to samo,
    co brak godziny - plik mowiacy "o polnocy" opisuje konkretna pore.
  */
  sprawdz(
    'jawna godzina 00:00 w zrodle zostaje godzina, nie staje sie calodzienna',
    parsujDateTolerancyjnie('02/03/2024 00:00 (GMT+1)') === '2024-03-02T00:00'
  );

  /*
    Dziennik NIE korzysta z tego parsera - ma wlasna parsujDateWpisu dla formatu
    "@March 2, 2024", ktora od zawsze zwracala sama date. Ta asercja pilnuje, ze
    zmiana w parserze zadan nie przeciekla do dziennika przez wspolny modul.
  */
  const mapDziennika = require('../config/mapowanie-dziennika');
  sprawdz(
    'dziennik ma wlasny parser daty i zwraca sama date',
    mapDziennika.parsujDateWpisu('@March 2, 2024') === '2024-03-02',
    mapDziennika.parsujDateWpisu('@March 2, 2024')
  );
  sprawdz(
    'kolumna daty dziennika idzie przez TRANSFORMACJE, nie przez pola datowe',
    mapDziennika.TRANSFORMACJE.data === mapDziennika.parsujDateWpisu
  );
  /*
    Higiena listy kolumn ignorowanych dziennika - 52 pozycje utrzymywane recznie.
    Testu 'czy pokrywa caly plik' tu nie ma i byc nie moze: prawdziwy eksport lezy
    w gitignorowanym _test/. Sprawdzamy to, co da sie sprawdzic bez pliku.
  */
  const ignDziennika = mapDziennika.KOLUMNY_IGNOROWANE;
  sprawdz(
    'lista kolumn ignorowanych dziennika bez powtorzen',
    new Set(ignDziennika).size === ignDziennika.length,
    JSON.stringify(ignDziennika.filter((n, i) => ignDziennika.indexOf(n) !== i))
  );
  const kolizjeDziennika = ignDziennika.filter((n) => n in mapDziennika.MAPOWANIE_KOLUMN);
  sprawdz(
    'kolumna ignorowana dziennika nie jest jednoczesnie mapowana',
    kolizjeDziennika.length === 0,
    JSON.stringify(kolizjeDziennika)
  );

  // --- wartosci bledne nadal odrzucane: tolerancja nie moze znaczyc "cokolwiek" ---
  sprawdz('31/02/2024 to nieistniejacy dzien -> null', parsujDateTolerancyjnie('31/02/2024') === null);
  sprawdz(
    'godzina 25:00 -> null',
    parsujDateTolerancyjnie('02/03/2024 25:00 (GMT+1)') === null
  );
  sprawdz('tekst bez daty -> null', parsujDateTolerancyjnie('kiedys w przyszlosci') === null);
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
  /*
    Przecinek w nazwie projektu. Wczesniej Upstream byl ciety po przecinku i te dwie
    nazwy rozpadaly sie na kawalki ("Stan" / " ale trudniejszy"), przez co zadania
    nie dopinaly sie do projektu. Oba przypadki pochodza z prawdziwego eksportu.
  */
  sprawdz(
    'przecinek w nazwie projektu nie rozrywa Upstream',
    questLog.parsujUpstream(
      'Stan, ale trudniejszy  (https://app.notion.com/p/Stan-ale-trudniejszy-4f5c?pvs=21)'
    ) === 'Stan, ale trudniejszy'
  );
  sprawdz(
    'dwukropek i przecinki w dlugiej nazwie kursu',
    questLog.parsujUpstream(
      'The Ultimate React Course 2024: React, Next.js, Redux & More (https://app.notion.com/p/x?pvs=21)'
    ) === 'The Ultimate React Course 2024: React, Next.js, Redux & More'
  );
  /*
    Nawias obcinamy tylko na koncu wartosci - nazwa projektu sama moze zawierac
    nawiasy i te musza przetrwac.
  */
  sprawdz(
    'nawias wewnatrz nazwy zostaje, koncowy link znika',
    questLog.parsujUpstream('Projekt (etap 2) (https://x/1)') === 'Projekt (etap 2)'
  );

  /*
    Higiena listy kolumn ignorowanych - 46 pozycji utrzymywanych recznie.
    Testu "czy pokrywa caly plik" tu NIE MA i byc nie moze: prawdziwy eksport lezy
    w _test/, ktore jest poza repozytorium. Sprawdzamy to, co da sie sprawdzic bez
    pliku - ze lista nie ma powtorzen i nie zachodzi na mapowanie.
  */
  const ignorowane = questLog.KOLUMNY_IGNOROWANE;
  sprawdz(
    'lista kolumn ignorowanych bez powtorzen',
    new Set(ignorowane).size === ignorowane.length,
    JSON.stringify(ignorowane.filter((n, i) => ignorowane.indexOf(n) !== i))
  );
  const kolizje = ignorowane.filter(
    (n) => n in questLog.ZADANIA.mapowanie || n in questLog.PROJEKTY.mapowanie
  );
  sprawdz('kolumna ignorowana nie jest jednoczesnie mapowana', kolizje.length === 0, JSON.stringify(kolizje));

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
    plytki.termin === '2026-03-10' && plytki.start_zadania === null,
    JSON.stringify({ termin: plytki.termin, start: plytki.start_zadania })
  );
  sprawdz('Closing Date -> czas_zakonczenia', plytki.czas_zakonczenia === '2026-03-05');

  const nadpisany = zadania.find((z) => z.nazwa === 'Z nadpisanym terminem');
  sprawdz(
    'Due Date (Optional) NADPISUJE termin z Do Date',
    nadpisany.termin === '2026-06-15',
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

/*
  DEDUPLIKACJA IMPORTU DZIENNIKA po dacie.

  Import byl wylacznie dopisujacy, wiec powtorne wczytanie nakladajacego sie okresu
  duplikowalo wpisy - a XP liczy sie z kazdego wpisu osobno, wiec razem z duplikatami
  podwajalo sie tez punkty. To ostatnie jest najwazniejsze do przypilnowania, bo
  psuje dane wyliczane, nie tylko widok.
*/
async function testujDeduplikacjeDziennika() {
  sekcja('DEDUPLIKACJA IMPORTU DZIENNIKA');

  const naglowek =
    'Name,🙌 Reported Wake Up Time,💤 # of hours sleep,⭐ Sleep Quality,🙏 Grateful For,🍽 Breakfast';
  const plik = (wiersze) => [naglowek, ...wiersze].join('\r\n');

  const DATA = '@June 3, 2026';
  const pelny = plik([`"${DATA}",03/06/2026 6:15 (GMT+2),7,4 - A,Spokoj,Owsianka`]);

  const ileWpisow = async () => (await zapytaj('GET', '/api/dziennik')).tresc.length;
  const wpisZDaty = async (d) =>
    (await zapytaj('GET', '/api/dziennik')).tresc.find((w) => w.data === d);

  const przed = await ileWpisow();
  const xpPrzed = (await zapytaj('GET', '/api/postac')).tresc.rozbicie.dziennik;

  // --- pierwszy import: wpis jest nowy ---
  const podglad1 = await zapytaj('POST', '/api/import/dziennik/podglad', { tresc: pelny });
  sprawdzListe(
    'podglad pierwszego importu: 1 nowy, 0 do aktualizacji',
    [1, 0],
    [podglad1.tresc.dziennik.nowych, podglad1.tresc.dziennik.doAktualizacji]
  );

  const zapis1 = await zapytaj('POST', '/api/import/dziennik/zatwierdz', { tresc: pelny });
  sprawdzListe(
    'pierwszy zapis: 1 dodany, 0 zaktualizowanych',
    [1, 0],
    [zapis1.tresc.dziennik.nowych, zapis1.tresc.dziennik.zaktualizowanych]
  );
  sprawdz('liczba wpisow wzrosla o 1', (await ileWpisow()) === przed + 1);

  // Punkt odniesienia dla XP: stan PO pierwszym imporcie, czyli z jednym wpisem.
  const xpPoPierwszym = (await zapytaj('GET', '/api/postac')).tresc.rozbicie.dziennik;
  sprawdz(
    'nowy wpis w ogole dolozyl XP (inaczej test ponizej nic nie dowodzi)',
    xpPoPierwszym > xpPrzed,
    `przed: ${xpPrzed}, po pierwszym imporcie: ${xpPoPierwszym}`
  );

  /*
    --- POWTORNY import TEGO SAMEGO pliku ---
    Sedno zmiany: nie moze powstac drugi wpis o tej samej dacie.
  */
  const podglad2 = await zapytaj('POST', '/api/import/dziennik/podglad', { tresc: pelny });
  sprawdzListe(
    'podglad powtorki: 0 nowych, 1 do aktualizacji, 0 pol do zmiany',
    [0, 1, 0],
    [
      podglad2.tresc.dziennik.nowych,
      podglad2.tresc.dziennik.doAktualizacji,
      podglad2.tresc.dziennik.polZmieni,
    ]
  );

  await zapytaj('POST', '/api/import/dziennik/zatwierdz', { tresc: pelny });
  const poPowtorce = await ileWpisow();
  sprawdz(
    'powtorny import NIE zwieksza liczby wpisow',
    poPowtorce === przed + 1,
    `oczekiwano ${przed + 1}, jest ${poPowtorce}`
  );

  const xpPoPowtorce = (await zapytaj('GET', '/api/postac')).tresc.rozbicie.dziennik;
  sprawdz(
    'XP z dziennika NIE rosnie po powtornym imporcie',
    xpPoPowtorce === xpPoPierwszym,
    `po pierwszym: ${xpPoPierwszym}, po powtorce: ${xpPoPowtorce}`
  );

  // --- reczny dopisek po imporcie nie moze zostac skasowany pustym polem ---
  const wpis = await wpisZDaty('2026-06-03');
  await zapytaj('PATCH', `/api/dziennik/${wpis.id}`, {
    bledy: 'dopisane recznie po eksporcie',
    obiad: 'zupa',
  });

  // Ten sam dzien, ale plik ma TYLKO date - wszystkie inne kolumny puste.
  const pusty = plik([`"${DATA}",,,,,`]);
  const podglad3 = await zapytaj('POST', '/api/import/dziennik/podglad', { tresc: pusty });
  sprawdz(
    'plik z samymi pustymi polami nie zapowiada zadnej zmiany',
    podglad3.tresc.dziennik.polZmieni === 0,
    JSON.stringify(podglad3.tresc.dziennik)
  );

  await zapytaj('POST', '/api/import/dziennik/zatwierdz', { tresc: pusty });
  const poPustym = await wpisZDaty('2026-06-03');
  sprawdzListe(
    'puste pola w pliku NIE kasuja danych zapisanych w aplikacji',
    ['dopisane recznie po eksporcie', 'zupa', 'Spokoj', '06:15'],
    [poPustym.bledy, poPustym.obiad, poPustym.wdziecznosc, poPustym.pobudka]
  );

  // --- plik ze ZMIENIONA wartoscia faktycznie nadpisuje ---
  const zmieniony = plik([`"${DATA}",03/06/2026 5:00 (GMT+2),9,4 - A,Spokoj,Owsianka`]);
  const podglad4 = await zapytaj('POST', '/api/import/dziennik/podglad', { tresc: zmieniony });
  sprawdz(
    'podglad liczy TYLKO pola, ktore naprawde sie roznia',
    podglad4.tresc.dziennik.polZmieni === 2,
    JSON.stringify(podglad4.tresc.dziennik)
  );

  const zapis4 = await zapytaj('POST', '/api/import/dziennik/zatwierdz', { tresc: zmieniony });
  sprawdz(
    'zapis raportuje te sama liczbe zmienionych pol co podglad',
    zapis4.tresc.dziennik.zmienionychPol === 2,
    JSON.stringify(zapis4.tresc.dziennik)
  );

  const poZmianie = await wpisZDaty('2026-06-03');
  sprawdzListe(
    'nadpisane wartosci z pliku, reczny dopisek nietkniety',
    ['05:00', 9, 'dopisane recznie po eksporcie'],
    [poZmianie.pobudka, poZmianie.godziny_snu, poZmianie.bledy]
  );

  await zapytaj('DELETE', `/api/dziennik/${poZmianie.id}`);
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
    await testujMotyw(reguly);
    await testujZasadyXp();
    await testujFormatKopii();
    await testujPlakietkiZadan();
    await testujAtrybuty();
    await testujKolejnoscKolumnDziennika();
    await testujDatyCalodzienne(reguly);
    await testujDuplikowanie();
    await testujDomyslneOgraniczenie(reguly);
    await testujParserDat();
    await testujQuestLog();
    await testujNawyki();
    await testujDeduplikacjeDziennika();
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
