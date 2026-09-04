# gamify-life — stan projektu

> **Zasada dotycząca sekcji „Pomysły i obserwacje":** to sekcja **wyłącznie do notowania**.
> Nic z niej nie jest wdrażane bez wyraźnego polecenia — nawet jeśli wygląda na oczywiste
> usprawnienie. Zapisanie pomysłu tutaj **nie** jest zgodą na jego realizację.

## Czym jest projekt

Lokalna, jednoosobowa aplikacja webowa do prowadzenia listy zadań i dziennika, z warstwą
grywalizacji (XP, poziomy, waluta). Stos jest celowo minimalny: **Node.js + Express 5 +
SQLite** (`better-sqlite3`), frontend to **czysty JavaScript w przeglądarce** — bez
frameworka, bez kroku budowania, bez zależności poza `express`, `better-sqlite3` i `nodemon`.

Uruchomienie: `npm start` (albo `start.bat`), potem `http://localhost:3000`. Baza żyje
w `data/baza.db` i przeżywa restart. Testy: `npm run test:smoke`.

Pięć stron: **Zadania**, **Dziennik**, **Projekty**, **Statystyki**, **Postać**. Dane wchodzą
ręcznie albo importem CSV z Notion; wychodzą eksportem CSV i codzienną kopią zapasową.

## Zrobione

### Zadania
- [x] Tabela z edycją w miejscu — każda zmiana leci `PATCH`-em, błąd cofa komórkę
- [x] Sortowanie dwupoziomowe po każdej kolumnie, zakończone zawsze na dole
- [x] Filtry: nazwa, stan, priorytet, obszar, projekt, zakres dat, granica terminu
- [x] Tryb **wykluczania** dla obszaru i projektu (zamiast zaznaczania 40 z 41)
- [x] Widok domyślny: aktywne z terminem do dziś + 7 dni; przeterminowane i bez terminu zostają
- [x] Daty **całodzienne** albo z godziną, z przełącznikiem zegara w komórce
- [x] Duplikowanie zadania (bez stanu i daty zakończenia — nie generuje XP)
- [x] Kolumna „Dni do terminu" **zamrażana** w chwili ukończenia
- [x] Plakietki emoji dla stanu, priorytetu, trudności i obszaru
- [x] Skróty klawiszowe: `n` (nowe zadanie), `w` (przełącz widok)
- [x] Podświetlenie edytowanego wiersza i błysk po zapisie

### Dziennik
- [x] Tabela wpisów z 18 kolumnami, edycja w miejscu
- [x] Oceny 1–5 z plakietkami; **stres w skali odwróconej** (0 = najgorzej)
- [x] Słownik nawyków w bazie, edytowalny, ze zmianą nazwy kaskadującą po wpisach
- [x] Filtry: tekst po 8 kolumnach, zakres dat, multi-select nawyków
- [x] Miękkie ostrzeżenie o duplikacie daty (żółte, nieblokujące)
- [x] Widok domyślny: ostatnie 30 dni

### Import i eksport
- [x] Generyczny silnik importu CSV sterowany profilami (`lib/import.js`)
- [x] Trzy profile: `zadania`, `dziennik`, `notion-quest-log`
- [x] Dwuetapowy przepływ: podgląd (dry-run) → zatwierdzenie
- [x] Quest-log: dwuprzebiegowy, tworzy projekty i zadania z jednego pliku
- [x] **Deduplikacja dziennika po dacie** — powtórny import nie mnoży wpisów ani XP
- [x] Eksport CSV zadań i dziennika (zawsze pełny zbiór, niezależnie od filtrów)
- [x] Wybór profilu importu w interfejsie

### Nagrody
- [x] XP z zadań (trudność × czas × mnożnik terminowości), wpisów i nawyków
- [x] Poziomy, prestiż, waluta zarobiona/wydana/dostępna
- [x] Sklep z nagrodami — zakupy jako jedyny zapisywany stan
- [x] Wszystko **wyliczane na bieżąco**, nigdy nie zapisywane

### Infrastruktura
- [x] Migracje wersjonowane przez `PRAGMA user_version` (7 migracji)
- [x] Smoke test — 271 asercji, izolowana baza tymczasowa
- [x] Czyste reguły w osobnych plikach, testowane bez przeglądarki
- [x] Codzienna kopia zapasowa CSV z rotacją
- [x] Statystyki zadań i dziennika z tabelą miesięczną

## Do zrobienia

- [ ] Otworzyć PR dla gałęzi `feat/zadania-i-dziennik` (brakuje `gh` na maszynie)
- [ ] Uzupełnić `KOLUMNY_IGNOROWANE` przy następnym eksporcie, jeśli dojdą kolumny
- [ ] Rozważyć asercję pokrycia `wykryjSeparator` (import TSV nietestowany)
- [ ] **Widok podstawowy + okno szczegółów** — lista pokazuje tylko pola używane
      codziennie (pobudka, sen, jakość snu, spokój); kliknięcie w wiersz otwiera okno
      z kompletem pól rzadszych (refleksje, posiłki, nawyki). To samo dla zadań.
      Powód: pola wypełniane wieczorem wyszły z użycia, ale dane zostają — chodzi
      o odciążenie widoku, nie o usuwanie kolumn.
- [ ] **Kopia zapasowa poza dyskiem** — `backups/` leży na tym samym dysku co baza.
      Ustalenia: OneDrive obecny, ale nieaktywny i pusty; D: 59 GB, E: 173 GB wolnego.
      Propozycja: kopiowanie dziennej migawki `.db` na E: jako krok w istniejącym
      zadaniu harmonogramu, ścieżka ze zmiennej środowiskowej. Odłożone jako duża zmiana.

## Pomysły i obserwacje

> Przypomnienie: **nic z tej sekcji nie jest wdrażane bez wyraźnego polecenia.**

- **Czas szacowany kontra rzeczywisty** — mamy `czas_trwania_godziny` wpisywane ręcznie
  oraz `start_zadania` i `czas_zakonczenia` z godzinami. Dałoby się pokazać różnicę
  między szacunkiem a realnym czasem i uczyć się szacować.
- **Leniwe selecty** — komórki renderują tekst, pełna lista rozwijana powstaje dopiero
  przy kliknięciu. Zmierzone: ~87% kosztu wiersza to elementy `<option>` (31 200 na stronie).
  Pełny widok zszedłby z ~294 ms do ~40 ms.
- **Zadania powtarzalne** — reguła powtarzania plus generowanie kolejnego wystąpienia
  po ukończeniu. Szczegółowy plan był już raz ustalony, nigdy nie wdrożony.
- **Dostęp zdalny przez Tailscale** — aplikacja jest lokalna; Tailscale dałby dostęp
  z telefonu bez wystawiania czegokolwiek publicznie.
- **Przepisanie interfejsu na React** — dziś czysty JS bez kroku budowania. Zmiana
  oznaczałaby porzucenie zasady „zero zależności frontendowych".
- **Testy warstwy DOM (Playwright)** — **świadomie odrzucone**. Zapisane, żeby nie wracać
  do tematu bez powodu: smoke test pokrywa reguły i API, a warstwa DOM jest weryfikowana
  ręcznie w przeglądarce. Playwright dołożyłby ciężką zależność do projektu, którego
  całą wartością jest brak zależności.

## Decyzje, których nie cofać

Zebrane z kodu i README — wybrane te, które najłatwiej cofnąć przez przypadek.

| Decyzja | Gdzie | Dlaczego |
| --- | --- | --- |
| Router importu montowany **przed** globalnym `express.json()` | `server.js` | Inaczej jego własny limit 20 MB jest martwy i duże pliki dostają 413 |
| Klasa `.slupek`, nie `.pasek`, dla słupków postępu | `public/css/style.css` | `.pasek` jest zajęta przez nagłówek strony — ponowne użycie rozwalało nagłówek na wszystkich stronach |
| **Brak `UNIQUE`** na `dziennik.data` | `db/migracje.js` | Import idzie w jednej transakcji; jedna kolizja wywracałaby cały zapis zamiast go poprawić |
| `pasujeTerminDo` osobno od `pasujeZakresDat` | `public/js/reguly-zadan.js` | Inna semantyka: brak dolnej granicy i przepuszczanie zadań bez terminu. Nie są duplikatami |
| Wartości zapasowe w `poWierszu`, nie w `wartosciDomyslne` | `config/mapowanie-quest-log.js` | Pusta komórka zapisuje `null` **po** wartości domyślnej i kasowała ją |
| `Do Date` → `termin`, nie `start_zadania` | `config/mapowanie-quest-log.js` | `Due Date` było wypełnione w 4 rekordach na 582; inaczej mnożnik terminowości byłby martwy dla 468 zadań |
| Eksport woła `posortowane()` **bez** `filtrowane()` | `public/js/zadania.js` | Eksport, kopia zapasowa i XP zawsze obejmują pełny zbiór, niezależnie od widoku |
| Skala stresu **odwrócona** (0 = najgorzej) | `config/mapowanie-ocen.js` | Tak jest w źródle danych; „stres 2,68" czyta się odwrotnie, niż znaczy |
| `numerDnia` bierze pierwsze 10 znaków | `lib/nagrody.js`, `public/js/filtr-dat.js` | Wszystkie porównania dat idą na pełnych dniach — dzięki temu daty całodzienne nie wymagały zmian w regułach. Dwie kopie pilnuje asercja |
| XP nigdy nie zapisywane w bazie | `lib/nagrody.js` | Zmiana wzoru przelicza całą historię bez migracji; zapisywana jest tylko wydana waluta |
| Duplikat zadania powstaje w SQL (`INSERT ... SELECT`) | `routes/zadania.js` | Reguła „bez stanu i bez daty zakończenia" musi być wymuszona po stronie bazy — inaczej kopia naliczyłaby XP za niewykonaną pracę |
| Migracja 7 była rozstrzygalna **jednorazowo** | `db/migracje.js` | `T00:00` dało się zinterpretować tylko dlatego, że przed przełącznikiem zegara północy nie dało się ustawić celowo. Dziś to samo rozumowanie już nie działa |
