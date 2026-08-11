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

  function zbudujRozbicie(p) {
    const zrodla = [
      ['Zadania', p.rozbicie.zadania, 'ukończone zadania z wpisaną trudnością i czasem'],
      ['Nawyki', p.rozbicie.nawyki, 'odhaczone nawyki we wpisach dziennika'],
      ['Dziennik', p.rozbicie.dziennik, 'wpisy i wypełnione pola refleksyjne'],
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
    elRozbicie.replaceChildren(tabela);
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
