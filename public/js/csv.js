/*
  Generowanie i pobieranie plikow CSV - modul niezalezny od zadan,
  do wykorzystania takze przez przyszly dziennik i statystyki.

  Wszystko dzieje sie w przegladarce: plik powstaje jako Blob i jest pobierany
  przez sztuczne klikniecie w link. Serwer o eksporcie w ogole nie wie
  i nic nie zapisuje na dysku.
*/

const csv = (() => {
  /*
    Separatorem jest przecinek - tak wyglada standardowy CSV (RFC 4180) i tak czytaja
    go Arkusze Google, LibreOffice oraz kazde narzedzie programistyczne.

    UWAGA NA EXCELA: Excel w polskiej lokalizacji oczekuje SREDNIKA i plik rozdzielony
    przecinkami wrzuci w jedna kolumne. Wtedy albo uzyj w Excelu
    Dane -> Tekst jako kolumny, albo zmien ponizsza stala na ';' - to jedyne miejsce,
    ktore trzeba poprawic.
  */
  const SEPARATOR = ',';

  // CRLF zamiast samego LF - tego wymaga RFC 4180 i tego oczekuje Excel.
  const KONIEC_LINII = '\r\n';

  /*
    BOM (Byte Order Mark) na poczatku pliku. Bez niego Excel czyta plik jako
    Windows-1250/ANSI i polskie znaki zamieniaja sie w krzaki. Inne programy BOM ignoruja.
  */
  // Zapisany jako escape'owany kod, a nie goly znak - goly BOM jest w edytorze niewidoczny.
  const BOM = '\uFEFF';

  /**
   * Przygotowuje pojedyncza wartosc do wstawienia w CSV.
   * Wartosc trafia w cudzyslowy tylko wtedy, gdy naprawde tego wymaga:
   * gdy zawiera separator, cudzyslow albo lamanie linii. Cudzyslowy w tresci
   * podwajamy - tak nakazuje RFC 4180 (Ala "Kot" -> "Ala ""Kot""").
   */
  function komorka(wartosc) {
    if (wartosc === null || wartosc === undefined) return '';

    const tekst = String(wartosc);
    const wymagaCudzyslowow =
      tekst.includes(SEPARATOR) || tekst.includes('"') || /[\r\n]/.test(tekst);

    return wymagaCudzyslowow ? '"' + tekst.replaceAll('"', '""') + '"' : tekst;
  }

  /**
   * Skleja tresc pliku CSV (bez BOM-u).
   * @param {string[]} naglowki
   * @param {Array<Array<*>>} wiersze
   */
  function zbuduj(naglowki, wiersze) {
    const linie = [naglowki, ...wiersze].map((wiersz) => wiersz.map(komorka).join(SEPARATOR));
    return linie.join(KONIEC_LINII);
  }

  /**
   * Buduje plik CSV i uruchamia jego pobieranie.
   * @param {string} nazwaPliku np. 'zadania-eksport-2026-08-08.csv'
   * @param {string[]} naglowki
   * @param {Array<Array<*>>} wiersze
   */
  function pobierz(nazwaPliku, naglowki, wiersze) {
    const blob = new Blob([BOM + zbuduj(naglowki, wiersze)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);

    // Link musi trafic do dokumentu, zeby klikniecie zadzialalo w kazdej przegladarce.
    const link = document.createElement('a');
    link.href = url;
    link.download = nazwaPliku;
    document.body.appendChild(link);
    link.click();
    link.remove();

    // Zwolnienie pamieci po Blobie. Z opoznieniem, bo pobieranie startuje asynchronicznie
    // i zbyt wczesne revoke potrafi je przerwac.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { zbuduj, pobierz };
})();
