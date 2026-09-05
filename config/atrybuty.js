/**
 * Atrybuty postaci - nazwy, emoji i opisy.
 *
 * Ten sam wzorzec co config/slowniki.js i config/plakietki-zadan.js: konfiguracja
 * w jednym miejscu, wystawiana przez /api/slowniki, kod jej nie zna z nazwy.
 *
 * KLUCZ jest tym, co siedzi w kolumnie `nazwa` tabeli `atrybuty`, i tego NIE
 * zmieniamy bez migracji. Etykieta, emoji i opis to warstwa prezentacji - zmiana
 * slowa "Witalnosc" na "Kondycja" nie wymaga ruszania ani jednego rekordu.
 *
 * Kolejnosc w tablicy to kolejnosc na ekranie.
 */

const ATRYBUTY = [
  {
    klucz: 'sila',
    etykieta: 'Siła',
    emoji: '💪',
    opis: 'Ile ciężaru udźwigniesz w jednym podejściu.',
  },
  {
    klucz: 'zrecznosc',
    etykieta: 'Zręczność',
    emoji: '🤸',
    opis: 'Precyzja i szybkość reakcji.',
  },
  {
    klucz: 'witalnosc',
    etykieta: 'Witalność',
    emoji: '❤️',
    opis: 'Zapas energii i tempo regeneracji.',
  },
];

/*
  Klucze same w sobie - wystawiamy je osobno, bo walidacja w routes/postac.js
  potrzebuje wylacznie listy dozwolonych nazw, bez calej reszty opisu.
*/
const KLUCZE_ATRYBUTOW = ATRYBUTY.map((a) => a.klucz);

module.exports = { ATRYBUTY, KLUCZE_ATRYBUTOW };
