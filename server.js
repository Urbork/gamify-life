/**
 * Punkt wejscia aplikacji.
 *
 * Ten plik ma zostac maly. Dodanie kolejnego modulu (dziennik, statystyki) to:
 *   1. nowy plik w routes/,
 *   2. jedna linijka app.use(...) w sekcji "API" ponizej,
 *   3. nowa migracja w db/migracje.js.
 */

const path = require('path');
const express = require('express');

// Samo require('./db') otwiera polaczenie i doprowadza schemat do aktualnej wersji
// (migracje siedza w db/index.js) - dlatego nie ma tu osobnego wywolania migracji.
const db = require('./db');
const zadaniaRouter = require('./routes/zadania');
const slownikiRouter = require('./routes/slowniki');
const czasRouter = require('./routes/czas');
const importRouter = require('./routes/import');
const dziennikRouter = require('./routes/dziennik');
const nawykiRouter = require('./routes/nawyki');
const postacRouter = require('./routes/postac');
const projektyRouter = require('./routes/projekty');

const PORT = process.env.PORT || 3000;

const app = express();

// --- API ------------------------------------------------------------------

/*
  UWAGA NA KOLEJNOSC: router importu musi byc zamontowany PRZED globalnym
  express.json() ponizej.

  express.json() zamontowany przez app.use() bez sciezki dziala na KAZDYM zadaniu,
  takze na /api/import/*. Gdyby staly tu w odwrotnej kolejnosci, to globalny parser
  (z ciasnym limitem) odrzucalby duzy plik bledem 413 "request entity too large"
  zanim router importu zdazylby uzyc swojego wlasnego, podniesionego limitu -
  i ten limit bylby martwym kodem. Ustawiony tutaj, parsuje cialo pierwszy,
  a globalny express.json() widzi juz sparsowane zadanie i je pomija.
*/
app.use('/api/import', importRouter);
app.use('/api/dziennik', dziennikRouter);

/*
  PONIZEJ TEJ LINII obowiazuje domyslny limit 100kb.
  Kazdy router zamontowany WYZEJ ma wlasny express.json() z wlasnym limitem;
  kazdy router zamontowany NIZEJ dostaje ten domyslny. Dopisujac nowy modul,
  zdecyduj swiadomie, po ktorej stronie ma stac - i jesli przyjmuje duze ciala,
  daj mu wlasny parser i zamontuj go wyzej.
*/

// Parsowanie JSON-a z ciala requestow (PATCH/POST z frontendu).
// Limit domyslny (100kb) w zupelnosci wystarcza na edycje pojedynczego pola.
app.use(express.json());

app.use('/api/zadania', zadaniaRouter);
app.use('/api/slowniki', slownikiRouter);
app.use('/api/czas', czasRouter);
// Nazwy nawykow to kilkadziesiat bajtow - domyslny limit wystarcza z zapasem.
app.use('/api/nawyki', nawykiRouter);
app.use('/api/projekty', projektyRouter);
// Router obsluguje /api/postac oraz /api/zakupy - stad montowanie na /api.
app.use('/api', postacRouter);

// --- Frontend -------------------------------------------------------------
// Zwykle pliki statyczne, bez build stepu. Wejscie: public/index.html.
app.use(express.static(path.join(__dirname, 'public')));

// --- Obsluga bledow -------------------------------------------------------

// Nieznany adres pod /api/* ma zwrocic JSON, a nie HTML-owy blad Expressa.
app.use('/api', (req, res) => {
  res.status(404).json({ blad: `Nieznany endpoint: ${req.method} ${req.originalUrl}` });
});

// Wspolny handler bledow. Rzucenie w routach `blad(400, '...')` konczy sie tutaj.
// Kolejnosc argumentow (err, req, res, next) jest dla Expressa obowiazkowa -
// po niej rozpoznaje, ze to middleware od bledow.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ blad: err.message || 'Nieoczekiwany blad serwera.' });
});

app.listen(PORT, () => {
  console.log(`[serwer] http://localhost:${PORT}`);
  console.log(`[db]     ${db.name}`);
});
