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

Kolumny **Dni do terminu** i **Czas trwania (dni)** są wyliczane w przeglądarce przy
renderowaniu i **nie są zapisywane w bazie**. Pierwsza to `termin − dzisiaj`
(wartość ujemna = po terminie, podświetlana na czerwono), druga to
`zakończenie − start` (pusta, gdy brakuje którejś z dat).

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

Przycisk **Importuj z CSV** wczytuje plik wyeksportowany z innego narzędzia
(domyślnie: eksport z Notion). Import jest **dwuetapowy**:

1. wybór pliku → `POST /api/import/podglad` — plik jest parsowany i sprawdzany,
   ale **nic nie trafia do bazy**;
2. podgląd pokazuje „X gotowych do zaimportowania, Y odrzuconych" plus tabelkę
   odrzuconych wierszy z numerem linii w pliku i konkretnym powodem;
3. dopiero **Zatwierdź import** → `POST /api/import/zatwierdz` zapisuje dane.

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

**Formaty dat** próbowane po kolei: `YYYY-MM-DD`, `Month D, YYYY` (np. `August 8, 2026` —
domyślny format Notion), `DD.MM.YYYY`. Puste pole to brak daty, a nie błąd.
Godzina jest uzupełniana jako `00:00`.

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

## Struktura projektu

```
server.js                    punkt wejścia — bootstrap i montowanie modułów
config/slowniki.js           stany, priorytety, klienci (jedno źródło prawdy)
config/mapowanie-importu.js  profil importu zadań (nagłówki CSV -> kolumny)
config/mapowanie-dziennika.js profil importu dziennika + transformacje Notion
db/index.js                  połączenie z SQLite (data/baza.db)
db/migracje.js               wersjonowane migracje schematu
lib/csv-parser.js            parser CSV                  — do użycia w każdym module
lib/daty.js                  parsowanie i normalizacja dat — j.w.
lib/import.js                silnik importu (generyczny)  — j.w.
routes/zadania.js            REST API dla zadań
routes/slowniki.js           listy wyboru dla frontendu
routes/czas.js               dzisiejsza data serwera (presety filtrów)
routes/import.js             podgląd i zatwierdzenie importu (wszystkie profile)
routes/dziennik.js           REST API dla dziennika
public/index.html            zadania — szkielet strony i nagłówki tabeli
public/dziennik.html         dziennik — j.w.
public/js/dziennik.js        render, sortowanie, edycja inline, eksport dziennika
public/css/style.css         styl (paleta zbudowana pod jasne tło — patrz color-scheme)
public/js/api.js             wspólny wrapper na fetch    — do użycia w każdym module
public/js/csv.js             generowanie i pobieranie CSV — j.w.
public/js/filtr-dat.js       arytmetyka dat i presety zakresu — j.w.
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
| `GET`    | `/api/dziennik`     | lista wszystkich wpisów                  |
| `POST`   | `/api/dziennik`     | tworzy wpis z dzisiejszą datą            |
| `PATCH`  | `/api/dziennik/:id` | aktualizuje wybrane pola                 |
| `DELETE` | `/api/dziennik/:id` | usuwa wpis                               |
| `POST`   | `/api/import/:profil/podglad`   | sprawdza plik CSV, **nic nie zapisuje** (dry-run) |
| `POST`   | `/api/import/:profil/zatwierdz` | zapisuje poprawne wiersze (jedna transakcja)      |

`:profil` to `zadania` albo `dziennik`.

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
