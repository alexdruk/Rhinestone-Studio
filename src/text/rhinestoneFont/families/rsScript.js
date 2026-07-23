/**
 * RS Script -- connected, flowing rhinestone letterform family with production-safe joins (TXT-101A).
 *
 * Unlike RS Block/RS Modern (uniform-width strokes over a shared skeleton), RS Script uses a
 * fundamentally different, independently authored construction:
 *
 *  1. Calligraphic taper: every stroke segment's width is derived from its own angle relative to
 *     horizontal (near-vertical segments render thick, near-horizontal segments render thin), the
 *     same principle a broad-edge calligraphy pen produces -- see applyCalligraphicTaper() below.
 *  2. A connecting thread: every lowercase letter gets an additional thin horizontal stroke running
 *     through the whole glyph width (and slightly overshooting both edges into the side-bearing
 *     zone), so consecutive letters' threads overlap in the gap between them once GeometryEngine
 *     positions them along its pen walk -- producing the visual look of connected cursive writing.
 *     The overshoot is deliberately small (kept well inside the destination layer's own stone gap),
 *     and because GeometryEngine._textPolygons() combines every character's contours into one
 *     polygon set before a single sampleShapeFillPoints() call, any near-touching thread stones
 *     between two letters go through the exact same cross-contour dedupe every other multi-contour
 *     shape in this app already relies on (StoneSampler.js's sampleMultiContourOutlinePoints() /
 *     even-odd sampleFillPoints()) -- this is what makes the join "production-safe" rather than
 *     merely cosmetic: it is guaranteed no two stones from adjoining letters can land closer than
 *     the destination layer's own stone pitch, the same guarantee every other overlapping-contour
 *     case in this app already gets, not a new or weaker one invented for this family.
 *  3. A slight forward slant (shear transform), the traditional visual marker of a script/cursive
 *     hand, applied uniformly to every point.
 *
 * Only lowercase a-z reuses the shared skeleton's letter shapes as a base (still run through the
 * taper+connector+slant pipeline above, which is what actually produces the connected script look).
 * Uppercase/digits/punctuation reuse the shared skeleton directly through the same taper+slant
 * pipeline but WITHOUT the connecting thread -- simplified, non-connecting swash-style forms, which
 * is standard practice in real script typefaces (capitals begin a word; they are not expected to
 * connect into what follows). This is a deliberate, documented scope simplification, not an
 * oversight -- see the TXT-101A final report's "deferred/simplified" section.
 */

import { UNITS_PER_EM, CAP_HEIGHT, SIDE_BEARING, getSkeletonGlyph } from '../skeletonGlyphs.js';

const THIN_UNITS = 4;
const THICK_UNITS = 13;
const CAPSULE_SEGMENTS = 16;
const SLANT_RATIO = 0.22; // ~12 degree forward slant, x' = x + SLANT_RATIO * y.
const CONNECTOR_Y = 8; // Height above baseline the connecting thread runs at.
const CONNECTOR_OVERSHOOT = 4; // How far the thread extends into each side's bearing zone.
const SCRIPT_SIDE_BEARING = 4; // Tighter than Block/Modern's SIDE_BEARING, so threads can bridge the gap.

const LOWERCASE_RANGE = /^[a-z]$/;

function segmentAngle(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function widthForAngle(angleRad) {
  return THIN_UNITS + (THICK_UNITS - THIN_UNITS) * Math.abs(Math.sin(angleRad));
}

// Assigns each point a width derived from its adjacent segment angle(s) -- see module doc point 1.
function applyCalligraphicTaper(stroke) {
  const points = stroke.points;
  const n = points.length;
  const tapered = points.map((point, i) => {
    if (typeof point.w === 'number') return point; // Explicit width (e.g. a dot) always wins.
    const angles = [];
    if (i > 0) angles.push(segmentAngle(points[i - 1], point));
    if (i < n - 1) angles.push(segmentAngle(point, points[i + 1]));
    const avgAngle = angles.reduce((sum, a) => sum + a, 0) / angles.length;
    return { ...point, w: widthForAngle(avgAngle) };
  });
  return { ...stroke, points: tapered };
}

function connectorThread(inkWidth) {
  return {
    points: [
      { x: -CONNECTOR_OVERSHOOT, y: CONNECTOR_Y, w: THIN_UNITS },
      { x: inkWidth + CONNECTOR_OVERSHOOT, y: CONNECTOR_Y, w: THIN_UNITS }
    ],
    closed: false
  };
}

function applySlant(strokes) {
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((p) => ({ ...p, x: p.x + SLANT_RATIO * p.y }))
  }));
}

export const descriptor = {
  id: 'rs-script-regular',
  displayName: 'RS Script',
  category: 'script',
  unitsPerEm: UNITS_PER_EM,
  capHeightUnits: CAP_HEIGHT,
  recommendedStoneSizeMm: 1.4,
  minStoneSizeMm: 1.0,
  recommendedGapMm: 0.25,
  recommendedUses: ['Personalized names and monograms', 'Wedding/event favors', 'Elegant gifting items'],
  notes: 'Calligraphic angle-based taper plus a connecting thread between lowercase letters for a flowing, joined look; uppercase/digits/punctuation are simplified non-connecting swash forms.'
};

export function getGlyphStrokes(character) {
  const skeleton = getSkeletonGlyph(character);
  if (!skeleton) return null;

  const isConnectingLowercase = LOWERCASE_RANGE.test(character);
  const inkWidth = skeleton.width;
  const taperedStrokes = skeleton.strokes.map(applyCalligraphicTaper);
  const strokes = isConnectingLowercase ? [connectorThread(inkWidth), ...taperedStrokes] : taperedStrokes;
  const sideBearing = isConnectingLowercase ? SCRIPT_SIDE_BEARING : SIDE_BEARING;

  return { width: inkWidth + sideBearing * 2, strokes: applySlant(strokes), sideBearing };
}

export const renderOptions = { capsuleSegments: CAPSULE_SEGMENTS, defaultWidthUnits: THIN_UNITS };
