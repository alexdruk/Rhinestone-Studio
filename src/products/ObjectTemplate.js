/**
 * Object templates — RS-1004.
 *
 * Per docs/ARCHITECTURE.md's "Product Plugins" principle, a product/object template supplies a
 * printable area, a schematic preview, and wrap behavior; it never generates a layout. This module
 * is data only: plain, validated template records plus lookup helpers. It has no dependency on
 * `StoneLayout`, `GeometryEngine`, the DOM, or any renderer — those consume a template's fields as
 * plain display options, exactly like `CupRenderer.js` already treats `cupColor`/`wrap`.
 *
 * Distinct from `StoneLayout`: a `StoneLayout` is the manufacturing product of one project's
 * layers (mm stone positions). An `ObjectTemplate` never contains a stone position — it only
 * describes the physical item the (unchanged) `StoneLayout` is being previewed/produced against.
 */

export const WRAP_MODES = Object.freeze(['front', 'wide', 'half', 'full']);

const PREVIEW_KINDS = new Set(['mug', 'tumbler', 'bottle']);

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`ObjectTemplate: ${label} must be a finite number.`);
  }
}

function assertPositiveNumber(value, label) {
  assertFiniteNumber(value, label);
  if (value <= 0) {
    throw new TypeError(`ObjectTemplate: ${label} must be a positive number.`);
  }
}

function assertNonNegativeNumber(value, label) {
  assertFiniteNumber(value, label);
  if (value < 0) {
    throw new TypeError(`ObjectTemplate: ${label} must be a non-negative number.`);
  }
}

/**
 * Validates a plain template definition object and returns a frozen, defensively-copied record.
 * Throws a specific TypeError describing the first problem found. Never mutates its input.
 *
 * @param {object} def
 * @returns {object} A frozen, validated template record.
 */
export function createObjectTemplate(def) {
  if (!def || typeof def !== 'object') {
    throw new TypeError('ObjectTemplate: definition must be an object.');
  }
  if (typeof def.id !== 'string' || def.id.length === 0) {
    throw new TypeError('ObjectTemplate: id must be a non-empty string.');
  }
  if (typeof def.displayName !== 'string' || def.displayName.length === 0) {
    throw new TypeError('ObjectTemplate: displayName must be a non-empty string.');
  }
  assertPositiveNumber(def.productionWidthMm, 'productionWidthMm');
  assertPositiveNumber(def.productionHeightMm, 'productionHeightMm');

  const inset = def.safeAreaInsetMm;
  if (!inset || typeof inset !== 'object') {
    throw new TypeError('ObjectTemplate: safeAreaInsetMm must be an object.');
  }
  for (const side of ['top', 'right', 'bottom', 'left']) {
    assertNonNegativeNumber(inset[side], `safeAreaInsetMm.${side}`);
  }
  if (inset.top + inset.bottom >= def.productionHeightMm) {
    throw new TypeError('ObjectTemplate: safeAreaInsetMm.top + bottom must leave a positive interior height.');
  }
  if (inset.left + inset.right >= def.productionWidthMm) {
    throw new TypeError('ObjectTemplate: safeAreaInsetMm.left + right must leave a positive interior width.');
  }

  const wrap = def.wrap;
  if (!wrap || typeof wrap !== 'object') {
    throw new TypeError('ObjectTemplate: wrap must be an object.');
  }
  if (!Array.isArray(wrap.supported) || wrap.supported.length === 0) {
    throw new TypeError('ObjectTemplate: wrap.supported must be a non-empty array.');
  }
  for (const mode of wrap.supported) {
    if (!WRAP_MODES.includes(mode)) {
      throw new TypeError(`ObjectTemplate: wrap.supported contains an unknown wrap mode: ${mode}`);
    }
  }
  if (!wrap.supported.includes(wrap.default)) {
    throw new TypeError('ObjectTemplate: wrap.default must be a member of wrap.supported.');
  }

  const preview = def.preview;
  if (!preview || typeof preview !== 'object') {
    throw new TypeError('ObjectTemplate: preview must be an object.');
  }
  if (!PREVIEW_KINDS.has(preview.kind)) {
    throw new TypeError(`ObjectTemplate: preview.kind must be one of ${[...PREVIEW_KINDS].join(', ')}.`);
  }
  assertPositiveNumber(preview.topWidthFactor, 'preview.topWidthFactor');
  assertPositiveNumber(preview.bottomWidthFactor, 'preview.bottomWidthFactor');
  assertPositiveNumber(preview.bodyHeightFactor, 'preview.bodyHeightFactor');
  if (typeof preview.hasHandle !== 'boolean') {
    throw new TypeError('ObjectTemplate: preview.hasHandle must be a boolean.');
  }
  if (preview.kind === 'bottle') {
    for (const field of ['neckWidthFactor', 'neckHeightFactor', 'shoulderHeightFactor', 'capHeightFactor']) {
      assertPositiveNumber(preview[field], `preview.${field}`);
    }
  }

  return Object.freeze({
    id: def.id,
    displayName: def.displayName,
    productionWidthMm: def.productionWidthMm,
    productionHeightMm: def.productionHeightMm,
    safeAreaInsetMm: Object.freeze({ ...inset }),
    wrap: Object.freeze({ supported: Object.freeze([...wrap.supported]), default: wrap.default }),
    preview: Object.freeze({ ...preview })
  });
}

/**
 * Derives the safe-area guide rectangle (mm, relative to canvas origin) for a template at a given
 * canvas size. Pure function, no rendering — callers (the app's editor overlay) turn this into a
 * drawn rectangle using whatever mm->px transform they already have.
 *
 * @param {object} template A record returned by createObjectTemplate()/getObjectTemplate().
 * @param {number} canvasWidthMm
 * @param {number} canvasHeightMm
 * @returns {{xMm:number,yMm:number,widthMm:number,heightMm:number}}
 */
export function getSafeAreaRectMm(template, canvasWidthMm, canvasHeightMm) {
  assertPositiveNumber(canvasWidthMm, 'canvasWidthMm');
  assertPositiveNumber(canvasHeightMm, 'canvasHeightMm');
  const { top, right, bottom, left } = template.safeAreaInsetMm;
  const widthMm = Math.max(0, canvasWidthMm - left - right);
  const heightMm = Math.max(0, canvasHeightMm - top - bottom);
  return { xMm: left, yMm: top, widthMm, heightMm };
}

export const DEFAULT_OBJECT_TEMPLATE_ID = 'mug';

const TEMPLATE_DEFINITIONS = [
  {
    id: 'mug',
    displayName: 'Mug',
    productionWidthMm: 210,
    productionHeightMm: 90,
    safeAreaInsetMm: { top: 10, right: 14, bottom: 10, left: 14 },
    wrap: { supported: WRAP_MODES, default: 'front' },
    preview: {
      kind: 'mug',
      topWidthFactor: 0.52,
      bottomWidthFactor: 0.43,
      bodyHeightFactor: 0.64,
      hasHandle: true
    }
  },
  {
    id: 'tumbler',
    displayName: 'Straight Tumbler',
    productionWidthMm: 230,
    productionHeightMm: 100,
    safeAreaInsetMm: { top: 8, right: 10, bottom: 8, left: 10 },
    wrap: { supported: WRAP_MODES, default: 'half' },
    preview: {
      kind: 'tumbler',
      // A straight tumbler's wall does not taper, unlike the mug's frustum — equal top/bottom
      // width is what makes the shared silhouette path draw a true cylinder.
      topWidthFactor: 0.40,
      bottomWidthFactor: 0.40,
      bodyHeightFactor: 0.78,
      hasHandle: false
    }
  },
  {
    id: 'bottle',
    displayName: 'Bottle',
    productionWidthMm: 180,
    productionHeightMm: 90,
    safeAreaInsetMm: { top: 14, right: 12, bottom: 14, left: 12 },
    wrap: { supported: WRAP_MODES, default: 'wide' },
    preview: {
      kind: 'bottle',
      topWidthFactor: 0.46,
      bottomWidthFactor: 0.46,
      bodyHeightFactor: 0.56,
      hasHandle: false,
      neckWidthFactor: 0.18,
      neckHeightFactor: 0.12,
      shoulderHeightFactor: 0.09,
      capHeightFactor: 0.06
    }
  }
];

const OBJECT_TEMPLATES = Object.freeze(
  Object.fromEntries(TEMPLATE_DEFINITIONS.map((def) => [def.id, createObjectTemplate(def)]))
);

export const OBJECT_TEMPLATE_IDS = Object.freeze(Object.keys(OBJECT_TEMPLATES));

export function isValidObjectTemplateId(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(OBJECT_TEMPLATES, id);
}

/**
 * @param {string} id
 * @returns {object} The template record for `id`, or the default ('mug') template if `id` is
 *   missing/unrecognized — matching this codebase's existing permissive fallback style for
 *   `project.product`/`project.wrap`/`project.cupColor` (never throws for unknown user data).
 */
export function getObjectTemplate(id) {
  return OBJECT_TEMPLATES[isValidObjectTemplateId(id) ? id : DEFAULT_OBJECT_TEMPLATE_ID];
}

export function listObjectTemplates() {
  return OBJECT_TEMPLATE_IDS.map((id) => OBJECT_TEMPLATES[id]);
}
