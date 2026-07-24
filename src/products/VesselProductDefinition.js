/**
 * Standard vessel (mug/tumbler/bottle) physical product definitions -- RS-2010.
 *
 * Mirrors src/products/PlateProductDefinition.js's own contract exactly, parameterized by product
 * id instead of hard-coded to one product: the JSON definitions under src/products/definitions/
 * (vessel-standard-{mug,tumbler,bottle}.json) are the single source of truth for each product's
 * dimension ranges/defaults; this module only turns them into small, validated, plain-data helpers.
 * It never generates a StoneLayout and has no dependency on GeometryEngine/StoneLayout/the
 * DOM/Three.js -- the same "pure data + validation" contract every other src/products/** module
 * follows.
 *
 * Per docs/specifications/RS-2010-PhysicalProductDimensions.md: `printableHeightMm` is always
 * derived from bodyHeightMm and the product's own printableMarginMm (never independently authored
 * or user-edited), the same way PlateProductDefinition.js derives rimWidthMm from outer/inner
 * diameter -- structurally impossible for a stored value to disagree with the dimensions it comes
 * from.
 */
import MUG_DEFINITION from './definitions/vessel-standard-mug.json' with { type: 'json' };
import TUMBLER_DEFINITION from './definitions/vessel-standard-tumbler.json' with { type: 'json' };
import BOTTLE_DEFINITION from './definitions/vessel-standard-bottle.json' with { type: 'json' };

const VESSEL_DEFINITIONS = Object.freeze({
  mug: MUG_DEFINITION,
  tumbler: TUMBLER_DEFINITION,
  bottle: BOTTLE_DEFINITION
});

export const VESSEL_PRODUCT_IDS = Object.freeze(Object.keys(VESSEL_DEFINITIONS));

// A derived printable height is never allowed to collapse to zero/negative for a malformed or
// extreme-min bodyHeightMm -- mirrors the floor style of this codebase's other clamp helpers.
const MIN_PRINTABLE_HEIGHT_MM = 10;

function assertPositiveFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`VesselProductDefinition: ${label} must be a positive finite number.`);
  }
}

export function isValidVesselProductId(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(VESSEL_DEFINITIONS, id);
}

/**
 * @param {string} productId
 * @returns {object} The raw JSON definition for `productId`, or the mug's (default) definition for
 *   any unknown/missing id -- matching this codebase's existing permissive fallback style (see
 *   ObjectTemplate.js's getObjectTemplate()).
 */
export function getVesselDefinition(productId) {
  return VESSEL_DEFINITIONS[isValidVesselProductId(productId) ? productId : 'mug'];
}

/**
 * @param {string} productId
 * @param {'bodyDiameterMm'|'topDiameterMm'|'bodyHeightMm'} field
 * @returns {{description:string, min:number, average:number, max:number}}
 */
export function getVesselDimensionRange(productId, field) {
  const range = getVesselDefinition(productId).dimensions[field];
  if (!range) throw new TypeError(`VesselProductDefinition: unknown dimension field "${field}".`);
  return range;
}

/**
 * Clamps a candidate mm value into the JSON's [min, max] range for that product/dimension. Falls
 * back to that product's own default for a non-number/NaN input -- same style as
 * PlateProductDefinition.js's clampPlateDimensionMm().
 *
 * @param {string} productId
 * @param {string} field
 * @param {number} value
 * @returns {number}
 */
export function clampVesselDimensionMm(productId, field, value) {
  const { min, max } = getVesselDimensionRange(productId, field);
  if (typeof value !== 'number' || !Number.isFinite(value)) return getVesselDefinition(productId).defaults[field];
  return Math.max(min, Math.min(max, value));
}

/**
 * @param {string} productId
 * @param {number} bodyHeightMm
 * @returns {number} printableHeightMm = max(MIN_PRINTABLE_HEIGHT_MM, bodyHeightMm - printableMarginMm).
 */
export function computePrintableHeightMm(productId, bodyHeightMm) {
  assertPositiveFiniteNumber(bodyHeightMm, 'bodyHeightMm');
  const { printableMarginMm } = getVesselDefinition(productId);
  return Math.max(MIN_PRINTABLE_HEIGHT_MM, bodyHeightMm - printableMarginMm);
}

/**
 * @param {string} productId
 * @returns {{bodyDiameterMm:number, topDiameterMm:number, bodyHeightMm:number, printableHeightMm:number}}
 *   A fresh copy of the product's own default vessel params -- safe to mutate.
 */
export function getVesselDefaults(productId) {
  const d = getVesselDefinition(productId).defaults;
  return {
    bodyDiameterMm: d.bodyDiameterMm,
    topDiameterMm: d.topDiameterMm,
    bodyHeightMm: d.bodyHeightMm,
    printableHeightMm: computePrintableHeightMm(productId, d.bodyHeightMm)
  };
}

/**
 * Normalizes an arbitrary (possibly missing/malformed) vessel params object into a complete,
 * in-range set, using that product's own JSON defaults for anything missing and clamping anything
 * out of range -- the live-edit/new-project path (see deriveLegacyVesselParams() below for the
 * separate, unclamped, canvas-preserving legacy-load path).
 *
 * @param {string} productId
 * @param {object|null|undefined} raw
 * @returns {{bodyDiameterMm:number, topDiameterMm:number, bodyHeightMm:number, printableHeightMm:number}}
 */
export function normalizeVesselParams(productId, raw) {
  const defaults = getVesselDefaults(productId);
  const source = raw && typeof raw === 'object' ? raw : {};
  const bodyDiameterMm = clampVesselDimensionMm(productId, 'bodyDiameterMm', source.bodyDiameterMm ?? defaults.bodyDiameterMm);
  // Straight-wall products (tumbler, bottle body zone) force topDiameterMm === bodyDiameterMm
  // regardless of stored/imported input -- the defining trait of "no taper", not a user choice.
  const { requireTopDiameterEqualsBody } = getVesselDefinition(productId).validation;
  const topDiameterMm = requireTopDiameterEqualsBody
    ? bodyDiameterMm
    : clampVesselDimensionMm(productId, 'topDiameterMm', source.topDiameterMm ?? defaults.topDiameterMm);
  const bodyHeightMm = clampVesselDimensionMm(productId, 'bodyHeightMm', source.bodyHeightMm ?? defaults.bodyHeightMm);
  return {
    bodyDiameterMm,
    topDiameterMm,
    bodyHeightMm,
    printableHeightMm: computePrintableHeightMm(productId, bodyHeightMm)
  };
}

/**
 * Reverse-derives vessel params from a legacy (pre-RS-2010) project's existing canvas + object
 * template ratios, deliberately UNCLAMPED (only a positivity guard) -- an old project's implied
 * body diameter may legitimately fall outside the new commercial range (e.g. the old fixed mug
 * preset), and clamping here would misrepresent what the legacy project actually contains. Never
 * changes canvasWidthMm/canvasHeightMm itself; callers must not feed the result back through
 * computeCanvasFromVessel() during project load (see RS-2010-PhysicalProductDimensions.md, S4).
 *
 * @param {string} productId
 * @param {object} template An ObjectTemplate record (src/products/ObjectTemplate.js) for productId.
 * @param {number} canvasWidthMm
 * @param {number} canvasHeightMm
 * @returns {{bodyDiameterMm:number, topDiameterMm:number, bodyHeightMm:number, printableHeightMm:number}}
 */
export function deriveLegacyVesselParams(productId, template, canvasWidthMm, canvasHeightMm) {
  assertPositiveFiniteNumber(canvasWidthMm, 'canvasWidthMm');
  assertPositiveFiniteNumber(canvasHeightMm, 'canvasHeightMm');
  const bodyDiameterMm = canvasWidthMm / Math.PI;
  const { requireTopDiameterEqualsBody } = getVesselDefinition(productId).validation;
  const preview = template.preview;
  const topDiameterMm = requireTopDiameterEqualsBody
    ? bodyDiameterMm
    : bodyDiameterMm * (preview.topWidthFactor / preview.bottomWidthFactor);
  const printableHeightMm = canvasHeightMm;
  const { printableMarginMm } = getVesselDefinition(productId);
  return {
    bodyDiameterMm,
    topDiameterMm,
    bodyHeightMm: printableHeightMm + printableMarginMm,
    printableHeightMm
  };
}

/**
 * @param {{bodyDiameterMm:number, printableHeightMm:number}} vesselParams
 * @returns {{width:number, height:number}} The derived project.canvas size -- width is the
 *   printable circumference (π*bodyDiameterMm, consistent with
 *   src/preview3d/ObjectDimensions.js's computeBodyRadiusMm()/circumferenceMm() contract), height
 *   is the printable height. Only ever called for a *new* project or a live vessel-field edit --
 *   never during project load (see deriveLegacyVesselParams() above).
 */
export function computeCanvasFromVessel(vesselParams) {
  assertPositiveFiniteNumber(vesselParams?.bodyDiameterMm, 'vesselParams.bodyDiameterMm');
  assertPositiveFiniteNumber(vesselParams?.printableHeightMm, 'vesselParams.printableHeightMm');
  return {
    width: Math.PI * vesselParams.bodyDiameterMm,
    height: vesselParams.printableHeightMm
  };
}
