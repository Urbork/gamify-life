/**
 * Emoji nawykow - warstwa prezentacji, tak samo jak przy slowach (config/slowa.js).
 *
 * W BAZIE SIEDZI SAMA NAZWA. Nazwy nawykow sa w tabeli `nawyki_slownik`, uzytkownik
 * edytuje je z panelu wyboru, a emoji przychodzi stad, po nazwie. Dzieki temu:
 *   - lista sortuje sie po nazwie, a nie po emoji,
 *   - zmiana ikony nie rusza ani jednego rekordu,
 *   - kaskadowa zmiana nazwy nadal dopasowuje CALE tokeny.
 *
 * NAWYKI NIE MAJA KATEGORII, w odroznieniu od slow. Slowa opisuja, JAKI byl dzien,
 * wiec podzial na "dobre / trudne / zmeczenie" cos znaczy. Nawyk to czynnosc -
 * pokolorowanie "Vitamins" na zielono, a "Drink Water" na niebiesko byloby
 * podzialem wymyslonym, a nie odczytanym z tego, czym te nawyki sa.
 *
 * BRAK WPISU TO NIE BLAD. Nawyk dopisany przez uzytkownika po prostu nie ma ikony,
 * i tak zostaje, dopoki ktos nie uzna, ze jakas do niego pasuje. Lepiej puste
 * miejsce niz znak dobrany na sile - "Literalnie" nie ma emoji wlasnie dlatego.
 */

const EMOJI_NAWYKOW = {
  'Book or Movie': '📖',
  'Breathing Exercises': '🌬️',
  'Daily commit': '💻',
  Drawing: '✏️',
  'Drink Water': '💧',
  'Duolingo (road to 3 years)': '🦉',
  'Exercise/Tai Chi/Swimming': '🏊',
  'Go For A Walk': '🚶',
  'Proktis-M': '🩹',
  'Sprawdzić Slack i Discord': '💬',
  Vitamins: '💊',
  'Zapisać emocje (rano)': '🌅',
  'Zapisać emocje (popołudnie)': '☀️',
  'Zapisać emocje (wieczór)': '🌙',
};

module.exports = { EMOJI_NAWYKOW };
