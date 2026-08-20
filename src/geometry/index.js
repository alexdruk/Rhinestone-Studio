export {
  GeometryEngine,
  createGeometryEngine,
  TEXT_SCALE_FAILURE_REASONS,
  AUTHORED_FONT_FITTING_GAP_MM,
  computeNaturalContourTransform,
  applyNaturalContourTransform
} from './GeometryEngine.js';

export {
  Stone,
  DEFAULT_STONE_COLOR
} from './Stone.js';

export {
  StoneLayout,
  findOverlappingStonePairs
} from './StoneLayout.js';

export {
  flattenContourToPolygon,
  flattenContourToPolygonWithCornerFlags,
  translateContour,
  detectPolygonCornerFlags,
  CURVE_FLATTEN_SEGMENTS
} from './ContourGeometry.js';

export {
  sampleOutlinePoints,
  sampleFillPoints,
  sampleFieldFillPoints,
  isPointInsidePolygons,
  sampleStaggeredFillPoints,
  sampleStaggeredFieldFillPoints,
  sampleRadialFillPoints,
  sampleRadialFieldFillPoints,
  sampleContourFillPoints,
  sampleContourFieldFillPoints,
  sampleShapeFillPoints,
  sampleFieldByMode,
  dedupeStonePoints,
  dedupeStonesByRadius,
  findCrossGroupCollisions
} from './StoneSampler.js';

export {
  computeInwardRingPolygons,
  ContourFillPrecisionError
} from './ContourRingSampler.js';

export {
  projectPointToArc,
  projectPolygonToArc,
  CURVE_DIRECTIONS,
  CURVE_ALIGNMENTS
} from './ArcProjection.js';

export {
  combineShapeSources,
  combineManyShapeSources,
  BOOLEAN_OPERATIONS,
  BooleanPrecisionError,
  MIN_CELL_SIZE_MM,
  contourAreaAbs
} from './PathBoolean.js';

export {
  SHAPE_LIBRARY_KINDS,
  createShapeNaturalContours
} from './ShapeLibrary.js';

export {
  FITTABLE_SHAPE_TYPES,
  computeInscribedRect,
  computeShapeFitScale,
  computeContainingShapeScale
} from './ShapeFit.js';

export {
  listFrames,
  getFrameDefinition,
  resolveGenerationContours,
  resolveInnerFittingContours,
  computeFrameInterior,
  computeFrameFitRect
} from './FrameLibrary.js';

export {
  selectPaintTarget,
  absolutePolygonsToNaturalSpace,
  hitTestPathLayerRegion
} from './PaintRegionSelection.js';
