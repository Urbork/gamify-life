/**
 * Opisy slowne ocen w dzienniku - do plakietek w listach rozwijanych.
 *
 * Ten sam wzorzec co config/slowniki.js: konfiguracja w jednym miejscu,
 * wystawiana przez /api/slowniki, kod jej nie zna.
 *
 * W BAZIE ZAPISUJEMY WYLACZNIE LICZBE. Emoji i opis sa warstwa prezentacji -
 * zmiana slowa "Przecietny" na "Sredni" nie wymaga ruszania ani jednego rekordu.
 * Dlatego kolumny w bazie zostaja INTEGER-ami i statystyki licza sie bez zmian.
 */

/*
  Kolejnosc w tablicach to kolejnosc na liscie rozwijanej: OD NAJLEPSZEJ oceny.
  Przy wystawianiu oceny czesciej siega sie po gorne wartosci, wiec sa pod reka.
*/

/*
  ETYKIETY SA WYSRODKOWANE NA "PRZECIETNY" - to nie jest kosmetyka, tylko poprawka
  do zmierzonego problemu.

  Pomiar na 768 wpisach (sen, spokoj) i 520 (nastroj, intencjonalnosc) pokazal, ze
  skrajnosci sa martwe: piatka padala w 1,2-3,1% wpisow, jedynka przy snie i nastroju
  w 0,7-1,0%. Piec stopni dzialalo w praktyce jak trzy.

  Przyczyna siedziala w slowach, nie w liczbach. Na koncach staly SUPERLATYWY -
  "Znakomity", "Swietny", "Fatalny" - ktore opisuja dzien wyjatkowy, wiec rezerwowalo
  sie je na cos, co zdarza sie pare razy w roku. Skala zwezala sie sama do srodka.

  Druga rzecz: srodek nie stal tam, gdzie trzeba. Nastroj mial mode na 4 (52,9%),
  bo "Neutralny" czyta sie jako brak nastroju, a nie jako nastroj przecietny -
  czlowiek w zwyklym, dobrym humorze nie nazwie go neutralnym. Intencjonalnosc miala
  mode na 2-3, bo gora byla zdefiniowana sama nazwa cechy ("Bardzo intencjonalny"),
  wiec kazdy dzien mniej niz w pelni zaplanowany ladowal na "Malo intencjonalny".

  Stad jednolita drabina: 3 = "Przecietny" w kazdej skali, konce bez superlatywow,
  slowa symetryczne wzgledem srodka.

  UWAGA NA CIAGLOSC DANYCH: to zmienia ZACHOWANIE przy wystawianiu oceny, wiec
  szereg czasowy ma w tym miejscu prog. Liczby w bazie znacza dokladnie to samo
  (piatka to nadal gora skali), przesuwa sie tylko punkt odniesienia. Date zmiany
  odnotowano w docs/PROJEKT.md, zeby dalo sie ja uwzglednic przy porownaniach
  "2024 kontra 2026".
*/
const JAKOSC_SNU = [
  { wartosc: 5, emoji: '🌟', opis: 'Bardzo dobry' },
  { wartosc: 4, emoji: '😴', opis: 'Dobry' },
  { wartosc: 3, emoji: '😐', opis: 'Przeciętny' },
  { wartosc: 2, emoji: '😕', opis: 'Słaby' },
  { wartosc: 1, emoji: '😫', opis: 'Bardzo słaby' },
];

/*
  SPOKOJ - dawniej "Stres".

  Wartosci w bazie sie NIE ZMIENILY: od poczatku 5 znaczylo brak stresu, a 0 stres
  skrajny. Zla byla wylacznie nazwa - przy etykiecie "Stres" wyzsza liczba czytala sie
  jako gorszy wynik, choc znaczyla lepszy, i trzeba to bylo tlumaczyc ostrzezeniem
  w statystykach. Po zmianie nazwy kierunek tlumaczy sie sam: wiecej spokoju to lepiej,
  dokladnie tak jak przy pozostalych ocenach.

  ZAKRES ZOSTAJE 0-5, w odroznieniu od pozostalych ocen (1-5). Sklejenie zera z jedynka
  ujednoliciloby skale, ale bezpowrotnie zatarloby dwanascie dni skrajnego stresu -
  a te dwanascie dni to najrzadszy i przez to najbardziej wymowny sygnal w calym
  dzienniku. Niespojnosc zakresu jest tu tansza niz utrata danych.

  ETYKIET TEJ SKALI NIE RUSZAMY przy srodkowaniu pozostalych. Spokoj jako jedyny
  z czterech nie wymagal poprawki: ma najzdrowszy rozklad (cztery uzywane stopnie
  z szesciu, mode 3 = 35,2%), bo jego slowa od poczatku byly stopniowane wzglednie
  i bez superlatywow. To wlasnie ten wzorzec przeniesiono na pozostale skale.
  Dopisanie mu "Przecietny" dla jednolitosci wymienialoby rzecz dzialajaca
  na rzecz wygladajaca spojnie.
*/
const SPOKOJ = [
  { wartosc: 5, emoji: '🧘', opis: 'Pełny spokój' },
  { wartosc: 4, emoji: '😌', opis: 'Duży spokój' },
  { wartosc: 3, emoji: '🙂', opis: 'Umiarkowany' },
  { wartosc: 2, emoji: '😬', opis: 'Niepokój' },
  { wartosc: 1, emoji: '😰', opis: 'Duży stres' },
  { wartosc: 0, emoji: '🔥', opis: 'Skrajny stres' },
];

const NASTROJ = [
  { wartosc: 5, emoji: '😄', opis: 'Bardzo dobry' },
  { wartosc: 4, emoji: '🙂', opis: 'Dobry' },
  // "Przecietny", a nie "Neutralny": neutralny nastroj czyta sie jako BRAK nastroju,
  // wiec zwykly dobry dzien ladowal na 4 - stad mode 52,9% na czworce.
  { wartosc: 3, emoji: '😐', opis: 'Przeciętny' },
  { wartosc: 2, emoji: '🙁', opis: 'Zły' },
  { wartosc: 1, emoji: '😢', opis: 'Bardzo zły' },
];

/*
  Gora celowo NIE powtarza nazwy cechy. "Bardzo intencjonalny" brzmial jak dzien
  zaplanowany co do godziny, wiec praktycznie nie padal (1,2%), a wszystko ponizej
  ladowalo na "Malo intencjonalny". "Skupiony" jest osiagalne w zwyklym dniu.
*/
const INTENCJONALNOSC = [
  { wartosc: 5, emoji: '🎯', opis: 'Bardzo skupiony' },
  { wartosc: 4, emoji: '🧭', opis: 'Skupiony' },
  { wartosc: 3, emoji: '🤔', opis: 'Przeciętny' },
  { wartosc: 2, emoji: '🤷', opis: 'Rozproszony' },
  { wartosc: 1, emoji: '🌊', opis: 'Zupełnie przypadkowy' },
];

/*
  Klucz odpowiada nazwie kolumny w tabeli `dziennik`, dzieki czemu frontend
  moze siegnac po opisy bez zadnego dodatkowego mapowania.

  Kolumna nazywa sie nadal `stres`, choc pole nazywa sie juz "Spokoj". Zmiana nazwy
  kolumny to migracja calej bazy plus poprawki w profilu importu, eksporcie i kopii
  zapasowej - za duzo ruchu jak na zmiane etykiety. Nazwe kolumny zmienimy przy
  najblizszej migracji, ktora i tak bedzie dotykac dziennika.
*/
const OCENY = {
  jakosc_snu: JAKOSC_SNU,
  stres: SPOKOJ,
  nastroj: NASTROJ,
  intencjonalnosc: INTENCJONALNOSC,
};

module.exports = { OCENY };
