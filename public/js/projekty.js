/*
  Widok tabeli projektow: edycja inline, dodawanie, usuwanie.

  Ten sam wzorzec co zadania i dziennik:
  - `projekty` to lokalna kopia bazy (Map: id -> rekord),
  - kazda zmiana leci od razu PATCH-em, odpowiedz serwera nadpisuje kopie,
  - nieudany zapis cofa komorke, zeby tabela nie pokazywala czegos,
    czego nie ma w bazie.

  Projekt jest KONTENEREM - nie daje XP. Licznik "X/Y" liczy serwer
  (GET /api/projekty), zeby nie sciagac wszystkich zadan tylko po to,
  zeby je tu zliczyc.
*/

(() => {
  'use strict';

  const projekty = new Map();
  let stany = [];

  const elWiersze = document.getElementById('wiersze');
  const elStatus = document.getElementById('status');
  const elPodsumowanie = document.getElementById('podsumowanie');
  const elDodaj = document.getElementById('przycisk-dodaj');

  let timerStatusu = null;

  function pokazStatus(tekst, typ) {
    elStatus.textContent = tekst;
    elStatus.className = 'status ' + (typ || '');
    clearTimeout(timerStatusu);
    timerStatusu = setTimeout(
      () => {
        elStatus.textContent = '';
        elStatus.className = 'status';
      },
      typ === 'blad' ? 8000 : 1500
    );
  }

  // ==========================================================================
  // Komorki
  // ==========================================================================

  function komorkaId(p) {
    const td = document.createElement('td');
    td.className = 'kol-id';
    td.textContent = p.id;
    return td;
  }

  /** Komorka tekstowa (contenteditable). Zapis przy opuszczeniu pola. */
  function komorkaTekst(p, pole, klasa) {
    const td = document.createElement('td');
    td.className = klasa;
    td.dataset.pole = pole;
    td.contentEditable = 'true';
    // textContent, nie innerHTML - tresc od uzytkownika nigdy nie jest HTML-em.
    td.textContent = p[pole] ?? '';

    td.addEventListener('blur', () => {
      const nowa = td.textContent.trim();
      const rekord = projekty.get(p.id);
      if (!rekord) return;
      if (nowa === (rekord[pole] ?? '')) return;
      zapisz(td.closest('tr'), pole, nowa);
    });

    td.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        td.blur();
      }
      if (e.key === 'Escape') {
        const rekord = projekty.get(p.id);
        td.textContent = rekord ? rekord[pole] ?? '' : '';
        td.blur();
      }
    });

    return td;
  }

  /** Status projektu - ta sama zamknieta lista co stan zadania. */
  function komorkaStatusu(p) {
    const td = document.createElement('td');
    td.className = 'kol-stan';
    td.dataset.pole = 'status';

    const select = document.createElement('select');
    for (const s of stany) select.appendChild(new Option(s, s));

    // Wartosc spoza slownika dopisujemy, zeby edycja innej kolumny
    // nie podmienila jej po cichu na pierwsza z listy.
    if (p.status && !stany.includes(p.status)) {
      select.appendChild(new Option(p.status + ' (spoza listy)', p.status));
    }

    select.value = p.status ?? '';
    select.addEventListener('change', () => zapisz(td.closest('tr'), 'status', select.value));

    td.appendChild(select);
    return td;
  }

  /** Licznik ukonczonych zadan wraz z paskiem postepu. */
  function komorkaPostepu(p) {
    const td = document.createElement('td');
    td.className = 'kol-postep';
    td.dataset.wyliczane = 'postep';

    const lacznie = p.zadan_lacznie ?? 0;
    const ukonczone = p.zadan_ukonczonych ?? 0;

    td.appendChild(document.createTextNode(`${ukonczone}/${lacznie}`));

    // Pasek tylko wtedy, gdy jest co pokazywac - przy zerze bylby mylacy.
    if (lacznie > 0) {
      const tlo = document.createElement('span');
      tlo.className = 'slupek slupek-tlo';
      const wyp = document.createElement('span');
      wyp.className = 'slupek';
      wyp.style.width = `${(100 * ukonczone) / lacznie}%`;
      tlo.appendChild(wyp);
      td.appendChild(tlo);
    }

    td.title = `Ukończone zadania: ${ukonczone} z ${lacznie}`;
    return td;
  }

  function komorkaUsun(p) {
    const td = document.createElement('td');
    td.className = 'kol-akcje';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'usun';
    btn.textContent = '×';
    btn.title = 'Usuń projekt (zadania zostaną, tylko się odepną)';
    btn.addEventListener('click', () => usunProjekt(p.id));

    td.appendChild(btn);
    return td;
  }

  function zbudujWiersz(p) {
    const tr = document.createElement('tr');
    tr.dataset.id = p.id;
    tr.dataset.stan = p.status; // CSS wyszarza wiersze "Zrobione"

    tr.append(
      komorkaId(p),
      komorkaTekst(p, 'nazwa', 'kol-nazwa'),
      komorkaStatusu(p),
      komorkaTekst(p, 'opis', 'kol-opis'),
      komorkaPostepu(p),
      komorkaUsun(p)
    );
    return tr;
  }

  // ==========================================================================
  // Renderowanie
  // ==========================================================================

  function renderuj() {
    // Kolejnosc po id - projektow jest niewiele, wiec sortowanie po kolumnach
    // bylo by tu nadmiarowe.
    const lista = [...projekty.values()].sort((a, b) => a.id - b.id);
    elWiersze.replaceChildren(...lista.map(zbudujWiersz));

    const ukonczonych = lista.filter((p) => p.status === 'Zrobione').length;
    elPodsumowanie.textContent =
      lista.length === 0
        ? 'Brak projektów.'
        : `Projektów: ${lista.length} (ukończonych: ${ukonczonych})`;
  }

  function przywrocKomorke(tr, pole) {
    const p = projekty.get(Number(tr.dataset.id));
    const td = tr.querySelector(`[data-pole="${pole}"]`);
    if (!p || !td) return;

    const kontrolka = td.querySelector('select, input');
    if (kontrolka) kontrolka.value = p[pole] ?? '';
    else td.textContent = p[pole] ?? '';
  }

  // ==========================================================================
  // Operacje na danych
  // ==========================================================================

  async function zapisz(tr, pole, wartosc) {
    const id = Number(tr.dataset.id);
    try {
      const zaktualizowany = await api.patch(`/api/projekty/${id}`, { [pole]: wartosc });

      /*
        Odpowiedz PATCH-a nie zawiera licznikow zadan (liczy je tylko GET),
        wiec zachowujemy je z poprzedniej wersji rekordu - inaczej "X/Y"
        znikaloby po kazdej edycji nazwy.
      */
      const poprzedni = projekty.get(id) ?? {};
      projekty.set(id, {
        ...zaktualizowany,
        zadan_lacznie: poprzedni.zadan_lacznie ?? 0,
        zadan_ukonczonych: poprzedni.zadan_ukonczonych ?? 0,
      });

      tr.classList.remove('blad-zapisu');
      tr.dataset.stan = zaktualizowany.status;
      renderuj();
      pokazStatus('zapisano', 'ok');
    } catch (e) {
      tr.classList.add('blad-zapisu');
      przywrocKomorke(tr, pole);
      pokazStatus(e.message, 'blad');
    }
  }

  async function dodajProjekt() {
    try {
      const nowy = await api.post('/api/projekty');
      projekty.set(nowy.id, { ...nowy, zadan_lacznie: 0, zadan_ukonczonych: 0 });
      renderuj();

      const tr = elWiersze.querySelector(`tr[data-id="${nowy.id}"]`);
      if (tr) {
        // Zaznaczamy nazwe zastepcza, zeby pierwsze wpisane znaki ja nadpisaly.
        const td = tr.querySelector('[data-pole="nazwa"]');
        td.focus();
        const zakres = document.createRange();
        zakres.selectNodeContents(td);
        const zaznaczenie = window.getSelection();
        zaznaczenie.removeAllRanges();
        zaznaczenie.addRange(zakres);
      }
    } catch (e) {
      pokazStatus(e.message, 'blad');
    }
  }

  async function usunProjekt(id) {
    const p = projekty.get(id);
    const ile = p ? p.zadan_lacznie ?? 0 : 0;

    /*
      Ostrzezenie MUSI mowic, co dzieje sie z zadaniami - inaczej latwo
      pomyslec, ze usuwa sie je razem z projektem. Klucz obcy ma ON DELETE
      SET NULL, wiec zadania zostaja i tylko traca przypisanie.
    */
    const opis =
      ile > 0
        ? `Usunąć projekt „${p.nazwa}"?\n\n${ile} ${ile === 1 ? 'zadanie zostanie' : 'zadań zostanie'} ODPIĘTE, ale NIE usunięte — pozostaną jako zadania luźne.`
        : `Usunąć projekt „${p ? p.nazwa : id}"?`;
    if (!confirm(opis)) return;

    try {
      await api.usun(`/api/projekty/${id}`);
      projekty.delete(id);
      renderuj();
      pokazStatus(ile > 0 ? `usunięto, odpięto zadań: ${ile}` : 'usunięto', 'ok');
    } catch (e) {
      pokazStatus(e.message, 'blad');
    }
  }

  // ==========================================================================
  // Start
  // ==========================================================================

  async function start() {
    try {
      const [slowniki, lista] = await Promise.all([
        api.get('/api/slowniki'),
        api.get('/api/projekty'),
      ]);
      stany = slowniki.stany;

      projekty.clear();
      for (const p of lista) projekty.set(p.id, p);
      renderuj();
    } catch (e) {
      pokazStatus('Nie udało się wczytać danych: ' + e.message, 'blad');
    }
  }

  elDodaj.addEventListener('click', dodajProjekt);

  start();
})();
