/**
 * Plakietki pol zadan - emoji do etykiet w listach rozwijanych.
 *
 * DLACZEGO OSOBNY PLIK, A NIE mapowanie-ocen.js ANI slowniki.js
 * - config/mapowanie-ocen.js opisuje OCENY DZIENNIKA i jest kluczowane nazwami
 *   kolumn dziennika (jakosc_snu, stres...). Wystawiamy je jako `oceny`, wiec
 *   dolozenie tam pol zadan zlamaloby opisany kontrakt tamtego pliku.
 * - config/slowniki.js to konfiguracja WALIDACJI. STANY i OBSZARY sa plaskimi
 *   tablicami tekstow, ktorych uzywa backend przy sprawdzaniu wartosci; zamiana
 *   ich na obiekty rozlalaby sie po routes/zadania.js i routes/import.js.
 *
 * CENA TEJ DECYZJI: powstaje druga lista obok slownika, a wiec ryzyko rozjazdu -
 * dokladnie to, co w audycie dalo martwe wpisy 'Sub-Type' i 'Research'.
 * Zamykaja je asercje higieny w test/smoke.js: kazdy klucz musi trafiac
 * w wartosc ze slownika i kazda wartosc slownika musi miec plakietke.
 *
 * W BAZIE ZAPISUJEMY WYLACZNIE SUROWA WARTOSC (liczbe albo tekst). Emoji jest
 * warstwa prezentacji - eksport CSV, kopia zapasowa i XP nie wiedza o jego istnieniu.
 */

/*
  TRUDNOSC mieszka tutaj w CALOSCI (wartosc + opis + emoji), bo nie ma jej
  w config/slowniki.js - backend jej nie waliduje slownikiem, tylko zakresem 1-3.
  Wczesniej ta lista byla zaszyta w public/js/zadania.js; zostala stamtad USUNIETA,
  zeby nie powstala druga kopia.

  Kolejnosc w tablicy to kolejnosc na liscie rozwijanej.
*/
const TRUDNOSCI = [
  { wartosc: 1, emoji: '🟢', opis: 'Łatwe' },
  { wartosc: 2, emoji: '🟡', opis: 'Średnie' },
  { wartosc: 3, emoji: '🔴', opis: 'Trudne' },
];

/*
  PRIORYTET i STAN maja swoje wartosci w config/slowniki.js - tutaj sa TYLKO emoji,
  przypisane do wartosci. Dzieki temu dopisanie stanu w slowniku jest widoczne
  od razu (dostanie pusta plakietke), a nie po cichu ignorowane.
*/
const PRIORYTETY = {
  4: '🔥',
  3: '⬆️',
  2: '➡️',
  1: '⬇️',
  0: '⚪',
};

const STANY = {
  Plan: '📋',
  Czeka: '⏳',
  'W trakcie': '⚙️',
  Zrobione: '✅',
  Blok: '🚧',
};

const OBSZARY = {
  Mindset: '🧠',
  Career: '💼',
  Knowledge: '📚',
  Creative: '🎨',
  Health: '❤️',
  Home: '🏠',
  Lifestyle: '🌿',
  Family: '👨‍👩‍👧',
  Finances: '💰',
  'Fun/Relax': '🎮',
  Travel: '✈️',
  Inne: '◽',
};

module.exports = {
  TRUDNOSCI,
  PRIORYTETY,
  STANY,
  OBSZARY,
};
