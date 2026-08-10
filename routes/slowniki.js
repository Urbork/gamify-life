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
  KLIENCI,
} = require('../config/slowniki');
const { OCENY } = require('../config/mapowanie-ocen');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    stany: STANY,
    stanDomyslny: STAN_DOMYSLNY,
    stanZakonczony: STAN_ZAKONCZONY,
    priorytety: PRIORYTETY,
    priorytetDomyslny: PRIORYTET_DOMYSLNY,
    klienci: KLIENCI,
    // Opisy slowne ocen dziennika (plakietki w listach rozwijanych).
    // Lista nawykow NIE jest tu wystawiana - mieszka w bazie, patrz GET /api/nawyki.
    oceny: OCENY,
  });
});

module.exports = router;
