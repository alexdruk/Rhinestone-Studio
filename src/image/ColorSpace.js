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

const D65_WHITE = [0.95047, 1.0, 1.08883];

function labF(t) {
  const delta = 6 / 29;
  return t > delta * delta * delta ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
}

export function rgbToLab(r, g, b) {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
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
