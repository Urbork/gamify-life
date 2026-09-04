/*
  Widok postaci: poziom, prestiz, rozbicie XP i wydawanie waluty.

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
      el('span', 'prestiz', p.prestiz > 0 ? `Prestiż ${p.prestiz}` : 'Prestiż 0')
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
      karta('Waluta dostępna', liczba(p.waluta_dostepna), `zarobiono ${liczba(p.waluta_zarobiona)}, wydano ${liczba(p.waluta_wydana)}`)
    );

    elWskaznik.replaceChildren(naglowek, tlo, opis, karty);
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
      btn.title = 'Cofnij zakup (waluta wraca)';
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
    if (!confirm(`Cofnąć zakup „${zakup.nazwa}" za ${zakup.koszt}? Waluta wróci na konto.`)) return;

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

  async function wczytaj() {
    const [postac, zakupy] = await Promise.all([api.get('/api/postac'), api.get('/api/zakupy')]);
    zbudujWskaznik(postac);
    zbudujRozbicie(postac);
    zbudujListeZakupow(zakupy);
    return postac;
  }

  async function start() {
    try {
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
