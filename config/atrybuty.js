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
    etykieta: 'Strength',
    emoji: '💪',
    opis: 'How much you can lift in a single effort.',
  },
  {
    klucz: 'zrecznosc',
    etykieta: 'Agility',
    emoji: '🤸',
    opis: 'Precision and reaction speed.',
  },
  {
    klucz: 'witalnosc',
    etykieta: 'Vitality',
    emoji: '❤️',
    opis: 'Energy reserve and recovery rate.',
  },
];

/*
  Klucze same w sobie - wystawiamy je osobno, bo walidacja w routes/postac.js
  potrzebuje wylacznie listy dozwolonych nazw, bez calej reszty opisu.
*/
const KLUCZE_ATRYBUTOW = ATRYBUTY.map((a) => a.klucz);

module.exports = { ATRYBUTY, KLUCZE_ATRYBUTOW };
