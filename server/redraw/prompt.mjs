// IMG-022: the prompt the redraw server sends with every image. The palette line is generated from
// the stone catalogue, so a colour added there reaches the prompt with no edit here. Any change to
// the wording is a PROMPT_VERSION bump; a catalogue change is not. See
// docs/specifications/IMG-022-RedrawProvider.md D6.
import { STONE_COLORS } from '../../src/renderer/StoneColors.js';

export const PROMPT_VERSION = 1;

const PROMPT_LINES = [
  'You are a rhinestone mosaic artist. Turn the attached image into a rhinestone mosaic picture.',
  'Rules:',
  '1. All stones are round and the same size. The picture is exactly 100 stones wide, in staggered (honeycomb) rows.',
  '2. Each stone is ONE flat colour taken from the palette below. No gradients inside a stone, no reflections, no sparkle, only a small white highlight dot.',
  '3. Use at most 8 colours from the palette for the whole picture, and use large even areas of one colour rather than mixing colours stone by stone.',
  '4. Dark outlines, eyes, mouth and other key details are chains of Jet or Hematite stones, one stone wide.',
  '5. Square image, subject fills the frame, transparent background, no frame, no text, no tables, no labels.',
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
