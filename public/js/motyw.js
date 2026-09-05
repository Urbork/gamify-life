/*
  Motyw jasny / ciemny.

  TRZY STANY, nie dwa: 'system' (domyslny), 'jasny', 'ciemny'. Sam przelacznik
  jasny/ciemny odebralby mozliwosc podazania za ustawieniem systemu, ktora
  dzialala wczesniej - a to najsensowniejsze zachowanie na co dzien.

  DLACZEGO JS ROZSTRZYGA MOTYW, A NIE @media W CSS
  Gdyby ciemna paleta byla i w @media (prefers-color-scheme: dark), i w regule
  [data-motyw='ciemny'], istnialaby w DWOCH kopiach - a rozjazd miedzy kopiami
  to blad, ktory w tym projekcie wystepowal juz kilka razy (numerDnia, listy kolumn).
  Zamiast tego JS zamienia wybor na KONKRETNY motyw i ustawia go atrybutem,
  wiec w CSS zostaje jedna definicja ciemnej palety.

  Skrypt jest ladowany SYNCHRONICZNIE w <head>, przed pierwszym malowaniem -
  inaczej przy ustawieniu ciemnym mignelaby jasna strona.
*/
const motyw = (() => {
  'use strict';

  const KLUCZ = 'gamify-life:motyw';
  const WYBORY = ['system', 'jasny', 'ciemny'];

  const OPISY = {
    system: { ikona: '🖥️', etykieta: 'Motyw: systemowy' },
    jasny: { ikona: '☀️', etykieta: 'Motyw: jasny' },
    ciemny: { ikona: '🌙', etykieta: 'Motyw: ciemny' },
  };

  /*
    localStorage bywa niedostepny (tryb prywatny, zablokowane dane witryn),
    a wtedy sam odczyt rzuca wyjatkiem. Motyw to preferencja, nie dane -
    brak zapisu ma tylko oznaczac powrot do ustawienia systemu, nie awarie strony.
  */
  function odczytajWybor() {
    try {
      const w = localStorage.getItem(KLUCZ);
      return WYBORY.includes(w) ? w : 'system';
    } catch {
      return 'system';
    }
  }

  function zapiszWybor(wybor) {
    try {
      if (wybor === 'system') localStorage.removeItem(KLUCZ);
      else localStorage.setItem(KLUCZ, wybor);
    } catch {
      /* brak zapisu nie jest bledem - patrz komentarz wyzej */
    }
  }

  /** Czy system prosi o ciemny motyw. */
  function systemChceCiemny() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /**
   * Wybor uzytkownika + preferencja systemu -> KONKRETNY motyw.
   * Czysta funkcja: nie dotyka DOM ani localStorage, wiec da sie ja przetestowac.
   */
  function rozstrzygnij(wybor, ciemnyWSystemie) {
    if (wybor === 'jasny') return 'jasny';
    if (wybor === 'ciemny') return 'ciemny';
    return ciemnyWSystemie ? 'ciemny' : 'jasny';
  }

  /** Ustawia atrybut na <html>. CSS reaguje wylacznie na te wartosc. */
  function zastosuj() {
    const motywDoUzycia = rozstrzygnij(odczytajWybor(), systemChceCiemny());
    document.documentElement.dataset.motyw = motywDoUzycia;
    return motywDoUzycia;
  }

  // Ustawiamy OD RAZU, jeszcze przed <body> - zeby nie mignela jasna strona.
  zastosuj();

  /*
    Zmiana ustawienia systemu w trakcie dziala tylko przy wyborze 'system'.
    Bez tego przejscie na motyw ciemny o zmierzchu wymagaloby odswiezenia strony.
  */
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (odczytajWybor() === 'system') zastosuj();
    });
  }

  /** Podpina przycisk przelacznika. Wolane po zbudowaniu DOM. */
  function podepnijPrzycisk() {
    const btn = document.getElementById('przelacznik-motywu');
    if (!btn) return;

    const odswiez = () => {
      const wybor = odczytajWybor();
      const opis = OPISY[wybor];
      btn.textContent = opis.ikona;
      // Przy wyborze systemowym mowimy TAKZE, co z niego wynika - inaczej ikona
      // monitora nic nie mowi o tym, co widac na ekranie.
      btn.title =
        wybor === 'system'
          ? `${opis.etykieta} (teraz ${rozstrzygnij('system', systemChceCiemny())}) — kliknij, aby zmienić`
          : `${opis.etykieta} — kliknij, aby zmienić`;
      btn.setAttribute('aria-label', btn.title);
      btn.dataset.wybor = wybor;
    };

    btn.addEventListener('click', () => {
      const kolejny = WYBORY[(WYBORY.indexOf(odczytajWybor()) + 1) % WYBORY.length];
      zapiszWybor(kolejny);
      zastosuj();
      odswiez();
    });

    odswiez();
  }

  document.addEventListener('DOMContentLoaded', podepnijPrzycisk);

  // Eksport do testow - reszta modulu dotyka DOM i localStorage.
  return { rozstrzygnij, WYBORY };
})();
