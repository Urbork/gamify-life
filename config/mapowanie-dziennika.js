/**
 * Profil importu dla tabeli `dziennik` - eksport CSV z Notion ("Daily Quests").
 *
 * Ten sam wzorzec co config/mapowanie-importu.js (zadania). Cala roznica polega na tym,
 * ze wiekszosc kolumn Notion trzeba rozebrac na czesci - sluzy do tego TRANSFORMACJE,
 * czyli punkt rozszerzenia w lib/import.js. Silnik importu jest wspolny, tu jest
 * wylacznie wiedza o formacie pliku.
 *
 * UWAGA NA NAGLOWKI: zawieraja emoji, w tym znaki niewidoczne przy czytaniu -
 * selektory wariantow (U+FE0F) w "3️⃣ Three Words" i sekwencje ZWJ w "🤦‍♂️ Mistakes".
 * Dopasowanie jest DOKLADNE, wiec nie przepisuj ich recznie - kopiuj z pliku.
 */

// Angielskie nazwy miesiecy - Notion eksportuje daty po angielsku niezaleznie od jezyka UI.
const MIESIACE = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const dwie = (n) => String(n).padStart(2, '0');

/**
 * "Name" -> data.  '@March 2, 2024 ' -> '2024-03-02'
 * Notion poprzedza nazwe rekordu-daty malpa i bywa, ze zostawia spacje na koncu.
 * Zwraca null, gdy wartosci nie da sie sparsowac - wiersz odrzuci wtedy waliduj().
 */
function parsujDateWpisu(tekst) {
  const wzorzec = /^@?\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\s*$/;
  const m = wzorzec.exec(tekst.trim());
  if (!m) return null;

  const miesiac = MIESIACE[m[1].toLowerCase()];
  if (!miesiac) return null;

  const rok = Number(m[3]);
  const dzien = Number(m[2]);

  // Kontrola istnienia dnia - odrzuca np. "February 30, 2024".
  const d = new Date(Date.UTC(rok, miesiac - 1, dzien));
  if (d.getUTCFullYear() !== rok || d.getUTCMonth() !== miesiac - 1 || d.getUTCDate() !== dzien) {
    return null;
  }

  return `${rok}-${dwie(miesiac)}-${dwie(dzien)}`;
}

/**
 * "🙌 Reported Wake Up Time" -> pobudka.  '02/03/2024 7:30 (GMT+1)' -> '07:30'
 *
 * Bierzemy WYLACZNIE godzine. Date pomijamy, bo wpis ma juz wlasna date z "Name",
 * a strefe pomijamy, bo godzina pobudki jest z definicji lokalna.
 *
 * Separatorem jest UKOSNIK (DD/MM/YYYY) - to inny format niz trzy obslugiwane
 * przez lib/daty.js dla zadan, dlatego parsujemy go tutaj, a nie tam.
 *
 * Czesc wartosci w pliku to sama data, bez godziny ('30/03/2025') - wtedy null,
 * czyli brak godziny pobudki. To nie jest blad.
 */
function parsujGodzinePobudki(tekst) {
  const m = /^\d{1,2}\/\d{1,2}\/\d{4}\s+(\d{1,2}):(\d{2})/.exec(tekst.trim());
  if (!m) return null;

  const godzina = Number(m[1]);
  const minuta = Number(m[2]);
  if (godzina > 23 || minuta > 59) return null;

  // Dopelnienie do dwoch cyfr: w pliku godziny jednocyfrowe zapisane sa jako "7:30".
  return `${dwie(godzina)}:${dwie(minuta)}`;
}

/**
 * Wyciaga wiodaca cyfre z wartosci typu '4 - A ⭐️⭐️⭐️⭐️', '0 - Very high', '3 - ⭐️⭐️⭐️'.
 * Uzywane dla jakosci snu, poziomu stresu i intencjonalnosci.
 */
function wiodacaCyfra(tekst) {
  const m = /^\s*(\d+)\s*-/.exec(tekst);
  return m ? Number(m[1]) : null;
}

/** Liczba wprost ('8', '7.5'). Zwraca null dla czegokolwiek, co nie jest liczba. */
function liczba(tekst) {
  const n = Number(String(tekst).replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
}

// "😁 Happiness" -> nastroj. W pliku wystepuje dokladnie tych piec emoji.
const NASTROJE = { '😄': 5, '🙂': 4, '😐': 3, '🙁': 2, '😢': 1 };

function parsujNastroj(tekst) {
  const klucz = tekst.trim();
  return NASTROJE[klucz] ?? null;
}

/**
 * "⭐ Habits" -> nawyki.
 * Zrodlo: 'Drink Water (https://…), Duolingo (road to 3 years) (https://…)'
 * Wynik:  'Drink Water, Duolingo (road to 3 years)'
 *
 * UWAGA: nazwy nawykow SAME zawieraja nawiasy (np. "Zapisać emocje (rano)",
 * "Duolingo (road to 3 years)") - w tym pliku dotyczy to 649 wierszy.
 * Dlatego usuwamy wylacznie nawiasy zawierajace URL, a nie "wszystko od pierwszego (",
 * bo to obcieloby czesc nazwy.
 */
function parsujNawyki(tekst) {
  const bezLinkow = tekst.replace(/\s*\(https?:\/\/[^)]*\)/g, '');
  const nazwy = bezLinkow
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return nazwy.length > 0 ? nazwy.join(', ') : null;
}

const MAPOWANIE_KOLUMN = {
  Name: 'data',
  '🙌 Reported Wake Up Time': 'pobudka',
  '💤 # of hours sleep': 'godziny_snu',
  '⭐ Sleep Quality': 'jakosc_snu',
  '🤯 Stress Level': 'stres',
  '😁 Happiness': 'nastroj',
  '⭐ Intentionality': 'intencjonalnosc',
  '3️⃣ Three Words': 'trzy_slowa',
  '⭐ Habits': 'nawyki',
  '🙏 Grateful For': 'wdziecznosc',
  '🤦‍♂️ Mistakes': 'bledy',
  '💬 Meaningful Convo': 'rozmowa',
  '❔ What did I do that I feel good about?': 'co_poszlo_dobrze',
  '❔ What could I do tomorrow that is high leverage?': 'jutro_wazne',
  '❔ What do I want to sleep on?': 'do_przemyslenia',
  '🍳 Breakfast': 'sniadanie',
  '🍜 Lunch': 'obiad',
  '🍽 Dinner': 'kolacja',
};

const TRANSFORMACJE = {
  data: parsujDateWpisu,
  pobudka: parsujGodzinePobudki,
  godziny_snu: liczba,
  jakosc_snu: wiodacaCyfra,
  stres: wiodacaCyfra,
  nastroj: parsujNastroj,
  intencjonalnosc: wiodacaCyfra,
  nawyki: parsujNawyki,
  // trzy_slowa i pola tekstowe ida wprost - nie ma dla nich transformacji.
};

/*
  Notion wpisuje literalne "null" w niewypelnione pola tekstowe (w tym eksporcie
  ponad 900 razy). Bez tej listy trafiloby ono do bazy jako tresc wpisu.
*/
const WARTOSCI_PUSTE = ['null'];

// Bez "Name" plik nie jest tym, za co sie podaje - przerywamy caly import.
const KOLUMNY_WYMAGANE = ['Name'];

/*
  Eksport "all" ma 70 kolumn; mapujemy 18. Reszta to mechanika grywalizacji Notion
  (Badges, Loot Box, Reward, Completion %, EXP Multiplier, kolumny wyliczane...),
  ktora nie ma odpowiednika w naszym schemacie.

  Lista jest tu po to, zeby podglad importu nie zasypywal Cie ostrzezeniem
  "kolumny pominiete" dla rzeczy pomijanych SWIADOMIE. Kolumna spoza tej listy
  i spoza mapowania nadal pokaze sie w podgladzie - i dobrze, bo to sygnal,
  ze eksport zmienil ksztalt.
*/
const KOLUMNY_IGNOROWANE = [
  // Liczniki pomocnicze Notion - liczymy je sami z zapisanych wartosci.
  '# of Habits',
  '# of Meals',
  '# of Reflections',
  '# of Skills Practiced',
  '# of Skills To Practice',
  '# of Supplementary Habits',

  // Naglowki sekcji - w Notion to wizualne przekladki, zawsze puste.
  '> Badges',
  '> Calculations',
  '> Connectors',
  '> Information',
  '> Loot Box',
  '> Make Work Fun',
  '> Morning Report',
  '> Overall Progress',
  '> Reflection Progress',

  // Grywalizacja Notion. Mamy wlasny silnik (lib/nagrody.js), ktory liczy to sam.
  'Badge: Exercise This Week?',
  'Badge: Habit Details',
  'Badge: Over 70% yesterday?',
  'Badge: Reflection This Week?',
  'Badge: Slept Well Yesterday?',
  'Choose Your Reward',
  'EXP Multiplier',
  'Habit Multiplier',
  'Item Purchased?',
  'Of Times Purchased',
  'Reflection Multiplier',
  'Reward Matches?',
  'Reward Rarity',
  'Reward Rarity Earned',
  'Stress Level Modifier',
  'Supplementary Multiplier',

  // Postep i wskazniki liczone formula z innych kolumn.
  'Completion %',
  'Daily Habit Goal',
  'Intentionality #',
  'Remaining Energy',
  'Sleep Quality Output',
  'Slept Enough',
  "Today's Energy",
  "Today's Progress",
  'Reflection Details',
  '🎲 Dice Roll',

  // Duplikaty i warianty pol, ktore bierzemy z kolumn zrodlowych.
  'Wake Up Time',
  '🙌 Automatic Wake Up Time',
  '🎶 Skills Practice',

  // Metadane i organizacja bez odpowiednika w naszym modelu.
  'Details',
  'Family Connection',
  'Medical Assignment',
  'Share With Family?',
  'Show?',
  'Tag',
  'Type',
  'Week',
];

/**
 * Walidacja wiersza dziennika.
 * JEDYNYM wymaganym polem jest data - reszta bywa pusta i to normalne,
 * zwlaszcza w nowszych wpisach.
 *
 * @param {object} rekord przetworzony wiersz
 * @param {object} surowy oryginalne wartosci z pliku (do komunikatu o bledzie)
 */
function waliduj(rekord, surowy) {
  if (!rekord.data) {
    const wartosc = surowy.Name ?? '';
    return wartosc.trim() === ''
      ? 'Pusta kolumna "Name" - brak daty wpisu.'
      : `Kolumna "Name": nie udało się odczytać daty z "${wartosc}". Oczekiwano np. "@March 2, 2024".`;
  }
  return null;
}

module.exports = {
  MAPOWANIE_KOLUMN,
  KOLUMNY_WYMAGANE,
  KOLUMNY_IGNOROWANE,
  TRANSFORMACJE,
  WARTOSCI_PUSTE,
  waliduj,
  // eksportowane do testow jednostkowych
  parsujDateWpisu,
  parsujGodzinePobudki,
  parsujNawyki,
  parsujNastroj,
  wiodacaCyfra,
};
