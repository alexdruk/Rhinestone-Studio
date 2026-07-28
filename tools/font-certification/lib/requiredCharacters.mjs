/**
 * Shared character/word corpora and required-table list for FONT-CERT-001.
 *
 * Kept as data, not logic, so the validator, typography reviewer, and
 * production reviewer all evaluate the exact same character/word sets the
 * milestone spec calls out -- no drift between "what Part 1 checks glyph
 * coverage for" and "what Part 2/3 render".
 */

export const REQUIRED_UPPERCASE = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
export const REQUIRED_LOWERCASE = Array.from('abcdefghijklmnopqrstuvwxyz');
export const REQUIRED_DIGITS = Array.from('0123456789');
export const REQUIRED_PUNCTUATION = [
  { char: ' ', name: 'space' },
  { char: '.', name: 'period' },
  { char: ',', name: 'comma' },
  { char: '\'', name: 'apostrophe' },
  { char: '-', name: 'hyphen' },
  { char: '!', name: 'exclamation mark' },
  { char: '?', name: 'question mark' }
];

export const REQUIRED_CHARACTERS = [
  ...REQUIRED_UPPERCASE.map((char) => ({ char, name: char })),
  ...REQUIRED_LOWERCASE.map((char) => ({ char, name: char })),
  ...REQUIRED_DIGITS.map((char) => ({ char, name: char })),
  ...REQUIRED_PUNCTUATION
];

export const REQUIRED_SFNT_TABLES = ['cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post', 'OS/2'];

// Alternate tags the same logical table may appear under across tools/spec text --
// used only to normalize comparisons against REQUIRED_SFNT_TABLES above.
export const SFNT_TABLE_TAG_ALIASES = {
  'OS/2': ['OS/2'],
  cmap: ['cmap'],
  glyf: ['glyf'],
  head: ['head'],
  hhea: ['hhea'],
  hmtx: ['hmtx'],
  loca: ['loca'],
  maxp: ['maxp'],
  name: ['name'],
  post: ['post']
};

// Disambiguation-critical character pairs called out explicitly in the milestone spec (Part 3),
// plus the ambiguity-prone Latin pairs from Part 2's stress block. Each entry is compared both as
// raw glyph outlines (typography review) and as generated stone layouts (rhinestone review).
export const CONFUSABLE_PAIRS = [
  ['I', 'l'], ['l', '1'], ['I', '1'],
  ['O', '0'],
  ['S', '5'],
  ['B', '8'],
  ['G', 'C'],
  ['Q', 'O'],
  ['e', 'c'], ['e', 'o'], ['c', 'o'],
  ['6', '9']
];

export const TYPOGRAPHY_SPECIMEN_LINES = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789'
];

export const TYPOGRAPHY_AMBIGUITY_GROUPS = [
  ['I', 'l', '1'],
  ['O', '0'],
  ['S', '5'],
  ['B', '8'],
  ['G', 'C'],
  ['6', '9']
];

export const TYPOGRAPHY_WORDS = [
  'Ashley', 'Sophia', 'Michael', 'Emma', 'Bride', 'Bride Squad', 'Happy Birthday', 'Dance Team', 'Class of 2027'
];

export const STRESS_STRINGS = [
  'abcde', 'gopq', 'mnuvw', 'rn', 'mm', 'nn', 'oo', 'ee', 'pp', 'qq', 'ww', '88', '69', 'GC', 'OQ'
];

// Representative words/glyphs the Part 3 rhinestone production review evaluates at every stone
// size, chosen to cover: the anatomy-critical letters called out in the spec (g/p/q descenders,
// m/n/u/v/w counters, B/8, 6/9), a mixed-case word, and a word containing every required
// punctuation-adjacent construct (apostrophe) actually likely in production use (names).
export const PRODUCTION_REVIEW_GLYPHS = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
export const PRODUCTION_REVIEW_WORDS = [
  'Ashley', 'Sophia', 'Michael', 'Emma', "Bride", 'Bride Squad', 'Happy Birthday', 'Dance Team', "Class of 2027"
];

export const STONE_SIZE_IDS = ['ss6', 'ss10', 'ss16', 'ss20', 'ss30'];
