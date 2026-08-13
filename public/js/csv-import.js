/*
  Import z CSV - strona przegladarki.

  PRZEPLYW (dwuetapowy, celowo)
  1. wybor pliku  -> File.text() -> POST /api/import/:profil/podglad
  2. podglad      -> ile wierszy wejdzie, ktore odpadaja i dlaczego
  3. zatwierdzenie-> POST /api/import/:profil/zatwierdz z TA SAMA trescia pliku

  PROFIL trafia do adresu jako parametr - rejestr PROFILE w routes/import.js
  przyjmuje go wprost. Skad go bierzemy, zalezy od strony:
    - strona zadan    - z listy wyboru #profil-importu (dwa zrodla: eksport wlasny
                        albo eksport "Success Plan" z Notion),
    - strona dziennika - z atrybutu data-profil na przycisku (jeden profil, bez listy).

  Do serwera leci zwykly JSON { tresc }, nie multipart - dzieki temu backend
  nie potrzebuje zadnej biblioteki do obslugi przesylania plikow.

  Tresc pliku trzymamy w pamieci miedzy krokami i wysylamy ponownie przy
  zatwierdzeniu. Serwer parsuje ja drugi raz, zamiast ufac wynikom z przegladarki -
  inaczej dalo by sie tym kanalem wstawic do bazy cokolwiek, omijajac walidacje.

  Modul nie siega do wnetrza zadania.js. Po udanym imporcie wysyla zdarzenie
  'dane-<tabela>-zmienione' dla kazdej ruszonej tabeli, a moduly stron je lapia
  i przeladowuja swoje listy (patrz ZMIENIANE_TABELE nizej).
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

  // Lista wyboru profilu - jest tylko tam, gdzie profil da sie wybrac (strona zadan).
  const elProfil = document.getElementById('profil-importu');

  /*
    Ktore tabele zmienia dany profil.

    Nazwa zdarzenia NIE moze wynikac z nazwy profilu: "notion-quest-log" wysylalby
    zdarzenie "dane-notion-quest-log-zmienione", ktorego nikt nie sluchа, wiec tabela
    nie odswiezylaby sie po imporcie. Poza tym ten profil zapisuje do DWOCH tabel
    naraz, wiec jedno zdarzenie i tak by nie wystarczylo.
  */
  const ZMIENIANE_TABELE = {
    zadania: ['zadania'],
    dziennik: ['dziennik'],
    'notion-quest-log': ['projekty', 'zadania'],
  };

  /*
    Profil odczytujemy PRZY KAZDYM UZYCIU, a nie raz przy starcie - inaczej zmiana
    w liscie wyboru nie mialaby zadnego skutku.

    Strona dziennika nie ma listy wyboru i podaje profil atrybutem data-profil
    na przycisku; oba sposoby obsluguje ta sama funkcja.
  */
  function aktualnyProfil() {
    if (elProfil && elProfil.value) return elProfil.value;
    return elPrzyciskImport.dataset.profil || 'zadania';
  }

  // Tresc wybranego pliku - potrzebna jeszcze raz przy zatwierdzaniu.
  let trescPliku = null;

  /*
    Profil UZYTY DO PODGLADU. Zatwierdzenie musi isc dokladnie tym samym profilem,
    ktorym liczony byl podglad - inaczej przestawienie listy przy otwartym podgladzie
    zapisaloby dane wedlug innego mapowania niz to, ktore uzytkownik zobaczyl.
    Dodatkowo blokujemy liste na czas podgladu, zeby bylo to widoczne.
  */
  let profilPodgladu = null;

  function pokazStatus(tekst, typ) {
    elStatus.textContent = tekst;
    elStatus.className = 'status ' + (typ || '');
  }

  function schowajPanel() {
    elPanel.hidden = true;
    trescPliku = null;
    profilPodgladu = null;
    if (elProfil) elProfil.disabled = false;
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
    /*
      Nazwa profilu w podgladzie. Przy dwoch zrodlach na jednej stronie latwo
      wczytac plik nie tym mapowaniem i zobaczyc same odrzucone wiersze, nie wiedzac
      dlaczego. Na stronie dziennika listy nie ma i ta uwaga sie nie pojawia.
    */
    if (elProfil) {
      const opcja = elProfil.selectedOptions[0];
      uwagi.push(`profil: ${opcja ? opcja.textContent.trim() : profilPodgladu}`);
    }
    if (wynik.separator !== ',') {
      uwagi.push(`wykryty separator: "${wynik.separator === '\t' ? 'tabulator' : wynik.separator}"`);
    }
    if (wynik.nieznaneKolumny.length > 0) {
      uwagi.push(`kolumny pominięte (brak w mapowaniu): ${wynik.nieznaneKolumny.join(', ')}`);
    }
    uwagi.push('dane zostaną dopisane, nic istniejącego nie zostanie nadpisane');
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
      profilPodgladu = aktualnyProfil();
      const wynik = await api.post(`/api/import/${profilPodgladu}/podglad`, { tresc: trescPliku });
      // Lista zablokowana dopoki podglad jest otwarty - patrz komentarz przy profilPodgladu.
      if (elProfil) elProfil.disabled = true;
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
      // Celowo profilPodgladu, nie aktualnyProfil() - zapis musi isc tym samym
      // mapowaniem, ktore policzylo pokazany przed chwila podglad.
      const uzytyProfil = profilPodgladu;
      const wynik = await api.post(`/api/import/${uzytyProfil}/zatwierdz`, { tresc: trescPliku });
      schowajPanel();
      pokazStatus(`zaimportowano ${wynik.zaimportowano} wierszy`, 'ok');

      /*
        Tabela zyje w osobnym module - dajemy mu znac, ze dane sie zmienily.
        Zdarzenie idzie per TABELA, nie per profil: strony nasluchuja niezaleznie
        i nie przeladowuja sie nawzajem, a profil ruszajacy dwie tabele naraz
        (notion-quest-log) odswieza jedno i drugie.
      */
      for (const tabela of ZMIENIANE_TABELE[uzytyProfil] || [uzytyProfil]) {
        document.dispatchEvent(new CustomEvent(`dane-${tabela}-zmienione`));
      }
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
