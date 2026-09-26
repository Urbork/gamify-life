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

  // ==========================================================================
  // Konsekwencja
  // ==========================================================================

  const MS_W_DNIU = 86400000;

  /** 'YYYY-MM-DD' -> numer dnia. Ta sama zasada co numerDnia w filtr-dat.js. */
  function numerDniaISO(data) {
    if (!wypelnione(data)) return null;
    const czesci = String(data).slice(0, 10).split('-').map(Number);
    if (czesci.length !== 3 || czesci.some(Number.isNaN)) return null;
    return Date.UTC(czesci[0], czesci[1] - 1, czesci[2]) / MS_W_DNIU;
  }

  /*
    Serie dni z wpisem.

    "Obecna" seria liczy sie od OSTATNIEGO wpisu wstecz, a nie od dzisiaj. Gdyby
    liczyla od dzisiaj, wejscie na strone nazajutrz po przerwie pokazywaloby zero
    i kasowalo informacje o tym, ile dni z rzedu bylo przed przerwa. Osobne pole
    `doDnia` mowi, kiedy ta seria sie konczy - to wystarczy, zeby ocenic, czy trwa.

    Dni bez wpisu po prostu nie istnieja w danych, wiec ciaglosc sprawdzamy
    po numerze dnia, a nie po liczbie rekordow.
  */
  function serieDni(wpisy) {
    const dni = [...new Set(wpisy.map((w) => numerDniaISO(w.data)).filter((n) => n !== null))].sort(
      (a, b) => a - b
    );

    if (dni.length === 0) {
      return { najdluzsza: 0, obecna: 0, odDnia: null, doDnia: null, ostatniDzien: null };
    }

    const naDate = (n) => new Date(n * MS_W_DNIU).toISOString().slice(0, 10);

    let najdluzsza = 1;
    let najOd = dni[0];
    let najDo = dni[0];
    let biezaca = 1;
    let poczatek = dni[0];

    for (let i = 1; i < dni.length; i++) {
      if (dni[i] === dni[i - 1] + 1) biezaca++;
      else {
        biezaca = 1;
        poczatek = dni[i];
      }
      if (biezaca > najdluzsza) {
        najdluzsza = biezaca;
        najOd = poczatek;
        najDo = dni[i];
      }
    }

    return {
      najdluzsza,
      obecna: biezaca,
      odDnia: naDate(najOd),
      doDnia: naDate(najDo),
      ostatniDzien: naDate(dni[dni.length - 1]),
    };
  }

  /*
    Pokrycie: ile dni z zakresu ma wpis. Mianownikiem jest rozpietosc OD PIERWSZEGO
    DO OSTATNIEGO wpisu, a nie cala historia kalendarza - inaczej pokrycie zaleznoby
    od tego, jak dawno projekt powstal, a nie od tego, jak regularnie sie pisze.
  */
  function pokrycie(wpisy) {
    const dni = [...new Set(wpisy.map((w) => numerDniaISO(w.data)).filter((n) => n !== null))];
    if (dni.length === 0) return { dniZWpisem: 0, dniWZakresie: 0, procent: null };

    const min = Math.min(...dni);
    const max = Math.max(...dni);
    const wZakresie = max - min + 1;

    return {
      dniZWpisem: dni.length,
      dniWZakresie: wZakresie,
      procent: (100 * dni.length) / wZakresie,
    };
  }

  // ==========================================================================
  // Rytm tygodnia
  // ==========================================================================

  const NAZWY_DNI = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /** Godzina 'HH:MM' -> minuty od polnocy. Puste i niepoprawne dają null. */
  function minutyOdPolnocy(godzina) {
    if (!wypelnione(godzina)) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(godzina).trim());
    if (!m) return null;
    const g = Number(m[1]);
    const min = Number(m[2]);
    if (g > 23 || min > 59) return null;
    return g * 60 + min;
  }

  /** Minuty od polnocy -> 'HH:MM'. */
  function naGodzine(minuty) {
    if (minuty === null || Number.isNaN(minuty)) return null;
    const g = Math.floor(minuty / 60);
    const m = Math.round(minuty % 60);
    return `${String(g).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /*
    Srednie w rozbiciu na dzien tygodnia.

    Dzien liczymy z numeru dnia UTC, a nie z new Date(data).getDay() na czas lokalny -
    przy datach calodziennych przegladarka w innej strefie potrafi przesunac dzien
    o jeden. Ta sama pulapka co przy numerDnia.

    Kolejnosc: poniedzialek pierwszy. Tydzien zaczyna sie w poniedzialek, a niedziela
    na poczatku tabeli rozbijalaby weekend na dwa konce.
  */
  function wedlugDniTygodnia(wpisy) {
    const grupy = NAZWY_DNI.map((nazwa, i) => ({ dzien: i, nazwa, wpisy: [] }));

    for (const w of wpisy) {
      const n = numerDniaISO(w.data);
      if (n === null) continue;
      // 1970-01-01 (numer 0) byl czwartkiem, stad przesuniecie o 4.
      grupy[(((n % 7) + 4) % 7 + 7) % 7].wpisy.push(w);
    }

    const kolejnosc = [1, 2, 3, 4, 5, 6, 0]; // poniedzialek ... niedziela (tydzien od poniedzialku)

    return kolejnosc.map((i) => {
      const g = grupy[i];
      const pobudki = g.wpisy.map((w) => minutyOdPolnocy(w.pobudka)).filter((x) => x !== null);
      const sredniaPobudka = pobudki.length
        ? pobudki.reduce((a, b) => a + b, 0) / pobudki.length
        : null;

      return {
        nazwa: g.nazwa,
        weekend: i === 0 || i === 6,
        wpisow: g.wpisy.length,
        sen: srednia(g.wpisy, 'godziny_snu').srednia,
        jakosc_snu: srednia(g.wpisy, 'jakosc_snu').srednia,
        stres: srednia(g.wpisy, 'stres').srednia,
        nastroj: srednia(g.wpisy, 'nastroj').srednia,
        pobudka: naGodzine(sredniaPobudka),
      };
    });
  }

  // ==========================================================================
  // Wplyw wartosci wielokrotnego wyboru (slowa, nawyki)
  // ==========================================================================

  /** Rozbija pole wielokrotnego wyboru na nazwy. */
  function nazwyWartosci(w, pole) {
    if (!wypelnione(w[pole])) return [];
    return String(w[pole])
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /*
    Dla kazdej wartosci (slowa albo nawyku) srednia ocen w dniach, w ktorych
    wystapila, i ODCHYLENIE od sredniej ze wszystkich dni.

    PROG WYSTAPIEN jest obowiazkowy. Bez niego na czele listy ladowalyby wartosci
    uzyte raz albo dwa, gdzie "srednia" to pojedynczy dzien - a taka liczba wyglada
    dokladnie tak samo jak wynik ze stu dni i nie da sie ich odroznic wzrokiem.

    TO JEST WSPOLWYSTEPOWANIE, NIE PRZYCZYNA. Slowo "Difficult" nie obniza spokoju -
    opisuje dzien, w ktorym spokoju bylo mniej. Widok musi to mowic wprost, dlatego
    kazdy wiersz niesie ze soba `wystapien`.
  */
  function wplywWartosci(wpisy, pole, oceny, prog) {
    const bazowe = {};
    for (const ocena of oceny) bazowe[ocena] = srednia(wpisy, ocena).srednia;

    const grupy = new Map();
    for (const w of wpisy) {
      for (const nazwa of nazwyWartosci(w, pole)) {
        if (!grupy.has(nazwa)) grupy.set(nazwa, []);
        grupy.get(nazwa).push(w);
      }
    }

    const wynik = [];
    for (const [nazwa, dni] of grupy) {
      if (dni.length < prog) continue;

      const pozycja = { nazwa, wystapien: dni.length, oceny: {} };
      for (const ocena of oceny) {
        const sr = srednia(dni, ocena).srednia;
        pozycja.oceny[ocena] = {
          srednia: sr,
          odchylenie: sr === null || bazowe[ocena] === null ? null : sr - bazowe[ocena],
        };
      }
      wynik.push(pozycja);
    }

    return { bazowe, pozycje: wynik };
  }

  // ==========================================================================
  // Trend i postep
  // ==========================================================================

  /** Srednie ocen w rozbiciu na miesiace - do odczytania kierunku zmian. */
  function trendMiesieczny(wpisy, oceny) {
    const miesiace = new Map();

    for (const w of wpisy) {
      if (!wypelnione(w.data)) continue;
      const klucz = String(w.data).slice(0, 7);
      if (!miesiace.has(klucz)) miesiace.set(klucz, []);
      miesiace.get(klucz).push(w);
    }

    return [...miesiace.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([miesiac, lista]) => {
        const wiersz = { miesiac, wpisow: lista.length };
        for (const ocena of oceny) wiersz[ocena] = srednia(lista, ocena).srednia;
        return wiersz;
      });
  }

  /*
    XP w rozbiciu na miesiace i zrodla.

    XP KAZDEGO REKORDU LICZY SERWER i przysyla je gotowe (`xp` przy zadaniu
    i przy wpisie dziennika). Tutaj wylacznie sumujemy - powtorzenie wzoru
    w przegladarce dalo by druga implementacje silnika nagrod.

    Zadanie wpada do miesiaca swojego ZAKONCZENIA, a nie utworzenia: XP powstaje
    w chwili ukonczenia i tam ma sie liczyc.
  */
  function xpWedlugMiesiecy(wpisy, zadania) {
    const miesiace = new Map();
    const dodaj = (klucz, pole, ile) => {
      if (!klucz) return;
      if (!miesiace.has(klucz)) miesiace.set(klucz, { miesiac: klucz, dziennik: 0, zadania: 0 });
      miesiace.get(klucz)[pole] += ile;
    };

    for (const w of wpisy) {
      if (!wypelnione(w.data)) continue;
      dodaj(String(w.data).slice(0, 7), 'dziennik', w.xp || 0);
    }
    for (const z of zadania) {
      if (!wypelnione(z.czas_zakonczenia)) continue;
      dodaj(String(z.czas_zakonczenia).slice(0, 7), 'zadania', z.xp || 0);
    }

    return [...miesiace.values()]
      .sort((a, b) => (a.miesiac < b.miesiac ? -1 : 1))
      .map((m) => ({ ...m, razem: m.dziennik + m.zadania }));
  }

  // ==========================================================================
  // Zadania w czasie i terminowosc wedlug pola
  // ==========================================================================

  /** Ukonczone zadania w rozbiciu na miesiace zakonczenia. */
  function zadaniaWedlugMiesiecy(zadania) {
    const miesiace = new Map();
    for (const z of zadania) {
      if (!wypelnione(z.czas_zakonczenia)) continue;
      const klucz = String(z.czas_zakonczenia).slice(0, 7);
      miesiace.set(klucz, (miesiace.get(klucz) || 0) + 1);
    }
    return [...miesiace.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([miesiac, ile]) => ({ miesiac, ile }));
  }

  /*
    Terminowosc w rozbiciu na wybrane pole (obszar, priorytet).

    Liczymy WYLACZNIE zadania majace obie daty - bez terminu albo bez zakonczenia
    nie ma czego porownac, a wliczenie ich jako "na czas" zanizaloby odsetek
    spoznien tam, gdzie po prostu brakuje danych.
  */
  function terminowoscWedlug(zadania, pole, prog) {
    const grupy = new Map();

    for (const z of zadania) {
      if (!wypelnione(z.termin) || !wypelnione(z.czas_zakonczenia)) continue;
      const klucz = wypelnione(z[pole]) ? String(z[pole]) : '(brak)';
      if (!grupy.has(klucz)) grupy.set(klucz, { klucz, zBadanych: 0, poTerminie: 0 });
      const g = grupy.get(klucz);
      g.zBadanych++;
      if (numerDniaISO(z.czas_zakonczenia) > numerDniaISO(z.termin)) g.poTerminie++;
    }

    return [...grupy.values()]
      .filter((g) => g.zBadanych >= prog)
      .map((g) => ({ ...g, procent: (100 * g.poTerminie) / g.zBadanych }))
      .sort((a, b) => b.procent - a.procent);
  }

  // ==========================================================================
  // Porownania okresow
  // ==========================================================================

  /*
    DATA ZMIANY KALIBRACJI OCEN.

    Wysrodkowanie etykiet ocen (szczegoly w config/mapowanie-ocen.js i w tabeli
    decyzji w docs/PROJEKT.md). Liczby w bazie znacza to samo, ale punkt odniesienia
    przy ich wystawianiu sie przesunal.

    TA STALA TO OSTATNI DZIEN OCENIANY PO STAREMU, nie dzien commita.
    Ustalone ze znacznikow czasu, nie z pamieci: commit 2f2d73e ma date
    2026-09-06 20:56, a wpis z 2026-09-06 powstal o 20:14 - czyli jeszcze przed
    zmiana. Pierwszym dniem na nowych etykietach jest 2026-09-07.

    Kazde porownanie PRZECHODZACE przez te granice miesza dwie kalibracje.
    Nie blokujemy go - odciecie polowy historii byloby gorsze - ale oznaczamy,
    zeby liczba nie udawala czystej.
  */
  const DATA_ZMIANY_KALIBRACJI = '2026-09-06';

  /** Okno [od, do] o zadanej dlugosci, cofniete o `przesuniecie` okien wstecz. */
  function oknoDat(dzisiaj, dlugosc, przesuniecie = 0) {
    const koniec = numerDniaISO(dzisiaj) - przesuniecie * dlugosc;
    const naDate = (n) => new Date(n * MS_W_DNIU).toISOString().slice(0, 10);
    return { od: naDate(koniec - dlugosc + 1), do: naDate(koniec) };
  }

  /*
    Podsumowanie jednego okresu.

    KAZDA SREDNIA NIESIE ZE SOBA `ile` I `wypelnienie`. To nie jest ozdoba: wrzesien
    2024 mial refleksje w 90% dni, a 2026 w 57%, wiec sama srednia porownuje dwie
    rozne rzeczy i nikt tego nie zauwaza. Widok ma obowiazek pokazac oba liczniki
    obok siebie.
  */
  function podsumujOkres(wpisy, od, do_, oceny) {
    const wOkresie = wpisy.filter((w) => wypelnione(w.data) && w.data >= od && w.data <= do_);
    const dni = numerDniaISO(do_) - numerDniaISO(od) + 1;

    const wynik = {
      od,
      do: do_,
      dniWOkresie: dni,
      wpisow: wOkresie.length,
      pokrycie: dni > 0 ? (100 * wOkresie.length) / dni : null,
      /*
        Flaga siedzi PRZY OKRESIE, a nie tylko przy porownaniu. Okres rozciagniety
        przez 5 wrzesnia usrednia oceny z dwoch kalibracji naraz - jego wlasna
        liczba jest juz mieszana, niezaleznie od tego, z czym ja zestawimy.
      */
      mieszaKalibracje: przecinaKalibracje(od, do_),
      oceny: {},
    };

    for (const pole of oceny) {
      const s = srednia(wOkresie, pole);
      wynik.oceny[pole] = {
        srednia: s.srednia,
        ile: s.ile,
        wypelnienie: wOkresie.length > 0 ? (100 * s.ile) / wOkresie.length : null,
      };
    }

    return wynik;
  }

  /*
    Tlo porownania: CALA HISTORIA POZA badanym okresem.

    Gdyby tlem bylo wszystko razem z okresem, przy oknie 365 dni porownywalibysmy
    okres z samym soba w 43% - i kazda roznica bylaby sztucznie stlumiona.
    "Ten okres kontra reszta" jest pytaniem, ktore ma sens; "ten okres kontra
    ten okres plus reszta" nie ma zadnego.
  */
  function tloPozaOkresem(wpisy, od, do_, oceny) {
    const poza = wpisy.filter((w) => wypelnione(w.data) && (w.data < od || w.data > do_));
    if (poza.length === 0) return null;

    const daty = poza.map((w) => w.data).sort();
    return podsumujOkres(poza, daty[0], daty[daty.length - 1], oceny);
  }

  /** Czy zakres [od, do] przechodzi przez date zmiany kalibracji ocen? */
  function przecinaKalibracje(od, do_) {
    return od <= DATA_ZMIANY_KALIBRACJI && do_ > DATA_ZMIANY_KALIBRACJI;
  }

  /*
    Porownanie okien kroczacych.

    Dla kazdej dlugosci zwracamy trzy kolumny: okres biezacy, poprzedni taki sam
    i reszta historii. Roznice liczymy WYLACZNIE tam, gdzie obie strony maja dane -
    odejmowanie od brakujacej sredniej dawaloby zero, czyli "bez zmian", co jest
    najgorsza mozliwa odpowiedzia przy braku danych.
  */
  function porownanieOkien(wpisy, dzisiaj, dlugosci, oceny) {
    return dlugosci.map((dlugosc) => {
      const bOkno = oknoDat(dzisiaj, dlugosc, 0);
      const pOkno = oknoDat(dzisiaj, dlugosc, 1);

      const biezacy = podsumujOkres(wpisy, bOkno.od, bOkno.do, oceny);
      const poprzedni = podsumujOkres(wpisy, pOkno.od, pOkno.do, oceny);
      const tlo = tloPozaOkresem(wpisy, bOkno.od, bOkno.do, oceny);

      const roznice = {};
      for (const pole of oceny) {
        const b = biezacy.oceny[pole].srednia;
        const p = poprzedni.oceny[pole].srednia;
        const t = tlo ? tlo.oceny[pole].srednia : null;
        roznice[pole] = {
          wobecPoprzedniego: b === null || p === null ? null : b - p,
          wobecTla: b === null || t === null ? null : b - t,
        };
      }

      return {
        dlugosc,
        biezacy,
        poprzedni,
        tlo,
        roznice,
        /*
          Porownanie jest mieszane, gdy mieszany jest ktorykolwiek z zestawianych
          okresow ALBO gdy granica przebiega miedzy nimi. Same okresy nosza swoje
          flagi w `mieszaKalibracje` - tu chodzi o zestawienie jako calosc.
        */
        mieszaneZestawienie: {
          zPoprzednim:
            biezacy.mieszaKalibracje ||
            poprzedni.mieszaKalibracje ||
            przecinaKalibracje(pOkno.od, bOkno.do),
          zTlem: Boolean(tlo) && (biezacy.mieszaKalibracje || tlo.mieszaKalibracje),
        },
      };
    });
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
    // --- nowe grupy statystyk ---
    numerDniaISO,
    serieDni,
    pokrycie,
    minutyOdPolnocy,
    naGodzine,
    wedlugDniTygodnia,
    nazwyWartosci,
    wplywWartosci,
    trendMiesieczny,
    xpWedlugMiesiecy,
    zadaniaWedlugMiesiecy,
    terminowoscWedlug,
    NAZWY_DNI,
    // --- porownania okresow ---
    oknoDat,
    podsumujOkres,
    tloPozaOkresem,
    przecinaKalibracje,
    porownanieOkien,
    DATA_ZMIANY_KALIBRACJI,
  };
})();
