/**
 * FONT-SOURCE-001 -- catalog of the 14 open-license Google Fonts being evaluated as starting points
 * for future proprietary rhinestone fonts. Single source of truth for both download-sources.mjs (what
 * to fetch) and compare-sources.mjs (how to group the comparison by category) -- kept as data, not
 * duplicated between the two scripts.
 *
 * `oflPath` is the file's path under google/fonts' `ofl/` directory (verified to exist there at
 * authoring time), which mirrors what fonts.google.com serves. `variableFont: true` marks families that
 * ship only as a variable TTF (no static Regular instance) -- these are evaluated at their default
 * (Regular/400) instance, the same outline opentype.js reads by default and the same one the app's own
 * pipeline would use, since the app has no variable-instancing logic.
 */

export const FONT_SOURCE_CATALOG = [
  { name: 'DancingScript', displayName: 'Dancing Script', category: 'script', styleNote: 'casual script', oflPath: 'dancingscript/DancingScript[wght].ttf', variableFont: true },
  { name: 'AlexBrush', displayName: 'Alex Brush', category: 'script', styleNote: 'casual script', oflPath: 'alexbrush/AlexBrush-Regular.ttf', variableFont: false },
  { name: 'GreatVibes', displayName: 'Great Vibes', category: 'script', styleNote: 'elegant script', oflPath: 'greatvibes/GreatVibes-Regular.ttf', variableFont: false },
  { name: 'Allura', displayName: 'Allura', category: 'script', styleNote: 'monoline script', oflPath: 'allura/Allura-Regular.ttf', variableFont: false },
  { name: 'Sacramento', displayName: 'Sacramento', category: 'script', styleNote: 'monoline script', oflPath: 'sacramento/Sacramento-Regular.ttf', variableFont: false },
  { name: 'Parisienne', displayName: 'Parisienne', category: 'script', styleNote: 'elegant script', oflPath: 'parisienne/Parisienne-Regular.ttf', variableFont: false },

  { name: 'Anton', displayName: 'Anton', category: 'heavy', styleNote: 'heavy', oflPath: 'anton/Anton-Regular.ttf', variableFont: false },
  { name: 'ArchivoBlack', displayName: 'Archivo Black', category: 'heavy', styleNote: 'heavy', oflPath: 'archivoblack/ArchivoBlack-Regular.ttf', variableFont: false },
  { name: 'BebasNeue', displayName: 'Bebas Neue', category: 'heavy', styleNote: 'heavy', oflPath: 'bebasneue/BebasNeue-Regular.ttf', variableFont: false },

  { name: 'Baloo2', displayName: 'Baloo 2', category: 'rounded', styleNote: 'rounded', oflPath: 'baloo2/Baloo2[wght].ttf', variableFont: true },
  { name: 'Fredoka', displayName: 'Fredoka', category: 'rounded', styleNote: 'rounded', oflPath: 'fredoka/Fredoka[wdth,wght].ttf', variableFont: true },
  { name: 'Quicksand', displayName: 'Quicksand', category: 'rounded', styleNote: 'rounded', oflPath: 'quicksand/Quicksand[wght].ttf', variableFont: true },

  { name: 'Poppins', displayName: 'Poppins', category: 'modern-sans', styleNote: 'modern sans', oflPath: 'poppins/Poppins-Regular.ttf', variableFont: false },
  { name: 'Montserrat', displayName: 'Montserrat', category: 'modern-sans', styleNote: 'modern sans', oflPath: 'montserrat/Montserrat[wght].ttf', variableFont: true }
];

export const GOOGLE_FONTS_OFL_BASE_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl';

/**
 * @param {string} name Catalog entry `name` (e.g. "Anton").
 * @returns {string} e.g. "fonts/sources/Anton/Anton.ttf"
 */
export function sourceTtfRelativePath(name) {
  return `fonts/sources/${name}/${name}.ttf`;
}
