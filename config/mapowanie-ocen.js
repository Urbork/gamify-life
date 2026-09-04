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

const JAKOSC_SNU = [
  { wartosc: 5, emoji: '🌟', opis: 'Znakomity' },
  { wartosc: 4, emoji: '😴', opis: 'Dobry' },
  { wartosc: 3, emoji: '😐', opis: 'Przeciętny' },
  { wartosc: 2, emoji: '😕', opis: 'Słaby' },
  { wartosc: 1, emoji: '😫', opis: 'Fatalny' },
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
  { wartosc: 5, emoji: '😄', opis: 'Świetny' },
  { wartosc: 4, emoji: '🙂', opis: 'Dobry' },
  { wartosc: 3, emoji: '😐', opis: 'Neutralny' },
  { wartosc: 2, emoji: '🙁', opis: 'Słaby' },
  { wartosc: 1, emoji: '😢', opis: 'Zły' },
];

const INTENCJONALNOSC = [
  { wartosc: 5, emoji: '🎯', opis: 'Bardzo intencjonalny' },
  { wartosc: 4, emoji: '🧭', opis: 'Intencjonalny' },
  { wartosc: 3, emoji: '🤔', opis: 'Umiarkowany' },
  { wartosc: 2, emoji: '🤷', opis: 'Mało intencjonalny' },
  { wartosc: 1, emoji: '🌊', opis: 'Przypadkowy' },
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
