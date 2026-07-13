/**
 * RS-0003.5E1 — shared library for the `.rhs` example regression suite.
 *
 * The `.rhs` project schema used here is the flat, mm-suffixed schema already established by the
 * two pre-existing fixtures `examples/vitalina.rhs` / `examples/vitalina-serbin.rhs`
 * (`heightMm`/`stoneSizeMm`/`gapMm`, `mode: "centerline"|"fill"`, `font` as a family display
 * name or font id). It is NOT the same as `app.js`'s ad hoc live-editor schema
 * (`height`/`stoneSize`/`gap`, `textMode: "stroke"|"fill"`, `font` as a font id only) — running
 * `app.js`'s own `validateProject()` against `vitalina.rhs` throws, confirming the two schemas
 * are genuinely different, pre-existing things. See
 * docs/specifications/RS-0003.5E1-RealProductionValidation.md "Resolved discrepancy" for the full
 * reasoning. `toAppProjectShape()` below bridges the two only for verification purposes; it does
 * not change either live schema.
 *
 * generateProjectStoneLayout() calls only the permanent src/geometry/GeometryEngine.js per layer
 * (via its index.js barrel) to generate stone positions, then reproduces app.js's existing
 * cross-layer proximity-dedupe/auto-fit/centering algorithm verbatim (a faithful port for test
 * infrastructure, not a new invention — that merge step living outside the permanent engine is a
 * documented, pre-existing architectural gap, see docs/ARCHITECTURE.md "Current Architectural
 * Limitations" #2). Nothing here invents a stone position; dedupe only filters already-generated
 * positions by proximity, exactly like app.js's own dedupe().
 */

import { Stone, StoneLayout } from '../../src/geometry/index.js';

// RS-2000: svg/image/path join text/circle/rectangle, extending this schema to match every layer
// type app.js's own live-editor schema supports (RS-1001 SVG Import, RS-1008 Image Trace, RS-1012
// Boolean Operations, RS-1011 Fill Algorithms). Field names stay in this file's existing flat
// mm-suffixed convention (svgSource/imageSrc/contours are not measurements, so they stay
// unprefixed, exactly like `color`/`font` already do) rather than adopting app.js's field names
// verbatim -- see this module's header comment for why the two schemas are deliberately distinct.
export const SUPPORTED_LAYER_TYPES = new Set(['text', 'circle', 'rectangle', 'svg', 'image', 'path']);
export const SUPPORTED_WRAP_MODES = new Set(['front', 'wide', 'half', 'full']);
export const SUPPORTED_TEXT_MODES = new Set(['centerline', 'fill']);
// RS-1011: Fill Style modes. Vector shapes (circle/rectangle/svg/path) support all five; a raster
// Image Trace layer has no perimeter to trace an "outline" from, so it supports only the four
// interior-sampling modes -- mirroring app.js's VECTOR_FILL_MODES/IMAGE_FILL_MODES exactly.
export const SUPPORTED_VECTOR_FILL_MODES = new Set(['outline', 'fill', 'staggered', 'radial', 'contour']);
export const SUPPORTED_IMAGE_FILL_MODES = new Set(['fill', 'staggered', 'radial', 'contour']);

const FONT_FAMILY_TO_ID = {
  'Courier Prime': 'courier-prime-regular',
  'courier-prime-regular': 'courier-prime-regular',
  'Great Vibes': 'great-vibes-regular',
  'great-vibes-regular': 'great-vibes-regular'
};

export function resolveFontId(fontValue) {
  const id = FONT_FAMILY_TO_ID[fontValue];
  if (!id) {
    throw new Error(`Unrecognized font "${fontValue}". Expected one of: ${Object.keys(FONT_FAMILY_TO_ID).join(', ')}`);
  }
  return id;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Structurally validates a parsed `.rhs` project object. Throws a specific Error describing the
 * first problem found. Never mutates its input; returns a normalized deep clone on success.
 *
 * @param {object} obj
 * @param {string} [sourceLabel] Used only in error messages.
 * @returns {object}
 */
export function validateRhsProject(obj, sourceLabel = 'project') {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(`${sourceLabel}: must be a JSON object.`);
  }
  if (obj.units !== 'mm') {
    throw new Error(`${sourceLabel}: units must be "mm".`);
  }
  const canvas = obj.canvas;
  if (!canvas || !isFiniteNumber(canvas.width) || canvas.width <= 0) {
    throw new Error(`${sourceLabel}: canvas.width must be a positive finite number.`);
  }
  if (!isFiniteNumber(canvas.height) || canvas.height <= 0) {
    throw new Error(`${sourceLabel}: canvas.height must be a positive finite number.`);
  }
  if (obj.cupColor !== undefined && typeof obj.cupColor !== 'string') {
    throw new Error(`${sourceLabel}: cupColor must be a string when present.`);
  }
  if (obj.wrap !== undefined && !SUPPORTED_WRAP_MODES.has(obj.wrap)) {
    throw new Error(`${sourceLabel}: wrap must be one of ${[...SUPPORTED_WRAP_MODES].join(', ')} when present.`);
  }
  if (!Array.isArray(obj.layers) || obj.layers.length === 0) {
    throw new Error(`${sourceLabel}: layers must be a non-empty array.`);
  }

  const ids = new Set();
  const layers = obj.layers.map((layer, i) => {
    const label = `${sourceLabel}: layers[${i}]`;
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
      throw new Error(`${label} must be an object.`);
    }
    if (!isNonEmptyString(layer.id)) {
      throw new Error(`${label} is missing a non-empty string id.`);
    }
    if (ids.has(layer.id)) {
      throw new Error(`${sourceLabel}: duplicate layer id "${layer.id}".`);
    }
    ids.add(layer.id);
    if (!SUPPORTED_LAYER_TYPES.has(layer.type)) {
      throw new Error(`${label} ("${layer.id}") has unsupported type: ${layer.type}`);
    }
    if (!isFiniteNumber(layer.stoneSizeMm) || layer.stoneSizeMm <= 0) {
      throw new Error(`${label} ("${layer.id}") stoneSizeMm must be a positive finite number.`);
    }
    if (!isFiniteNumber(layer.gapMm) || layer.gapMm < 0) {
      throw new Error(`${label} ("${layer.id}") gapMm must be a non-negative finite number.`);
    }
    if (!isNonEmptyString(layer.color)) {
      throw new Error(`${label} ("${layer.id}") color must be a non-empty string.`);
    }

    if (layer.type === 'text') {
      if (!isNonEmptyString(layer.text)) {
        throw new Error(`${label} ("${layer.id}") text must be a non-empty string.`);
      }
      resolveFontId(layer.font);
      if (layer.mode !== undefined && !SUPPORTED_TEXT_MODES.has(layer.mode)) {
        throw new Error(`${label} ("${layer.id}") mode must be one of ${[...SUPPORTED_TEXT_MODES].join(', ')} when present.`);
      }
      if (!isFiniteNumber(layer.heightMm) || layer.heightMm <= 0) {
        throw new Error(`${label} ("${layer.id}") heightMm must be a positive finite number.`);
      }
      if (layer.autoFit !== undefined && typeof layer.autoFit !== 'boolean') {
        throw new Error(`${label} ("${layer.id}") autoFit must be a boolean when present.`);
      }
    } else if (layer.type === 'circle') {
      for (const field of ['cxMm', 'cyMm']) {
        if (!isFiniteNumber(layer[field])) {
          throw new Error(`${label} ("${layer.id}") ${field} must be a finite number.`);
        }
      }
      if (!isFiniteNumber(layer.radiusMm) || layer.radiusMm <= 0) {
        throw new Error(`${label} ("${layer.id}") radiusMm must be a positive finite number.`);
      }
      if (layer.fillMode !== undefined && !SUPPORTED_VECTOR_FILL_MODES.has(layer.fillMode)) {
        throw new Error(`${label} ("${layer.id}") fillMode must be one of ${[...SUPPORTED_VECTOR_FILL_MODES].join(', ')} when present.`);
      }
    } else if (layer.type === 'rectangle') {
      for (const field of ['xMm', 'yMm']) {
        if (!isFiniteNumber(layer[field])) {
          throw new Error(`${label} ("${layer.id}") ${field} must be a finite number.`);
        }
      }
      for (const field of ['widthMm', 'heightMm']) {
        if (!isFiniteNumber(layer[field]) || layer[field] <= 0) {
          throw new Error(`${label} ("${layer.id}") ${field} must be a positive finite number.`);
        }
      }
      if (layer.fillMode !== undefined && !SUPPORTED_VECTOR_FILL_MODES.has(layer.fillMode)) {
        throw new Error(`${label} ("${layer.id}") fillMode must be one of ${[...SUPPORTED_VECTOR_FILL_MODES].join(', ')} when present.`);
      }
    } else if (layer.type === 'svg') {
      // RS-1001 / RS-2000: an SVG-imported layer. svgSource is real, self-contained SVG markup
      // (not a measurement, so no "Mm" suffix, matching color/font's existing unprefixed style).
      if (!isNonEmptyString(layer.svgSource)) {
        throw new Error(`${label} ("${layer.id}") svgSource must be a non-empty string.`);
      }
      for (const field of ['xMm', 'yMm', 'widthMm', 'heightMm']) {
        if (!isFiniteNumber(layer[field])) {
          throw new Error(`${label} ("${layer.id}") ${field} must be a finite number.`);
        }
      }
      if (layer.fillMode !== undefined && !SUPPORTED_VECTOR_FILL_MODES.has(layer.fillMode)) {
        throw new Error(`${label} ("${layer.id}") fillMode must be one of ${[...SUPPORTED_VECTOR_FILL_MODES].join(', ')} when present.`);
      }
    } else if (layer.type === 'image') {
      // RS-1008 / RS-2000: an Image Trace layer. imageSrc is a real, self-contained data: URI.
      if (!isNonEmptyString(layer.imageSrc)) {
        throw new Error(`${label} ("${layer.id}") imageSrc must be a non-empty string.`);
      }
      for (const field of ['xMm', 'yMm', 'widthMm', 'heightMm']) {
        if (!isFiniteNumber(layer[field])) {
          throw new Error(`${label} ("${layer.id}") ${field} must be a finite number.`);
        }
      }
      if (!isFiniteNumber(layer.threshold) || layer.threshold < 0 || layer.threshold > 255) {
        throw new Error(`${label} ("${layer.id}") threshold must be a finite number between 0 and 255.`);
      }
      if (!isFiniteNumber(layer.blurRadiusPx) || layer.blurRadiusPx < 0) {
        throw new Error(`${label} ("${layer.id}") blurRadiusPx must be a non-negative finite number.`);
      }
      for (const field of ['maxWidthPx', 'maxHeightPx']) {
        if (!isFiniteNumber(layer[field]) || layer[field] <= 0) {
          throw new Error(`${label} ("${layer.id}") ${field} must be a positive finite number.`);
        }
      }
      // A raster layer has no perimeter to trace an "outline" from -- only the four interior-
      // sampling fill modes apply (mirrors app.js's IMAGE_FILL_MODES exactly).
      if (layer.fillMode !== undefined && !SUPPORTED_IMAGE_FILL_MODES.has(layer.fillMode)) {
        throw new Error(`${label} ("${layer.id}") fillMode must be one of ${[...SUPPORTED_IMAGE_FILL_MODES].join(', ')} when present.`);
      }
    } else if (layer.type === 'path') {
      // RS-1012 / RS-2000: a Boolean Operation result. `contours` stores plain (0,0)-rooted
      // polygons; point fields are `x`/`y` (NOT `xMm`/`yMm`) -- matching how GeometryEngine.
      // generatePathLayout()/app.js's own validateProject() already store path contours (app.js
      // ~line 344), so a contour round-trips byte-identical between the two schemas.
      if (!(
        Array.isArray(layer.contours) &&
        layer.contours.length > 0 &&
        layer.contours.every((c) => Array.isArray(c) && c.length >= 3 && c.every((p) => p && isFiniteNumber(p.x) && isFiniteNumber(p.y)))
      )) {
        throw new Error(`${label} ("${layer.id}") contours must be a non-empty array of polygons, each with 3+ numeric {x,y} points.`);
      }
      for (const field of ['xMm', 'yMm', 'widthMm', 'heightMm']) {
        if (!isFiniteNumber(layer[field])) {
          throw new Error(`${label} ("${layer.id}") ${field} must be a finite number.`);
        }
      }
      if (layer.fillMode !== undefined && !SUPPORTED_VECTOR_FILL_MODES.has(layer.fillMode)) {
        throw new Error(`${label} ("${layer.id}") fillMode must be one of ${[...SUPPORTED_VECTOR_FILL_MODES].join(', ')} when present.`);
      }
    }

    return JSON.parse(JSON.stringify(layer));
  });

  return {
    version: Number(obj.version) || 1,
    product: String(obj.product || 'mug'),
    units: 'mm',
    canvas: { width: canvas.width, height: canvas.height },
    cupColor: typeof obj.cupColor === 'string' ? obj.cupColor : '#1f3556',
    wrap: SUPPORTED_WRAP_MODES.has(obj.wrap) ? obj.wrap : 'front',
    layers
  };
}

/**
 * Translates a validated `.rhs` project to app.js's ad hoc live-editor schema. Used only by the
 * regression suite (to cross-check app.js's real validateProject(), and to drive browser-import
 * verification) — app.js itself is unmodified by this milestone.
 */
export function toAppProjectShape(rhsProject) {
  return {
    version: Number(rhsProject.version) || 2,
    units: 'mm',
    product: String(rhsProject.product || 'mug'),
    canvas: { width: rhsProject.canvas.width, height: rhsProject.canvas.height },
    cupColor: rhsProject.cupColor || '#1f3556',
    wrap: rhsProject.wrap || 'front',
    layers: rhsProject.layers.map((layer) => {
      const visible = layer.visible !== false;
      if (layer.type === 'text') {
        return {
          id: layer.id,
          type: 'text',
          visible,
          text: layer.text,
          font: resolveFontId(layer.font),
          height: layer.heightMm,
          textMode: layer.mode === 'fill' ? 'fill' : 'stroke',
          stoneSize: layer.stoneSizeMm,
          gap: layer.gapMm,
          color: layer.color,
          autoFit: Boolean(layer.autoFit)
        };
      }
      // RS-2000: fillMode (and svg's own `mode`) is an optional field in both schemas -- a fixture
      // that doesn't set it must translate to an app-shape object with the key genuinely absent,
      // not present-with-value-undefined (JSON.stringify() drops undefined-valued keys, so a
      // literal `fillMode: layer.fillMode` here silently failed the round-trip test whenever the
      // source layer had no fillMode: the pre-stringify object still had the key, the post-parse
      // object didn't). Conditional spread keeps the key out entirely when absent, exactly
      // matching how app.js's own live layers are shaped before a user ever touches the control.
      const fillModeField = layer.fillMode !== undefined ? { fillMode: layer.fillMode } : {};

      if (layer.type === 'circle') {
        return {
          id: layer.id,
          type: 'circle',
          visible,
          cx: layer.cxMm,
          cy: layer.cyMm,
          r: layer.radiusMm,
          ...fillModeField,
          stoneSize: layer.stoneSizeMm,
          gap: layer.gapMm,
          color: layer.color
        };
      }
      if (layer.type === 'rectangle') {
        return {
          id: layer.id,
          type: 'rectangle',
          visible,
          x: layer.xMm,
          y: layer.yMm,
          w: layer.widthMm,
          h: layer.heightMm,
          ...fillModeField,
          stoneSize: layer.stoneSizeMm,
          gap: layer.gapMm,
          color: layer.color
        };
      }
      if (layer.type === 'svg') {
        // app.js's own svg-layer field is genuinely named `mode`, not `fillMode` (see
        // generateSvgStonesLive()/writeSelectedControlsToLayer() in app.js) -- every other vector
        // layer type (circle/rectangle/path) uses `fillMode`; svg is the one exception in the live
        // schema, so this translation preserves that exact quirk rather than "fixing" it.
        return {
          id: layer.id,
          type: 'svg',
          visible,
          svgSource: layer.svgSource,
          x: layer.xMm,
          y: layer.yMm,
          w: layer.widthMm,
          h: layer.heightMm,
          ...(layer.fillMode !== undefined ? { mode: layer.fillMode } : {}),
          stoneSize: layer.stoneSizeMm,
          gap: layer.gapMm,
          color: layer.color
        };
      }
      if (layer.type === 'image') {
        return {
          id: layer.id,
          type: 'image',
          visible,
          imageSrc: layer.imageSrc,
          x: layer.xMm,
          y: layer.yMm,
          w: layer.widthMm,
          h: layer.heightMm,
          threshold: layer.threshold,
          invert: Boolean(layer.invert),
          blurRadiusPx: layer.blurRadiusPx,
          maxWidthPx: layer.maxWidthPx,
          maxHeightPx: layer.maxHeightPx,
          ...fillModeField,
          stoneSize: layer.stoneSizeMm,
          gap: layer.gapMm,
          color: layer.color
        };
      }
      // path
      return {
        id: layer.id,
        type: 'path',
        visible,
        contours: layer.contours,
        x: layer.xMm,
        y: layer.yMm,
        w: layer.widthMm,
        h: layer.heightMm,
        ...fillModeField,
        stoneSize: layer.stoneSizeMm,
        gap: layer.gapMm,
        color: layer.color
      };
    })
  };
}

async function generateTextStonesForLayer(layer, canvas, permanentEngine) {
  const fontId = resolveFontId(layer.font);
  const mode = layer.mode === 'fill' ? 'fill' : 'outline';
  const base = {
    text: layer.text,
    fontId,
    layerId: layer.id,
    heightMm: layer.heightMm,
    stoneSizeMm: layer.stoneSizeMm,
    gapMm: layer.gapMm,
    mode,
    color: layer.color
  };
  let result = await permanentEngine.generateTextLayout(base);

  if (layer.autoFit) {
    const maxWidth = canvas.width - 10;
    if (result.widthMm > maxWidth && result.widthMm > 0) {
      const scale = maxWidth / result.widthMm;
      const scaledHeight = Math.max(1, layer.heightMm * scale);
      result = await permanentEngine.generateTextLayout({ ...base, heightMm: scaledHeight });
    }
  }

  const bb = result.getBoundingBox();
  const offsetX = bb ? (canvas.width - bb.widthMm) / 2 - bb.minXmm : 0;
  const offsetY = bb ? (canvas.height - bb.heightMm) / 2 - bb.minYmm : 0;

  return result.stones.map((s) => ({
    x: s.xMm + offsetX,
    y: s.yMm + offsetY,
    d: s.sizeMm,
    color: s.color,
    layerId: s.layerId
  }));
}

// RS-2000: circle/rectangle layers are never centered, and are sampled per their own `fillMode`
// (RS-1011) -- this now mirrors app.js's *current* generateShapeStonesLive(), which honors
// layer.fillMode via resolveVectorFillMode() (falling back to 'outline' for a missing/invalid
// value), not the pre-RS-1011 hardcoded 'outline' this function used to reproduce verbatim.
function generateShapeStonesForLayer(layer, permanentEngine) {
  const isCircle = layer.type === 'circle';
  const params = {
    shape: layer.type,
    layerId: layer.id,
    stoneSizeMm: layer.stoneSizeMm,
    gapMm: layer.gapMm,
    mode: resolveVectorFillMode(layer.fillMode),
    color: layer.color,
    ...(isCircle
      ? { cxMm: layer.cxMm, cyMm: layer.cyMm, radiusMm: layer.radiusMm }
      : { xMm: layer.xMm, yMm: layer.yMm, widthMm: layer.widthMm, heightMm: layer.heightMm })
  };
  const result = permanentEngine.generateShapeLayout(params);
  return result.stones.map((s) => ({ x: s.xMm, y: s.yMm, d: s.sizeMm, color: s.color, layerId: s.layerId }));
}

// RS-1001 / RS-2000: an 'svg' layer, mirroring app.js's generateSvgStonesLive() -- src/svg/**
// (not this file) does the actual SVG parsing, inside generateSvgLayout().
function generateSvgStonesForLayer(layer, permanentEngine) {
  const params = {
    svgSource: layer.svgSource,
    layerId: layer.id,
    xMm: layer.xMm,
    yMm: layer.yMm,
    widthMm: layer.widthMm,
    heightMm: layer.heightMm,
    stoneSizeMm: layer.stoneSizeMm,
    gapMm: layer.gapMm,
    mode: resolveVectorFillMode(layer.fillMode),
    color: layer.color
  };
  const result = permanentEngine.generateSvgLayout(params);
  return result.stones.map((s) => ({ x: s.xMm, y: s.yMm, d: s.sizeMm, color: s.color, layerId: s.layerId }));
}

// RS-1008 / RS-2000: an 'image' (Image Trace) layer, mirroring app.js's generateImageStonesLive().
// Node has no bundled PNG/JPEG/WebP decoder (src/image/ImageDecoder.js is deliberately the one
// DOM-only file in src/image/**), so this cannot decode layer.imageSrc itself -- the caller must
// supply `resolveImageBuffer(layer)` (e.g. backed by a real browser's decoded getImageData(), via
// CDP, or any other already-decoded {widthPx,heightPx,data} source) returning an ImageBuffer
// (src/image/index.js's createImageBuffer() shape).
async function generateImageStonesForLayer(layer, permanentEngine, resolveImageBuffer) {
  const imageBuffer = await resolveImageBuffer(layer);
  const params = {
    imageBuffer,
    layerId: layer.id,
    xMm: layer.xMm,
    yMm: layer.yMm,
    widthMm: layer.widthMm,
    heightMm: layer.heightMm,
    stoneSizeMm: layer.stoneSizeMm,
    gapMm: layer.gapMm,
    mode: resolveImageFillMode(layer.fillMode),
    color: layer.color,
    threshold: layer.threshold,
    invert: Boolean(layer.invert),
    blurRadiusPx: layer.blurRadiusPx,
    maxWidthPx: layer.maxWidthPx,
    maxHeightPx: layer.maxHeightPx
  };
  const result = permanentEngine.generateImageLayout(params);
  return result.stones.map((s) => ({ x: s.xMm, y: s.yMm, d: s.sizeMm, color: s.color, layerId: s.layerId }));
}

// RS-1012 / RS-2000: a 'path' (Boolean Operation result) layer, mirroring app.js's
// generatePathStonesLive(). layer.contours is already plain (0,0)-rooted polygon data (no parsing
// step, unlike SVG) -- {x,y} point fields translate straight to generatePathLayout()'s {xMm,yMm}.
function generatePathStonesForLayer(layer, permanentEngine) {
  const params = {
    contours: layer.contours.map((c) => c.map((p) => ({ xMm: p.x, yMm: p.y }))),
    layerId: layer.id,
    xMm: layer.xMm,
    yMm: layer.yMm,
    widthMm: layer.widthMm,
    heightMm: layer.heightMm,
    stoneSizeMm: layer.stoneSizeMm,
    gapMm: layer.gapMm,
    mode: resolveVectorFillMode(layer.fillMode),
    color: layer.color
  };
  const result = permanentEngine.generatePathLayout(params);
  return result.stones.map((s) => ({ x: s.xMm, y: s.yMm, d: s.sizeMm, color: s.color, layerId: s.layerId }));
}

function resolveVectorFillMode(value) {
  return SUPPORTED_VECTOR_FILL_MODES.has(value) ? value : 'outline';
}

function resolveImageFillMode(value) {
  return SUPPORTED_IMAGE_FILL_MODES.has(value) ? value : 'fill';
}

// Verbatim port of app.js's GeometryEngine.dedupe() (grid-based proximity filter). Only filters
// already-generated stones; invents no positions.
function dedupe(stones, minDist) {
  const cell = Math.max(minDist, 0.5);
  const grid = new Map();
  const out = [];
  const m2 = minDist * minDist;
  for (const s of stones) {
    const gx = Math.floor(s.x / cell);
    const gy = Math.floor(s.y / cell);
    let ok = true;
    for (let yy = gy - 1; yy <= gy + 1 && ok; yy++) {
      for (let xx = gx - 1; xx <= gx + 1 && ok; xx++) {
        const arr = grid.get(`${xx},${yy}`) || [];
        for (const o of arr) {
          const dx = s.x - o.x, dy = s.y - o.y;
          if (dx * dx + dy * dy < m2) { ok = false; break; }
        }
      }
    }
    if (ok) {
      out.push(s);
      const k = `${gx},${gy}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(s);
    }
  }
  return out;
}

/**
 * Generates the merged, deduped, project-level StoneLayout for a validated `.rhs` project, using
 * the permanent GeometryEngine per visible layer. Deterministic for a given project + engine.
 *
 * @param {object} rhsProject A project returned by validateRhsProject().
 * @param {import('../../src/geometry/GeometryEngine.js').GeometryEngine} permanentEngine
 * @param {object} [options]
 * @param {(layer: object) => Promise<{widthPx:number,heightPx:number,data:Uint8ClampedArray}>} [options.resolveImageBuffer]
 *   Required only if the project has an 'image' layer -- see generateImageStonesForLayer()'s doc
 *   comment for why this file cannot decode layer.imageSrc itself.
 * @returns {Promise<StoneLayout>}
 */
export async function generateProjectStoneLayout(rhsProject, permanentEngine, options = {}) {
  const { resolveImageBuffer } = options;
  let raw = [];
  for (const layer of rhsProject.layers) {
    if (layer.visible === false) continue;
    if (layer.type === 'text') {
      raw.push(...await generateTextStonesForLayer(layer, rhsProject.canvas, permanentEngine));
    } else if (layer.type === 'circle' || layer.type === 'rectangle') {
      raw.push(...generateShapeStonesForLayer(layer, permanentEngine));
    } else if (layer.type === 'svg') {
      raw.push(...generateSvgStonesForLayer(layer, permanentEngine));
    } else if (layer.type === 'image') {
      if (typeof resolveImageBuffer !== 'function') {
        throw new Error(`generateProjectStoneLayout: image layer "${layer.id}" requires options.resolveImageBuffer (no PNG/JPEG/WebP decoder is bundled in Node).`);
      }
      raw.push(...await generateImageStonesForLayer(layer, permanentEngine, resolveImageBuffer));
    } else if (layer.type === 'path') {
      raw.push(...generatePathStonesForLayer(layer, permanentEngine));
    }
  }
  const minDist = Math.min(...raw.map((s) => s.d || 2), 2) * 0.58;
  const deduped = dedupe(raw, minDist);
  const stones = deduped.map((s) => new Stone({ xMm: s.x, yMm: s.y, sizeMm: s.d, color: s.color, layerId: s.layerId }));
  return new StoneLayout({ layerId: 'project', stones });
}

export function visibleLayerCount(rhsProject) {
  return rhsProject.layers.filter((l) => l.visible !== false).length;
}
