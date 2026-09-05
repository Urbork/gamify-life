/*
  Widok postaci: poziom, prestiz, rozbicie XP i wydawanie zlota.

  Cala arytmetyka siedzi na serwerze (lib/nagrody.js) - tutaj jest wylacznie
  pobranie gotowych liczb i zbudowanie DOM. Dzieki temu regul naliczania XP
  nie ma w dwoch implementacjach.

  Strona przelicza sie przy kazdym wejsciu i po kazdej zmianie zakupow -
  nic nie jest cache'owane, bo dane zrodlowe sa jedyna prawda.
*/

(() => {
  'use strict';

  const elWskaznik = document.getElementById('wskaznik');
  const elRozbicie = document.getElementById('rozbicie');
  const elListaZakupow = document.getElementById('lista-zakupow');
  const elFormularz = document.getElementById('formularz-zakupu');
  const elNazwa = document.getElementById('nazwa-zakupu');
  const elKoszt = document.getElementById('koszt-zakupu');
  const elAtrybuty = document.getElementById('atrybuty');
  const elStatus = document.getElementById('status');

  const liczba = (n) => Number(n).toLocaleString('pl');

  function el(tag, klasa, tekst) {
    const e = document.createElement(tag);
    if (klasa) e.className = klasa;
    // textContent, nie innerHTML - nazwy zakupow pochodza od uzytkownika.
    if (tekst !== undefined) e.textContent = tekst;
    return e;
  }

  function pokazStatus(tekst, typ) {
    elStatus.textContent = tekst;
    elStatus.className = 'status ' + (typ || '');
  }

  // ==========================================================================
  // Wskaznik glowny
  // ==========================================================================

  function zbudujWskaznik(p) {
    const naglowek = el('div', 'poziom-naglowek');
    naglowek.append(
      el('span', 'poziom-numer', `Poziom ${p.poziom}`),
      el('span', 'prestiz', etykietaPrestizu(p.prestiz))
    );

    // Pasek postepu w obrebie biezacego poziomu.
    const zdobyteWPoziomie = p.prog_poziomu - p.xp_do_nastepnego_poziomu;
    const procent = (100 * zdobyteWPoziomie) / p.prog_poziomu;

    const tlo = el('div', 'postep-tlo');
    const wypelnienie = el('div', 'postep');
    wypelnienie.style.width = `${procent}%`;
    tlo.appendChild(wypelnienie);

    const opis = el(
      'p',
      'podstawa',
      `${liczba(zdobyteWPoziomie)} / ${liczba(p.prog_poziomu)} XP w tym poziomie · ` +
        `do następnego brakuje ${liczba(p.xp_do_nastepnego_poziomu)} XP`
    );

    const karty = el('div', 'karty');
    karty.append(
      karta('XP łącznie', liczba(p.calkowite_xp)),
      karta('🪙 ZŁOTO', liczba(p.waluta_dostepna), `zarobiono ${liczba(p.waluta_zarobiona)}, wydano ${liczba(p.waluta_wydana)}`)
    );

    elWskaznik.replaceChildren(naglowek, tlo, opis, karty);
  }

  /*
    Korona za kazdy poziom prestizu. Powyzej MAKS_KORON przestajemy je rysowac
    i piszemy mnoznik - dwadziescia koron obok siebie przestaje sie liczyc wzrokiem
    i rozpycha naglowek, a liczba nadal jest czytelna.
  */
  const MAKS_KORON = 5;

  function etykietaPrestizu(prestiz) {
    if (prestiz <= 0) return 'Prestiż 0';
    const korony = prestiz <= MAKS_KORON ? '👑'.repeat(prestiz) : `👑 ×${prestiz}`;
    return `Prestiż ${prestiz} ${korony}`;
  }

  function karta(etykieta, wartosc, podstawa) {
    const k = el('div', 'karta');
    k.append(el('span', 'etykieta', etykieta), el('span', 'liczba', wartosc));
    if (podstawa) k.append(el('span', 'podstawa', podstawa));
    return k;
  }

  /*
    JAK LICZY SIE XP - sekcja wylacznie DO ODCZYTU.

    Rozbicie wyzej pokazuje, ze dziennik daje wiekszosc XP, ale nie tlumaczy DLACZEGO.
    Powod siedzi w czestotliwosci, nie w stawkach: kazde pole wazy 1 XP, ale wpis
    powstaje codziennie i ma osiemnascie miejsc do wypelnienia, a zadanie zamyka
    sie rzadziej i daje tyle, ile godzin przeliczonych na trudnosc.

    DLACZEGO NIE DA SIE TEGO EDYTOWAC W INTERFEJSIE
    XP nie jest nigdzie zapisywane, tylko liczone od zera przy kazdym wejsciu.
    Zmiana stalej przelicza wiec CALA HISTORIE wstecz - i to nie tylko w gore:
    podwojenie stawki za pole podwaja XP, ale poziom potrafi SPASC, bo suma
    przeskakuje prog prestizu i licznik wraca do jedynki. Suwak robilby takie rzeczy
    jednym przeciagnieciem. Wartosci zmienia sie swiadomie w lib/nagrody.js.

    OPISY sa tutaj, a nie przy stalych na serwerze, bo to tekst interfejsu.
    Zgodnosci obu list pilnuje asercja w test/smoke.js - inaczej dopisanie stalej
    bez opisu (albo opisu bez stalej) przeszloby niezauwazone.
  */
  const OPISY_ZASAD = {
    PROG_POZIOMU: 'Ile XP trzeba zebrać, żeby awansować o jeden poziom.',
    POZIOMOW_DO_RESETU: 'Po tylu poziomach licznik wraca do 1, a prestiż rośnie o 1.',
    XP_ZA_UTWORZENIE_WPISU: 'Za sam wpis w dzienniku, nawet gdy nie ma w nim ani jednego pola.',
    XP_ZA_POLE_WPISU: 'Za każde wypełnione pole wpisu. Nawyki liczą się jako jedno pole.',
    DNI_NA_PREMIE: 'Taki zapas dni przed terminem daje mnożnik premiowy do XP zadania.',
    PUNKTY_NA_POZIOM: 'Tyle punktów atrybutów dostajesz za każdy zdobyty poziom.',
  };

  function zbudujZasady(p) {
    if (!p.zasady) return null;

    const sekcja = el('section');
    sekcja.appendChild(el('h2', null, 'Jak liczy się XP'));

    const tabela = el('table');
    const thead = el('thead');
    const trN = el('tr');
    trN.append(el('th', null, 'Ustawienie'), el('th', 'liczbowa', 'Wartość'), el('th', null, 'Znaczenie'));
    thead.appendChild(trN);

    const tbody = el('tbody');
    for (const [klucz, wartosc] of Object.entries(p.zasady)) {
      const tr = el('tr');
      tr.append(
        el('td', null, klucz),
        el('td', 'liczbowa', liczba(wartosc)),
        // Brak opisu nie moze wywrocic strony - asercja i tak to zlapie w testach.
        el('td', null, OPISY_ZASAD[klucz] || '')
      );
      tbody.appendChild(tr);
    }

    tabela.append(thead, tbody);
    sekcja.appendChild(tabela);

    sekcja.appendChild(
      el(
        'p',
        'podstawa',
        'Wartości są stałe i zmienia się je w pliku lib/nagrody.js. Nie ma ich tu do ' +
          'edycji celowo: XP liczy się od zera przy każdym wejściu, więc zmiana ' +
          'dowolnej z nich przelicza całą dotychczasową historię wstecz.'
      )
    );

    return sekcja;
  }

  function zbudujRozbicie(p) {
    const zrodla = [
      ['Zadania', p.rozbicie.zadania, 'ukończone zadania: godziny przeliczone na trudność'],
      ['Dziennik', p.rozbicie.dziennik, 'wpisy i wypełnione w nich pola'],
    ];

    const tabela = el('table');
    const thead = el('thead');
    const trN = el('tr');
    for (const [tekst, liczbowa] of [['Źródło', false], ['XP', true], ['Udział', true], ['', false]]) {
      trN.appendChild(el('th', liczbowa ? 'liczbowa' : null, tekst));
    }
    thead.appendChild(trN);

    const tbody = el('tbody');
    for (const [nazwa, xp, opis] of zrodla) {
      const udzial = p.calkowite_xp === 0 ? 0 : (100 * xp) / p.calkowite_xp;

      const tr = el('tr');
      tr.append(el('td', null, nazwa), el('td', 'liczbowa', liczba(xp)));
      tr.appendChild(el('td', 'liczbowa', `${udzial.toFixed(1)}%`));

      const tdPasek = el('td');
      const tlo = el('span', 'slupek slupek-tlo');
      const wyp = el('span', 'slupek');
      wyp.style.width = `${udzial}%`;
      tlo.appendChild(wyp);
      tdPasek.appendChild(tlo);
      tr.appendChild(tdPasek);

      tr.title = opis;
      tbody.appendChild(tr);
    }

    tabela.append(thead, tbody);

    // Sekcja z zasadami idzie POD rozbiciem - najpierw wynik, potem wyjasnienie.
    const zasady = zbudujZasady(p);
    elRozbicie.replaceChildren(...(zasady ? [tabela, zasady] : [tabela]));
  }

  // ==========================================================================
  // Atrybuty
  // ==========================================================================

  /*
    Jedyna sekcja tej strony, ktora ZAPISUJE. Rozdanie punktow to decyzja
    uzytkownika - nie da sie jej wyliczyc z zadan ani wpisow, wiec musi trafic
    do bazy (tabela `atrybuty`, migracja 8).

    Kazda zmiana leci od razu na serwer, tak jak edycja komorki w zadaniach -
    nie ma przycisku "Zapisz", ktory dalby sie zamknac bez klikniecia.

    POLE LICZBOWE, A NIE SAME PLUSY: przy prestizu 2 pula to ponad czterysta
    punktow, wiec dosypywanie ich po jednym byloby karą, a nie zabawą.
    Przyciski +/- zostaja dla drobnych korekt.
  */

  function wierszAtrybutu(def, stan, wolne) {
    const wiersz = el('div', 'atrybut');

    const nazwa = el('span', 'atrybut-nazwa', `${def.emoji} ${def.etykieta}`);
    nazwa.title = def.opis;

    const obecne = stan.atrybuty[def.klucz] ?? 0;

    const pole = el('input', 'atrybut-pole');
    pole.type = 'number';
    pole.min = '0';
    pole.step = '1';
    pole.value = String(obecne);
    /*
      Gorna granica to obecna wartosc PLUS to, co zostalo wolne. Przegladarka
      pilnuje jej tylko miekko (strzalkami), wiec twarda kontrola i tak jest
      po stronie serwera - to wylacznie podpowiedz dla klikajacego.
    */
    pole.max = String(Math.max(0, obecne + wolne));
    pole.addEventListener('change', () => zapiszAtrybut(def.klucz, pole.value));

    const minus = el('button', 'atrybut-krok', '−');
    minus.type = 'button';
    minus.disabled = obecne <= 0;
    minus.addEventListener('click', () => zapiszAtrybut(def.klucz, obecne - 1));

    const plus = el('button', 'atrybut-krok', '+');
    plus.type = 'button';
    plus.disabled = wolne <= 0;
    plus.addEventListener('click', () => zapiszAtrybut(def.klucz, obecne + 1));

    wiersz.append(nazwa, minus, pole, plus);
    return wiersz;
  }

  function zbudujAtrybuty(p, definicje) {
    if (!p.punkty || !definicje) return;

    const wolne = p.punkty.wolne;

    const naglowek = el('div', 'atrybuty-naglowek');
    naglowek.append(
      el('span', 'atrybuty-wolne', `Wolne punkty: ${liczba(wolne)}`),
      el('span', 'podstawa', `z ${liczba(p.punkty.lacznie)} zdobytych · rozdano ${liczba(p.punkty.rozdane)}`)
    );

    const wiersze = definicje.map((def) => wierszAtrybutu(def, p, wolne));

    const reset = el('button', null, 'Resetuj punkty');
    reset.type = 'button';
    reset.addEventListener('click', resetujAtrybuty);

    const stopka = el('p', 'podstawa');
    stopka.append(
      document.createTextNode(
        `Każdy zdobyty poziom daje ${p.zasady ? p.zasady.PUNKTY_NA_POZIOM : 2} punkty. `
      ),
      reset
    );

    const dzieci = [naglowek, ...wiersze, stopka];

    /*
      Pula potrafi ZMALEC - poziom liczy sie na zywo, wiec poprawienie starego
      zadania albo zmiana stalych XP moze cofnac postac o kilka poziomow.
      Rozdanych punktow wtedy nie kasujemy po cichu; mowimy o tym wprost,
      bo jedynym wyjsciem jest swiadomy reset.
    */
    if (wolne < 0) {
      const ostrzezenie = el(
        'p',
        'uwaga-punkty',
        `Rozdano ${liczba(p.punkty.rozdane)} punktów, a po przeliczeniu poziomu ` +
          `dostępnych jest ${liczba(p.punkty.lacznie)}. Punkty zostały nietknięte — ` +
          'żeby rozdać je od nowa, użyj przycisku poniżej.'
      );
      dzieci.unshift(ostrzezenie);
    }

    elAtrybuty.replaceChildren(...dzieci);
  }

  async function zapiszAtrybut(klucz, wartosc) {
    const n = Number(wartosc);
    if (!Number.isInteger(n) || n < 0) {
      pokazStatus('punkty muszą być liczbą całkowitą nie mniejszą niż 0', 'blad');
      await wczytaj();
      return;
    }

    try {
      await api.patch('/api/atrybuty', { [klucz]: n });
      await wczytaj();
      pokazStatus('zapisano punkty', 'ok');
    } catch (err) {
      // Serwer odrzuca rozdanie ponad pule - jego komunikat niesie konkretne liczby.
      pokazStatus(err.message, 'blad');
      // Przywracamy widok do stanu z bazy, zeby pole nie zostalo z wartoscia,
      // ktorej nikt nie zapisal.
      await wczytaj();
    }
  }

  async function resetujAtrybuty() {
    if (!confirm('Wyzerować wszystkie punkty atrybutów? Rozdasz je od nowa.')) return;

    try {
      await api.post('/api/atrybuty/reset', {});
      await wczytaj();
      pokazStatus('punkty wyzerowane', 'ok');
    } catch (err) {
      pokazStatus(err.message, 'blad');
    }
  }

  // ==========================================================================
  // Zakupy
  // ==========================================================================

  function zbudujListeZakupow(zakupy) {
    if (zakupy.length === 0) {
      elListaZakupow.replaceChildren(el('p', 'brak-danych', 'Nic jeszcze nie kupiono.'));
      return;
    }

    const tabela = el('table');
    const thead = el('thead');
    const trN = el('tr');
    for (const [tekst, liczbowa] of [['Data', false], ['Na co', false], ['Koszt', true], ['', false]]) {
      trN.appendChild(el('th', liczbowa ? 'liczbowa' : null, tekst));
    }
    thead.appendChild(trN);

    const tbody = el('tbody');
    for (const z of zakupy) {
      const tr = el('tr');
      tr.append(el('td', null, z.data), el('td', null, z.nazwa), el('td', 'liczbowa', liczba(z.koszt)));

      const tdAkcje = el('td', 'kol-akcje');
      const btn = el('button', 'usun', '×');
      btn.type = 'button';
      btn.title = 'Cofnij zakup (złoto wraca)';
      btn.addEventListener('click', () => cofnijZakup(z));
      tdAkcje.appendChild(btn);
      tr.appendChild(tdAkcje);

      tbody.appendChild(tr);
    }

    tabela.append(thead, tbody);
    elListaZakupow.replaceChildren(tabela);
  }

  async function dodajZakup(e) {
    e.preventDefault();

    const nazwa = elNazwa.value.trim();
    const koszt = elKoszt.value;
    if (nazwa === '' || koszt === '') return;

    try {
      await api.post('/api/zakupy', { nazwa, koszt: Number(koszt) });
      elNazwa.value = '';
      elKoszt.value = '';
      await wczytaj();
      pokazStatus('zapisano zakup', 'ok');
    } catch (err) {
      // Serwer odrzuca zakup ponad stan konta - pokazujemy jego komunikat,
      // bo zawiera konkretne liczby (ile brakuje).
      pokazStatus(err.message, 'blad');
    }
  }

  async function cofnijZakup(zakup) {
    if (!confirm(`Cofnąć zakup „${zakup.nazwa}" za ${zakup.koszt}? Złoto wróci na konto.`)) return;

    try {
      await api.usun(`/api/zakupy/${zakup.id}`);
      await wczytaj();
      pokazStatus('cofnięto zakup', 'ok');
    } catch (err) {
      pokazStatus(err.message, 'blad');
    }
  }

  // ==========================================================================
  // Start
  // ==========================================================================

  /*
    Definicje atrybutow (nazwy, emoji, opisy) pobieramy RAZ - to konfiguracja,
    ktora nie zmienia sie miedzy zapisami. Wartosci punktow ida z /api/postac
    przy kazdym odswiezeniu.
  */
  let definicjeAtrybutow = null;

  async function wczytaj() {
    const [postac, zakupy] = await Promise.all([api.get('/api/postac'), api.get('/api/zakupy')]);
    zbudujWskaznik(postac);
    zbudujAtrybuty(postac, definicjeAtrybutow);
    zbudujRozbicie(postac);
    zbudujListeZakupow(zakupy);
    return postac;
  }

  async function start() {
    try {
      definicjeAtrybutow = (await api.get('/api/slowniki')).atrybuty;
      const postac = await wczytaj();
      pokazStatus(`przeliczono ${liczba(postac.calkowite_xp)} XP`, 'ok');
    } catch (e) {
      elWskaznik.replaceChildren(el('p', 'brak-danych', 'Nie udało się wczytać danych.'));
      pokazStatus(e.message, 'blad');
    }
  }

  elFormularz.addEventListener('submit', dodajZakup);

  start();
})();
