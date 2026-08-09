/*
  Czyste reguly modulu dziennika: filtrowanie i sortowanie.

  Ten sam powod istnienia co public/js/reguly-zadan.js - zero odwolan do DOM,
  wiec te same funkcje wykonuje przegladarka i skrypt testowy (npm run test:smoke).
  Stan (filtry, sortowanie) wchodzi ARGUMENTEM; modul niczego nie pamieta.
*/

const regulyDziennika = (() => {
  'use strict';

  const { numerDnia } = filtrDat;

  /*
    Kolumny przeszukiwane jednym polem "Szukaj". Sklejamy je i szukamy fragmentu -
    dzieki temu nie trzeba pamietac, w ktorej rubryce cos sie zapisalo.

    UWAGA: posilki (sniadanie, obiad, kolacja) NIE sa tu wymienione - tak wynika
    ze specyfikacji pola. Szukanie "kawa" da zero wynikow, mimo ze slowo wystepuje
    w danych setki razy, bo siedzi wylacznie w opisach posilkow.
  */
  const POLA_SZUKANIA = [
    'wdziecznosc',
    'bledy',
    'rozmowa',
    'co_poszlo_dobrze',
    'jutro_wazne',
    'do_przemyslenia',
    'trzy_slowa',
    'nawyki',
  ];

  // Pola liczbowe sortuja sie liczbowo, reszta tekstowo.
  const POLA_LICZBOWE = new Set([
    'id',
    'godziny_snu',
    'jakosc_snu',
    'stres',
    'nastroj',
    'intencjonalnosc',
  ]);

  /** Rozbija pole `nawyki` na pojedyncze nazwy. */
  function nazwyNawykow(w) {
    if (!w.nawyki) return [];
    return w.nawyki
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function pasujeSzukaj(w, filtry) {
    if (!filtry.szukaj) return true;
    const tresc = POLA_SZUKANIA.map((p) => w[p] ?? '')
      .join(' \n ')
      .toLocaleLowerCase('pl');
    return tresc.includes(filtry.szukaj);
  }

  /*
    Dopasowanie po nawyku. Rozbijamy pole na nazwy i porownujemy DOKLADNIE,
    zamiast szukac fragmentu w calym tekscie.

    Powod: dzis zadna nazwa nie jest fragmentem innej, ale gole `includes`
    byloby mina na przyszlosc - wystarczyloby dopisac nawyk "Water" obok
    istniejacego "Drink Water", zeby filtr zaczal lapac oba naraz.
  */
  function pasujeNawyk(w, filtry) {
    if (filtry.nawyki.size === 0) return true;
    return nazwyNawykow(w).some((n) => filtry.nawyki.has(n));
  }

  /*
    Zakres dat. Dziennik ma tylko JEDNO pole daty, wiec regula jest prosta:
    data wpisu musi miescic sie w [OD, DO]. Brak ktorejs granicy = zakres otwarty
    z tej strony. To swiadomie prostsze niz w zadaniach, gdzie sa trzy pola datowe
    i dwa niezalezne warunki.
  */
  function pasujeZakresDat(w, filtry) {
    const od = numerDnia(filtry.od);
    const doDnia = numerDnia(filtry.do);
    if (od === null && doDnia === null) return true;

    const data = numerDnia(w.data);
    if (data === null) return false; // wpis bez daty nie miesci sie w zadnym zakresie

    return (od === null || data >= od) && (doDnia === null || data <= doDnia);
  }

  /** Wpisy spelniajace WSZYSTKIE aktywne filtry (pola lacza sie przez ORAZ). */
  function filtrowane(lista, filtry) {
    return lista.filter(
      (w) => pasujeSzukaj(w, filtry) && pasujeNawyk(w, filtry) && pasujeZakresDat(w, filtry)
    );
  }

  /** Ile pol filtrow jest aktywnych (do znacznika przy zwinietym panelu). */
  function ileAktywnych(filtry) {
    return [
      filtry.szukaj !== '',
      filtry.nawyki.size > 0,
      filtry.od !== '' || filtry.do !== '',
    ].filter(Boolean).length;
  }

  /** Brak wartosci. Zero NIE jest brakiem - stres 0 to prawidlowa ocena. */
  function pusta(w) {
    return w === null || w === undefined || w === '';
  }

  /*
    Puste wartosci zawsze na koncu, takze przy sortowaniu malejaco - ta sama zasada
    co w tabeli zadan. Wpis bez oceny nie jest ani najlepszy, ani najgorszy.
    Remisy rozstrzyga id, zeby kolejnosc byla powtarzalna.
  */
  function posortowane(lista, sortowanie) {
    const { kolumna, kierunek } = sortowanie;

    return [...lista].sort((a, b) => {
      const wa = a[kolumna];
      const wb = b[kolumna];

      const pustaA = pusta(wa);
      const pustaB = pusta(wb);
      if (pustaA && pustaB) return a.id - b.id;
      if (pustaA) return 1;
      if (pustaB) return -1;

      let wynik;
      if (POLA_LICZBOWE.has(kolumna)) wynik = wa - wb;
      // Data w formacie YYYY-MM-DD i godzina HH:MM maja stala szerokosc,
      // wiec kolejnosc alfabetyczna = kolejnosc chronologiczna.
      else if (kolumna === 'data' || kolumna === 'pobudka') wynik = wa < wb ? -1 : wa > wb ? 1 : 0;
      else wynik = String(wa).localeCompare(String(wb), 'pl');

      if (wynik === 0) return a.id - b.id;
      return kierunek === 'malejaco' ? -wynik : wynik;
    });
  }

  return { nazwyNawykow, filtrowane, ileAktywnych, posortowane, POLA_SZUKANIA };
})();
