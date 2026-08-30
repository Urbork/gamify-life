/*
  Wspolna obsluga zakresu dat w filtrach - uzywana przez zadania i dziennik.

  Modul odpowiada za DWIE rzeczy:
  1. arytmetyke dat (liczenie w dniach, przesuwanie o N dni),
  2. mechanike presetow: budowanie przyciskow i podswietlanie tego,
     ktory odpowiada aktualnie wpisanemu zakresowi.

  Czego tu NIE MA: regul dopasowania wiersza do zakresu. Sa rozne w kazdym module
  (zadania sprawdzaja termin ORAZ okres aktywnosci, dziennik jedno pole `data`),
  wiec siedza w plikach widokow.

  Presety sa wystawione POJEDYNCZO, a nie jako gotowa lista, bo zestawy sie roznia:
  zadania maja "Dziś + jutro", dziennik nie. Kazdy widok sklada wlasna liste
  z tych samych klockow.
*/

const filtrDat = (() => {
  const MS_W_DNIU = 86400000;

  /*
    Daty liczymy w "numerach dni" - liczbie pelnych dni od 1970-01-01, wyznaczonej
    w UTC. Dzieki temu porownywanie i odejmowanie dat to zwykla arytmetyka liczb
    calkowitych i nie psuje sie na zmianie czasu (w strefie lokalnej doba potrafi
    miec 23 albo 25 godzin).
  */

  /**
   * Znacznik czasu -> numer dnia. CZESC GODZINOWA JEST POMIJANA,
   * wiec funkcja przyjmuje zarowno 'YYYY-MM-DD', jak i 'YYYY-MM-DDTHH:MM'.
   * Zwraca null dla pustej lub niepoprawnej wartosci.
   */
  function numerDnia(znacznik) {
    if (!znacznik) return null;
    const czesci = znacznik.slice(0, 10).split('-').map(Number);
    if (czesci.length !== 3 || czesci.some(Number.isNaN)) return null;
    return Date.UTC(czesci[0], czesci[1] - 1, czesci[2]) / MS_W_DNIU;
  }

  /** 'YYYY-MM-DD' + n dni -> 'YYYY-MM-DD'. */
  function dataPlusDni(iso, dni) {
    const numer = numerDnia(iso);
    if (numer === null) return '';
    return new Date((numer + dni) * MS_W_DNIU).toISOString().slice(0, 10);
  }

  /** Dzisiejsza data jako 'YYYY-MM-DD' wedlug czasu LOKALNEGO (nie UTC - stad nie toISOString). */
  function dzisiajLokalnie() {
    const t = new Date();
    const dwie = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${dwie(t.getMonth() + 1)}-${dwie(t.getDate())}`;
  }

  /*
    `dni` to liczba dni kalendarzowych liczona OD DZISIAJ WLACZNIE, stad
    "Dziś" = 1 dzien, "Dziś + jutro" = 2 dni, "7 dni" = dzis .. dzis+6.
    `dni: null` oznacza brak filtra (czyszczenie obu pol).
  */
  const PRESETY = {
    WSZYSTKIE: { etykieta: 'Wszystkie', dni: null },
    DZIS: { etykieta: 'Dziś', dni: 1 },
    DZIS_JUTRO: { etykieta: 'Dziś + jutro', dni: 2 },
    TYDZIEN: { etykieta: '7 dni', dni: 7 },
    MIESIAC: { etykieta: '30 dni', dni: 30 },

    /*
      WARIANTY WSTECZNE: dzis-(dni-1) .. dzis.

      Kierunek zalezy od tego, CZEGO dotyczy widok, a nie od samej liczby dni:
      - zadania opisuja PRZYSZLOSC (termin, co mam zrobic), wiec licza w przod;
      - dziennik opisuje PRZESZLOSC - wpisu z jutra po prostu nie ma, wiec preset
        liczacy w przod pokazywal najwyzej dzisiejszy wpis i byl bezuzyteczny.

      Etykiety zostaja te same ('7 dni'), bo w dzienniku nie ma dwuznacznosci:
      wszystkie jego presety patrza wstecz.
    */
    OSTATNIE_7_DNI: { etykieta: '7 dni', dni: 7, wstecz: true },
    OSTATNIE_30_DNI: { etykieta: '30 dni', dni: 30, wstecz: true },
  };

  /**
   * Zakres dla presetu, liczony od podanej daty. Zwraca { od, do } - puste dla "Wszystkie".
   *
   * `wstecz` odwraca kierunek: zamiast dzis .. dzis+(dni-1) daje dzis-(dni-1) .. dzis.
   * Obie postacie obejmuja DZISIAJ i licza `dni` pelnych dni kalendarzowych.
   */
  function zakresPresetu(dzisiaj, dni, wstecz = false) {
    if (dni === null || !dzisiaj) return { od: '', do: '' };
    if (wstecz) return { od: dataPlusDni(dzisiaj, -(dni - 1)), do: dzisiaj };
    return { od: dzisiaj, do: dataPlusDni(dzisiaj, dni - 1) };
  }

  /**
   * Buduje przyciski presetow w podanym pojemniku.
   * @param {Element} pojemnik
   * @param {Array<{etykieta: string, dni: number|null}>} presety
   * @param {(zakres: {od: string, do: string}) => void} przyWyborze
   *        wolane po klknieciu; dostaje gotowy zakres do wpisania w pola OD/DO
   * @param {() => string} dajDzisiaj funkcja zwracajaca aktualna date serwera
   */
  function zbudujPrzyciski(pojemnik, presety, przyWyborze, dajDzisiaj) {
    pojemnik.replaceChildren(
      ...presety.map((preset) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = preset.etykieta;
        // Liczba dni w atrybucie, zeby odswiezPrzyciski() mogl odtworzyc zakres
        // bez trzymania osobnego stanu.
        btn.dataset.dni = preset.dni === null ? '' : preset.dni;
        // Kierunek tez trafia do atrybutu - odswiezPrzyciski odtwarza z niego zakres.
        btn.dataset.wstecz = preset.wstecz ? 'tak' : 'nie';

        btn.addEventListener('click', () =>
          przyWyborze(zakresPresetu(dajDzisiaj(), preset.dni, Boolean(preset.wstecz)))
        );

        return btn;
      })
    );
  }

  /**
   * Podswietla preset odpowiadajacy aktualnie wpisanemu zakresowi (jesli ktorys).
   * Recznie zmieniona data gasi podswietlenie, bo zakres przestaje byc "tym presetem".
   */
  function odswiezPrzyciski(pojemnik, { od, do: doDnia, dzisiaj }) {
    for (const btn of pojemnik.querySelectorAll('button')) {
      const dni = btn.dataset.dni === '' ? null : Number(btn.dataset.dni);
      const oczekiwany = zakresPresetu(dzisiaj, dni, btn.dataset.wstecz === 'tak');

      const pasuje =
        dni === null
          ? od === '' && doDnia === ''
          : dzisiaj !== null && od === oczekiwany.od && doDnia === oczekiwany.do;

      btn.dataset.aktywny = pasuje ? 'tak' : 'nie';
    }
  }

  return {
    numerDnia,
    dataPlusDni,
    dzisiajLokalnie,
    PRESETY,
    zakresPresetu,
    zbudujPrzyciski,
    odswiezPrzyciski,
  };
})();
