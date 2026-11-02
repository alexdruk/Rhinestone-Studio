// IMG-022: the prompt the redraw server sends with every image. The palette line is generated from
// the stone catalogue, so a colour added there reaches the prompt with no edit here. IMG-024: one
// prompt per redraw style, each with its own version -- a change to one style's wording bumps that
// style's version only; a catalogue change is not a bump. See
// docs/specifications/IMG-022-RedrawProvider.md D6 and docs/specifications/IMG-024-FlatArtworkStyle.md D2.
import { STONE_COLORS } from '../../src/renderer/StoneColors.js';

// IMG-026 (build N): version 7 is the placement-chart prompt of the spec's Appendix E, with the
// generated palette line inside rule 4, in two shapes (REDRAW_SHAPES). Version 6 (Appendix D, build H)
// had no skin-tone lines; version 5 (Appendix C, build F) had ramps without the eight build H colours;
// version 4 (Appendix B, build E) had colour ramps without the twelve aiOnly colours; version 3
// (Appendix A) lacked the ramps and the outline and texture rules; version 2 was the IMG-023
// "designer" prompt; see docs/specifications/IMG-026-StrassLayoutService.md.
export const PROMPT_VERSION = 7;

// IMG-024 (D1/D2): 'stones' is the prompt above; 'flat' asks for flat colour regions, no stones.
// IMG-026 (build P): 'bold' and 'shaded' are the two Black & white styles, each versioned on its own
// (docs/IS-PORT-PLAN.md section 4).
export const REDRAW_STYLES = Object.freeze(['stones', 'flat', 'bold', 'shaded']);
export const FLAT_PROMPT_VERSION = 1;
export const BOLD_PROMPT_VERSION = 1;
export const SHADED_PROMPT_VERSION = 1;
export const PROMPT_VERSIONS = Object.freeze({ stones: PROMPT_VERSION, flat: FLAT_PROMPT_VERSION, bold: BOLD_PROMPT_VERSION, shaded: SHADED_PROMPT_VERSION });
export const BW_REDRAW_STYLES = Object.freeze(['bold', 'shaded']);
// The two stones of Black & white: Jet and the catalogue colour named Crystal (id crystal-clear).
export const BW_COLOR_IDS = Object.freeze(['jet', 'crystal-clear']);
// IMG-026 (build N): the output shape. 'square' (vessels and the plate) asks for a square image of
// about 60 stones across; 'auto' (the Flat Sheet) asks for the uploaded image's shape. Both are
// prompt version 7. The flat prompt has no composition section, so its text is the same for both.
export const REDRAW_SHAPES = Object.freeze(['square', 'auto']);

const V7_HEAD = [
  'Turn the uploaded image into a rhinestone design drawn as a flat technical placement chart. Software will measure every stone in your image (position, size and colour) and rebuild it as a real rhinestone layout, so clean geometry matters more than a realistic look.',
  '',
  '1. STONES',
  '- Every stone is a perfect circle seen straight from above, filled with ONE flat colour.',
  '- No highlights, facets, sparkle, glints, gradients, rims, shadows, reflections or white dots on the stones.',
  '<stone size>',
  '- Only two exceptions:',
  '  a) a smaller stone, 3/4 of the main diameter, only for very fine details (eyes, eyelids, nostrils, thin lines);',
  '  b) one large stone, twice the main diameter, for each pupil.',
  '- No other sizes: no tiny filler dots, no half stones, no ovals.',
  '',
  '2. GAPS',
  '- Every stone is separated from its neighbours by a small, clearly visible gap of about 1/8 of the stone diameter.',
  '- Stones never touch and never overlap.',
  '- Keep the gaps even and small. Pack the stones tightly, with neighbouring rows shifted so that stones sit in the notches of the next row. Avoid wide empty spaces inside the subject.',
  '- The gaps show the background only. Never draw anything in the gaps: no dark shading, no glow, no colour, no dots, no texture.',
  '',
  '3. BACKGROUND AND EDGES',
  '- Background fully transparent. If transparency is not available, use solid pure magenta #FF00FF with no variation, and never use magenta inside the subject.',
  '- Every stone is fully opaque with a crisp edge. No soft or semi-transparent edges.',
  '- No frame, border, text, watermark, drop shadow or decoration.',
  ''
].join('\n');

// Section 4 of the colour prompt ('stones'): the palette line goes between the intro and the rules.
const V7_COLOURS_INTRO = [
  '4. COLOURS',
  'Use only the colours below, with exactly these hex values, as flat fills:'
].join('\n');

const V7_COLOURS_RULES = [
  '- Every stone gets exactly one of these colours. Do not invent, mix, tint or shade colours.',
  '- Pick the closest of these colours for each area, and keep neighbouring areas clearly distinguishable so the design reads well from a distance.',
  '- Use these ramps, from light to dark, and stay inside the ramp of each kind of area:',
  '  skin (every skin tone, from the lightest to the deepest; deep skin uses the dark end of this ramp): Silk, Light Peach, Rose Gold, Light Colorado Topaz, Golden Shadow, Copper, Colorado Topaz, Smoked Topaz, with Rose Peach and Vintage Rose for cheeks and Crystal only for the brightest highlights;',
  '  tan or brown fur, wood, earth: Silk, Light Peach, Golden Shadow, Light Colorado Topaz, Light Smoked Topaz, Copper, Colorado Topaz, Smoked Topaz;',
  '  white, grey and black hair, fur, metal, stone: Crystal, Silver, Greige, Grey, Black Diamond, Graphite, Jet Hematite, Hematite, Jet;',
  '  greens: Chrysolite, Citrus Green, Peridot, Emerald, Fern Green, Erinite, Olivine, Khaki; blues: Light Sapphire, Aquamarine, Sapphire, Capri Blue; reds and pinks: Rose, Rose Peach, Vintage Rose, Padparadscha, Light Siam, Scarlet, Siam, Indian Siam, Fuchsia; yellows and oranges: Citrine, Light Topaz, Metallic Sunshine, Gold, Topaz, Hyacinth.',
  '- Never use Topaz or Hyacinth on skin.',
  "- Keep each person's skin tone, lightness and undertone as the photo shows them. Never lighten or whiten skin: each face stays as light or as dark as it is in the photo.",
  '- Inside one area use at most three neighbouring shades of its ramp, in clear patches; never alternate shades stone by stone.',
  '- When a colour of the image lies between two listed colours, choose one of them for the whole patch; do not paint an in-between shade.'
].join('\n');

// Sections 5 and 6, the same for every stone style.
const V7_DESIGN = [
  '',
  '5. DESIGN',
  '- Lay the stones in rows that follow the shapes: along feathers, hair strands, fur direction, wrinkles, petals and outlines.',
  '- Outline important shapes with one row of stones in a darker colour of the same colour family (plain black only where the area itself is black or very dark).',
  '- Outline stones are ordinary stones: the main size or the 3/4 size, on the same rows as their neighbours, with the same gap. Never squeeze extra stones between rows and never let outline stones touch.',
  '- Busy textures (rocks, grass, foliage, fur, water) are simplified into patches of one or two shades. Every stone there is still a separate flat circle with a gap; never draw broken, angular or overlapping stones.',
  '- Eyes: a dark outline ring, the iris in 1 or 2 rings of stones, one large dark pupil stone, and one Crystal #f5f5f5 stone touching the pupil at its upper right as the catch-light.',
  '- Keep the subject, pose, proportions and recognisable features of the uploaded image. Simplify only where stones cannot show the detail.',
  '',
  '6. COMPOSITION',
  '<image shape>',
  '- The whole subject fits inside the image with a margin of about 3 stones on every side; nothing is cut off at the edges.',
  '- One scale for the whole image, no perspective.'
].join('\n');

const CHECK_HEAD = 'Before finishing, check that: every stone is a separate flat circle; no two stones touch, outline stones included; nothing is drawn in the gaps; only the three allowed sizes are used; ';
const CHECK_TAIL = '; the background is transparent or pure magenta.';
const V7_CHECK = `${CHECK_HEAD}only the listed colours are used, skin and fur only from their ramps${CHECK_TAIL}`;

// IMG-026 (build P): section 4 of the two Black & white styles, from PatternNifty (IS commit e9e7014,
// src/pipeline/prompt.js). Only Jet and Crystal, so there are no ramps and no skin lines. 'bold' is IS's
// stencil variant (version 5 there, with the eye rule); 'shaded' is IS spec Appendix A (halftone).
function bwColoursIntro(colors) {
  return [
    '4. COLOURS',
    'Use only these two colours, with exactly these hex values, as flat fills:',
    `Jet ${colors.jet.previewColor}, Crystal ${colors['crystal-clear'].previewColor}.`,
    '- Every stone is either Jet or Crystal. No greys, no other colours, no tints.'
  ];
}

const BW_COLOURS_RULES = Object.freeze({
  bold: [
    '- Stencil style: every area is solid. Decide for each area whether it is dark or light, and fill all of it with that one colour.',
    '- Never alternate or mix the two colours to suggest grey: no checkerboards, no dotted, speckled or halftone areas.',
    '- Faces: light skin in Crystal. The shadows that shape the face (eye sockets, under the nose, under the lower lip, the jaw and neck shadow) and the hair in solid Jet, as clean shapes.',
    '- Eyes are never part of a dark area. In each eye the white is Crystal, the iris and the pupil are Jet, with one Crystal catch-light stone, and at least one row of Crystal stones separates the eye from any dark shadow or eyebrow around it.',
    '- Keep the subject clearly readable from a distance: strong Jet outlines around the main shapes.'
  ],
  shaded: [
    '- Dark areas, outlines, pupils and shadows are Jet; light areas, highlights and the catch-light are Crystal.',
    '- Show mid-tones only by mixing the two colours in clear patterns (rows or patches), never by inventing a grey.',
    '- Keep the subject clearly readable from a distance: strong Jet outlines around the main shapes.'
  ]
});

const BW_CHECKS = Object.freeze({
  bold: `${CHECK_HEAD}every stone is Jet or Crystal; no area is mixed or speckled${CHECK_TAIL}`,
  shaded: `${CHECK_HEAD}every stone is Jet or Crystal${CHECK_TAIL}`
});

// The two lines that differ between the shapes. On non-square output the 60-across sentence does
// not set the stone size (PatternNifty IS-03b), so 'auto' drops it.
const SHAPE_LINES = Object.freeze({
  square: {
    stoneSize: '- Use one main stone size for the whole design. Make the stones large: about 60 stones across the full width of the image.',
    imageShape: '- Square image at the highest resolution available.'
  },
  auto: {
    stoneSize: '- Use one main stone size for the whole design.',
    imageShape: '- Use the whole image at the highest resolution available, in the same shape (width to height) as the uploaded image.'
  }
});

const FLAT_PROMPT_LINES = [
  'Create a production-oriented flat-color artwork specifically designed to be converted into a rhinestone placement pattern. Do NOT draw rhinestones. Do NOT simulate stones. Use only the palette below. Use large, clean, contiguous color regions with strong boundaries and simplified detail. Avoid gradients, photographic texture, shadows, highlights, hair-level texture, tiny isolated regions and fine lines thinner than approximately one rhinestone diameter (1/70 of the image width). Transparent background. No frame. Preserve the recognizable silhouette and major facial features. The resulting artwork will be converted separately into precisely measured rhinestone geometry.',
  'Palette (name and hex):'
];

// "Name #hex" pairs in catalogue order; the hex is previewColor, the value app.js's
// imageColorPalette() quantises against. IMG-026F: the aiOnly colours are listed only with
// includeAiOnly, which the stones prompt passes (its result goes to the layout service); the flat
// prompt keeps the standard palette.
export function buildPaletteLine(colors = STONE_COLORS, includeAiOnly = false) {
  return Object.values(colors).filter((c) => includeAiOnly || !c.aiOnly).map((c) => `${c.name} ${c.previewColor}`).join(', ');
}

// Any style other than 'flat', 'bold' or 'shaded' is the stones prompt, and any shape other than 'auto'
// the square one; the handler only passes a validated style and shape. IMG-026 (build P): 'bold' and
// 'shaded' are the stones prompt with section 4 and the final check replaced; both shapes apply.
export function buildRedrawPrompt(colors = STONE_COLORS, style = 'stones', shape = 'square') {
  if (style === 'flat') return [...FLAT_PROMPT_LINES, buildPaletteLine(colors)].join('\n');
  const lines = SHAPE_LINES[shape === 'auto' ? 'auto' : 'square'];
  const bw = BW_REDRAW_STYLES.includes(style);
  const colours = bw
    ? [...bwColoursIntro(colors), ...BW_COLOURS_RULES[style]].join('\n')
    : [V7_COLOURS_INTRO, buildPaletteLine(colors, true), V7_COLOURS_RULES].join('\n');
  return [V7_HEAD.replace('<stone size>', lines.stoneSize), colours, V7_DESIGN.replace('<image shape>', lines.imageShape), '', bw ? BW_CHECKS[style] : V7_CHECK].join('\n');
}

// IMG-026 (build P): the layout request of a style. A Black & white style asks the service for mode
// 'bw' with only Jet and Crystal; every other style for mode 'colour' with the whole catalogue.
export function layoutRequestFor(style, colors = STONE_COLORS) {
  return BW_REDRAW_STYLES.includes(style)
    ? { mode: 'bw', colorIds: [...BW_COLOR_IDS] }
    : { mode: 'colour', colorIds: Object.keys(colors) };
}
