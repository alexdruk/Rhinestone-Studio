export {
  WRAP_MODES,
  DEFAULT_OBJECT_TEMPLATE_ID,
  OBJECT_TEMPLATE_IDS,
  createObjectTemplate,
  getObjectTemplate,
  getSafeAreaRectMm,
  isValidObjectTemplateId,
  listObjectTemplates
} from './ObjectTemplate.js';

// S-112: Round Dinner Plate product definition + design-target guide geometry. Kept as their own
// named exports (not folded into ObjectTemplate.js's own exports) since they are plate-specific,
// not part of the generic ObjectTemplate registry contract every other template also uses.
export {
  PLATE_ROUND_DINNER_DEFINITION,
  PLATE_DESIGN_TARGETS,
  DEFAULT_PLATE_DESIGN_TARGET,
  DEFAULT_PLATE_COLOR_ID,
  getPlateDimensionRange,
  clampPlateDimensionMm,
  getPlateDefaults,
  getPlateColorOptions,
  getPlateColor,
  isValidPlateDesignTarget,
  getPlateDesignTargetMeta,
  computeRimWidthMm,
  validatePlateDiameters,
  normalizePlateParams
} from './PlateProductDefinition.js';

export { getPlateDesignTargetGuide } from './PlateGuides.js';

// RS-2010: Standard Mug/Tumbler/Bottle physical product definitions. Kept as their own named
// exports (not folded into ObjectTemplate.js's own exports) for the same reason the plate exports
// above are separate -- these are vessel-specific, not part of the generic ObjectTemplate registry
// contract every other template also uses.
export {
  VESSEL_PRODUCT_IDS,
  isValidVesselProductId,
  getVesselDefinition,
  getVesselDimensionRange,
  clampVesselDimensionMm,
  computePrintableHeightMm,
  getVesselDefaults,
  normalizeVesselParams,
  deriveLegacyVesselParams,
  computeCanvasFromVessel
} from './VesselProductDefinition.js';
