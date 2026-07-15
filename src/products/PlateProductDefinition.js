/**
 * Round Dinner Plate product definition (S-112).
 *
 * The approved product-definition input (plate-round-dinner.json, kept verbatim under
 * src/products/definitions/) is the single source of truth for plate dimension ranges/defaults,
 * color options, and design-target metadata -- per docs/ARCHITECTURE.md's "Product Plugins"
 * principle, this module only turns that JSON into small, validated, plain-data helpers. It never
 * generates a StoneLayout and has no dependency on GeometryEngine/StoneLayout/the DOM/Three.js --
 * the same "pure data + validation" contract src/products/ObjectTemplate.js already follows.
 *
 * "Radial plate profile" (docs/specifications/S-112-RoundDinnerPlate.md) means: this module owns
 * the mm ranges/defaults; src/preview3d/ObjectDimensions.js turns a live set of plate mm params
 * into plain dimensions; src/preview3d/ObjectGeometryBuilder.js revolves those dimensions into a
 * THREE.LatheGeometry profile. Nothing here decides how the plate is rendered.
 */
import PLATE_ROUND_DINNER_DEFINITION from './definitions/plate-round-dinner.json' with { type: 'json' };

export { PLATE_ROUND_DINNER_DEFINITION };

// The one design-target id list this whole feature is built on -- matches the JSON's
// designTargets keys exactly. Order here is also display order (Center Well first == the default).
export const PLATE_DESIGN_TARGETS = Object.freeze(['centerWell', 'rimBand', 'fullTopSurface']);

export const DEFAULT_PLATE_DESIGN_TARGET = PLATE_ROUND_DINNER_DEFINITION.defaults.designTarget;
export const DEFAULT_PLATE_COLOR_ID = PLATE_ROUND_DINNER_DEFINITION.defaults.colorId;

function assertPositiveFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`PlateProductDefinition: ${label} must be a positive finite number.`);
  }
}

/**
 * @param {'outerDiameterMm'|'innerWellDiameterMm'|'overallHeightMm'|'centerDepthMm'|
 *   'footRingOuterDiameterMm'|'footRingHeightMm'} field
 * @returns {{description:string, min:number, average:number, max:number}} The JSON's own range
 *   record for that dimension, unmodified.
 */
export function getPlateDimensionRange(field) {
  const range = PLATE_ROUND_DINNER_DEFINITION.dimensions[field];
  if (!range) throw new TypeError(`PlateProductDefinition: unknown dimension field "${field}".`);
  return range;
}

/**
 * Clamps a candidate mm value into the JSON's [min, max] range for that dimension. Used both by
 * the UI (so a typed value never exceeds the approved modeling envelope) and by validateProject()'s
 * backward-compatible fallback for malformed/legacy project.plate data.
 *
 * @param {string} field
 * @param {number} value
 * @returns {number}
 */
export function clampPlateDimensionMm(field, value) {
  const { min, max } = getPlateDimensionRange(field);
  if (typeof value !== 'number' || !Number.isFinite(value)) return PLATE_ROUND_DINNER_DEFINITION.defaults[field];
  return Math.max(min, Math.min(max, value));
}

/**
 * @returns {{outerDiameterMm:number, innerWellDiameterMm:number, overallHeightMm:number,
 *   centerDepthMm:number, footRingOuterDiameterMm:number, footRingHeightMm:number,
 *   weightGrams:number, colorId:string, designTarget:string}} A fresh copy of the JSON's default
 *   plate params -- safe to mutate.
 */
export function getPlateDefaults() {
  const d = PLATE_ROUND_DINNER_DEFINITION.defaults;
  return {
    outerDiameterMm: d.outerDiameterMm,
    innerWellDiameterMm: d.innerWellDiameterMm,
    overallHeightMm: d.overallHeightMm,
    centerDepthMm: d.centerDepthMm,
    footRingOuterDiameterMm: d.footRingOuterDiameterMm,
    footRingHeightMm: d.footRingHeightMm,
    weightGrams: PLATE_ROUND_DINNER_DEFINITION.weightGrams.average,
    colorId: d.colorId,
    designTarget: d.designTarget
  };
}

/**
 * @returns {{id:string, name:string, hex:string}[]} Every selectable plate color, default first --
 *   exactly White then Creme, per the JSON's colors.default/colors.alternatives.
 */
export function getPlateColorOptions() {
  const { default: def, alternatives } = PLATE_ROUND_DINNER_DEFINITION.colors;
  return [def, ...alternatives].map((c) => ({ id: c.id, name: c.name, hex: c.hex }));
}

/**
 * @param {string} colorId
 * @returns {{id:string, name:string, hex:string}} The matching color record, or the default
 *   (White) color for any unknown/missing id -- matching this codebase's existing permissive
 *   fallback style for product/wrap/color ids (see src/products/ObjectTemplate.js's
 *   getObjectTemplate()).
 */
export function getPlateColor(colorId) {
  const options = getPlateColorOptions();
  return options.find((c) => c.id === colorId) || options[0];
}

/**
 * @param {string} designTarget
 * @returns {boolean}
 */
export function isValidPlateDesignTarget(designTarget) {
  return PLATE_DESIGN_TARGETS.includes(designTarget);
}

/**
 * @param {string} designTarget
 * @returns {object} The JSON's own designTargets[designTarget] record (name/shape/diameter
 *   source(s)/enabled), or the Center Well record for any unknown/missing id.
 */
export function getPlateDesignTargetMeta(designTarget) {
  const targets = PLATE_ROUND_DINNER_DEFINITION.designTargets;
  return targets[isValidPlateDesignTarget(designTarget) ? designTarget : DEFAULT_PLATE_DESIGN_TARGET];
}

/**
 * The one place rim width is computed -- never stored, always derived, so it is structurally
 * impossible for a saved/edited outer+inner diameter pair to disagree with a separately-stored rim
 * width (validation.requireDerivedRimWidthConsistency in the JSON).
 *
 * @param {number} outerDiameterMm
 * @param {number} innerWellDiameterMm
 * @returns {number} rimWidthMm = (outerDiameterMm - innerWellDiameterMm) / 2.
 */
export function computeRimWidthMm(outerDiameterMm, innerWellDiameterMm) {
  assertPositiveFiniteNumber(outerDiameterMm, 'outerDiameterMm');
  assertPositiveFiniteNumber(innerWellDiameterMm, 'innerWellDiameterMm');
  return (outerDiameterMm - innerWellDiameterMm) / 2;
}

/**
 * Validates that an outer/inner diameter pair is physically consistent
 * (validation.requireInnerWellSmallerThanOuterDiameter). Throws a specific TypeError describing the
 * problem; never mutates/clamps -- callers that need a safe fallback should clamp first via
 * clampPlateDimensionMm() and only then validate.
 *
 * @param {number} outerDiameterMm
 * @param {number} innerWellDiameterMm
 * @returns {number} The derived rimWidthMm, once validation passes.
 */
export function validatePlateDiameters(outerDiameterMm, innerWellDiameterMm) {
  assertPositiveFiniteNumber(outerDiameterMm, 'outerDiameterMm');
  assertPositiveFiniteNumber(innerWellDiameterMm, 'innerWellDiameterMm');
  if (innerWellDiameterMm >= outerDiameterMm) {
    throw new TypeError('PlateProductDefinition: innerWellDiameterMm must be smaller than outerDiameterMm.');
  }
  return computeRimWidthMm(outerDiameterMm, innerWellDiameterMm);
}

/**
 * Normalizes an arbitrary (possibly missing/malformed/legacy) plate params object into a complete,
 * physically-consistent set, using the JSON's own defaults for anything missing and clamping
 * anything out of range -- the one place project.plate's backward-compatible fallback logic lives,
 * consumed by both app.js's validateProject() and this module's own tests.
 *
 * @param {object|null|undefined} raw
 * @returns {{outerDiameterMm:number, innerWellDiameterMm:number, overallHeightMm:number,
 *   centerDepthMm:number, footRingOuterDiameterMm:number, footRingHeightMm:number,
 *   colorId:string, designTarget:string}}
 */
export function normalizePlateParams(raw) {
  const defaults = getPlateDefaults();
  const source = raw && typeof raw === 'object' ? raw : {};
  const outerDiameterMm = clampPlateDimensionMm('outerDiameterMm', source.outerDiameterMm ?? defaults.outerDiameterMm);
  let innerWellDiameterMm = clampPlateDimensionMm('innerWellDiameterMm', source.innerWellDiameterMm ?? defaults.innerWellDiameterMm);
  // requireInnerWellSmallerThanOuterDiameter: an inconsistent stored/imported pair falls back to
  // the JSON's own default ratio rather than throwing -- matching this codebase's permissive
  // legacy-data style (see app.js's validateProject()) instead of rejecting the whole project.
  if (innerWellDiameterMm >= outerDiameterMm) {
    innerWellDiameterMm = outerDiameterMm * (defaults.innerWellDiameterMm / defaults.outerDiameterMm);
  }
  return {
    outerDiameterMm,
    innerWellDiameterMm,
    overallHeightMm: clampPlateDimensionMm('overallHeightMm', source.overallHeightMm ?? defaults.overallHeightMm),
    centerDepthMm: clampPlateDimensionMm('centerDepthMm', source.centerDepthMm ?? defaults.centerDepthMm),
    footRingOuterDiameterMm: clampPlateDimensionMm('footRingOuterDiameterMm', source.footRingOuterDiameterMm ?? defaults.footRingOuterDiameterMm),
    footRingHeightMm: clampPlateDimensionMm('footRingHeightMm', source.footRingHeightMm ?? defaults.footRingHeightMm),
    colorId: getPlateColor(source.colorId).id,
    designTarget: isValidPlateDesignTarget(source.designTarget) ? source.designTarget : defaults.designTarget
  };
}
