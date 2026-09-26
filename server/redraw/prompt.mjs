// IMG-022: the prompt the redraw server sends with every image. The palette line is generated from
// the stone catalogue, so a colour added there reaches the prompt with no edit here. IMG-024: one
// prompt per redraw style, each with its own version -- a change to one style's wording bumps that
// style's version only; a catalogue change is not a bump. See
// docs/specifications/IMG-022-RedrawProvider.md D6 and docs/specifications/IMG-024-FlatArtworkStyle.md D2.
import { STONE_COLORS } from '../../src/renderer/StoneColors.js';

// IMG-023 (D6): version 2 is the "designer" prompt chosen by experiment; see
// docs/specifications/IMG-023-AiStoneTransfer.md.
export const PROMPT_VERSION = 2;

// IMG-024 (D1/D2): 'stones' is the prompt above; 'flat' asks for flat colour regions, no stones.
export const REDRAW_STYLES = Object.freeze(['stones', 'flat']);
export const FLAT_PROMPT_VERSION = 1;
export const PROMPT_VERSIONS = Object.freeze({ stones: PROMPT_VERSION, flat: FLAT_PROMPT_VERSION });

const PROMPT_LINES = [
  'You are a professional designer of hot-fix rhinestone transfer templates. Design a rhinestone version of the attached image that a machine can set stone by stone.',
  'Use identical round stones in honeycomb rows, about 70 stones across. Every stone is one flat colour from the palette below, drawn as a glossy round stone with a small white highlight dot.',
  'Design choices a good template designer makes:',
  '- Simplify: fewer, larger colour areas; drop texture and fine shading that stones cannot show.',
  '- Keep what makes the subject recognisable, and exaggerate it slightly if needed.',
  '- Separate colour areas and outline the subject with one-stone-wide chains of Jet stones, with no gaps.',
  '- Use at most 8 palette colours, with strong contrast between neighbouring areas.',
  'Square image, subject fills the frame, transparent background, no shadow or glow, no text.',
  'Palette (name and hex):'
];

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
  return [...PROMPT_LINES, buildPaletteLine(colors)].join('\n');
}
