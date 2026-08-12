/*
  Czyste obliczenia statystyk - zero odwolan do DOM.

  Ten sam wzorzec co reguly-zadan.js i reguly-dziennika.js: plik laduje sie
  normalnym <script> w przegladarce, a smoke test wczytuje go w sandboksie (vm),
  wiec testy sprawdzaja dokladnie ten kod, ktory liczy liczby na ekranie.

  ZASADA: kazda funkcja dostaje dane argumentem i niczego nie pamieta.
  Strona przelicza wszystko przy kazdym wejsciu - dane zrodlowe sa jedyna prawda.
*/

const regulyStatystyk = (() => {
  'use strict';

  const { numerDnia } = filtrDat;

  // ==========================================================================
  // Pomocnicze
  // ==========================================================================

  /**
   * Czy pole jest wypelnione? Pusty tekst liczy sie jako BRAK.
   * To istotne przy polach tekstowych: edycja inline potrafi zostawic '',
   * ktore w bazie nie jest NULL-em, a znaczy dokladnie to samo co brak wpisu.
   */
  function wypelnione(w) {
    return w !== null && w !== undefined && String(w).trim() !== '';
  }

  /**
   * Srednia z wartosci liczbowych, z POMINIECIEM brakow.
   * Zwraca takze `ile` - liczbe rekordow, na ktorych srednia sie opiera.
   * Bez tego "srednia 3,4" nie mowi, czy policzona z 20 czy z 800 wpisow.
   */
  function srednia(lista, pole) {
    const wartosci = lista.map((x) => x[pole]).filter((v) => typeof v === 'number');
    if (wartosci.length === 0) return { srednia: null, ile: 0, min: null, max: null };

    const suma = wartosci.reduce((a, b) => a + b, 0);
    return {
      srednia: suma / wartosci.length,
      ile: wartosci.length,
      min: Math.min(...wartosci),
      max: Math.max(...wartosci),
    };
  }

  /** Rozklad wartosci: [{ wartosc, ile }] posortowany rosnaco po wartosci. */
  function rozklad(lista, pole) {
    const licznik = new Map();
    for (const x of lista) {
      const v = x[pole];
      if (typeof v !== 'number') continue;
      licznik.set(v, (licznik.get(v) || 0) + 1);
    }
    return [...licznik.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([wartosc, ile]) => ({ wartosc, ile }));
  }

  /** Zliczanie wystapien wartosci tekstowej. Brak wartosci trafia pod podana etykiete. */
  function zliczWedlug(lista, pole, etykietaBraku) {
    const licznik = new Map();
    for (const x of lista) {
      const klucz = wypelnione(x[pole]) ? x[pole] : etykietaBraku;
      licznik.set(klucz, (licznik.get(klucz) || 0) + 1);
    }
    return [...licznik.entries()].map(([klucz, ile]) => ({ klucz, ile }));
  }

  // ==========================================================================
  // Zadania
  // ==========================================================================

  /*
    Odsetek zadan zakonczonych PO TERMINIE.

    MIANOWNIK: zadania majace WYPELNIONE OBA pola - termin i czas_zakonczenia.
    Celowo BEZ filtrowania po `stan`: o tym, czy zadanie zostalo zakonczone,
    swiadczy tu wypelniona data zakonczenia, a nie etykieta stanu.

    LICZNIK: te, w ktorych czas_zakonczenia wypada PO terminie.

    Porownanie na PELNYCH DNIACH KALENDARZOWYCH, spojnie z reszta aplikacji:
    zakonczenie o 23:00 w dniu terminu jest NA CZAS, a nie po terminie.

    Zwracamy komplet (ile, zBadanych, procent), zeby interfejs mogl pokazac
    "X z Y", a nie goly procent - przy trzech zadaniach "33%" wprowadza w blad.
    Przy zBadanych = 0 procent jest null, nie NaN.
  */
  function poTerminie(zadania) {
    const zBadanych = zadania.filter((z) => wypelnione(z.termin) && wypelnione(z.czas_zakonczenia));

    const spoznione = zBadanych.filter(
      (z) => numerDnia(z.czas_zakonczenia) > numerDnia(z.termin)
    );

    return {
      ile: spoznione.length,
      zBadanych: zBadanych.length,
      procent: zBadanych.length === 0 ? null : (100 * spoznione.length) / zBadanych.length,
    };
  }

  /**
   * Sredni czas trwania zadan w GODZINACH.
   *
   * Liczy z RECZNIE wpisanego pola `czas_trwania_godziny`, ktore zastapilo dawna
   * kolumne wyliczana z roznicy dat. Zmiana jednostki jest zamierzona: roznica dat
   * mowila, ile dni zadanie bylo otwarte, a nie ile zajelo pracy.
   *
   * Skutek uboczny do zapamietania: srednia obejmuje wylacznie zadania, w ktorych
   * to pole wypelniono. Historycznych zadan nie da sie z niego odtworzyc.
   */
  function sredniCzasTrwania(zadania) {
    const trwania = zadania
      .map((z) => z.czas_trwania_godziny)
      .filter((v) => typeof v === 'number' && Number.isFinite(v));

    if (trwania.length === 0) return { srednia: null, ile: 0 };
    return { srednia: trwania.reduce((a, b) => a + b, 0) / trwania.length, ile: trwania.length };
  }

  /** Komplet statystyk zadan. */
  function statystykiZadan(zadania, slowniki) {
    // Kolejnosc stanow ze slownika, nie alfabetyczna - zeby czytalo sie jak przeplyw pracy.
    const wgStanu = slowniki.stany.map((stan) => ({
      klucz: stan,
      ile: zadania.filter((z) => z.stan === stan).length,
    }));

    // Stany spoza slownika (np. po recznej zmianie danych) tez trzeba pokazac,
    // inaczej suma nie zgadzalaby sie z liczba wszystkich zadan.
    const znane = new Set(slowniki.stany);
    for (const { klucz, ile } of zliczWedlug(zadania, 'stan', '(brak)')) {
      if (!znane.has(klucz)) wgStanu.push({ klucz, ile });
    }

    const wgObszaru = zliczWedlug(zadania, 'obszar', '(brak)').sort(
      (a, b) => b.ile - a.ile || a.klucz.localeCompare(b.klucz, 'pl')
    );

    return {
      lacznie: zadania.length,
      wgStanu,
      wgObszaru,
      czasTrwania: sredniCzasTrwania(zadania),
      poTerminie: poTerminie(zadania),
    };
  }

  // ==========================================================================
  // Dziennik
  // ==========================================================================

  // Pola uznawane za "refleksyjne" w tabeli miesiecznej.
  const POLA_REFLEKSYJNE = [
    'wdziecznosc',
    'bledy',
    'rozmowa',
    'co_poszlo_dobrze',
    'jutro_wazne',
    'do_przemyslenia',
  ];

  /** Czy wpis ma wypelnione CHOC JEDNO pole refleksyjne? */
  function maRefleksje(w) {
    return POLA_REFLEKSYJNE.some((pole) => wypelnione(w[pole]));
  }

  /*
    Tabela miesieczna: dla kazdego miesiaca OBECNEGO W DANYCH liczba wpisow
    i odsetek tych z refleksja.

    Klucz to 'YYYY-MM' wyciete z daty - format ma stala szerokosc, wiec sortowanie
    tekstowe jest zarazem chronologiczne. Sortujemy ROSNACO, bo tak czyta sie trend.

    Miesiace bez ani jednego wpisu po prostu sie nie pojawiaja - nie zmyslamy
    wierszy z zerami dla okresow, w ktorych dziennika nie prowadzono.
  */
  function wedlugMiesiecy(wpisy) {
    const miesiace = new Map();

    for (const w of wpisy) {
      if (!wypelnione(w.data)) continue;
      const klucz = String(w.data).slice(0, 7);

      if (!miesiace.has(klucz)) miesiace.set(klucz, { miesiac: klucz, wpisow: 0, zRefleksja: 0 });
      const m = miesiace.get(klucz);
      m.wpisow++;
      if (maRefleksje(w)) m.zRefleksja++;
    }

    return [...miesiace.values()]
      .sort((a, b) => (a.miesiac < b.miesiac ? -1 : 1))
      .map((m) => ({ ...m, procent: (100 * m.zRefleksja) / m.wpisow }));
  }

  /** Komplet statystyk dziennika. */
  function statystykiDziennika(wpisy) {
    const daty = wpisy
      .map((w) => w.data)
      .filter(wypelnione)
      .sort();

    const sen = srednia(wpisy, 'godziny_snu');

    return {
      lacznie: wpisy.length,
      odDaty: daty[0] ?? null,
      doDaty: daty[daty.length - 1] ?? null,

      sen: {
        ...sen,
        // Odsetek wpisow z wypelnionym polem - srednia bez tego nie mowi calej prawdy.
        procentWypelnienia: wpisy.length === 0 ? null : (100 * sen.ile) / wpisy.length,
      },

      oceny: ['jakosc_snu', 'stres', 'nastroj', 'intencjonalnosc'].map((pole) => ({
        pole,
        ...srednia(wpisy, pole),
        rozklad: rozklad(wpisy, pole),
        procentWypelnienia: wpisy.length === 0 ? null : (100 * srednia(wpisy, pole).ile) / wpisy.length,
      })),

      miesiace: wedlugMiesiecy(wpisy),
    };
  }

  return {
    wypelnione,
    srednia,
    rozklad,
    zliczWedlug,
    poTerminie,
    sredniCzasTrwania,
    statystykiZadan,
    maRefleksje,
    wedlugMiesiecy,
    statystykiDziennika,
    POLA_REFLEKSYJNE,
  };
})();
