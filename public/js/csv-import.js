/*
  Import z CSV - strona przegladarki.

  PRZEPLYW (dwuetapowy, celowo)
  1. wybor pliku  -> File.text() -> POST /api/import/podglad
  2. podglad      -> ile wierszy wejdzie, ktore odpadaja i dlaczego
  3. zatwierdzenie-> POST /api/import/zatwierdz z TA SAMA trescia pliku

  Do serwera leci zwykly JSON { tresc }, nie multipart - dzieki temu backend
  nie potrzebuje zadnej biblioteki do obslugi przesylania plikow.

  Tresc pliku trzymamy w pamieci miedzy krokami i wysylamy ponownie przy
  zatwierdzeniu. Serwer parsuje ja drugi raz, zamiast ufac wynikom z przegladarki -
  inaczej dalo by sie tym kanalem wstawic do bazy cokolwiek, omijajac walidacje.

  Modul nie siega do wnetrza zadania.js. Po udanym imporcie wysyla zdarzenie
  'dane-zadan-zmienione', ktorego zadania.js sluchaja i przeladowuja liste.
  Przyszly dziennik moze uzyc dokladnie tego samego mechanizmu.
*/

(() => {
  'use strict';

  const elPrzyciskImport = document.getElementById('przycisk-import');
  const elPlik = document.getElementById('plik-importu');
  const elPanel = document.getElementById('panel-importu');
  const elNaglowek = document.getElementById('import-naglowek');
  const elUwagi = document.getElementById('import-uwagi');
  const elOdrzucone = document.getElementById('import-odrzucone');
  const elZatwierdz = document.getElementById('przycisk-zatwierdz-import');
  const elAnuluj = document.getElementById('przycisk-anuluj-import');
  const elStatus = document.getElementById('status');

  /*
    Profil importu bierzemy z atrybutu data-profil na przycisku, dzieki czemu ten
    sam plik obsluguje strone zadan i strone dziennika. Odpowiada kluczowi
    w rejestrze PROFILE w routes/import.js.
  */
  const profil = elPrzyciskImport.dataset.profil || 'zadania';

  // Tresc wybranego pliku - potrzebna jeszcze raz przy zatwierdzaniu.
  let trescPliku = null;

  function pokazStatus(tekst, typ) {
    elStatus.textContent = tekst;
    elStatus.className = 'status ' + (typ || '');
  }

  function schowajPanel() {
    elPanel.hidden = true;
    trescPliku = null;
    elOdrzucone.replaceChildren();
    // Czyscimy input, zeby ponowny wybor TEGO SAMEGO pliku znowu wywolal 'change'.
    elPlik.value = '';
  }

  /** Buduje tabelke odrzuconych wierszy: numer linii w pliku, nazwa, powod. */
  function tabelaOdrzuconych(odrzucone) {
    const tabela = document.createElement('table');
    tabela.className = 'tabela-odrzuconych';

    const thead = document.createElement('thead');
    const naglowki = document.createElement('tr');
    for (const tekst of ['Linia', 'Nazwa', 'Powód odrzucenia']) {
      const th = document.createElement('th');
      th.textContent = tekst;
      naglowki.appendChild(th);
    }
    thead.appendChild(naglowki);

    const tbody = document.createElement('tbody');
    for (const o of odrzucone) {
      const tr = document.createElement('tr');
      for (const tekst of [o.linia, o.nazwa || '(pusta)', o.powod]) {
        const td = document.createElement('td');
        // textContent, nie innerHTML - tresc pochodzi z pliku, nie ufamy jej.
        td.textContent = tekst;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    tabela.append(thead, tbody);
    return tabela;
  }

  function pokazPodglad(wynik) {
    elNaglowek.textContent = `Podgląd importu: ${wynik.gotowych} gotowych do zaimportowania, ${wynik.odrzuconych} odrzuconych`;

    const uwagi = [];
    if (wynik.separator !== ',') {
      uwagi.push(`wykryty separator: "${wynik.separator === '\t' ? 'tabulator' : wynik.separator}"`);
    }
    if (wynik.nieznaneKolumny.length > 0) {
      uwagi.push(`kolumny pominięte (brak w mapowaniu): ${wynik.nieznaneKolumny.join(', ')}`);
    }
    uwagi.push('zadania zostaną dopisane, nic istniejącego nie zostanie nadpisane');
    elUwagi.textContent = uwagi.join(' · ');

    elOdrzucone.replaceChildren();
    if (wynik.odrzuconych > 0) elOdrzucone.appendChild(tabelaOdrzuconych(wynik.odrzucone));

    // Nie ma czego zatwierdzac, gdy wszystko odpadlo.
    elZatwierdz.disabled = wynik.gotowych === 0;
    elPanel.hidden = false;
  }

  async function wybranoPlik() {
    const plik = elPlik.files[0];
    if (!plik) return;

    try {
      // File.text() dekoduje jako UTF-8; ewentualny BOM usuwa parser po stronie serwera.
      trescPliku = await plik.text();
      const wynik = await api.post(`/api/import/${profil}/podglad`, { tresc: trescPliku });
      pokazPodglad(wynik);
      pokazStatus(`wczytano plik: ${plik.name}`, 'ok');
    } catch (e) {
      schowajPanel();
      pokazStatus('Import: ' + e.message, 'blad');
    }
  }

  async function zatwierdz() {
    if (trescPliku === null) return;

    elZatwierdz.disabled = true;
    try {
      const wynik = await api.post(`/api/import/${profil}/zatwierdz`, { tresc: trescPliku });
      schowajPanel();
      pokazStatus(`zaimportowano ${wynik.zaimportowano} wierszy`, 'ok');

      // Tabela zyje w osobnym module - dajemy mu znac, ze dane sie zmienily.
      // Nazwa zdarzenia zalezy od profilu, wiec strona zadan i strona dziennika
      // nasluchuja niezaleznie i nie przeladowuja sie nawzajem.
      document.dispatchEvent(new CustomEvent(`dane-${profil}-zmienione`));
    } catch (e) {
      elZatwierdz.disabled = false;
      pokazStatus('Import: ' + e.message, 'blad');
    }
  }

  elPrzyciskImport.addEventListener('click', () => elPlik.click());
  elPlik.addEventListener('change', wybranoPlik);
  elZatwierdz.addEventListener('click', zatwierdz);
  elAnuluj.addEventListener('click', () => {
    schowajPanel();
    pokazStatus('import anulowany', 'ok');
  });
})();
