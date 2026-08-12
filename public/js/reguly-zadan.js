/*
  Czyste reguly modulu zadan: kolumny wyliczane, filtrowanie, sortowanie.

  DLACZEGO OSOBNY PLIK
  Te reguly to sedno zachowania aplikacji, wiec musza dac sie przetestowac.
  Dopoki siedzialy w domknieciu zadania.js - ktore przy starcie siega do
  document.getElementById - nie dalo sie ich uruchomic poza przegladarka,
  a predykaty byly prywatne. Test moglby wtedy najwyzej powtorzyc te sama
  logike u siebie, czyli przechodzic tez wtedy, gdy aplikacja jest zepsuta.

  Tutaj nie ma ani jednego odwolania do DOM. Plik laduje sie normalnym <script>
  w przegladarce, a skrypt testowy wczytuje go w sandboksie (vm) - dzieki temu
  test sprawdza DOKLADNIE ten kod, ktory wykonuje przegladarka.

  ZASADA: wszystko, co zmienne (filtry, sortowanie, slowniki), wchodzi
  ARGUMENTEM. Modul nie trzyma zadnego stanu.
*/

const regulyZadan = (() => {
  'use strict';

  const { numerDnia } = filtrDat;

  // ==========================================================================
  // Kolumny wyliczane
  // ==========================================================================

  /*
    Obie licza w PELNYCH DNIACH KALENDARZOWYCH i CALKOWICIE ignoruja godzine
    (numerDnia bierze pierwsze 10 znakow znacznika). To swiadoma decyzja:
    start 10.08 23:59 i koniec 12.08 00:01 daja 2 dni, mimo ze minelo
    nieco ponad 24 godziny.
  */

  /** Ile pelnych dni zostalo do terminu wzgledem podanego "dzisiaj" (ujemne = po terminie). */
  function dniDoTerminu(z, dzisiaj) {
    const termin = numerDnia(z.termin);
    if (termin === null) return null;

    const dzien = numerDnia(dzisiaj);
    if (dzien === null) return null;

    return termin - dzien;
  }

  /*
    USUNIETE: czasTrwania(z) liczone z dat start/koniec.

    Zastapilo je RECZNE pole `czas_trwania_godziny`, wpisywane przy zadaniu.
    Powod: roznica dat mowila tylko, ile dni zadanie bylo otwarte, a nie ile
    faktycznie zajelo pracy - a to drugie jest potrzebne do naliczania XP.
  */

  /**
   * Czy zadanie ma komplet danych potrzebnych do naliczenia XP?
   *
   * Sam wynik XP liczy serwer (lib/nagrody.js) - tutaj sprawdzamy wylacznie
   * OBECNOSC pol, zeby interfejs mogl pokazac wskazowke. Powielanie calego
   * silnika w przegladarce dalo by dwie implementacje tych samych regul.
   */
  function maDaneDoXp(z) {
    const wypelnione = (w) => w !== null && w !== undefined && String(w).trim() !== '';
    return wypelnione(z.trudnosc) && wypelnione(z.czas_trwania_godziny);
  }

  // ==========================================================================
  // Filtrowanie
  // ==========================================================================

  /*
    Ksztalt obiektu `filtry`:
      { nazwa: string, stany: Set, priorytety: Set, klienci: Set, od: string, do: string }
    Pusty zbior = "nie filtruj po tym polu". Pola lacza sie przez ORAZ,
    zaznaczenia w obrebie jednego pola przez LUB.
  */

  function pasujeNazwa(z, filtry) {
    if (!filtry.nazwa) return true;
    // Zwykly "zawiera", bez rozrozniania wielkosci liter.
    return (z.nazwa || '').toLocaleLowerCase('pl').includes(filtry.nazwa);
  }

  function pasujeStan(z, filtry) {
    return filtry.stany.size === 0 || filtry.stany.has(z.stan);
  }

  function pasujePriorytet(z, filtry) {
    return filtry.priorytety.size === 0 || filtry.priorytety.has(z.priorytet);
  }

  function pasujeObszar(z, filtry) {
    if (filtry.obszary.size === 0) return true;
    // Zadanie bez obszaru ma null - Set go nie zawiera, wiec zostanie odfiltrowane.
    return filtry.obszary.has(z.obszar);
  }

  /*
    Filtr po projekcie. Zbior zawiera ID projektow (liczby), nie nazwy:
    nazwa moze sie zmienic albo powtorzyc, id jest stabilne.

    Sprawdzenie `filtry.projekty` na istnienie, bo starsze wywolania (i testy)
    moga podawac obiekt filtrow bez tego pola.
  */
  function pasujeProjekt(z, filtry) {
    if (!filtry.projekty || filtry.projekty.size === 0) return true;
    return filtry.projekty.has(z.projekt_id);
  }

  /*
    Dopasowanie do zakresu dat [OD, DO].

    Zadanie pasuje, jesli spelnia CO NAJMNIEJ JEDEN z dwoch warunkow:

      a) TERMIN jest wypelniony i miesci sie w zakresie;
      b) AKTYWNOSC zadania nachodzi na zakres, czyli start jest wypelniony,
         zaczyna sie nie pozniej niz DO, a konczy nie wczesniej niz OD.

    Kazdy warunek sprawdzany jest NIEZALEZNIE - zadanie bez terminu moze pasowac
    przez b), a zadanie bez startu przez a). Zadanie bez zadnej z trzech dat
    nie pasuje nigdy (oba warunki wymagaja swojej daty).

    PUSTY czas_zakonczenia = zadanie wciaz trwa, wiec warunek konca jest spelniony
    (zadanie traktujemy jako otwarte, bez daty zamkniecia). Praktyczna roznica wobec
    wariantu "trwa dokladnie do dzisiaj" pojawia sie tylko dla zakresu w calosci
    w przyszlosci (OD > dzisiaj); zaden z presetow takiego zakresu nie tworzy.

    Porownania ida na PELNYCH DNIACH KALENDARZOWYCH - tak samo jak kolumny wyliczane.
  */
  function pasujeZakresDat(z, filtry) {
    const od = numerDnia(filtry.od);
    const doDnia = numerDnia(filtry.do);
    if (od === null && doDnia === null) return true; // zakres nieustawiony = brak filtra

    const termin = numerDnia(z.termin);
    const start = numerDnia(z.start_zadania);
    const koniec = numerDnia(z.czas_zakonczenia);

    const przezTermin =
      termin !== null && (od === null || termin >= od) && (doDnia === null || termin <= doDnia);

    const przezAktywnosc =
      start !== null &&
      (doDnia === null || start <= doDnia) &&
      (koniec === null || od === null || koniec >= od);

    return przezTermin || przezAktywnosc;
  }

  /** Zadania spelniajace WSZYSTKIE aktywne filtry. */
  function filtrowane(lista, filtry) {
    return lista.filter(
      (z) =>
        pasujeNazwa(z, filtry) &&
        pasujeStan(z, filtry) &&
        pasujePriorytet(z, filtry) &&
        pasujeObszar(z, filtry) &&
        pasujeProjekt(z, filtry) &&
        pasujeZakresDat(z, filtry)
    );
  }

  /** Ile pol filtrow jest aktywnych (do znacznika przy zwinietym panelu). */
  function ileAktywnych(filtry) {
    return [
      filtry.nazwa !== '',
      filtry.stany.size > 0,
      filtry.priorytety.size > 0,
      filtry.obszary.size > 0,
      Boolean(filtry.projekty && filtry.projekty.size > 0),
      filtry.od !== '' || filtry.do !== '',
    ].filter(Boolean).length;
  }

  // ==========================================================================
  // Sortowanie
  // ==========================================================================

  /*
    REGULY (w tej kolejnosci):
    1. Zadania zakonczone zawsze na dole - niezaleznie od wybranej kolumny i kierunku.
    2. W obrebie grupy: wybrana kolumna, rosnaco albo malejaco.
    3. Puste wartosci zawsze na koncu swojej grupy, TAKZE przy sortowaniu malejaco.
    4. Remisy rozstrzyga id rosnaco - kolejnosc ma byc powtarzalna.
  */

  /**
   * Definicje kolumn sortowania. Klucz odpowiada atrybutowi data-kolumna
   * w naglowku tabeli (public/index.html).
   *
   * Zwracamy je z funkcji, bo czesc potrzebuje slownikow (kolejnosc stanow)
   * i biezacej daty (kolumna "Dni do terminu").
   *
   * Typy: 'liczba' - odejmowanie, 'tekst' - localeCompare('pl'),
   *       'znacznik' - data z godzina o stalej szerokosci, wiec porownanie tekstowe.
   */
  function kolumnySortowania(slowniki, dzisiaj) {
    return {
      id: { typ: 'liczba', wartosc: (z) => z.id },
      // Stan wedlug kolejnosci ze slownika (Plan, Czeka, W trakcie...),
      // a nie alfabetycznie - alfabetyczna kolejnosc stanow nic nie znaczy.
      stan: {
        typ: 'liczba',
        wartosc: (z) => {
          const i = slowniki.stany.indexOf(z.stan);
          return i === -1 ? slowniki.stany.length : i; // stan spoza slownika laduje na koncu
        },
      },
      nazwa: { typ: 'tekst', wartosc: (z) => z.nazwa },
      // Po NUMERZE priorytetu, nie po etykiecie - alfabetycznie wyszloby
      // Brak, Niski, Pilne, Sredni, Wysoki, czyli kolejnosc bez sensu.
      priorytet: { typ: 'liczba', wartosc: (z) => z.priorytet },
      obszar: { typ: 'tekst', wartosc: (z) => z.obszar },
      projekt_id: { typ: 'liczba', wartosc: (z) => z.projekt_id },
      start_zadania: { typ: 'znacznik', wartosc: (z) => z.start_zadania },
      termin: { typ: 'znacznik', wartosc: (z) => z.termin },
      dni_do_terminu: { typ: 'liczba', wartosc: (z) => dniDoTerminu(z, dzisiaj) },
      czas_zakonczenia: { typ: 'znacznik', wartosc: (z) => z.czas_zakonczenia },
      czas_trwania_godziny: { typ: 'liczba', wartosc: (z) => z.czas_trwania_godziny },
      trudnosc: { typ: 'liczba', wartosc: (z) => z.trudnosc },
    };
  }

  /**
   * Brak wartosci: null, undefined albo pusty tekst.
   * Zero NIE jest brakiem - priorytet 0 ("Brak") to prawidlowa wartosc do sortowania.
   */
  function pusta(w) {
    return w === null || w === undefined || w === '';
  }

  /** Numer grupy: 0 = aktywne, 1 = zakonczone. Grupa ma pierwszenstwo przed kolumna. */
  function grupa(z, slowniki) {
    return z.stan === slowniki.stanZakonczony ? 1 : 0;
  }

  /**
   * Zwraca zadania w kolejnosci wyswietlania.
   * @param {Array} lista
   * @param {{kolumna: string, kierunek: string}} sortowanie
   * @param {object} slowniki
   * @param {string} dzisiaj 'YYYY-MM-DD' - potrzebne kolumnie "Dni do terminu"
   */
  function posortowane(lista, sortowanie, slowniki, dzisiaj) {
    const kolumny = kolumnySortowania(slowniki, dzisiaj);
    const definicja = kolumny[sortowanie.kolumna];

    const porownajWKolumnie = (a, b) => {
      if (!definicja) return 0;

      const wa = definicja.wartosc(a);
      const wb = definicja.wartosc(b);

      const pustaA = pusta(wa);
      const pustaB = pusta(wb);
      if (pustaA && pustaB) return 0;
      if (pustaA) return 1; // puste na koniec - przed zwrotem kierunku, wiec go nie dotyczy
      if (pustaB) return -1;

      let wynik;
      if (definicja.typ === 'tekst') wynik = String(wa).localeCompare(String(wb), 'pl');
      else if (definicja.typ === 'znacznik') wynik = wa < wb ? -1 : wa > wb ? 1 : 0;
      else wynik = wa - wb;

      return sortowanie.kierunek === 'malejaco' ? -wynik : wynik;
    };

    return [...lista].sort((a, b) => {
      const roznicaGrup = grupa(a, slowniki) - grupa(b, slowniki);
      if (roznicaGrup !== 0) return roznicaGrup;

      const wynik = porownajWKolumnie(a, b);
      if (wynik !== 0) return wynik;

      return a.id - b.id;
    });
  }

  return {
    dniDoTerminu,
    maDaneDoXp,
    filtrowane,
    ileAktywnych,
    posortowane,
    kolumnySortowania,
  };
})();
