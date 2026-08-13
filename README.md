# gamify-life

Lokalna aplikacja webowa do zarządzania zadaniami. Działa wyłącznie na Twoim komputerze —
nic nie wychodzi na zewnątrz, baza to jeden plik w folderze projektu.

Docelowo dojdą kolejne moduły (dziennik, statystyki); struktura projektu jest pod to przygotowana.

## Wymagania

- Node.js 18+ (sprawdzone na Node 24)

## Instalacja

```bash
npm install
```

Instaluje trzy paczki: `express` (serwer HTTP), `better-sqlite3` (baza) i `nodemon` (tylko dev).
Smoke test i kopia zapasowa nie potrzebują żadnych dodatkowych zależności.

## Uruchomienie

```bash
npm start
```

Aplikacja: **http://localhost:3000**

Tryb deweloperski (restart serwera po każdej zmianie pliku):

```bash
npm run dev
```

Zatrzymanie serwera: `Ctrl + C` w terminalu.

Port można zmienić zmienną środowiskową `PORT`, np. `PORT=3001 npm start`.

## Baza danych

Plik `data/baza.db` — powstaje sam przy pierwszym uruchomieniu i przeżywa restart komputera.
Obok pojawią się pliki `baza.db-wal` i `baza.db-shm` (tryb WAL SQLite) — to normalne.

**Kopia zapasowa:** zatrzymaj serwer i skopiuj cały folder `data/`.
`data/` jest w `.gitignore`, więc baza nie trafia do repozytorium.

## Jak korzystać

- Wszystkie komórki edytuje się bezpośrednio w tabeli. Zapis następuje automatycznie
  po opuszczeniu pola (tekst) lub po zmianie wartości (lista, data) — nie ma przycisku „zapisz".
  W polu tekstowym `Enter` kończy edycję, `Esc` cofa zmianę.
- **+ Dodaj zadanie** tworzy wiersz o nazwie „Nowe zadanie", priorytecie „Średni"
  i dacie startu ustawionej na dzisiaj, po czym od razu zaznacza nazwę —
  pierwsze wpisane znaki ją nadpisują, nie trzeba nic kasować.
  Datę startu wyznacza **serwer** (`strftime('now','localtime')` w SQLite), a nie przeglądarka,
  żeby wynik nie zależał od strefy czasowej ani od zegara maszyny, z której korzystasz.
- **×** na końcu wiersza usuwa zadanie (z potwierdzeniem).
- Komunikat obok przycisku pokazuje wynik ostatniego zapisu. Gdy zapis się nie uda,
  komórka wraca do poprzedniej wartości, a wiersz podświetla się na czerwono —
  tabela nigdy nie pokazuje czegoś, czego nie ma w bazie.

- Co drugi wiersz ma odrobinę ciemniejsze tło, a wiersz pod kursorem podświetla się
  wyraźniej — to pomoc w czytaniu w poziomie przy kilkunastu kolumnach. Reguły celują
  w każdy `tbody` w tabeli, więc obejmą też kolejne tabele (np. przyszły dziennik)
  bez dopisywania czegokolwiek.

Kolumna **Dni do terminu** jest wyliczana w przeglądarce przy renderowaniu i **nie jest
zapisywana w bazie** — to `termin − dzisiaj` (wartość ujemna = po terminie, podświetlana
na czerwono).

### Daty z godziną

Pola **Start**, **Termin** i **Zakończenie** trzymają pełny znacznik ISO 8601
`YYYY-MM-DDTHH:MM` i są edytowane przez `<input type="datetime-local">`.

**Godzina nie wpływa na kolumny wyliczane.** Obie liczą w **pełnych dniach
kalendarzowych** i część godzinową ignorują (`numerDnia()` bierze pierwsze 10 znaków).
Przykład: start `10.08 23:59` i zakończenie `12.08 00:01` dają **2 dni**, mimo że
w rzeczywistości minęły nieco ponad 24 godziny. To świadoma decyzja — godzina jest
na razie dodatkową informacją do zapisu, a logika wyliczeń zostaje prosta.

Godzina **wpływa natomiast na sortowanie**: przy dwóch zadaniach na ten sam dzień
wcześniejsza godzina jest wyżej. To dotyczy porządkowania wierszy, nie wartości w kolumnach.

API przyjmuje też samo `YYYY-MM-DD` (uzupełnia `T00:00`) oraz znacznik z sekundami
(obcina do minut) — dzięki temu ręczne `curl`-e i starsze skrypty nadal działają.

### Priorytet

Liczba 0–4 z etykietą słowną: 0 = Brak, 1 = Niski, 2 = Średni, 3 = Wysoki, 4 = Pilne.
W bazie zapisany jest **numer**, nie etykieta — dzięki temu sortowanie jest naturalne
(0 < 1 < 2…, a nie alfabetycznie „Brak, Niski, Pilne, Średni, Wysoki"), a zmiana nazwy
w słowniku nie wymaga ruszania danych. Lista mieszka w `PRIORYTETY`
w [config/slowniki.js](config/slowniki.js).

### Obszar

Pole `obszar` (do migracji 6: `klient_kategoria`) trzyma obszar życia z Notion:
Mindset, Career, Knowledge, Creative, Health, Home, Lifestyle, Family, Finances,
Fun/Relax, Travel, Inne. Nazwy zostają **po angielsku**, dokładnie jak w źródle —
dzięki temu import mapuje je 1:1, bez tablicy tłumaczeń do utrzymywania.

Pole **nie jest walidowane ściśle**: wartość spoza listy zapisze się i pokaże
z dopiskiem „(spoza listy)". Stare wartości — nazwy klientów — przetrwały zmianę
nazwy kolumny nietknięte, właśnie dlatego.

### Projekty

Strona **/projekty.html**. Projekt jest **kontenerem** na zadania: sam z siebie
**nie daje XP**, punkty liczą się wyłącznie z zadań, wpisów dziennika i nawyków.
Licznik „X/Y ukończonych" liczy serwer jednym zapytaniem z `LEFT JOIN` — inaczej
przy kilkudziesięciu projektach robiłaby się lawina zapytań.

Zadanie przypisuje się do projektu dropdownem w kolumnie **Projekt**; jest też filtr
multi-select po projekcie. Filtr działa po **id**, nie po nazwie — nazwa może się zmienić.

> **Usunięcie projektu ODPINA zadania, nie kasuje ich.** Realizuje to
> `ON DELETE SET NULL` na kluczu obcym (migracja 6). Zadanie jest bytem
> samodzielnym, projekt tylko kontenerem — okno potwierdzenia mówi wprost,
> ile zadań zostanie odpiętych.

### Trudność i czas (h)

Dwa pola opcjonalne, oba potrzebne do naliczenia XP:

- **Trudność** — 1 Łatwe / 2 Średnie / 3 Trudne.
- **Czas (h)** — ile godzin zadanie faktycznie zajęło, **wpisywane ręcznie**.

**Trudność jest całkowicie niezależna od Priorytetu.** Priorytet mówi, jak pilne jest
zadanie (zarządzanie); trudność — ile było warte (naliczanie XP). Oba zostają.

Zadanie w stanie „Zrobione" bez któregoś z tych pól dostaje **żółty znacznik** na obu
komórkach i podpowiedź „uzupełnij trudność i czas, by policzyć XP". To uwaga, nie błąd —
zapis przechodzi, po prostu XP z tego zadania przepada.

> **Usunięta kolumna „Czas trwania (dni)".** Liczyła się automatycznie z różnicy
> `zakończenie − start`, czyli mówiła, ile dni zadanie było *otwarte* — a nie ile zajęło
> pracy. Zastąpiło ją ręczne pole godzin. Skutek: średnia w statystykach zmieniła jednostkę
> z **dni na godziny** i obejmuje tylko zadania z wypełnionym polem; historycznych nie da się
> odtworzyć z dat. Kolumna zniknęła też z eksportu CSV i z kopii zapasowej.

### Sortowanie

Sortowanie dzieje się w całości w przeglądarce — dane z API pobierane są raz, przy starcie.

1. **Zadania „Zrobione" są zawsze na dole**, niezależnie od wybranej kolumny i kierunku.
2. W obrębie każdej z grup obowiązuje wybrana kolumna. Domyślnie: **termin rosnąco**,
   czyli najbliższe terminy u góry.
3. **Puste wartości zawsze na końcu swojej grupy**, także przy sortowaniu malejąco.
   (Zadanie bez terminu nie jest ani najpilniejsze, ani najmniej pilne — jest nieokreślone,
   więc nie ma powodu, żeby wypływało na górę po odwróceniu kierunku.)
4. Remisy rozstrzyga `id` rosnąco, żeby kolejność była powtarzalna.

Kliknięcie nagłówka sortuje po tej kolumnie; kolejne kliknięcie odwraca kierunek.
Aktywna kolumna ma strzałkę ▲/▼. Kolumna **Stan** sortuje się według kolejności ze słownika
(Plan → Czeka → W trakcie → Zrobione → Blok), a nie alfabetycznie.

Tabela przebudowuje się tylko wtedy, gdy edycja faktycznie zmienia kolejność wierszy
(np. zmiana stanu na „Zrobione" albo edycja kolumny, po której sortujesz) — w pozostałych
przypadkach komórki aktualizują się w miejscu, żeby wiersze nie skakały pod kursorem.

### Filtry

Panel nad tabelą, domyślnie zwinięty. Filtrowanie dzieje się w przeglądarce, na tej samej
lokalnej kopii danych co sortowanie — potok to `posortowane(filtrowane())`.

**Pola łączą się przez ORAZ, a zaznaczenia w obrębie jednego pola przez LUB.**
Brak zaznaczenia = brak filtrowania po tym polu. Gdy panel jest zwinięty, w nagłówku widać
`— aktywne: N`, żeby krótsza lista nigdy nie wyglądała jak zgubione dane.

**Zakres dat.** Zadanie pasuje do `[OD, DO]`, jeśli spełnia **co najmniej jeden** z warunków:

- **a)** `termin` jest wypełniony **i** mieści się w zakresie;
- **b)** `start_zadania` jest wypełniony **i** `start ≤ DO` **i** (`czas_zakonczenia` pusty
  **lub** `czas_zakonczenia ≥ OD`).

Każdy warunek sprawdzany jest **niezależnie** względem braku daty: zadanie bez terminu może
pasować przez b), zadanie bez startu przez a). Zadanie bez żadnej z trzech dat nie pasuje nigdy.
Porównania idą na **pełnych dniach kalendarzowych** — godzina zapisana w zadaniu nie wpływa
na dopasowanie, dlatego pola filtra to `type="date"`.

Presety liczą dni kalendarzowe **włącznie z dzisiejszym**: `Dziś` = `[dziś, dziś]`,
`Dziś + jutro` = `[dziś, dziś+1]`, `7 dni` = `[dziś, dziś+6]`, `30 dni` = `[dziś, dziś+29]`.
Datę „dziś" podaje **serwer** (`GET /api/czas`), nie przeglądarka. Preset tylko wypełnia pola
OD i DO — zawsze widać, jaki zakres jest naprawdę użyty, i można go ręcznie poprawić
(wtedy podświetlenie presetu gaśnie).

> **Niuans do świadomej decyzji.** Pusty `czas_zakonczenia` traktujemy jako zadanie **otwarte**,
> czyli warunek końca jest spełniony zawsze. Wariant „trwa dokładnie do dzisiaj" różniłby się
> tylko dla zakresu w całości w przyszłości (`OD > dziś`), którego żaden preset nie tworzy.
> Zamiana to jedna linijka opisana w komentarzu przy `pasujeZakresDat`
> w [public/js/zadania.js](public/js/zadania.js).

### Domyślne ograniczenie widoku

Przy większych zbiorach obie tabele startują **ograniczone**, bo pełne przerysowanie
zaczyna być odczuwalne:

| Strona | Widok domyślny | Próg włączenia |
| --- | --- | --- |
| Zadania | tylko **aktywne** (stan inny niż `Zrobione`) | powyżej 100 zadań |
| Dziennik | ostatnie **30 dni** | powyżej 100 wpisów |

Poniżej progu ograniczenie się nie włącza — przy krótkiej liście nic nie przyspiesza,
a filtr zaznaczony na starcie tylko myli.

**Ograniczenie robi zwykły filtr**, ten sam, który jest w panelu: na stronie zadań
zaznaczone są wszystkie stany poza `Zrobione`, w dzienniku wypełnione jest pole **od**.
Panel filtrów pokazuje więc prawdę o tym, co widać, znacznik „aktywne: 1" się zapala,
a **Wyczyść filtry** działa jako pokazanie wszystkiego. Nad tabelą stoi dodatkowo żółty
pasek z liczbą ukrytych wierszy i przyciskiem **Pokaż wszystkie (N)** — żeby brak
zrobionych zadań nigdy nie wyglądał jak utrata danych.

Wybór **nie jest zapamiętywany**: po odświeżeniu strona wraca do widoku domyślnego.
W projekcie nie ma stanu trzymanego po stronie przeglądarki i ta zmiana tego nie wprowadza.

> **Eksport, kopia zapasowa i XP zawsze widzą pełny zbiór** — niezależnie od tego,
> co jest na ekranie. Eksport woła `posortowane()` z pominięciem `filtrowane()`, backup
> czyta prosto z bazy (`SELECT * FROM zadania ORDER BY id`), a XP liczy serwer
> w `routes/postac.js`. Pilnują tego asercje w `test/smoke.js`.

#### Skąd te progi — pomiar

Ograniczenie powstało po pomiarze, nie „na wyczucie". Na zbiorze 537 zadań / 823 wpisów:

| Etap | Czas | Udział |
| --- | --- | --- |
| fetch + JSON | 7,5 ms | 2% |
| filtrowanie, sortowanie, kolumny wyliczane | poniżej 1 ms | <0,5% |
| **budowa DOM** | **212–453 ms** | **~75%** |
| wstawienie do drzewa | 24–87 ms | ~20% |

Koszt siedzi w budowaniu DOM, a konkretnie w **opcjach list rozwijanych**: każdy wiersz
zadania ma pięć `<select>`, a lista projektów to 42 pozycje — razem **37 053 elementów
`<option>`** na stronie. Mikrotest: 537 wierszy z pięcioma pustymi `<select>` to 16,5 ms,
te same wiersze z kompletem opcji — 125,7 ms.

Efekt ograniczenia: zadania **537 → 74 wiersze, ~290 ms → ~30 ms**; dziennik
**823 → 19 wierszy, ~250 ms → ~8 ms**. Ma to znaczenie, bo `renderuj()` przebudowuje
całe `<tbody>` przy **każdym naciśnięciu klawisza** w polu filtra.

Gdyby to przestało wystarczać, następnym krokiem jest tworzenie `<select>` dopiero
przy kliknięciu komórki (do tego czasu zwykły tekst) — to uderza w faktyczną przyczynę,
czyli liczbę elementów `<option>`.

### Eksport do CSV

Przycisk **Eksportuj do CSV** pobiera plik `zadania-eksport-RRRR-MM-DD.csv`
(data dzisiejsza). Plik powstaje w przeglądarce — nic nie jest zapisywane na serwerze.

Eksportowane są **wszystkie** zadania w aktualnej kolejności sortowania — również te
ukryte przez filtry. `eksportujCsv()` celowo woła `posortowane()` bez argumentu,
z pominięciem `filtrowane()`. Wraz z kolumnami
`dni_do_terminu` i `czas_trwania_dni` jako **migawka na moment eksportu** (te same dane
wyeksportowane jutro dadzą inne „dni do terminu").

Kolejność kolumn jest ta sama co w tabeli na ekranie. Priorytet wychodzi w **dwóch**
kolumnach: `priorytet` (numer — do sortowania i obliczeń) oraz `priorytet_etykieta`
(słowna — do czytania).

Plik jest w UTF-8 z BOM-em, więc polskie znaki otworzą się poprawnie.
**Uwaga na Excela:** separatorem jest przecinek (standard RFC 4180, tak czytają go Arkusze
Google i LibreOffice), a Excel w polskiej lokalizacji oczekuje **średnika** i wrzuci wszystko
w jedną kolumnę. Wtedy albo użyj w Excelu *Dane → Tekst jako kolumny*, albo zmień stałą
`SEPARATOR` na `';'` w [public/js/csv.js](public/js/csv.js) — to jedyne miejsce do poprawki.

### Import z CSV

Przycisk **Importuj z CSV** wczytuje plik wyeksportowany z innego narzędzia.
Import jest **dwuetapowy**:

1. wybór pliku → `POST /api/import/:profil/podglad` — plik jest parsowany i sprawdzany,
   ale **nic nie trafia do bazy**;
2. podgląd pokazuje „X gotowych do zaimportowania, Y odrzuconych" plus tabelkę
   odrzuconych wierszy z numerem linii w pliku i konkretnym powodem;
3. dopiero **Zatwierdź import** → `POST /api/import/:profil/zatwierdz` zapisuje dane.

#### Wybór źródła

Na stronie zadań przed przyciskiem stoi lista **Źródło**, bo ta sama tabela przyjmuje
pliki z dwóch miejsc:

| Opcja | Kiedy jej użyć |
| --- | --- |
| **Zadania — eksport z tej aplikacji** | plik z przycisku „Eksportuj do CSV" obok; nagłówki `Nazwa zadania`, `Stan`, `Obszar`, `Termin`… |
| **Notion Success Plan — projekty + zadania** | eksport bazy „Success Plan" z Notion; z jednego pliku powstają **i projekty, i zadania**, powiązane kolumną `Upstream` |

Wybrana wartość trafia wprost do adresu jako `:profil` — router i tak działał
parametrem, więc doszedł sam wybór, bez zmian po stronie serwera.

**Strona dziennika listy nie ma**: ma jeden profil, podany atrybutem `data-profil`
na przycisku. `public/js/csv-import.js` obsługuje oba sposoby — najpierw patrzy na listę,
a gdy jej nie ma, sięga po atrybut.

Dwie rzeczy, które łatwo przeoczyć przy dwóch źródłach na jednej stronie:

- podgląd wypisuje **nazwę użytego profilu**, żeby plik wczytany nie tym mapowaniem
  (same odrzucone wiersze) dało się od razu rozpoznać;
- lista jest **zablokowana, dopóki podgląd jest otwarty**, a zatwierdzenie idzie profilem
  zapamiętanym przy podglądzie. Inaczej przestawienie listy między jednym krokiem a drugim
  zapisałoby dane według innego mapowania niż to, które przed chwilą było na ekranie.

Po zapisie moduł importu wysyła zdarzenie `dane-<tabela>-zmienione` **osobno dla każdej
ruszonej tabeli** (mapa `ZMIENIANE_TABELE`). Nazwa zdarzenia celowo nie bierze się z nazwy
profilu: `notion-quest-log` pisze do **dwóch** tabel naraz, więc strona zadań przeładowuje
zarówno listę zadań, jak i projekty — bez tego nowy projekt siedziałby w bazie, ale nie dało
by się go wybrać w kolumnie **Projekt** aż do odświeżenia strony.

Zaimportowane zadania są **dopisywane** — nic istniejącego nie jest nadpisywane ani usuwane.
Cały import idzie w jednej transakcji: albo wejdą wszystkie poprawne wiersze, albo żaden.

Zatwierdzenie przesyła **treść pliku jeszcze raz**, a serwer parsuje ją ponownie, zamiast
ufać wynikom z przeglądarki. Powód jest dwojaki: gdyby zapis przyjmował gotowe rekordy
od klienta, tym kanałem dałoby się wstawić do bazy cokolwiek z pominięciem walidacji;
a przy okazji serwer nie trzyma żadnego stanu między krokami — nie ma tokenów,
wygasania podglądu ani sprzątania po porzuconych importach.

**Mapowanie kolumn** siedzi w [config/mapowanie-importu.js](config/mapowanie-importu.js),
tym samym wzorcem co słowniki. Nagłówki dopasowywane są dokładnie, ale odpornie na
wiodące/końcowe spacje i BOM. Kolumny `Dni do terminu` i `Czas trwania (dni)` są
świadomie pomijane — to formuły, aplikacja liczy je sama.

Chcesz wczytać plik z innego źródła (albo własny eksport z tej aplikacji, który ma
nagłówki techniczne)? Dopisz wpisy do `MAPOWANIE_KOLUMN` — kilka nagłówków może
wskazywać na to samo pole.

**Formaty dat** próbowane po kolei (`lib/daty.js`):

| Format | Skąd | Godzina |
| --- | --- | --- |
| `YYYY-MM-DD` | postać z naszej bazy | `00:00` |
| `Month D, YYYY` | `August 8, 2026` — eksport Notion | `00:00` |
| `DD.MM.YYYY` | zapis polski | `00:00` |
| `DD/MM/YYYY` | eksport „Success Plan" | `00:00` |
| `DD/MM/YYYY HH:MM (GMT+X)` | eksport „Success Plan" | **zachowana** |

Dzień jest **pierwszy** — amerykańskiego `MM/DD/YYYY` te eksporty nie używają.
W ostatnim wariancie **strefa jest pomijana, a godzina zachowywana bez przeliczania**:
w źródle to czas lokalny autora i tak samo jest czytany w aplikacji. Przeliczanie na UTC
przesunęłoby część wpisów na sąsiedni dzień, a wszystkie porównania dat w aplikacji
idą na pełnych dniach kalendarzowych.

**Zakres dat** (`19/10/2024 → 20/10/2024`, także z godzinami po obu stronach) jest
skracany do **daty początkowej**. Nasze kolumny są pojedynczymi punktami w czasie,
a to po dacie początkowej filtrowały widoki w Notion. Cięcie idzie po samym znaku
strzałki (U+2192), więc nie zależy od tego, ile takich zakresów przyniesie kolejny eksport.

Puste pole to brak daty, a nie błąd.

**Wiersz jest odrzucany**, gdy: nazwa jest pusta, stan nie pasuje **dokładnie** do słownika
(wielkość liter ma znaczenie), albo data jest w nierozpoznanym formacie. Odrzucenie dotyczy
pojedynczego wiersza — reszta pliku importuje się normalnie. `Klient / Kategoria` **nie** jest
walidowany wobec listy, tak samo jak przy ręcznej edycji. Brak wymaganej **kolumny** to co
innego: przerywa cały import komunikatem „to nie ten plik", zamiast odrzucać każdy wiersz
z tym samym powodem.

Każdy zaimportowany wiersz dostaje `priorytet = 2` (Średni) — pliki źródłowe tej kolumny
nie mają.

> **Rozmiar pliku i kolejność montowania — pułapka, która już raz ugryzła.**
> `express.json()` zamontowany przez `app.use()` **bez ścieżki** działa na *każdym*
> żądaniu. Router zamontowany po nim nigdy nie zobaczy dużego ciała — globalny parser
> odrzuci je wcześniej błędem 413, a własny limit routera będzie martwym kodem.
>
> Dlatego w `server.js` obowiązuje podział: **nad** linią z globalnym `express.json()`
> stoją routery z własnym parserem i podniesionym limitem (`/api/import` — 20 MB,
> `/api/dziennik` — 1 MB), **pod** nią wszystko, czemu wystarcza domyślne 100 kB.
> Dopisując moduł, zdecyduj świadomie, po której stronie ma stać.
>
> Wszystkie profile importu obsługuje **jeden** router (`/api/import/:profil`), więc
> kolejny profil dziedziczy poprawną pozycję automatycznie — nie ma drugiego miejsca,
> w którym można ją pomylić.

## Dziennik

Drugi moduł, pod adresem **/dziennik.html** (link w nagłówku obu stron). Tabela działa
tak samo jak zadania: edycja inline z zapisem przy opuszczeniu pola, sortowanie
kliknięciem w nagłówek, eksport CSV. **Domyślnie sortuje po dacie malejąco** —
najnowszy wpis u góry.

Oceny (jakość snu, nastrój, intencjonalność) są w skali **1–5**, ale **stres w skali 0–5**,
gdzie `0` znaczy *bardzo wysoki*, a `5` *brak stresu*. Tak jest w źródle i tego nie zmieniamy —
uwaga przy liczeniu statystyk, bo ta jedna kolumna jest odwrócona względem pozostałych.

Kolumna `data` **nie ma** ograniczenia `UNIQUE`: jeden dzień może mieć więcej niż jeden wpis.
Gdyby było inaczej, pojedyncza kolizja przerywałaby cały import (idzie w transakcji).

### Plakietki ocen

Cztery pola ocen (jakość snu, stres, nastrój, intencjonalność) są listami rozwijanymi
z etykietą `liczba emoji opis`, np. `4 😴 Dobry`. **W bazie zapisywana jest wyłącznie liczba** —
emoji i opis to warstwa prezentacji, więc kolumny zostają `INTEGER`-ami, a statystyki
i sortowanie działają bez zmian. Zmiana słowa „Przeciętny" na „Średni" nie wymaga
ruszania ani jednego rekordu.

Opisy mieszkają w [config/mapowanie-ocen.js](config/mapowanie-ocen.js) i są wystawiane
przez istniejący `/api/slowniki`. Puste pole jest poprawnym stanem — wyboru nie wymuszamy.

Styl plakietki jest **neutralny** (jasnoszare tło, bez kolorowania wg wartości). Kolorowanie
sugerowałoby „dobrą/złą" ocenę, a przy stresie — którego skala jest odwrócona — prowadziłoby
wprost do błędnych wniosków. Opis słowny rozwiązuje ten problem lepiej: `0 🔥 Bardzo wysoki`
nie da się odczytać opacznie.

### Nawyki — edytowalna lista

Lista nawyków mieszka w tabeli **`nawyki_slownik`** (migracja 4) i jest edytowalna z aplikacji.
Kliknięcie komórki **Nawyki** otwiera panel z checkboxem przy każdej pozycji; zaznaczenie
zapisuje się od razu, bez osobnego przycisku. Przy każdej pozycji ✏️ zmienia nazwę,
a 🗑️ usuwa ją z listy wyboru. Na dole panelu dodajesz nową.

Kolumna `dziennik.nawyki` **nadal jest zwykłym tekstem** z nazwami rozdzielonymi przecinkami —
celowo nie ma tabeli łączącej. Wpisy mają prawo zawierać nazwy historyczne, których już nie ma
w słowniku, a klucz obcy by to uniemożliwił.

**Zmiana nazwy działa kaskadowo** na wszystkich wpisach dziennika. Dopasowanie idzie po
**całych tokenach**, nie po podciągach:

```
tokeny = nawyki.split(',').map(trim)
jeśli żaden token !== staraNazwa  →  wiersz w ogóle nie jest ruszany
```

Podmiana przez `REPLACE(nawyki, stara, nowa)` byłaby błędem: zmiana „Water" → „H2O"
zepsułaby „Drink Water" na „Drink H2O", a „Drink Water" → „Woda" uszkodziłoby
„Drink Water Extra". Nazwy z nawiasami i spacjami (`Duolingo (road to 3 years)`) też
przechodzą bez szwanku. Wszystkie te przypadki są w smoke teście.

Porównanie tokenu jest **dokładne**, z uwzględnieniem wielkości liter — inaczej zmiana nazwy
normalizowałaby przy okazji zapis historyczny. Wykrywanie duplikatów przy dodawaniu i zmianie
nazwy działa osobno i wielkości liter **nie** rozróżnia.

**Usunięcie nie kaskaduje.** Nazwa znika tylko ze słownika; wpisy zachowują ją nietkniętą,
bo historia ma pozostać wierna. Skutek uboczny: po takim nawyku nie da się już filtrować,
choć nadal widać go w treści wpisów.

> **Zabezpieczenie przed cichą utratą danych.** Panel pokazuje także nazwy obecne w danym
> wpisie, a nieobecne w słowniku — usunięte oraz historyczne (np. `Untitled`) — oznaczone
> jako **„(spoza listy)"**. Gdyby zapis składał się wyłącznie z zaznaczonych checkboxów,
> takie nazwy znikałyby po cichu przy pierwszej edycji wiersza. Kolejność nazw w wierszu
> jest zachowywana, a nowo zaznaczone dopisywane na końcu.

Zasiew migracji to **15** nazw znalezionych przy imporcie — bez `Untitled`, które było
artefaktem eksportu z Notion. Wpis, który je zawiera, został nietknięty.

### Ostrzeżenie o duplikacie daty

Gdy inny wpis ma tę samą datę, komórka daty dostaje **żółte** obramowanie i podpowiedź
„inny wpis już ma tę datę (id X)". To **uwaga, nie walidacja** — zapis przechodzi normalnie,
bo kolumna `data` celowo nie ma `UNIQUE` i wiele wpisów na jeden dzień jest dozwolone.
Czerwony jest w tej tabeli zarezerwowany dla nieudanego zapisu, stąd inny kolor.

Sprawdzenie działa na **wczytanej już lokalnej kopii danych** — bez dodatkowego zapytania
do serwera. Przy każdym przeliczeniu skanowane są **wszystkie** wiersze, nie tylko edytowany:
gdy wpis A odsunie się od daty wpisu B, to właśnie B przestaje być duplikatem, więc
sprawdzenie samego A zostawiłoby przy B ostrzeżenie na zawsze.

### Filtry dziennika

Ten sam potok co w zadaniach — `posortowane(filtrowane())` w `doWyswietlenia()` — i ten sam
panel `<details>`, przycisk **Wyczyść filtry** oraz znacznik `— aktywne: N` przy zwiniętym
panelu. Licznik pokazuje **„Pokazano X z Y wpisów"** wraz z zakresem dat tego, co widać.

Trzy pola, łączone przez **ORAZ**:

| Filtr | Działanie |
| --- | --- |
| **Zakres dat** | jedno pole `data` musi mieścić się w `[OD, DO]`; presety Wszystkie / Dziś / 7 dni / 30 dni |
| **Szukaj w tekście** | fragment (bez rozróżniania wielkości liter) w **ośmiu** kolumnach naraz: `wdziecznosc`, `bledy`, `rozmowa`, `co_poszlo_dobrze`, `jutro_wazne`, `do_przemyslenia`, `trzy_slowa`, `nawyki` |
| **Nawyk** | multi-select z 16 nawyków, **LUB** w obrębie zaznaczonych |

Zakres dat jest tu **prostszy niż w zadaniach**: dziennik ma jedno pole daty, więc nie ma
dwóch niezależnych warunków (termin / okres aktywności).

> **Uwaga przy szukaniu:** posiłki (`sniadanie`, `obiad`, `kolacja`) **nie** są przeszukiwane —
> tak wynika ze specyfikacji pola. Szukanie „kawa" da zero wyników, mimo że słowo występuje
> w danych ponad 500 razy, właśnie dlatego, że siedzi wyłącznie w opisach posiłków.
> Dopisanie ich to jedna linijka w `POLA_SZUKANIA` w [public/js/dziennik.js](public/js/dziennik.js).

Filtr nawyku **rozbija pole `nawyki` po przecinkach i porównuje dokładnie**, zamiast szukać
fragmentu w całym tekście. Dziś żadna nazwa nie jest fragmentem innej, ale gołe „zawiera"
byłoby miną na przyszłość: wystarczyłby nawyk „Water" obok istniejącego „Drink Water",
żeby filtr zaczął łapać oba naraz.

Lista nawyków mieszka w `NAWYKI` w [config/slowniki.js](config/slowniki.js) i jest wystawiana
przez `/api/slowniki`. **Nie jest słownikiem walidacyjnym** — pole `nawyki` to zwykły tekst,
więc wpis może zawierać nazwę spoza listy i nadal będzie poprawny; lista służy tylko
do zbudowania checkboxów. Jest tam też `Untitled` — artefakt eksportu z Notion (1 wystąpienie);
zostawiony, żeby takie wpisy dało się odfiltrować i poprawić.

Eksport CSV, tak jak w zadaniach, obejmuje **pełny zbiór** — filtry go nie okrajają.

### Wspólna obsługa dat w filtrach

Arytmetyka dat i mechanika presetów żyją w [public/js/filtr-dat.js](public/js/filtr-dat.js),
używanym przez oba moduły. Moduł daje `numerDnia`, `dataPlusDni`, `dzisiajLokalnie`,
nazwane presety (`WSZYSTKIE`, `DZIS`, `DZIS_JUTRO`, `TYDZIEN`, `MIESIAC`) oraz budowanie
i podświetlanie przycisków.

Presety są wystawione **pojedynczo**, a nie jako gotowa lista, bo zestawy się różnią:
zadania mają „Dziś + jutro", dziennik nie. Każdy widok składa własną listę z tych samych klocków.

Czego w module **nie ma**: reguł dopasowania wiersza do zakresu. Są różne w każdym module
(zadania sprawdzają termin *oraz* okres aktywności, dziennik jedno pole `data`),
więc siedzą w plikach widoków.

### Import dziennika

Profil `dziennik` w [config/mapowanie-dziennika.js](config/mapowanie-dziennika.js) czyta
eksport CSV z Notion („Daily Quests"). Z 70 kolumn pliku mapuje 18, resztę pomija.

Kolumny Notion wymagają rozebrania na części, więc profil korzysta z **transformacji** —
punktu rozszerzenia w `lib/import.js`:

| Kolumna źródłowa | Pole | Transformacja |
| --- | --- | --- |
| `Name` | `data` | `@March 2, 2024 ` → `2024-03-02` |
| `🙌 Reported Wake Up Time` | `pobudka` | `02/03/2024 7:30 (GMT+1)` → `07:30` |
| `⭐ Sleep Quality` / `🤯 Stress Level` / `⭐ Intentionality` | oceny | wiodąca cyfra przed `-` |
| `😁 Happiness` | `nastroj` | 😄→5, 🙂→4, 😐→3, 🙁→2, 😢→1 |
| `⭐ Habits` | `nawyki` | nazwy bez URL-i, złączone przecinkami |

**Nagłówki zawierają emoji ze znakami niewidocznymi** — selektory wariantów (U+FE0F)
w `3️⃣ Three Words` i sekwencję ZWJ w `🤦‍♂️ Mistakes`. Dopasowanie jest dokładne,
więc przy dodawaniu kolumn **kopiuj nagłówki z pliku, nie przepisuj ich ręcznie**.

Literalny tekst `"null"` (Notion wpisuje go w niewypełnione pola — w tym eksporcie
ponad 900 razy) jest traktowany jako brak wartości. Steruje tym `WARTOSCI_PUSTE` w profilu.

Jedynym wymaganym polem jest `data`. Reszta może być pusta — to normalne w nowszych wpisach.

### Import "notion-quest-log" (projekty + zadania)

Profil w [config/mapowanie-quest-log.js](config/mapowanie-quest-log.js) czyta eksport
bazy „Success Plan" z Notion, w której **projekty i zadania leżą w jednej tabeli**,
rozróżnione kolumną `Type`.

Import jest **dwuprzebiegowy** — ten sam plik przechodzi przez silnik dwa razy,
za każdym razem z innym mapowaniem (rozdziela je `filtrWierszy`):

1. `Type = "Project"` → tabela `projekty`,
2. `Type = "Task"` → tabela `zadania`, podpięte przez kolumnę relacji `Upstream`.

Wiązanie idzie **po nazwie projektu**, nie po id: w podglądzie projekty jeszcze nie
istnieją w bazie, więc id nie mają. Przy zapisie najpierw wstawiane są projekty,
z nich powstaje mapa `nazwa → id`, dopiero potem zadania — całość w jednej transakcji.
Porównanie pomija skrajne spacje i wielkość liter.

**Brak dopasowania nie jest błędem.** Zadanie wchodzi bez projektu, a podgląd pokazuje
osobno: ile projektów, ile zadań, ile z podpiętym projektem i ile bez dopasowania
(wraz z nazwami nieznanych projektów).

#### Dlaczego `Do Date` → `termin`, a nie `start_zadania`

W źródłowym Notion `Due Date (Optional)` jest wypełnione tylko w **4 rekordach na 582**,
a faktyczną funkcję terminu pełnił `Do Date` — to po nim filtrowały widoki.

Gdyby `Do Date` trafił na `start_zadania`, pole `termin` zostałoby puste niemal wszędzie.
Mnożnik terminowości wymaga **jednocześnie** terminu i daty zakończenia, więc dla
wszystkich **468 ukończonych** zadań wyniósłby neutralne ×1 — cała mechanika premii
i kary za termin byłaby martwa, a XP zaniżone.

`Due Date (Optional)` nadpisuje termin tam, gdzie jest wypełnione. Nadpisania **nie da się**
zrobić dwoma nagłówkami wskazującymi na to samo pole: silnik przetwarza je po kolei,
a pusta data ustawia `null` i skasowałaby wartość z `Do Date`. Dlatego data opcjonalna
trafia do pola tymczasowego, a wybór robi hook `poWierszu`.

#### Mapowanie wartości

| Źródło | Cel | Uwagi |
| --- | --- | --- |
| `Status` | `stan` / `status` | Backlog→Plan, Ready to Start→Czeka, In Progress→W trakcie, Complete→Zrobione, Blocked→Blok, puste→Plan |
| `Area` | `obszar` | 1:1, bez tłumaczenia; puste → `Inne` |
| `Difficulty Score` | `trudnosc` | 1 - Easy→1, 2 - Moderate→2, 3 - Hard→3 |
| `Impact` | `priorytet` | x10 High→4, x5 Semi-High→3, x2 Impact→2, x0.5 Semi-Low→1, x0.2 Low→0, puste→2 |
| `Time (Tasks Only)` | `czas_trwania_godziny` | liczba |

Wymagana jest wyłącznie niepusta kolumna `Name`. Reszta jest opcjonalna.

#### Jak czytana jest kolumna `Upstream`

Notion eksportuje relację jako `Nazwa (https://app.notion.com/p/…)`. Bierzemy **wszystko
przed końcowym nawiasem z URL-em**; wariant bez URL-a też przechodzi.

Pole jest traktowane jako **pojedyncza wartość** — w 372 zadaniach z relacją nie ma ani
jednego z dwoma URL-ami, więc zadanie ma najwyżej jeden projekt.

> **Nie dzielimy po przecinku.** Pierwotna wersja parsera tak robiła i rozrywała nazwy
> projektów, które przecinek zawierają — „Stan, ale trudniejszy" czy „The Ultimate React
> Course 2024: React, Next.js, Redux & More". Nawias obcinany jest wyłącznie na **końcu**
> wartości, bo nazwa projektu sama może zawierać nawiasy. Trim jest konieczny: nazwy mają
> końcowe spacje, a przed nawiasem bywa podwójna spacja.

#### Weryfikacja na prawdziwym eksporcie

Profil powstał ze specyfikacji, ale został **sprawdzony na prawdziwym pliku**
(582 wiersze, 56 kolumn — wariant `…_all.csv`; krótszy plik bez `_all` ma tylko 6 kolumn
i do importu się nie nadaje). Wynik podglądu:

| | |
| --- | --- |
| projekty | 41 |
| zadania | 541 |
| zadania z podpiętym projektem | 371 |
| bez dopasowania | 1 |
| wiersze odrzucone | 0 |

Jedyne niedopasowanie to zadanie, którego `Upstream` wskazuje na **inne zadanie**,
nie na projekt. To zachowanie poprawne: zadanie wchodzi bez projektu, a podgląd pokazuje
nazwę jako informację, nie jako błąd.

Weryfikacja wykryła trzy rozbieżności wobec specyfikacji — brakujące formaty dat
z ukośnikami, zakresy ze strzałką i cięcie `Upstream` po przecinku. Wszystkie trzy
są opisane wyżej i pokryte asercjami w `test/smoke.js`.

### Jak dodać własny profil importu

`lib/import.js` jest generyczny i **nie zna** ani zadań, ani dziennika. Profil to obiekt
konfiguracji przekazywany do `przygotujImport()`:

| Klucz | Znaczenie |
| --- | --- |
| `mapowanie` | nagłówek w pliku → pole w bazie |
| `kolumnyWymagane` | ich brak przerywa **cały** import |
| `kolumnyIgnorowane` | świadomie pomijane (nie trafią do ostrzeżenia) |
| `polaDatowe` | przez tolerancyjny parser dat z `lib/daty.js` |
| `transformacje` | pole → `(surowa) => wartość \| null`; `null` znaczy **brak wartości, nie błąd** |
| `wartosciPuste` | teksty znaczące „brak" (np. `null`) |
| `waliduj` | `(rekord, surowy) => powód odrzucenia \| null` |

O poprawności wiersza decyduje wyłącznie `waliduj` — dostaje też **surowy** wiersz z pliku,
żeby móc zacytować w komunikacie wartość, która nie przeszła. Nowy profil dodajesz przez
plik `config/mapowanie-*.js` i **jeden wpis** w rejestrze `PROFILE` w `routes/import.js`.

## Statystyki

Strona **/statystyki.html** (link w nagłówku pozostałych stron). Bez biblioteki wykresów —
liczby, tabele HTML i jeden pasek proporcjonalny (zwykły `div` o zadanej szerokości).

Dane pobierane z istniejących `GET /api/zadania`, `GET /api/dziennik` i `GET /api/slowniki`;
**żadnych nowych endpointów**, wszystkie obliczenia po stronie klienta. Strona **przelicza
wszystko przy każdym wejściu** — nic nie jest cache'owane ani zapisywane, więc nie ma czego
unieważniać. Obliczenia siedzą w [public/js/reguly-statystyk.js](public/js/reguly-statystyk.js)
(czyste funkcje, bez DOM) i są objęte smoke testem.

**Zadania:** liczba łącznie i wg stanu · wg klienta/kategorii (malejąco) · średni czas trwania ·
odsetek zakończonych po terminie.

**Dziennik:** liczba wpisów i zakres dat · sen (średnia, min, max, % wypełnienia) · cztery
oceny (średnia + rozkład wartości) · tabela miesięczna.

### Jak liczony jest odsetek „po terminie"

- **Mianownik:** zadania mające wypełnione **oba** pola — `termin` i `czas_zakonczenia`.
  Celowo **bez** filtrowania po `stan`: o zakończeniu świadczy tu wypełniona data, nie etykieta.
- **Licznik:** te, w których `czas_zakonczenia` wypada po `termin`.
- Porównanie na **pełnych dniach kalendarzowych**, spójnie z resztą aplikacji — zakończenie
  o 23:00 w dniu terminu jest **na czas**.

Interfejs pokazuje zawsze **„X z Y (Z%)"**, nigdy samego procentu: przy trzech zadaniach
„33%" brzmi jak wniosek, a jest szumem. Gdy mianownik jest zerowy, zamiast dzielenia
przez zero pojawia się „—" i wyjaśnienie.

### Tabela miesięczna dziennika

Dla każdego miesiąca **obecnego w danych** (klucz `YYYY-MM`, kolejność chronologiczna):
liczba wpisów, liczba wpisów z refleksją i odsetek. „Z refleksją" znaczy **wypełnione
co najmniej jedno** z pól: `wdziecznosc`, `bledy`, `rozmowa`, `co_poszlo_dobrze`,
`jutro_wazne`, `do_przemyslenia`. Pusty tekst liczy się jako brak — edycja inline potrafi
zostawić `''`, które w bazie nie jest `NULL`-em, a znaczy to samo.

Miesiące bez ani jednego wpisu po prostu się nie pojawiają — nie zmyślamy wierszy z zerami
dla okresów, w których dziennika nie prowadzono.

> **Skala stresu jest odwrócona** (`0` = bardzo wysoki stres, `5` = brak stresu), w odróżnieniu
> od pozostałych ocen `1–5`. Strona ostrzega o tym przy średnich i w nagłówku rozkładu,
> bo bez tego „stres 2,68" czyta się dokładnie odwrotnie, niż znaczy.

## Smoke test

```bash
npm run test:smoke
```

Formalizuje sprawdzenia, które wcześniej robiło się ręcznie po każdej zmianie.
Wypisuje `PASS`/`FAIL` dla każdego punktu i kończy się kodem `1`, gdy cokolwiek nie przeszło.

**Kiedy uruchamiać:** przed każdym pushem po większej zmianie, a bezwzględnie po ruszeniu
czegokolwiek w `public/js/reguly-*.js`, `lib/` albo w kolejności `app.use(...)` w `server.js`.

Co pokrywa:

| Obszar | Sprawdzenia |
| --- | --- |
| Zadania | 4 presety zakresu dat · sortowanie po 10 kolumnach × 2 kierunki z regułą „Zrobione na dole" · kolumny wyliczane (w tym `23:59 → 00:01` = 2 dni) · filtry nazwy, stanu i priorytetu `0` |
| Dziennik | filtr nawyku (także że „Water" nie łapie „Drink Water") · szukanie z wielkością liter · własny zakres dat · sortowanie |
| Silnik XP | minimalne 1 XP · trzy progi terminowości · granica poziomu przy 500 XP · reset i prestiż przy 50 000 · odrzucenie zakupu ponad saldo · zgodność list pól po obu stronach |
| Quest-log | mapowanie statusów i Impact (5 poziomów) · trudność · wiązanie projekt–zadanie po `Upstream` · brak dopasowania jako informacja · `DELETE` projektu odpina zadania |
| Statystyki | odsetek „po terminie" (mianownik, porównanie na dniach, pusty mianownik → `null` zamiast `NaN`) · tabela miesięczna · średnie pomijające braki |
| Import | oba profile odrzucają te same wiersze z tymi samymi powodami; transformacje Notion (`@March 2, 2024`, `7:30 → 07:30`, nawyki bez URL-i, literalne `null`) |
| Endpointy | `PATCH /api/zadania/:id` z ciałem 300 kB → **413**, `PATCH /api/dziennik/:id` z tym samym ciałem → **200** |

Ostatni punkt to **test kontrolny kolejności middleware**. Sam fakt, że dziennik przyjmuje
duże ciało, niczego nie dowodzi — dopiero to, że *identyczne* ciało jest odrzucane na
`/api/zadania`, potwierdza, że globalny `express.json()` nadal ma ciasny limit, a routery
z własnym parserem faktycznie stoją przed nim. Bez tej pary błąd „Request entity too large"
mógłby wrócić niezauważony.

### Izolacja danych

Skrypt **nie dotyka `data/baza.db`**. Tworzy własny plik w katalogu tymczasowym systemu,
uruchamia na nim `server.js` jako osobny proces (`BAZA_DANYCH` + `PORT=3999`), a na koniec
kasuje go razem z plikami `-wal` i `-shm`. Zmienna `BAZA_DANYCH` obsługiwana jest w
[db/index.js](db/index.js) i istnieje wyłącznie po to — w normalnym użyciu się jej nie ustawia.

Serwer działa jako **osobny proces**, a nie przez wywołania funkcji, bo test limitu 413
dotyczy kolejności middleware i ma sens tylko przez prawdziwy stos HTTP.

Reguły filtrowania i sortowania to kod przeglądarki. Test ładuje `public/js/reguly-*.js`
w sandboksie (`vm`) — tak samo, jak przeglądarka ładuje kolejne `<script>`. Dzięki temu
sprawdza **ten sam kod, który wykonuje aplikacja**, a nie jego kopię, która przechodziłaby
też wtedy, gdy aplikacja jest zepsuta.

## Kopia zapasowa CSV

```bash
npm run backup
```

Zapisuje `backups/zadania-RRRR-MM-DD.csv` i `backups/dziennik-RRRR-MM-DD.csv`, po czym
kasuje kopie starsze niż **30 dni**. Katalog `backups/` jest w `.gitignore` — zawiera
te same prywatne dane co baza.

Skrypt czyta bazę **bezpośrednio**, więc działa również przy wyłączonej aplikacji.
CSV, a nie kopia pliku `.db`, bo arkusz otworzysz za pięć lat niezależnie od tego,
czy projekt jeszcze działa. (Na kopię 1:1 zostaje `VACUUM INTO` opisane niżej.)

Retencja liczy się z **daty w nazwie pliku**, nie z czasu modyfikacji — skopiowanie
albo przeniesienie folderu odświeża znaczniki czasu i przy retencji po `mtime`
kasowałoby złe pliki. Pliki niepasujące do wzorca (`zadania-`/`dziennik-` + data) są pomijane.

### Codzienne uruchamianie — Harmonogram zadań Windows

1. `Win + R` → `taskschd.msc` → Enter.
2. W panelu po prawej: **Utwórz zadanie podstawowe**.
3. Nazwa: `gamify-life backup` → **Dalej**.
4. Wyzwalacz: **Codziennie** → **Dalej** → godzina np. `21:00` → **Dalej**.
5. Akcja: **Uruchom program** → **Dalej**.
6. Wypełnij trzy pola:
   - **Program/skrypt:** `node`
     (jeśli Harmonogram go nie znajdzie, podaj pełną ścieżkę — sprawdzisz ją komendą
     `where node`, zwykle `C:\Program Files\nodejs\node.exe`)
   - **Dodaj argumenty:** `scripts/backup.js`
   - **Rozpocznij w:** `C:\Users\Jon\Documents\_gamify-life`
7. **Dalej** → zaznacz **Otwórz okno Właściwości…** → **Zakończ**.
8. W oknie właściwości, zakładka **Ogólne**: zaznacz **Uruchom niezależnie od tego, czy
   użytkownik jest zalogowany**, jeśli backup ma działać także przy wylogowanym koncie.
9. Zakładka **Warunki**: odznacz **Uruchamiaj tylko wtedy, gdy komputer jest zasilany
   z sieci**, jeśli pracujesz na laptopie — inaczej zadanie nie odpali na baterii.

> **Pole „Rozpocznij w" jest obowiązkowe.** Bez niego zadanie startuje w `C:\Windows\System32`,
> a skrypt szuka bazy względem katalogu projektu i zakończy się błędem. To najczęstsza
> przyczyna „zadanie się wykonało, ale kopii nie ma".

Sprawdzenie po skonfigurowaniu: kliknij zadanie prawym → **Uruchom**, a potem zajrzyj
do `backups/`. Kolumna **Wynik ostatniego uruchomienia** powinna pokazać `0x0`.

## Postać — XP, poziomy i waluta

Strona **/postac.html**. Pokazuje poziom, prestiż, pasek postępu, rozbicie źródeł XP
oraz formularz wydawania waluty z listą zakupów.

**Wszystko liczy się na żywo** z zadań i wpisów dziennika, przy każdym wejściu na stronę.
Nie ma logu zdarzeń ani zapisanego „stanu XP" — dzięki temu poprawienie starego zadania
albo wpisu natychmiast poprawia wynik historyczny, a cała dotychczasowa historia wlicza się
sama, bez żadnego „aktywowania". Reguły siedzą w [lib/nagrody.js](lib/nagrody.js).

Jedynym trwale zapisanym elementem jest **wydawanie** waluty (tabela `zakupy`) — zakupu
nie da się odtworzyć z niczego innego, więc musi być zdarzeniem.

### Naliczanie XP

**Zadanie** (tylko `Zrobione`, tylko z wypełnioną trudnością i czasem):

```
bazowe = max(1, round(trudnosc × czas_trwania_godziny))
xp     = max(1, round(bazowe × mnoznik_terminowosci))
```

`max(1, …)` sprawia, że ukończone zadanie **nigdy nie jest warte zera**.

Mnożnik terminowości liczy się na **pełnych dniach kalendarzowych** (spójnie z resztą
aplikacji — zakończenie o 23:00 w dniu terminu to nadal *na czas*):

| Zapas = `termin − zakończenie` | Mnożnik |
| --- | --- |
| ≥ 3 dni | **×1,5** |
| 0…2 dni | ×1 |
| < 0 (po terminie) | ×0,5 |
| brak którejś z dat | ×1 (neutralnie) |

**Nawyki:** 3 XP za każdy odhaczony nawyk, sumowane po wszystkich wpisach.

**Dziennik:** 5 XP za wpis z jakąkolwiek treścią + 10 XP za każde z sześciu wypełnionych
pól refleksyjnych. Ten sam licznik pokazuje kolumna **Refleksje** („4/6") w tabeli dziennika.

### Poziomy i prestiż

Próg poziomu to **500 XP**, a po **100 poziomach** licznik wraca do 1 i rośnie prestiż:

```
prestiz    = floor(xp / 50000)
xp_w_cyklu = xp % 50000
poziom     = floor(xp_w_cyklu / 500) + 1
```

### Waluta

`waluta_zarobiona = floor(XP / 2)`, pomniejszona o sumę kosztów z tabeli `zakupy`.
**Nie da się wejść na minus** — zakup ponad stan konta jest odrzucany z komunikatem
podającym, ile dokładnie brakuje. Cofnięcie zakupu zwraca walutę (saldo liczy się z sumy,
więc usunięcie wiersza wystarczy).

### Dlaczego silnik jest po stronie serwera

W odróżnieniu od `reguly-*.js` z `public/js`, `lib/nagrody.js` **nie musi działać
w przeglądarce** — frontend dostaje gotowe liczby z `GET /api/postac`. Dzięki temu smoke
test sprawdza go zwykłym `require()`, bez sandboksu `vm` (ta sztuczka jest potrzebna tylko
dla plików działających po obu stronach). Wszystkie funkcje są czyste, więc testy karmią je
syntetycznymi przypadkami brzegowymi bez dotykania bazy.

> **Jedna świadoma duplikacja.** Lista sześciu pól refleksyjnych istnieje w `lib/nagrody.js`
> (serwer) i w `public/js/reguly-statystyk.js` (przeglądarka — licznik „4/6" i tabela
> miesięczna). Granica serwer–przeglądarka wymusza kopię, więc zamiast refaktoru pilnuje jej
> asercja w smoke teście: gdyby ktoś dopisał pole tylko w jednym miejscu, test to wychwyci.

## Struktura projektu

```
server.js                    punkt wejścia — bootstrap i montowanie modułów
config/slowniki.js           stany, priorytety, klienci (jedno źródło prawdy)
config/mapowanie-importu.js  profil importu zadań (nagłówki CSV -> kolumny)
config/mapowanie-dziennika.js profil importu dziennika + transformacje Notion
config/mapowanie-ocen.js     opisy słowne ocen (plakietki)
db/index.js                  połączenie z SQLite (data/baza.db)
db/migracje.js               wersjonowane migracje schematu
lib/csv-parser.js            parser CSV                  — do użycia w każdym module
lib/daty.js                  parsowanie i normalizacja dat — j.w.
lib/import.js                silnik importu (generyczny)  — j.w.
lib/nagrody.js               silnik XP, poziomów i waluty (czyste funkcje)
config/mapowanie-quest-log.js profil importu "Success Plan" (projekty + zadania)
routes/zadania.js            REST API dla zadań
routes/slowniki.js           listy wyboru dla frontendu
routes/czas.js               dzisiejsza data serwera (presety filtrów)
routes/import.js             podgląd i zatwierdzenie importu (wszystkie profile)
routes/dziennik.js           REST API dla dziennika
routes/nawyki.js             REST API słownika nawyków
routes/postac.js             XP, poziom, waluta i zakupy
routes/projekty.js           REST API projektów
public/index.html            zadania — szkielet strony i nagłówki tabeli
public/dziennik.html         dziennik — j.w.
public/js/dziennik.js        render, sortowanie, edycja inline, eksport dziennika
public/css/style.css         styl (paleta zbudowana pod jasne tło — patrz color-scheme)
public/js/api.js             wspólny wrapper na fetch    — do użycia w każdym module
public/js/csv.js             generowanie i pobieranie CSV — j.w.
public/js/filtr-dat.js       arytmetyka dat i presety zakresu — j.w.
public/js/reguly-zadan.js    czyste reguły zadań (filtry, sortowanie, wyliczenia)
public/js/reguly-dziennika.js czyste reguły dziennika
public/js/reguly-statystyk.js czyste obliczenia statystyk
public/statystyki.html       strona statystyk
public/postac.html           strona postaci (XP, waluta)
public/projekty.html         strona projektów
public/js/projekty.js        renderowanie projektów
public/js/postac.js          renderowanie strony postaci
public/js/statystyki.js      renderowanie statystyk
test/smoke.js                npm run test:smoke
scripts/backup.js            npm run backup
public/js/csv-import.js      obsługa importu w przeglądarce
public/js/zadania.js         render, sortowanie, filtry, edycja inline, eksport
data/baza.db                 baza (tworzona automatycznie)
```

Katalog `lib/` zawiera kod serwerowy **bez wiedzy o zadaniach** — to on ma zostać
użyty ponownie przez kolejne moduły. `lib/import.js` dostaje mapowanie i funkcję
walidującą jako konfigurację, więc dziennik zaimportuje się tym samym kodem,
podając własny `config/mapowanie-*.js`.

### API

| Metoda   | Ścieżka             | Opis                                     |
| -------- | ------------------- | ---------------------------------------- |
| `GET`    | `/api/zadania`      | lista wszystkich zadań                   |
| `POST`   | `/api/zadania`      | tworzy rekord z wartościami domyślnymi, zwraca gotowy wiersz |
| `PATCH`  | `/api/zadania/:id`  | aktualizuje wybrane pola                 |
| `DELETE` | `/api/zadania/:id`  | usuwa zadanie                            |
| `GET`    | `/api/slowniki`     | stany, priorytety, klienci               |
| `GET`    | `/api/czas`         | dzisiejsza data serwera (`YYYY-MM-DD`)   |
| `GET`    | `/api/nawyki`       | słownik nawyków                          |
| `POST`   | `/api/nawyki`       | dodaje nazwę, odrzuca duplikat (409)     |
| `PATCH`  | `/api/nawyki/:id`   | zmienia nazwę **i kaskadowo** poprawia wpisy |
| `DELETE` | `/api/nawyki/:id`   | usuwa ze słownika, **nie** rusza wpisów  |
| `GET`    | `/api/postac`       | XP, poziom, prestiż, waluta, rozbicie źródeł |
| `GET`    | `/api/zakupy`       | lista wydatków                           |
| `POST`   | `/api/zakupy`       | dodaje wydatek, odrzuca ponad stan konta |
| `DELETE` | `/api/zakupy/:id`   | cofa zakup (waluta wraca)                |
| `GET`    | `/api/projekty`     | projekty wraz z licznikiem `X/Y` zadań    |
| `POST`   | `/api/projekty`     | nowy projekt                             |
| `PATCH`  | `/api/projekty/:id` | aktualizuje nazwę, status, opis          |
| `DELETE` | `/api/projekty/:id` | usuwa projekt, **odpina** zadania        |
| `GET`    | `/api/dziennik`     | lista wszystkich wpisów                  |
| `POST`   | `/api/dziennik`     | tworzy wpis z dzisiejszą datą            |
| `PATCH`  | `/api/dziennik/:id` | aktualizuje wybrane pola                 |
| `DELETE` | `/api/dziennik/:id` | usuwa wpis                               |
| `POST`   | `/api/import/:profil/podglad`   | sprawdza plik CSV, **nic nie zapisuje** (dry-run) |
| `POST`   | `/api/import/:profil/zatwierdz` | zapisuje poprawne wiersze (jedna transakcja)      |

`:profil` to `zadania`, `dziennik` albo `notion-quest-log`.

Oba endpointy importu przyjmują JSON `{ "tresc": "<zawartość pliku CSV>" }` —
nie `multipart/form-data`. Przeglądarka czyta plik przez `File.text()`, dzięki czemu
backend nie potrzebuje żadnej biblioteki do obsługi przesyłania plików.

## Jak to rozwijać

**Dopisać klienta / kategorię lub stan:** `config/slowniki.js`. Nic więcej —
backend i wszystkie dropdowny biorą listy stąd. Stany tylko dodawaj, nie usuwaj
(walidacja jest twarda, a stare rekordy zostają w bazie).

**Zmienić schemat bazy** (nowa kolumna, nowa tabela): dopisz funkcję **na końcu**
tablicy `MIGRACJE` w `db/migracje.js`. Wykona się sama przy najbliższym starcie, raz.
Nigdy nie edytuj migracji, która już się wykonała. Wartości domyślne wpisuj w migracjach
**wprost** (`'Plan'`, `2`), a nie przez stałe z `config/slowniki.js` — migracja to zapis
historii i ma znaczyć to samo za dwa lata, nawet gdy słownik się zmieni.

Przed migracją dotykającą istniejących danych zrób kopię — przy zatrzymanym serwerze:

```bash
node -e "new (require('better-sqlite3'))('data/baza.db',{readonly:true}).exec(\"VACUUM INTO 'data/kopia.db'\")"
```

`VACUUM INTO` daje spójny snapshot w jednym pliku (scala też dziennik WAL), w odróżnieniu
od zwykłego skopiowania `baza.db` bez plików `-wal`/`-shm`.

**Dodać moduł** (np. dziennik):

1. migracja z nową tabelą w `db/migracje.js`,
2. `routes/dziennik.js` na wzór `routes/zadania.js`,
3. jedna linijka `app.use('/api/dziennik', dziennikRouter)` w `server.js`,
4. `public/js/dziennik.js` na wzór `public/js/zadania.js`
   (`public/js/api.js` i `public/js/csv.js` są wspólne — nie pisz ich od nowa).

**Dodać kolumnę do sortowania:** dopisz wpis do `KOLUMNY_SORTOWANIA` w
`public/js/zadania.js` i `data-kolumna="klucz"` w nagłówku w `public/index.html`.
Reszta (strzałka, przełączanie kierunku, grupy) zadziała sama.

**Dodać nowy filtr:** dopisz pole do obiektu `filtry`, funkcję `pasujeXxx(z)` i jedną
linijkę w `filtrowane()` oraz w `ileAktywnychFiltrow()`. Kontrolkę dorzuć do panelu
w `index.html` i podepnij pod `zastosujFiltry()`. Reszta (licznik, znacznik aktywnych
filtrów, znikanie wierszy po edycji) zadziała sama, bo wszystko przechodzi przez
`doWyswietlenia()`.
