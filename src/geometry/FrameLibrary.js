/**
 * MONO-003: FrameLibrary — reusable frame architecture for the future Monogram Generator.
 *
 * Same design philosophy as ShapeLibrary.js: this module contains data and pure geometry helpers
 * only. No DOM code, no renderer knowledge, no app.js dependency. Frame outlines are expressed in
 * the same natural, (0,0)-rooted coordinate space ShapeLibrary.js's own createXNaturalContours()
 * functions already use, and placed into an absolute mm box via the same independent-X/Y-scale +
 * translate transform GeometryEngine's private _placeNaturalContours() applies to every S-110 shape
 * kind (see placeNaturalContours() below — that method is not exported through
 * src/geometry/index.js, so the one shared transform is re-expressed locally here rather than
 * imported, keeping this module a GeometryEngine/DOM/app.js-free peer of ShapeLibrary.js and
 * ShapeFit.js, not a dependent of GeometryEngine).
 *
 * MONO-001A correction (implemented here): a hollow frame's stone geometry — generationContours, an
 * outer + inner contour pair forming a ring/band, the shape GeometryEngine will one day sample
 * stones from — is NOT the same thing as the region a future monogram letter should fit inside —
 * innerFittingContours, the inner opening alone, treated as an ordinary filled region. Fitting
 * against the full ring geometry would center a candidate rectangle on the ring's own bounding box
 * (which sits over the hole, not the border) and could let it grow into the band itself. This
 * mirrors the identical Ring-specific fix app.js's resolveShapeLayerPolygonsForFitting() already
 * applies for the Ring shape kind (S-110) — see computeFrameInterior() below, which is this
 * module's generalization of that same correction to every hollow frame.
 *
 * No text/letter/monogram logic lives here — this module only answers "what does this frame look
 * like" and "what region should something else fit inside it", exactly the two questions
 * ShapeLibrary.js/ShapeFit.js already answer for ordinary Shape Layers.
 */

import { Point2D, BoundingBox } from '../text/VectorPath.js';
import { createRingNaturalContours, createRegularPolygonNaturalContours } from './ShapeLibrary.js';
import { computeInscribedRect } from './ShapeFit.js';

function point(xMm, yMm) {
  return { xMm, yMm };
}

// Border-band thickness shared by every frame in this milestone's initial geometric set: the inner
// opening's radius/half-extent as a fraction of the frame's own outer radius/half-extent. This is
// the same relationship createRingNaturalContours()'s own innerRatio already expresses for a
// circular ring; every non-circular frame below reuses that exact relationship (see
// scaleContourTowardCenter()) rather than a shape-specific formula.
const DEFAULT_INNER_RATIO = 0.78;
// Rounded Square's corner radius, as a fraction of its own natural half-side.
const ROUNDED_SQUARE_CORNER_RATIO = 0.28;
const CORNER_SEGMENTS = 12;
// Every natural contour in this module shares ShapeLibrary's own (0,0)-rooted, radius/half-extent-1
// convention (see createRingNaturalContours()/createRegularPolygonNaturalContours()'s own
// (0,0)-top-left-of-bounding-box contract), which places each shape's own center at (1,1).
const NATURAL_CENTER_MM = 1;

/**
 * Scales every point of a natural, centrally-symmetric contour toward (centerXMm, centerYMm) by
 * `ratio` (0-1). This is the general form of the exact relationship createRingNaturalContours()
 * already establishes between its own outer and inner circle (a smaller concentric copy) — reused
 * here for the frame shapes ShapeLibrary.js does not itself define a ring variant for (Square,
 * Rounded Square, Diamond), so every hollow frame's inner contour is derived the same way, never a
 * shape-specific formula.
 */
function scaleContourTowardCenter(contour, centerXMm, centerYMm, ratio) {
  return contour.map((p) => point(
    centerXMm + (p.xMm - centerXMm) * ratio,
    centerYMm + (p.yMm - centerYMm) * ratio
  ));
}

/**
 * A square with optionally-rounded corners, natural half-side 1 (so its bounding box is [0,2]x[0,2]
 * once rooted, matching ShapeLibrary's own convention). ShapeLibrary.js has no rounded-rectangle
 * generator — S-110's kinds are Ellipse/Capsule/Polygon/Star/Heart/Arrow/Cross/Crescent/Ring only —
 * so this is new geometry, added here (not in ShapeLibrary.js) because it is frame-specific, not one
 * of the user-facing Shape Layer kinds app.js's shape grid offers, per MONO-003's "only add new
 * geometry where the repository genuinely lacks it" instruction. `cornerRadiusRatio` of 0 degenerates
 * cleanly to a plain axis-aligned square, so Square reuses this exact function rather than a second,
 * square-only implementation.
 */
function createRoundedSquareNaturalContours(cornerRadiusRatio) {
  const half = 1;
  const r = half * cornerRadiusRatio;
  // Y-down mm canvas convention (matches ShapeLibrary.js's own heart/ring arc math): corners walked
  // clockwise starting top-right, each corner's own quarter-circle sweeping from the edge above it
  // to the edge beside it.
  const corners = [
    { cxMm: half - r, cyMm: -half + r, startRad: -Math.PI / 2 },
    { cxMm: half - r, cyMm: half - r, startRad: 0 },
    { cxMm: -half + r, cyMm: half - r, startRad: Math.PI / 2 },
    { cxMm: -half + r, cyMm: -half + r, startRad: Math.PI }
  ];
  const contour = [];
  for (const corner of corners) {
    if (r <= 1e-9) {
      contour.push(point(corner.cxMm, corner.cyMm));
      continue;
    }
    for (let i = 0; i <= CORNER_SEGMENTS; i++) {
      const angle = corner.startRad + (Math.PI / 2) * (i / CORNER_SEGMENTS);
      contour.push(point(corner.cxMm + r * Math.cos(angle), corner.cyMm + r * Math.sin(angle)));
    }
  }
  return contour.map((p) => point(p.xMm + half, p.yMm + half));
}

/**
 * Builds a hollow frame's two natural contour sets from a single outer contour: generationNaturalContours
 * (outer + inner, the stone-generation band) and fittingNaturalContours (inner alone, the future
 * monogram-fitting region) — computed once, from the same inner contour, never re-derived per call
 * (MONO-003's "do not derive one from the other every call" instruction).
 */
function buildHollowFrameNaturalContours(outerContour, innerRatio) {
  const innerContour = scaleContourTowardCenter(outerContour, NATURAL_CENTER_MM, NATURAL_CENTER_MM, innerRatio);
  return {
    generationNaturalContours: [outerContour, innerContour],
    fittingNaturalContours: [innerContour]
  };
}

const circleRing = createRingNaturalContours(DEFAULT_INNER_RATIO);
// Oval reuses Circle's exact ring geometry — the elliptical look comes entirely from placing this
// same natural (circular) ring into a non-square width/height box, exactly how ShapeLibrary's own
// Ellipse is a circle in its own natural space (see ShapeLibrary.js's module doc comment).
const ovalRing = circleRing;
const squareFrame = buildHollowFrameNaturalContours(createRoundedSquareNaturalContours(0), DEFAULT_INNER_RATIO);
const roundedSquareFrame = buildHollowFrameNaturalContours(createRoundedSquareNaturalContours(ROUNDED_SQUARE_CORNER_RATIO), DEFAULT_INNER_RATIO);
const diamondFrame = buildHollowFrameNaturalContours(createRegularPolygonNaturalContours(4)[0], DEFAULT_INNER_RATIO);

const COMMON_SCALING_LIMITS_MM = { minWidthMm: 20, maxWidthMm: 150, minHeightMm: 20, maxHeightMm: 150 };
const NO_OPTICAL_OFFSET = { xMm: 0, yMm: 0 };

/**
 * The initial geometric frame set (MONO-003). Every frame is hollow: a stone border
 * (generationNaturalContours) around an inner opening (fittingNaturalContours) future monogram
 * letters will be fit into. `source` records which module's geometry the frame is built from —
 * 'shapeLibrary' when it is a direct reuse of an existing ShapeLibrary.js generator, 'frameLibrary'
 * when the geometry genuinely did not exist in the repository before this milestone.
 */
const FRAME_DEFINITIONS = Object.freeze([
  {
    id: 'circle',
    label: 'Circle',
    category: 'geometric',
    source: 'shapeLibrary',
    hollow: true,
    clearanceMm: 1.5,
    opticalCenterOffset: NO_OPTICAL_OFFSET,
    scalingLimitsMm: COMMON_SCALING_LIMITS_MM,
    generationNaturalContours: circleRing,
    fittingNaturalContours: [circleRing[1]]
  },
  {
    id: 'oval',
    label: 'Oval',
    category: 'geometric',
    source: 'shapeLibrary',
    hollow: true,
    clearanceMm: 1.5,
    opticalCenterOffset: NO_OPTICAL_OFFSET,
    scalingLimitsMm: { minWidthMm: 30, maxWidthMm: 180, minHeightMm: 20, maxHeightMm: 130 },
    generationNaturalContours: ovalRing,
    fittingNaturalContours: [ovalRing[1]]
  },
  {
    id: 'square',
    label: 'Square',
    category: 'geometric',
    source: 'frameLibrary',
    hollow: true,
    clearanceMm: 1.5,
    opticalCenterOffset: NO_OPTICAL_OFFSET,
    scalingLimitsMm: COMMON_SCALING_LIMITS_MM,
    generationNaturalContours: squareFrame.generationNaturalContours,
    fittingNaturalContours: squareFrame.fittingNaturalContours
  },
  {
    id: 'rounded-square',
    label: 'Rounded Square',
    category: 'geometric',
    source: 'frameLibrary',
    hollow: true,
    clearanceMm: 1.5,
    opticalCenterOffset: NO_OPTICAL_OFFSET,
    scalingLimitsMm: COMMON_SCALING_LIMITS_MM,
    generationNaturalContours: roundedSquareFrame.generationNaturalContours,
    fittingNaturalContours: roundedSquareFrame.fittingNaturalContours
  },
  {
    id: 'diamond',
    label: 'Diamond',
    category: 'geometric',
    source: 'shapeLibrary',
    hollow: true,
    clearanceMm: 1.5,
    opticalCenterOffset: NO_OPTICAL_OFFSET,
    scalingLimitsMm: COMMON_SCALING_LIMITS_MM,
    generationNaturalContours: diamondFrame.generationNaturalContours,
    fittingNaturalContours: diamondFrame.fittingNaturalContours
  }
]);

const FRAME_DEFINITIONS_BY_ID = new Map(FRAME_DEFINITIONS.map((frame) => [frame.id, frame]));

/** All frame definitions, in a stable, deterministic order. */
export function listFrames() {
  return FRAME_DEFINITIONS.slice();
}

/**
 * @param {string} id
 * @returns {object} The frame definition.
 * @throws {TypeError} If `id` is not a known frame.
 */
export function getFrameDefinition(id) {
  const frame = FRAME_DEFINITIONS_BY_ID.get(id);
  if (!frame) {
    throw new TypeError(`getFrameDefinition: unknown frame id "${id}". Expected one of: ${[...FRAME_DEFINITIONS_BY_ID.keys()].join(', ')}`);
  }
  return frame;
}

/**
 * Resolves a frame-or-id argument to a frame definition. Every resolve()/compute() function below
 * accepts either a known frame id (looked up via getFrameDefinition()) or an already-resolved,
 * frame-definition-shaped object directly — the latter is what lets a future generic frame (e.g. a
 * solid, non-bordered frame kind no id in this milestone's set represents) exercise the exact same
 * hollow/solid branching this module applies to its own built-in frames, without requiring every
 * possible frame shape to be pre-registered here.
 */
function resolveFrame(frameOrId) {
  return typeof frameOrId === 'string' ? getFrameDefinition(frameOrId) : frameOrId;
}

/**
 * Places `contours` into an absolute mm box, scaling independently in X and Y and translating so
 * the box's top-left corner lands at (xMm, yMm) — the same "natural contour -> mm placement"
 * contract GeometryEngine's private _placeNaturalContours() already establishes for every
 * ShapeLibrary shape kind (see this module's own doc comment for why it is re-expressed here rather
 * than imported).
 *
 * The scale factor itself is always derived from `referenceContours`, not from `contours`' own
 * natural bounding box. For resolveGenerationContours() these are the same set (the frame's full
 * outer+inner geometry), but resolveInnerFittingContours() deliberately passes the frame's full
 * generationNaturalContours as the reference while placing only the (smaller) inner contour — using
 * the inner contour's own natural bbox to derive the scale would independently blow the opening up
 * to fill the requested box on its own, rather than showing it at its true proportional size within
 * the frame.
 *
 * @param {{xMm:number,yMm:number}[][]} contours The contours to actually transform and return.
 * @param {{xMm:number,yMm:number}[][]} referenceContours The contours the scale factor is derived from.
 * @param {number} xMm
 * @param {number} yMm
 * @param {number|null} [widthMm] Defaults to the reference contours' own natural width when omitted.
 * @param {number|null} [heightMm] Defaults to the reference contours' own natural height when omitted.
 * @returns {{polygons: Point2D[][], boundingBox: BoundingBox|null}}
 */
function placeNaturalContours(contours, referenceContours, xMm, yMm, widthMm, heightMm) {
  const referenceBox = BoundingBox.fromPoints(referenceContours.flat().map((p) => new Point2D(p.xMm, p.yMm)));
  if (!referenceBox) {
    return { polygons: [], boundingBox: null };
  }

  const targetWidthMm = widthMm ?? referenceBox.widthMm;
  const targetHeightMm = heightMm ?? referenceBox.heightMm;
  const scaleX = referenceBox.widthMm > 0 ? targetWidthMm / referenceBox.widthMm : 1;
  const scaleY = referenceBox.heightMm > 0 ? targetHeightMm / referenceBox.heightMm : 1;

  const polygons = contours.map((contour) => contour.map((p) => new Point2D(
    xMm + p.xMm * scaleX,
    yMm + p.yMm * scaleY
  )));

  return { polygons, boundingBox: BoundingBox.fromPoints(polygons.flat()) };
}

/**
 * Resolves a frame's stone-generation geometry (outer + inner contour for a hollow frame) placed
 * into an absolute mm box. This is the geometry a future GeometryEngine frame generator would sample
 * stones from — never the geometry a monogram letter should be fit inside (see
 * resolveInnerFittingContours()/computeFrameInterior() below).
 *
 * @param {string|object} frameOrId A known frame id, or a frame-definition-shaped object (see resolveFrame()).
 * @param {{xMm:number,yMm:number,widthMm?:number,heightMm?:number}} box
 * @returns {{polygons: Point2D[][], boundingBox: BoundingBox|null}}
 */
export function resolveGenerationContours(frameOrId, box) {
  const frame = resolveFrame(frameOrId);
  return placeNaturalContours(frame.generationNaturalContours, frame.generationNaturalContours, box.xMm, box.yMm, box.widthMm, box.heightMm);
}

/**
 * Resolves a frame's inner fitting geometry alone, placed into an absolute mm box — for a hollow
 * frame this is the inner opening only (never the outer contour, never the band), matching the
 * MONO-001A correction. Solid frames have no separate inner contour, so this falls back to the
 * frame's own generation geometry for them (`frame.hollow` is false) — the same fallback
 * computeFrameInterior() relies on when it calls this function.
 *
 * @param {string|object} frameOrId A known frame id, or a frame-definition-shaped object (see resolveFrame()).
 * @param {{xMm:number,yMm:number,widthMm?:number,heightMm?:number}} box
 * @returns {{polygons: Point2D[][], boundingBox: BoundingBox|null}}
 */
export function resolveInnerFittingContours(frameOrId, box) {
  const frame = resolveFrame(frameOrId);
  const naturalContours = frame.hollow ? frame.fittingNaturalContours : frame.generationNaturalContours;
  // Scale is always derived from the frame's own full generation geometry (see placeNaturalContours()'s
  // own doc comment) so the inner opening is placed at its true proportional size, not independently
  // stretched to fill the requested box on its own.
  return placeNaturalContours(naturalContours, frame.generationNaturalContours, box.xMm, box.yMm, box.widthMm, box.heightMm);
}

/**
 * Moves a single point toward (centerXMm, centerYMm) by a fixed mm distance, clamping at the center
 * itself rather than overshooting past it. Exact for a circular region (moving every point on a
 * circle of radius r toward its own center by insetMm yields the circle of radius r-insetMm);
 * for a non-circular region this moves each vertex radially rather than offsetting each edge along
 * its own normal, the same kind of accepted approximation ShapeLibrary.js's own non-uniform
 * ellipse/star aspect stretching already documents (see that module's own doc comment) — appropriate
 * here because clearanceMm's purpose is a fitting safety margin, not exact production geometry (the
 * frame's own generationContours, which production stones are placed from, are never touched by
 * this function).
 */
function insetPointTowardCenterByMm(p, centerXMm, centerYMm, insetMm) {
  const dxMm = p.xMm - centerXMm;
  const dyMm = p.yMm - centerYMm;
  const distMm = Math.hypot(dxMm, dyMm);
  if (!(distMm > insetMm)) {
    return new Point2D(centerXMm, centerYMm);
  }
  const scale = (distMm - insetMm) / distMm;
  return new Point2D(centerXMm + dxMm * scale, centerYMm + dyMm * scale);
}

/**
 * MONO-001A: resolves the polygons/boundingBox a future monogram generator should fit letters
 * into — the inner fitting contour for hollow frames (never the full generation geometry, so
 * letters can never land inside the stone border itself), or the frame's ordinary generation
 * geometry for solid frames (which have no separate interior region to distinguish). The result is
 * additionally eroded inward by the frame's own clearanceMm (every vertex moved toward the region's
 * own center by that many mm — see insetPointTowardCenterByMm()), so a future caller does not need
 * to separately know about or apply clearanceMm itself.
 *
 * @param {string|object} frameOrId A known frame id, or a frame-definition-shaped object (see resolveFrame()).
 * @param {{xMm:number,yMm:number,widthMm?:number,heightMm?:number}} box
 * @returns {{polygons: Point2D[][], boundingBox: BoundingBox|null}}
 */
export function computeFrameInterior(frameOrId, box) {
  const frame = resolveFrame(frameOrId);
  const { polygons, boundingBox } = resolveInnerFittingContours(frame, box);
  if (!boundingBox) {
    return { polygons, boundingBox };
  }

  const clearanceMm = frame.clearanceMm || 0;
  if (!(clearanceMm > 0)) {
    return { polygons, boundingBox };
  }

  const centerXMm = boundingBox.center.xMm;
  const centerYMm = boundingBox.center.yMm;
  const insetPolygons = polygons.map((polygon) => polygon.map((p) => insetPointTowardCenterByMm(p, centerXMm, centerYMm, clearanceMm)));
  return { polygons: insetPolygons, boundingBox: BoundingBox.fromPoints(insetPolygons.flat()) };
}

/**
 * Convenience combining computeFrameInterior() with ShapeFit.computeInscribedRect() — the same
 * "resolve a shape's fittable region, then find the largest rect of a given aspect ratio inside it"
 * two-step app.js's fitTextToShape() already performs for ordinary Shape Layers, generalized to any
 * frame. This module never reimplements that search itself (per MONO-003's "do not duplicate
 * ShapeFit mathematics" instruction).
 *
 * @param {string|object} frameOrId A known frame id, or a frame-definition-shaped object (see resolveFrame()).
 * @param {{xMm:number,yMm:number,widthMm?:number,heightMm?:number}} box
 * @param {number} aspectRatio width/height
 * @returns {{xMm:number,yMm:number,widthMm:number,heightMm:number,fitRatio:number}|null}
 */
export function computeFrameFitRect(frameOrId, box, aspectRatio) {
  const { polygons, boundingBox } = computeFrameInterior(frameOrId, box);
  return computeInscribedRect(polygons, boundingBox, aspectRatio);
}
