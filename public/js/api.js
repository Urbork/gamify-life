/*
  Cienki wrapper na fetch - wspolny dla wszystkich przyszlych modulow
  (zadania, dziennik, statystyki).

  Robi dwie rzeczy, ktorych fetch sam nie robi:
  1. Rzuca wyjatkiem przy statusie 4xx/5xx (goly fetch odrzuca obietnice tylko przy bledzie sieci).
  2. Wyciaga z odpowiedzi pole `blad`, ktore ustawia nasz backend, i wstawia je do komunikatu.
*/

const api = (() => {
  async function zapytaj(metoda, url, dane) {
    const opcje = { method: metoda, headers: {} };

    if (dane !== undefined) {
      opcje.headers['Content-Type'] = 'application/json';
      opcje.body = JSON.stringify(dane);
    }

    const odpowiedz = await fetch(url, opcje);

    if (!odpowiedz.ok) {
      // Backend zwraca bledy jako { blad: "..." }, ale przy nieoczekiwanej awarii
      // odpowiedz moze nie byc JSON-em - stad zabezpieczenie.
      let wiadomosc = `Blad ${odpowiedz.status}`;
      try {
        const tresc = await odpowiedz.json();
        if (tresc && tresc.blad) wiadomosc = tresc.blad;
      } catch (_) {
        /* odpowiedz nie byla JSON-em - zostawiamy komunikat ze statusem */
      }
      throw new Error(wiadomosc);
    }

    // 204 No Content (np. po DELETE) nie ma ciala do sparsowania.
    if (odpowiedz.status === 204) return null;
    return odpowiedz.json();
  }

  return {
    get: (url) => zapytaj('GET', url),
    post: (url, dane) => zapytaj('POST', url, dane),
    patch: (url, dane) => zapytaj('PATCH', url, dane),
    usun: (url) => zapytaj('DELETE', url),
  };
})();
