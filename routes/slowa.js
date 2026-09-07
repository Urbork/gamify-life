/**
 * REST API dla slownika slow opisujacych dzien (tabela `slowa_slownik`).
 *
 *   GET    /api/slowa       - wszystkie nazwy
 *   POST   /api/slowa       - dodaje { nazwa }, odrzuca duplikat
 *   PATCH  /api/slowa/:id   - zmienia nazwe I KASKADOWO poprawia wpisy dziennika
 *   DELETE /api/slowa/:id   - usuwa TYLKO ze slownika, wpisow dziennika NIE rusza
 *
 * Kolumna `dziennik.trzy_slowa` zostaje zwyklym tekstem z nazwami rozdzielonymi
 * przecinkami - dokladnie jak `nawyki`. Dzieki temu wlaczenie listy wyboru nie
 * wymagalo migracji danych: 519 istniejacych wpisow juz mialo ten format.
 *
 * NAZWA "TRZY SLOWA" TO SUGESTIA, NIE LIMIT. Nie ma gornej granicy liczby wartosci
 * ani licznika - pole ma pomagac opisac dzien, a nie egzekwowac norme. Do XP liczy
 * sie jako JEDNO pole, tak samo jak nawyki, wiec zaznaczenie dziesieciu slow
 * nie daje wiecej punktow niz zaznaczenie jednego.
 *
 * Cala logika siedzi w lib/slownik-wartosci.js - patrz komentarz w routes/nawyki.js.
 */

const db = require('../db');
const { utworzRouterSlownika } = require('../lib/slownik-wartosci');

module.exports = utworzRouterSlownika(db, {
  tabela: 'slowa_slownik',
  kolumnaWpisu: 'trzy_slowa',
  mianownik: 'Word',
  dopelniacz: 'word',
});
