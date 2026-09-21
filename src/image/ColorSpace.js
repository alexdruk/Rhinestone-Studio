/**
 * sRGB -> CIE Lab (D65) and CIE76 distance (IMG-009).
 *
 * Moved verbatim out of ColorQuantize.js, which used these privately for its own nearest-palette-
 * entry matching (assignNearestIds()). SubjectMask.js (IMG-009) needs the same conversion for its
 * background-route pixel-vs-background distance test, so this is a shared module rather than a
 * second copy -- see docs/specifications/IMG-009-SubjectMask.md decision 5.
 */

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

// IMG-009 perf follow-up: computeSubjectMask()'s background route calls rgbToLab() once per native
// pixel (1870x1900 = ~3.55M calls measured at ~1075ms vs. ~147ms for threshold mode on the same
// image). Every one of those calls passes real 0-255 channel bytes, so srgbToLinear() is called with
// only 256 possible inputs -- precomputing it once at module load and reading the table for integer
// 0-255 inputs is bit-identical (the table is populated by calling this exact function once per
// value, not an approximation), not just close. Non-integer/out-of-range inputs (none in this
// module's own callers, but rgbToLab() is a public export) still take the direct computation path.
const SRGB_TO_LINEAR_LUT = new Float64Array(256);
for (let i = 0; i < 256; i++) SRGB_TO_LINEAR_LUT[i] = srgbToLinear(i);

function srgbToLinearFast(c) {
  return (Number.isInteger(c) && c >= 0 && c <= 255) ? SRGB_TO_LINEAR_LUT[c] : srgbToLinear(c);
}

const D65_WHITE = [0.95047, 1.0, 1.08883];

function labF(t) {
  const delta = 6 / 29;
  return t > delta * delta * delta ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
}

export function rgbToLab(r, g, b) {
  const rl = srgbToLinearFast(r);
  const gl = srgbToLinearFast(g);
  const bl = srgbToLinearFast(b);
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
  const z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;
  const fx = labF(x / D65_WHITE[0]);
  const fy = labF(y / D65_WHITE[1]);
  const fz = labF(z / D65_WHITE[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// CIE76: plain Euclidean distance in Lab space.
export function cie76Distance(labA, labB) {
  return Math.hypot(labA[0] - labB[0], labA[1] - labB[1], labA[2] - labB[2]);
}
