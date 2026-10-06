// IMG-022: the prompt the redraw server sends with every image. The palette line is generated from
// the stone catalogue, so a colour added there reaches the prompt with no edit here. IMG-024: one
// prompt per redraw style, each with its own version -- a change to one style's wording bumps that
// style's version only; a catalogue change is not a bump. See
// docs/specifications/IMG-022-RedrawProvider.md D6 and docs/specifications/IMG-024-FlatArtworkStyle.md D2.
import { STONE_COLORS } from '../../src/renderer/StoneColors.js';

// IMG-026 (S10, S11): version 3 is the placement-chart prompt of the spec's Appendix A, with the
// generated palette line inside rule 4. Version 2 was the IMG-023 "designer" prompt; see
// docs/specifications/IMG-026-StrassLayoutService.md.
export const PROMPT_VERSION = 3;

// IMG-024 (D1/D2): 'stones' is the prompt above; 'flat' asks for flat colour regions, no stones.
export const REDRAW_STYLES = Object.freeze(['stones', 'flat']);
export const FLAT_PROMPT_VERSION = 1;
export const PROMPT_VERSIONS = Object.freeze({ stones: PROMPT_VERSION, flat: FLAT_PROMPT_VERSION });

const V3_HEAD = [
  'Turn the uploaded image into a rhinestone design drawn as a flat technical placement chart. Software will measure every stone in your image (position, size and colour) and rebuild it as a real rhinestone layout, so clean geometry matters more than a realistic look.',
  '',
  '1. STONES',
  '- Every stone is a perfect circle seen straight from above, filled with ONE flat colour.',
  '- No highlights, facets, sparkle, glints, gradients, rims, shadows, reflections or white dots on the stones.',
  '- Use one main stone size for the whole design. Make the stones large: about 60 stones across the full width of the image.',
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
  '',
  '4. COLOURS',
  'Use only the colours below, with exactly these hex values, as flat fills:'
].join('\n');

const V3_TAIL = [
  '- Every stone gets exactly one of these colours. Do not invent, mix, tint or shade colours.',
  '- Pick the closest of these colours for each area, and keep neighbouring areas clearly distinguishable so the design reads well from a distance.',
  '',
  '5. DESIGN',
  '- Lay the stones in rows that follow the shapes: along feathers, hair strands, fur direction, wrinkles, petals and outlines.',
  '- Outline important shapes with one row of stones in a darker colour of the same colour family (plain black only where the area itself is black or very dark).',
  '- Eyes: a dark outline ring, the iris in 1 or 2 rings of stones, one large dark pupil stone, and one Crystal #f5f5f5 stone touching the pupil at its upper right as the catch-light.',
  '- Keep the subject, pose, proportions and recognisable features of the uploaded image. Simplify only where stones cannot show the detail.',
  '',
  '6. COMPOSITION',
  '- Square image at the highest resolution available.',
  '- The whole subject fits inside the image with a margin of about 3 stones on every side; nothing is cut off at the edges.',
  '- One scale for the whole image, no perspective.',
  '',
  'Before finishing, check that: every stone is a separate flat circle; no two stones touch; nothing is drawn in the gaps; only the three allowed sizes are used; only the listed colours are used; the background is transparent or pure magenta.'
].join('\n');

const FLAT_PROMPT_LINES = [
  'Create a production-oriented flat-color artwork specifically designed to be converted into a rhinestone placement pattern. Do NOT draw rhinestones. Do NOT simulate stones. Use only the palette below. Use large, clean, contiguous color regions with strong boundaries and simplified detail. Avoid gradients, photographic texture, shadows, highlights, hair-level texture, tiny isolated regions and fine lines thinner than approximately one rhinestone diameter (1/70 of the image width). Transparent background. No frame. Preserve the recognizable silhouette and major facial features. The resulting artwork will be converted separately into precisely measured rhinestone geometry.',
  'Palette (name and hex):'
];

// "Name #hex" pairs in catalogue order; the hex is previewColor, the value app.js's
// imageColorPalette() quantises against.
export function buildPaletteLine(colors = STONE_COLORS) {
  return Object.values(colors).map((c) => `${c.name} ${c.previewColor}`).join(', ');
}

// Any style other than 'flat' is the stones prompt; the handler only passes a validated style.
export function buildRedrawPrompt(colors = STONE_COLORS, style = 'stones') {
  if (style === 'flat') return [...FLAT_PROMPT_LINES, buildPaletteLine(colors)].join('\n');
  return [V3_HEAD, buildPaletteLine(colors), V3_TAIL].join('\n');
}
