/**
 * Grayscale stage of the Image Trace pipeline (RS-1008).
 *
 * Converts an RGBA ImageBuffer into a single-channel 0-255 luminosity field, alpha-compositing
 * onto a white background first. Compositing onto white (not black) is a deliberate default: a
 * PNG with a transparent background should trace only its visible artwork, and white resolves to
 * "background" (above any reasonable threshold), not "foreground" — the opposite default would
 * turn every transparent pixel into a stone.
 */

import { createField } from './ImageBuffer.js';

const LUMINOSITY_R = 0.299;
const LUMINOSITY_G = 0.587;
const LUMINOSITY_B = 0.114;

/**
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} imageBuffer RGBA.
 * @returns {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} single-channel 0-255.
 */
export function toGrayscale(imageBuffer) {
  const { widthPx, heightPx, data } = imageBuffer;
  const pixelCount = widthPx * heightPx;
  const out = new Uint8ClampedArray(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3] / 255;

    const luminosity = LUMINOSITY_R * r + LUMINOSITY_G * g + LUMINOSITY_B * b;
    // Composite onto white: fully opaque keeps the raw luminosity, fully transparent becomes 255.
    out[i] = luminosity * a + 255 * (1 - a);
  }

  return createField({ widthPx, heightPx, data: out });
}
