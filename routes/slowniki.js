/**
 * GET /api/slowniki - listy wyboru dla frontendu.
 *
 * Dzieki temu endpointowi lista klientow i stanow istnieje TYLKO w config/slowniki.js.
 * Frontend nie ma wlasnej kopii, wiec nie ma jak sie rozjechac z walidacja backendu.
 */

const express = require('express');
const {
  STANY,
  STAN_DOMYSLNY,
  STAN_ZAKONCZONY,
  PRIORYTETY,
  PRIORYTET_DOMYSLNY,
  OBSZARY,
} = require('../config/slowniki');
const { OCENY } = require('../config/mapowanie-ocen');
const plakietkiZadan = require('../config/plakietki-zadan');
const { ATRYBUTY } = require('../config/atrybuty');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    stany: STANY,
    stanDomyslny: STAN_DOMYSLNY,
    stanZakonczony: STAN_ZAKONCZONY,
    priorytety: PRIORYTETY,
    priorytetDomyslny: PRIORYTET_DOMYSLNY,
    obszary: OBSZARY,
    // Opisy slowne ocen dziennika (plakietki w listach rozwijanych).
    // Lista nawykow NIE jest tu wystawiana - mieszka w bazie, patrz GET /api/nawyki.
    oceny: OCENY,
    /*
      Plakietki pol zadan (emoji do etykiet). Wartosci zapisywane w bazie sa nadal
      surowe - to wylacznie warstwa prezentacji, patrz config/plakietki-zadan.js.
      Trudnosc przychodzi tu z KOMPLETEM wartosci, bo jako jedyna nie ma slownika wyzej.
    */
    plakietkiZadan,
    // Nazwy, emoji i opisy atrybutow postaci - wartosci punktow ida osobno,
    // przez /api/postac, bo sa danymi, a nie konfiguracja.
    atrybuty: ATRYBUTY,
  });
});

module.exports = router;
