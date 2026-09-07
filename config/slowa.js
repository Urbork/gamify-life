/**
 * Wyglad slow opisujacych dzien: emoji i kategoria (kolor).
 *
 * W BAZIE SIEDZI SAMA NAZWA - emoji i kolor sa warstwa prezentacji i przychodza
 * stad, po nazwie. Ta sama zasada co przy config/mapowanie-ocen.js i
 * config/plakietki-zadan.js.
 *
 * DLACZEGO TO WAZNE AKURAT TUTAJ
 * Emoji byly kiedys wklejone WPROST W NAZWE ("🦥 Lazy"), przez co lista sortowala
 * sie po emoji zamiast po slowie, a "Lazy" ladowalo miedzy "IDK" a "Love".
 * Migracja 10 wyczyscila nazwy, a emoji wrocilo tutaj - dzieki temu moze stac
 * z PRZODU etykiety i nie wplywa ani na sortowanie, ani na porownania nazw.
 *
 * SLOWO SPOZA TEJ LISTY DZIALA NORMALNIE. Uzytkownik moze dopisac wlasne z panelu
 * wyboru; dostanie kategorie "neutralne" i zadnego emoji. Brak wpisu tutaj nie jest
 * bledem - jest domyslna.
 */

/*
  Kategorie sluza do POGRUPOWANIA WZROKIEM, nie do liczenia. Kolory nie znacza
  "dobrze/zle" w sensie oceny - "Difficult" nie jest gorszym dniem, tylko innym.
  Podzial powstal z tego, co slowa opisuja, a nie z tego, jak koreluja z ocenami:
  korelacje zmieniaja sie z danymi, a znaczenie slowa nie.
*/
const KATEGORIE = [
  { id: 'dobre', etykieta: 'Good', opis: 'Joy, closeness, rest' },
  { id: 'produktywnosc', etykieta: 'Productivity', opis: 'Creating, learning, order' },
  { id: 'trudne', etykieta: 'Hard', opis: 'Stress, obstacles, feeling worse' },
  { id: 'zmeczenie', etykieta: 'Fatigue', opis: 'Low energy, a day without momentum' },
  { id: 'neutralne', etykieta: 'Neutral', opis: 'No clear colouring' },
];

const KATEGORIA_DOMYSLNA = 'neutralne';

/*
  Emoji dobrane tak, zeby ROZNILY SIE OD SIEBIE - to one niosa rozpoznanie przy
  szybkim skanowaniu listy. Asercja w test/smoke.js pilnuje, ze zadne sie nie powtarza.

  Celowo BEZ sekwencji ZWJ (np. 👨‍👩‍👧) i bez najnowszych emoji: w tym projekcie
  znaki zlozone juz raz sprawily klopot przy dopasowywaniu naglowkow importu,
  a starsze emoji renderuja sie wszedzie tak samo.

  Nie kazde slowo musi miec emoji - jesli zadne nie pasuje bez naciagania,
  zostaje samo slowo. Lepiej puste miejsce niz znak, ktory myli.
*/
const SLOWA = {
  // --- dobre ---
  Balanced: { emoji: '⚖️', kategoria: 'dobre' },
  Excited: { emoji: '⚡', kategoria: 'dobre' },
  Family: { emoji: '🏡', kategoria: 'dobre' },
  Festive: { emoji: '✨', kategoria: 'dobre' },
  Friendship: { emoji: '🤝', kategoria: 'dobre' },
  Fulfilled: { emoji: '🌱', kategoria: 'dobre' },
  Fun: { emoji: '🎉', kategoria: 'dobre' },
  Happy: { emoji: '🙂', kategoria: 'dobre' },
  Helpful: { emoji: '🙌', kategoria: 'dobre' },
  Leisure: { emoji: '🛋️', kategoria: 'dobre' },
  Love: { emoji: '❤️', kategoria: 'dobre' },
  Relieved: { emoji: '😌', kategoria: 'dobre' },
  Sharing: { emoji: '🎁', kategoria: 'dobre' },

  // --- produktywnosc ---
  Creative: { emoji: '🎨', kategoria: 'produktywnosc' },
  Diligent: { emoji: '🛠️', kategoria: 'produktywnosc' },
  Educational: { emoji: '📚', kategoria: 'produktywnosc' },
  Exploring: { emoji: '🧭', kategoria: 'produktywnosc' },
  Inspired: { emoji: '💡', kategoria: 'produktywnosc' },
  Introspective: { emoji: '🪞', kategoria: 'produktywnosc' },
  Investigative: { emoji: '🔍', kategoria: 'produktywnosc' },
  Motivated: { emoji: '🚀', kategoria: 'produktywnosc' },
  Organized: { emoji: '🗂️', kategoria: 'produktywnosc' },

  // --- trudne ---
  Difficult: { emoji: '🧗', kategoria: 'trudne' },
  Disappointed: { emoji: '😞', kategoria: 'trudne' },
  Frustrated: { emoji: '😤', kategoria: 'trudne' },
  Overwhelmed: { emoji: '🌊', kategoria: 'trudne' },
  Sad: { emoji: '😢', kategoria: 'trudne' },
  Sick: { emoji: '🤮', kategoria: 'trudne' },
  Stressed: { emoji: '😰', kategoria: 'trudne' },
  Stuck: { emoji: '🧱', kategoria: 'trudne' },

  // --- zmeczenie ---
  Lazy: { emoji: '🦥', kategoria: 'zmeczenie' },
  'Low Energy': { emoji: '🔋', kategoria: 'zmeczenie' },
  'Low Impact': { emoji: '🌫️', kategoria: 'zmeczenie' },
  Tired: { emoji: '🛏️', kategoria: 'zmeczenie' },

  // --- neutralne ---
  IDK: { emoji: '❔', kategoria: 'neutralne' },
  OK: { emoji: '👍', kategoria: 'neutralne' },
};

module.exports = { KATEGORIE, KATEGORIA_DOMYSLNA, SLOWA };
