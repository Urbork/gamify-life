/**
 * REST API dla slownika nawykow (tabela `nawyki_slownik`).
 *
 *   GET    /api/nawyki       - wszystkie nazwy
 *   POST   /api/nawyki       - dodaje { nazwa }, odrzuca duplikat
 *   PATCH  /api/nawyki/:id   - zmienia nazwe I KASKADOWO poprawia wpisy dziennika
 *   DELETE /api/nawyki/:id   - usuwa TYLKO ze slownika, wpisow dziennika NIE rusza
 *
 * Slownik sluzy do budowania listy wyboru. Kolumna `dziennik.nawyki` zostaje
 * zwyklym tekstem z nazwami rozdzielonymi przecinkami - patrz komentarz
 * przy migracji 4 w db/migracje.js.
 *
 * CALA LOGIKA SIEDZI W lib/slownik-wartosci.js, bo dziennik ma DWA pola tego
 * samego rodzaju (nawyki i trzy_slowa) i roznia sie wylacznie nazwa tabeli,
 * kolumna oraz odmiana slowa w komunikatach. Skopiowanie tego pliku dalo by
 * dwie implementacje kaskadowej zmiany nazwy - poprawka trafialaby do jednej
 * i po cichu omijala druga.
 */

const db = require('../db');
const { utworzRouterSlownika } = require('../lib/slownik-wartosci');

module.exports = utworzRouterSlownika(db, {
  tabela: 'nawyki_slownik',
  kolumnaWpisu: 'nawyki',
  mianownik: 'Habit',
  dopelniacz: 'habit',
});
