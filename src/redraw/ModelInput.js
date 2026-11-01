/**
 * IMG-026 (build N): the image the redraw sends on the Flat Sheet (shape 'auto'), as PatternNifty's
 * model input (IS spec 7.1). When the upload has a transparent background, it is cropped to the box
 * of the pixels with alpha >= SUBJECT_ALPHA plus SUBJECT_MARGIN of the box's longest side on every
 * side (transparent where the margin passes the image edge). With or without the crop, it is then
 * resized to MODEL_INPUT_SIDE_PX on its longest side, aspect kept, no padding. Pure: RGBA buffers
 * { widthPx, heightPx, data } in and out, no DOM. See docs/specifications/IMG-026-StrassLayoutService.md,
 * "Prompt v7 and model input (build N)".
 */

// Not in the src/image barrel; imported directly, as index.js does.
import { resizeImageBuffer } from '../image/ImageFieldPipeline.js';

export const MODEL_INPUT_SIDE_PX = 1024;
export const SUBJECT_ALPHA = 128;
export const SUBJECT_MARGIN = 0.03;

/** The box { left, top, width, height } of the pixels with alpha >= SUBJECT_ALPHA, or null if none. */
export function subjectBox({ widthPx, heightPx, data }) {
  let minX = widthPx, minY = heightPx, maxX = -1, maxY = -1;
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      if (data[(y * widthPx + x) * 4 + 3] < SUBJECT_ALPHA) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function hasTransparentPixel({ data }) {
  for (let i = 3; i < data.length; i += 4) if (data[i] < SUBJECT_ALPHA) return true;
  return false;
}

/** The subject crop with its margin, or the image itself (a copy) when it has no transparent
 * background (no pixel below SUBJECT_ALPHA) or no subject (no pixel at or above it). */
export function cropToSubject(buffer) {
  const box = hasTransparentPixel(buffer) ? subjectBox(buffer) : null;
  if (!box) return { widthPx: buffer.widthPx, heightPx: buffer.heightPx, data: new Uint8ClampedArray(buffer.data) };
  const m = Math.round(SUBJECT_MARGIN * Math.max(box.width, box.height));
  const left = box.left - m, top = box.top - m, widthPx = box.width + 2 * m, heightPx = box.height + 2 * m;
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y++) {
    const sy = top + y;
    if (sy < 0 || sy >= buffer.heightPx) continue;
    const x0 = Math.max(0, -left), x1 = Math.min(widthPx, buffer.widthPx - left);
    if (x1 <= x0) continue;
    const from = (sy * buffer.widthPx + left + x0) * 4;
    data.set(buffer.data.subarray(from, from + (x1 - x0) * 4), (y * widthPx + x0) * 4);
  }
  return { widthPx, heightPx, data };
}

// Bilinear enlargement with premultiplied alpha, so transparent pixels do not darken the edges.
function enlarge({ widthPx, heightPx, data }, newWidth, newHeight) {
  const out = new Uint8ClampedArray(newWidth * newHeight * 4);
  const sxScale = widthPx / newWidth, syScale = heightPx / newHeight;
  for (let oy = 0; oy < newHeight; oy++) {
    const fy = Math.min(heightPx - 1, Math.max(0, (oy + 0.5) * syScale - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(heightPx - 1, y0 + 1), wy = fy - y0;
    for (let ox = 0; ox < newWidth; ox++) {
      const fx = Math.min(widthPx - 1, Math.max(0, (ox + 0.5) * sxScale - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(widthPx - 1, x0 + 1), wx = fx - x0;
      let r = 0, g = 0, b = 0, a = 0;
      for (const [x, y, w] of [[x0, y0, (1 - wx) * (1 - wy)], [x1, y0, wx * (1 - wy)], [x0, y1, (1 - wx) * wy], [x1, y1, wx * wy]]) {
        const i = (y * widthPx + x) * 4, wa = w * data[i + 3];
        r += data[i] * wa; g += data[i + 1] * wa; b += data[i + 2] * wa; a += wa;
      }
      const o = (oy * newWidth + ox) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = Math.round(a);
    }
  }
  return { widthPx: newWidth, heightPx: newHeight, data: out };
}

/** Resized so the longest side is sidePx, aspect kept: shrunk as the upload is today
 * (resizeImageBuffer), enlarged bilinearly. */
export function resizeToLongestSide(buffer, sidePx = MODEL_INPUT_SIDE_PX) {
  const longest = Math.max(buffer.widthPx, buffer.heightPx);
  if (longest > sidePx) return resizeImageBuffer(buffer, sidePx, sidePx);
  if (longest === sidePx) return { widthPx: buffer.widthPx, heightPx: buffer.heightPx, data: new Uint8ClampedArray(buffer.data) };
  const scale = sidePx / longest;
  const widthPx = buffer.widthPx === longest ? sidePx : Math.max(1, Math.round(buffer.widthPx * scale));
  const heightPx = buffer.heightPx === longest ? sidePx : Math.max(1, Math.round(buffer.heightPx * scale));
  return enlarge(buffer, widthPx, heightPx);
}

/** The Flat Sheet model input: the subject crop (when there is one), then 1024 px on the long side. */
export function flatSheetModelInput(buffer) {
  return resizeToLongestSide(cropToSubject(buffer), MODEL_INPUT_SIDE_PX);
}
