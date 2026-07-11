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

export const SUPPORTED_LAYER_TYPES = new Set(['text', 'circle', 'rectangle']);
export const SUPPORTED_WRAP_MODES = new Set(['front', 'wide', 'half', 'full']);
export const SUPPORTED_TEXT_MODES = new Set(['centerline', 'fill']);

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
    } else {
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
      if (layer.type === 'circle') {
        return {
          id: layer.id,
          type: 'circle',
          visible,
          cx: layer.cxMm,
          cy: layer.cyMm,
          r: layer.radiusMm,
          stoneSize: layer.stoneSizeMm,
          gap: layer.gapMm,
          color: layer.color
        };
      }
      return {
        id: layer.id,
        type: 'rectangle',
        visible,
        x: layer.xMm,
        y: layer.yMm,
        w: layer.widthMm,
        h: layer.heightMm,
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

// Circle/rectangle layers are never centered and always sampled in 'outline' mode — this mirrors
// app.js's generateShapeStonesLive() exactly (it hardcodes mode:'outline' regardless of any
// per-layer mode field), so a shape layer's on-canvas position/mode is exactly what the author
// specified, with no hidden transform.
function generateShapeStonesForLayer(layer, permanentEngine) {
  const isCircle = layer.type === 'circle';
  const params = {
    shape: layer.type,
    layerId: layer.id,
    stoneSizeMm: layer.stoneSizeMm,
    gapMm: layer.gapMm,
    mode: 'outline',
    color: layer.color,
    ...(isCircle
      ? { cxMm: layer.cxMm, cyMm: layer.cyMm, radiusMm: layer.radiusMm }
      : { xMm: layer.xMm, yMm: layer.yMm, widthMm: layer.widthMm, heightMm: layer.heightMm })
  };
  const result = permanentEngine.generateShapeLayout(params);
  return result.stones.map((s) => ({ x: s.xMm, y: s.yMm, d: s.sizeMm, color: s.color, layerId: s.layerId }));
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
 * @returns {Promise<StoneLayout>}
 */
export async function generateProjectStoneLayout(rhsProject, permanentEngine) {
  let raw = [];
  for (const layer of rhsProject.layers) {
    if (layer.visible === false) continue;
    if (layer.type === 'text') {
      raw.push(...await generateTextStonesForLayer(layer, rhsProject.canvas, permanentEngine));
    } else {
      raw.push(...generateShapeStonesForLayer(layer, permanentEngine));
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
