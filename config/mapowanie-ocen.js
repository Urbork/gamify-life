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
  STRES MA SKALE ODWROCONA wzgledem pozostalych ocen: 0 = najgorzej (bardzo wysoki
  stres), 5 = najlepiej (brak stresu). Tak jest w zrodle danych i tego nie zmieniamy.

  Opisy slowne sa tu szczegolnie wazne: to one sprawiaja, ze przy wystawianiu oceny
  nie trzeba pamietac, w ktora strone leci skala. Widok statystyk osobno ostrzega
  o tym przy sredniej.
*/
const STRES = [
  { wartosc: 5, emoji: '🧘', opis: 'Brak stresu' },
  { wartosc: 4, emoji: '😌', opis: 'Bardzo niski' },
  { wartosc: 3, emoji: '🙂', opis: 'Niski' },
  { wartosc: 2, emoji: '😬', opis: 'Średni' },
  { wartosc: 1, emoji: '😰', opis: 'Wysoki' },
  { wartosc: 0, emoji: '🔥', opis: 'Bardzo wysoki' },
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
*/
const OCENY = {
  jakosc_snu: JAKOSC_SNU,
  stres: STRES,
  nastroj: NASTROJ,
  intencjonalnosc: INTENCJONALNOSC,
};

module.exports = { OCENY };
