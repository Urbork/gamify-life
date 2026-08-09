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

/** Data przesunieta o n dni wzgledem dzisiaj, jako znacznik 'YYYY-MM-DDT00:00'. */
function dzien(n) {
  return new Date((numerDnia(DZIS) + n) * MS_W_DNIU).toISOString().slice(0, 10) + 'T00:00';
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
  { nazwa: 'E zrobione dzis', stan: 'Zrobione', priorytet: 2, termin: dzien(0), start_zadania: '' },
  { nazwa: 'F bez zadnych dat', stan: 'Plan', priorytet: 0, start_zadania: '' },
  // Para godzin przez polnoc: 23:59 -> 00:01 to niecale 25 godzin, ale DWA dni kalendarzowe.
  {
    nazwa: 'G trwanie przez polnoc',
    stan: 'Plan',
    priorytet: 2,
    start_zadania: '2026-08-10T23:59',
    czas_zakonczenia: '2026-08-12T00:01',
    termin: '',
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
    klienci: new Set(),
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
  sprawdz(
    'Czas trwania: 23:59 -> 00:01 to 2 dni kalendarzowe (godzina ignorowana)',
    reguly.regulyZadan.czasTrwania(znajdz('G trwanie przez polnoc')) === 2,
    `otrzymano ${reguly.regulyZadan.czasTrwania(znajdz('G trwanie przez polnoc'))}`
  );
  sprawdz(
    'Czas trwania: brak daty konca -> null',
    reguly.regulyZadan.czasTrwania(znajdz('A termin dzis')) === null
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
    'klient_kategoria',
    'start_zadania',
    'termin',
    'dni_do_terminu',
    'czas_zakonczenia',
    'czas_trwania',
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
    'suma zadan wg klienta = liczba wszystkich (z pozycja "(brak)")',
    sz.wgKlienta.reduce((a, s) => a + s.ile, 0) === ZADANIA.length
  );

  /*
    W zestawie testowym tylko zadanie G ma start i koniec (10.08 -> 12.08 = 2 dni).
    Srednia liczy sie ta sama funkcja co kolumna w tabeli.
  */
  sprawdz(
    'sredni czas trwania liczony tylko z zadan majacych obie daty',
    sz.czasTrwania.ile === 1 && sz.czasTrwania.srednia === 2,
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
