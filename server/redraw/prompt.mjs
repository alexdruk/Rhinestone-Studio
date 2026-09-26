// IMG-022: the prompt the redraw server sends with every image. The palette line is generated from
// the stone catalogue, so a colour added there reaches the prompt with no edit here. Any change to
// the wording is a PROMPT_VERSION bump; a catalogue change is not. See
// docs/specifications/IMG-022-RedrawProvider.md D6.
import { STONE_COLORS } from '../../src/renderer/StoneColors.js';

// IMG-023 (D6): version 2 is the "designer" prompt chosen by experiment; see
// docs/specifications/IMG-023-AiStoneTransfer.md.
export const PROMPT_VERSION = 2;

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

// "Name #hex" pairs in catalogue order; the hex is previewColor, the value app.js's
// imageColorPalette() quantises against.
export function buildPaletteLine(colors = STONE_COLORS) {
  return Object.values(colors).map((c) => `${c.name} ${c.previewColor}`).join(', ');
}

export function buildRedrawPrompt(colors = STONE_COLORS) {
  return [...PROMPT_LINES, buildPaletteLine(colors)].join('\n');
}
