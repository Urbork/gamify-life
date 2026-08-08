/**
 * GET /api/czas - biezaca data wedlug SERWERA.
 *
 * Po co osobny endpoint, skoro przegladarka ma wlasny zegar:
 * presety zakresu dat w filtrach ("Dziś", "7 dni") maja byc liczone wzgledem daty
 * serwera, zeby wynik nie zalezal od tego, z ktorej maszyny akurat korzystasz
 * ani jak ustawiona jest w niej strefa czasowa.
 *
 * Endpoint jest osobno, a nie doklejony do /api/slowniki, bo slowniki sa stale
 * i pobiera sie je raz przy starcie, a data musi dac sie odswiezyc w trakcie
 * dzialania aplikacji (np. po powrocie do karty nastepnego dnia).
 */

const express = require('express');

const router = express.Router();

/** Dzisiejsza data jako 'YYYY-MM-DD' wedlug czasu LOKALNEGO serwera. */
function dzisiajLokalnie() {
  const t = new Date();
  const dwie = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${dwie(t.getMonth() + 1)}-${dwie(t.getDate())}`;
}

router.get('/', (req, res) => {
  // Cache-Control: data zmienia sie co dobe, a przegladarka nie ma prawa
  // podac starej wartosci z pamieci podrecznej.
  res.set('Cache-Control', 'no-store');
  res.json({ dzisiaj: dzisiajLokalnie() });
});

module.exports = router;
