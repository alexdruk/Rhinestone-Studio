/**
 * Shared content corpus for RS Modern's visual acceptance pass (FONT-002). Single source of truth
 * for both the QA sheet generator (tools/generate-rs-modern-qa-sheets.mjs) and the automated
 * corpus-wide structural checks in tools/test-rs-modern.mjs, so the two can never drift out of sync
 * with each other -- mirrors tools/rsBlockQaCorpus.mjs's own structure (see that file's module doc).
 */

const REVIEWED_KERNING_PAIRS = ['AV', 'VA', 'WA', 'AW', 'To', 'Yo', 'LA', 'LT', 'TT', 'TA', 'FA', 'PA', 'LY', 'RY'];

const COMMON_NAMES = ['Olivia', 'Benjamin', 'Isabella', 'Nathaniel', 'Charlotte', 'Sebastian', 'Amelia', 'Theodore'];

const WEDDING = ['Bride', 'Bride Squad', 'Bride Tribe', 'Just Married', 'Mr & Mrs', 'Wedding', 'Forever', 'Love'];

const SPORTS = ['Falcons', 'Grizzlies', 'Raptors', 'Comets', 'Rangers', 'Hornets'];

const BUSINESS = ['Modern Studio', 'Bright Designs', 'Craft & Co', 'Clean Slate', 'Prime Rhinestones'];

const STRESS_WORDS = [
  'MISSISSIPPI', 'BOOKKEEPER', 'MINIMUM', 'MILLION', 'ILLUSION', 'SUCCESS', 'BALLOON', 'RHINESTONE',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'
];

// ~100 mixed words/phrases exercising every glyph repeatedly -- same structure/coverage rationale as
// RS Block's own corpus, different word choices so the two QA packages aren't literal duplicates.
const RANDOM_PHRASES = [
  // Single words, one per starting letter (A-Z), for broad per-letter exposure.
  'Adventure', 'Blossom', 'Cascade', 'Discover', 'Ember', 'Frontier', 'Glimmer', 'Horizon',
  'Ignite', 'Journey', 'Kindred', 'Luminous', 'Meadow', 'Nova', 'Oasis',
  'Pinnacle', 'Quartz', 'Ripple', 'Solstice', 'Thrive', 'Utopia', 'Vertex', 'Wander',
  'Xenon', 'Yield', 'Zenith',
  // Two-word phrases.
  'Bold Spirit', 'Clear Sky', 'Fresh Start', 'Grand Design', 'High Tide',
  'Iron Will', 'Just Right', 'Keen Eye', 'Long Road', 'Main Street',
  'New Chapter', 'Open Road', 'Pure Gold', 'Quiet Mind', 'Rising Sun', 'Sharp Focus',
  'True Form', 'Utter Joy', 'Vivid Dream', 'Wide Open', 'Young Heart', 'Zero Gravity', 'Bright Future',
  'Calm Waters', 'Deep Roots', 'Even Ground', 'Fast Lane', 'Good Vibes', 'Hard Work', 'Inner Peace',
  // Punctuation-bearing phrases (only the family's supported set: . , ! ? ' - &).
  "Don't Stop!", "What's Next?", 'Ready, Set, Go!', 'Home & Away', 'Best Friends Forever!',
  "It's a Boy!", "It's a Girl!", 'Congrats, Grad!', 'No. 1 Fan', "Rock 'n' Roll", 'Mom & Dad',
  'Salt & Pepper', 'Hip-Hop', 'Well-Loved', 'One-of-a-Kind', "Y'all Ready?", 'Cheers, Friends!',
  'Thank You!', 'So Grateful.', 'All Set, Go!',
  // Digit-bearing phrases and mixed alphanumerics.
  'Class of 2026', 'Room 101', 'Table 7', '2026 Champions', 'Track 42', 'Level 99',
  'Est. 1985', 'Since 1999', 'Best of 2026', 'Route 66', 'Top 10', 'Number One',
  '24 Karat Gold', '3rd Base Champs', 'A1 Quality', 'Game Day 2026', 'Lucky 7', 'Fresh 2026',
  'Squad Goals 2026', 'Party of 5',
  // More single words and short phrases for volume/repetition of already-used glyphs.
  'Radiant', 'Serenade', 'Triumph', 'Uplift', 'Vantage', 'Whisper', 'Zephyr', 'Anchor',
  'Beacon', 'Cascade Falls', 'Dawn Patrol', 'Elevate', 'Flourish', 'Gravity', 'Haven',
  'Icon', 'Jubilant', 'Keepsake', 'Legacy', 'Momentum', 'Nourish', 'Orbit', 'Prism',
  'Quest', 'Reverie', 'Sanctuary', 'Timeless Grace', 'Unwind', 'Velvet Sky', 'Wildflower'
];

export const SHEETS = [
  {
    file: '01-complete-alphabet',
    title: '1. Complete alphabet',
    words: ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'],
    glyphGrid: null
  },
  {
    file: '02-uppercase',
    title: '2. Uppercase',
    words: ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ'],
    glyphGrid: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
  },
  {
    file: '03-lowercase',
    title: '3. Lowercase',
    words: ['abcdefghijklmnopqrstuvwxyz', 'abcdefghijklm', 'nopqrstuvwxyz'],
    glyphGrid: [...'abcdefghijklmnopqrstuvwxyz']
  },
  {
    file: '04-digits',
    title: '4. Digits',
    words: ['0123456789', '0 1 l I', '5 S', 'O 0', 'B 8', 'C G', 'P R', 'M N'],
    glyphGrid: [...'0123456789']
  },
  {
    file: '05-punctuation',
    title: '5. Punctuation',
    words: ['Hello, world!', 'Wait... really?', "Bride's Squad", 'Est. 2026', 'Rock & Roll', 'A-Frame'],
    glyphGrid: null
  },
  {
    file: '06-kerning',
    title: '6. Kerning pairs',
    words: REVIEWED_KERNING_PAIRS,
    glyphGrid: null
  },
  {
    file: '07-common-names',
    title: '7. Common names',
    words: COMMON_NAMES,
    glyphGrid: null
  },
  {
    file: '08-wedding',
    title: '8. Wedding',
    words: WEDDING,
    glyphGrid: null
  },
  {
    file: '09-sports',
    title: '9. Sports',
    words: SPORTS,
    glyphGrid: null
  },
  {
    file: '10-business',
    title: '10. Business',
    words: BUSINESS,
    glyphGrid: null
  },
  {
    file: '11-stress-words',
    title: '11. Stress words',
    words: STRESS_WORDS,
    glyphGrid: null
  },
  {
    file: '12-random-phrases',
    title: '12. Random phrases',
    words: RANDOM_PHRASES,
    glyphGrid: null
  }
];

export { REVIEWED_KERNING_PAIRS, COMMON_NAMES, WEDDING, SPORTS, BUSINESS, STRESS_WORDS, RANDOM_PHRASES };

/** Every content string across all 12 sheets, for corpus-wide automated checks. */
export const ALL_CONTENT_STRINGS = SHEETS.flatMap((sheet) => sheet.words);
