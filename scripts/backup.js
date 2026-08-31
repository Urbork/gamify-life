/*
  Codzienna kopia zapasowa obu modulow do plikow CSV.

  URUCHOMIENIE:  npm run backup

  Zapisuje backups/zadania-RRRR-MM-DD.csv i backups/dziennik-RRRR-MM-DD.csv,
  po czym kasuje kopie starsze niz 30 dni.

  DLACZEGO CSV, A NIE KOPIA PLIKU BAZY
  Plik .db jest kopia doskonala, ale czytelna wylacznie dla tej aplikacji.
  CSV otworzysz w arkuszu za piec lat, nawet gdyby projekt dawno nie dzialal.
  (Na kopie 1:1 zawsze zostaje VACUUM INTO opisane w README.)

  DLACZEGO NIE URUCHAMIAMY SERWERA
  Skrypt czyta baze bezposrednio, wiec dziala takze wtedy, gdy aplikacja jest
  wylaczona - a o to chodzi w zadaniu uruchamianym z Harmonogramu zadan.

  DLACZEGO CSV POWSTAJE PRZEZ public/js/csv.js
  Zeby nie istniala druga implementacja escapowania. Plik przegladarkowy ladujemy
  w sandboksie (vm) i wolamy z niego czysta funkcje zbuduj() - dokladnie ta sama,
  ktora tworzy plik przy eksporcie z przegladarki. Ta sama technika co w test/smoke.js.
*/

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const db = require('../db');

const KATALOG_PROJEKTU = path.join(__dirname, '..');
const KATALOG_KOPII = path.join(KATALOG_PROJEKTU, 'backups');
const DNI_RETENCJI = 30;

// --- narzedzia ------------------------------------------------------------

/** Laduje pliki przegladarkowe w jednym sandboksie i zwraca ich globalne stale. */
function zaladujModulyPrzegladarki() {
  const sandbox = { console };
  vm.createContext(sandbox);

  for (const plik of ['csv.js', 'filtr-dat.js', 'reguly-zadan.js']) {
    const kod = fs.readFileSync(path.join(KATALOG_PROJEKTU, 'public', 'js', plik), 'utf8');
    vm.runInContext(kod, sandbox, { filename: plik });
  }

  // Top-level `const` nie staje sie wlasciwoscia sandboksu - wyciagamy wyrazeniem.
  return vm.runInContext('({ csv, filtrDat, regulyZadan })', sandbox);
}

/** Dzisiejsza data 'YYYY-MM-DD' wedlug czasu lokalnego. */
function dzisiaj() {
  const t = new Date();
  const dwie = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${dwie(t.getMonth() + 1)}-${dwie(t.getDate())}`;
}

function zapisz(nazwaPliku, naglowki, wiersze, csv) {
  const sciezka = path.join(KATALOG_KOPII, nazwaPliku);
  // BOM tak jak przy eksporcie z przegladarki - bez niego Excel psuje polskie znaki.
  fs.writeFileSync(sciezka, '\uFEFF' + csv.zbuduj(naglowki, wiersze), 'utf8');
  const rozmiar = (fs.statSync(sciezka).size / 1024).toFixed(1);
  console.log(`  zapisano  ${nazwaPliku}  (${wiersze.length} wierszy, ${rozmiar} kB)`);
}

// --- eksporty -------------------------------------------------------------

/*
  Kolumny i ich kolejnosc sa takie same jak przy eksporcie z przegladarki,
  zeby oba pliki dalo sie porownywac i wczytywac tym samym narzedziem.
*/

function kopiaZadan(moduly, data) {
  /*
    NAGLOWKI MUSZA ODPOWIADAC PROFILOWI IMPORTU (config/mapowanie-importu.js).

    Wczesniej byly to nazwy kolumn bazy ('stan', 'nazwa'), przez co wlasnej kopii
    NIE DALO SIE wczytac z powrotem - import odrzucal plik bledem
    'W pliku brakuje kolumn: Nazwa zadania, Stan'. Kopia, ktorej nie da sie odtworzyc,
    nie jest kopia zapasowa.
  */
  const naglowki = [
    'Nazwa zadania',
    'Stan',
    'Priorytet',
    'Priorytet (opis)',
    'Trudność',
    'Czas trwania (h)',
    'Obszar',
    'Projekt',
    'Start zadania',
    'Termin',
    'Dni do terminu',
    'Czas zakończenia',
  ];

  const { PRIORYTETY } = require('../config/slowniki');
  const etykieta = (numer) => {
    const p = PRIORYTETY.find((x) => x.numer === numer);
    return p ? p.etykieta : `(${numer})`;
  };

  const lista = db.prepare('SELECT * FROM zadania ORDER BY id').all();

  /*
    Projekt zapisujemy NAZWA, nie id. Id sa lokalne dla tej bazy i po odtworzeniu
    do pustej tabeli byly by inne; nazwa jest tym, co ma znaczenie dla czlowieka.
  */
  const nazwyProjektow = new Map(
    db.prepare('SELECT id, nazwa FROM projekty').all().map((x) => [x.id, x.nazwa])
  );

  const wiersze = lista.map((z) => [
    z.nazwa,
    z.stan,
    z.priorytet,
    etykieta(z.priorytet),
    z.trudnosc,
    z.czas_trwania_godziny,
    z.obszar,
    z.projekt_id === null ? null : nazwyProjektow.get(z.projekt_id) || null,
    z.start_zadania,
    z.termin,
    // Kolumna wyliczana to MIGAWKA na dzien wykonania kopii - "dni do terminu"
    // liczy sie wzgledem dzisiaj, wiec jutro ten sam rekord da inna liczbe.
    moduly.regulyZadan.dniDoTerminu(z, data),
    z.czas_zakonczenia,
  ]);

  zapisz(`zadania-${data}.csv`, naglowki, wiersze, moduly.csv);
}

function kopiaDziennika(moduly, data) {
  const naglowki = [
    'data',
    'pobudka',
    'godziny_snu',
    'jakosc_snu',
    'stres',
    'nastroj',
    'intencjonalnosc',
    'trzy_slowa',
    'nawyki',
    'wdziecznosc',
    'bledy',
    'rozmowa',
    'co_poszlo_dobrze',
    'jutro_wazne',
    'do_przemyslenia',
    'sniadanie',
    'obiad',
    'kolacja',
  ];

  const lista = db.prepare('SELECT * FROM dziennik ORDER BY data, id').all();
  const wiersze = lista.map((w) => naglowki.map((pole) => w[pole]));

  zapisz(`dziennik-${data}.csv`, naglowki, wiersze, moduly.csv);
}

// --- rotacja --------------------------------------------------------------

/*
  Retencja liczona z DATY W NAZWIE PLIKU, a nie z czasu modyfikacji.
  Skopiowanie albo przeniesienie folderu kopii odswieza znaczniki czasu
  i przy retencji po mtime kasowaloby zle pliki (albo nie kasowalo wcale).
*/
// Wzorzec daty w nazwie pliku kopii, wspolny dla wszystkich rodzajow.
const DATA = '\d{4}-\d{2}-\d{2}';

/*
  MIGAWKA CALEJ BAZY - to jest wlasciwa droga ODTWARZANIA.

  Pliki CSV sa czytelne dla czlowieka i dobre do przegladania danych poza aplikacja,
  ale NIE odtworza wiernie tej bazy: nie niosa identyfikatorow, wiec relacja
  zadanie-projekt musialaby byc odtwarzana po nazwach, a kazda tabela
  potrzebowalaby wlasnego profilu importu.

  VACUUM INTO daje spojna kopie WSZYSTKICH tabel z relacjami, jednym poleceniem
  i bez zadnej konwersji. Przy bazie rzedu polmegabajta 30 takich migawek to
  kilkanascie megabajtow - cena bez znaczenia wobec tego, co chronia.

  VACUUM INTO nie nadpisuje istniejacego pliku, wiec przy powtornym uruchomieniu
  tego samego dnia usuwamy poprzedni - inaczej skrypt konczylby sie bledem.
*/
function migawkaBazy(data) {
  const plik = path.join(KATALOG_KOPII, `baza-${data}.db`);
  fs.rmSync(plik, { force: true });

  // Sciezka trafia do SQL-a, wiec zamieniamy ukosniki i podwajamy apostrofy.
  const bezpieczna = plik.split(path.sep).join('/').split("'").join("''");
  db.exec(`VACUUM INTO '${bezpieczna}'`);

  const rozmiar = fs.statSync(plik).size;
  console.log(`  zapisano  baza-${data}.db  (${(rozmiar / 1024).toFixed(1)} kB, wszystkie tabele)`);
}

/*
  Pozostale tabele w CSV. Wczesniej kopia obejmowala TYLKO zadania i dziennik,
  a baza ma piec tabel - projekty, zakupy i slownik nawykow nie byly zapisywane
  nigdzie. Zakupy sa o tyle istotne, ze to JEDYNY trwaly stan systemu nagrod:
  XP liczy sie na nowo, ale wydana waluta juz nie.
*/
function kopiaProstychTabel(moduly, data) {
  const tabele = [
    {
      nazwa: 'projekty',
      naglowki: ['Nazwa', 'Status', 'Opis'],
      sql: 'SELECT * FROM projekty ORDER BY id',
      wiersz: (r) => [r.nazwa, r.status, r.opis],
    },
    {
      nazwa: 'zakupy',
      naglowki: ['Nazwa', 'Koszt', 'Data'],
      sql: 'SELECT * FROM zakupy ORDER BY id',
      wiersz: (r) => [r.nazwa, r.koszt, r.data],
    },
    {
      nazwa: 'nawyki',
      naglowki: ['Nazwa'],
      sql: 'SELECT * FROM nawyki_slownik ORDER BY id',
      wiersz: (r) => [r.nazwa],
    },
  ];

  for (const t of tabele) {
    const lista = db.prepare(t.sql).all();
    zapisz(`${t.nazwa}-${data}.csv`, t.naglowki, lista.map(t.wiersz), moduly.csv);
  }
}

function rotacja(dzisiajISO) {
  // Obejmuje takze migawke .db i nowe tabele - inaczej katalog rosnie w nieskonczonosc.
  const wzorzec = new RegExp(
    '^(zadania|dziennik|projekty|zakupy|nawyki)-(' + DATA + ')\\.csv$|^baza-(' + DATA + ')\\.db$'
  );
  const granica = new Date(dzisiajISO + 'T00:00:00Z').getTime() - DNI_RETENCJI * 86400000;

  let usuniete = 0;
  for (const nazwa of fs.readdirSync(KATALOG_KOPII)) {
    const m = wzorzec.exec(nazwa);
    if (!m) continue; // nie nasz plik - nie ruszamy

    const czas = new Date((m[2] || m[3]) + 'T00:00:00Z').getTime();
    if (Number.isNaN(czas) || czas >= granica) continue;

    fs.rmSync(path.join(KATALOG_KOPII, nazwa), { force: true });
    usuniete++;
  }

  console.log(
    usuniete > 0
      ? `  rotacja   usunieto ${usuniete} kopii starszych niz ${DNI_RETENCJI} dni`
      : `  rotacja   nic do usuniecia (retencja ${DNI_RETENCJI} dni)`
  );
}

// --- przebieg -------------------------------------------------------------

function main() {
  fs.mkdirSync(KATALOG_KOPII, { recursive: true });

  const data = dzisiaj();
  const moduly = zaladujModulyPrzegladarki();

  console.log(`Kopia zapasowa ${data} -> ${KATALOG_KOPII}`);
  kopiaZadan(moduly, data);
  kopiaDziennika(moduly, data);
  kopiaProstychTabel(moduly, data);
  migawkaBazy(data);
  rotacja(data);
  console.log('Gotowe.');
}

main();
