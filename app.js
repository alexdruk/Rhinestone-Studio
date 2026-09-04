// Live browser application entry point. Loaded by index.html as
// `<script type="module" src="./app.js">`. Owns application state, UI event
// wiring, the legacy inline GeometryEngine (now a thin bridge to the
// permanent engine), and drag/selection UI. 2D/cup rendering and SVG export
// live in the permanent src/renderer/** and src/export/** modules.
// Migrated from the previous inline <script> block in index.html (RS-0003.5B1).
// RS-0003.5B2 added the browser dependency probe proving the permanent
// module graph resolves. RS-0003.5B3 wired the permanent GeometryEngine,
// the OpenType-backed font provider (via FontProviderRegistry), and
// FontManager into live text-layer generation. RS-0003.5C1 wired circle and
// rectangle layers to the same permanent GeometryEngine via
// generateShapeLayout(), so text and shapes now share one Geometry Engine and
// one StoneLayout/Stone product. RS-0003.5C2 extracted the 2D canvas
// renderer, cup renderer, and SVG exporter into src/renderer/** and
// src/export/** modules that consume only StoneLayout; app.js's generate()
// now returns a real StoneLayout (merged across layers) instead of an ad hoc
// plain object, and app.js itself keeps only the layer-aware editor overlay
// (selection outline/handles, grid transform reuse, HUD text, drag/resize
// UI). app.js only ever talks to the geometry/fonts/text/renderer/export
// barrel modules, never the provider class directly, keeping the module
// boundaries from docs/ARCHITECTURE.md intact. RS-0003.5D1 added a Project
// JSON import path (validated against the same ad hoc project/layer shape
// #exportProject already produces) and guarded every export button handler
// against a not-yet-ready layout / a thrown exporter error, so export
// failures surface a specific #status message instead of an uncaught
// exception. See docs/specifications/RS-0003.5D1-ProductionExportValidation.md. RS-1001 added SVG
// import: an 'svg' layer type reusing the same generic x/y/w/h shape-editing UI/drag/resize code
// rectangle already uses, generated via the permanent engine's generateSvgLayout(). src/svg/**
// parses the SVG; app.js never parses SVG geometry itself, it only calls parseSvgDocument() once
// at import time to validate/measure. See docs/specifications/RS-1001-SvgImport.md. RS-1002 added
// unlimited (configurably bounded) undo/redo via src/history/HistoryManager.js: every editing
// action commits a `{project,selectedLayerId}` JSON snapshot (never generated geometry) before
// mutating; continuous controls coalesce one undo step per edit session instead of one per input
// event. See docs/specifications/RS-1002-UndoRedo.md. RS-1003 added curved text: six new per-text-
// layer fields (curveEnabled/curveRadiusMm/curveDirection/curveStartAngleDeg/curveSweepAngleDeg/
// curveAlignment) passed straight through to the permanent engine's generateTextLayout(), which now
// arc-projects glyph geometry via the new src/geometry/ArcProjection.js before stone sampling.
// app.js only forwards the six fields; it generates no stones itself. See
// docs/specifications/RS-1003-CurvedText.md. RS-1004 activated the previously-inert
// src/products/** module and project.product field: an "Object type" control lets the user switch
// the active ObjectTemplate (mug/tumbler/bottle), which resets project.canvas/project.wrap to that
// template's defaults and is forwarded to renderCup() as a plain `objectTemplate` display option —
// exactly like cupColor/wrap already are, not a new geometry concept. GeometryEngine/StoneLayout
// are untouched; only the schematic preview silhouette and a new safe-area editor-overlay guide
// (drawn here, not inside CanvasRenderer2D.js) vary by object type. See
// docs/specifications/RS-1004-MultiObjectTemplates.md. RS-1005 added the Production Sheet export
// (SVG/PNG/PDF): a new src/export/ProductionSheetExporter.js consumes the same merged StoneLayout
// (plus plain metadata: project.name, the active object template's displayName, project.canvas,
// and the visible layers' gap values) to produce a one-page, mm-accurate manufacturing document.
// PNG export has no new src/export/** module -- it rasterizes the generated SVG via an offscreen
// Image+canvas at a fixed DPI, the same "capture, not a standalone exporter" shape #exportPNG/
// #exportCup already use. Page size/margin/mirror/registration-marks are view/export-only options
// (like rotation/zoom), read live from their controls at export-click time, not part of `project`.
// project.name is the one new project-level field, following the exact permissive-default pattern
// cupColor/wrap/product already use. See docs/specifications/RS-1005-ProductionSheetGenerator.md.
// RS-1006 replaced the Object Preview panel's fake 2D schematic (CupRenderer.js) with a real,
// interactive Three.js 3D preview: src/preview3d/** consumes the same merged StoneLayout plus the
// same category of plain display options (cupColor/wrap/objectTemplate) CupRenderer.js already
// took, plus the live project.canvas mm size (needed so the mesh and its canvas texture share one
// real millimeter scale). drawCup() is the only changed call site; CupRenderer.js itself is
// untouched and still covered by its own pre-existing tests, simply no longer imported here. The
// old custom pointer-drag-to-rotate handler on #cup is removed -- OrbitControls (inside
// src/preview3d/Preview3DRenderer.js) now owns pointer interaction on that canvas natively, and
// does strictly more (rotate, zoom, and pan, with damping). See
// docs/specifications/RS-1006-Real3DPreview.md. RS-1007 replaced the 7-color hard-coded palette
// with a permanent 17-color crystal catalog (src/renderer/CrystalColors.js, re-exported unchanged
// as STONE_COLORS from src/renderer/StoneColors.js -- this import line is unchanged). #stoneColor
// is now populated at startup from STONE_COLORS (grouped into <optgroup>s by each color's `group`
// field) instead of index.html's previous hardcoded 7 <option>s, and a live swatch next to it
// shows the selected color's previewColor. No renderer/exporter file changed -- every consumer
// already resolved colors generically through STONE_COLORS[stone.color]. RS-1008 added Image
// Trace: an 'image' layer type reusing the same generic x/y/w/h shape-editing UI/drag/resize code
// rectangle/svg already use. src/image/** (a new peer pipeline module, parallel to src/svg/**)
// prepares image-derived input only (grayscale/threshold/invert/blur/resize -> a neutral density
// field); the permanent GeometryEngine.generateImageLayout() (src/geometry/GeometryEngine.js) is
// the only place that turns that field into Stone/StoneLayout, exactly like generateSvgLayout()
// is the only caller that turns parseSvgDocument()'s output into stones. (RS-1008A architecture
// correction: the original RS-1008 design had src/image/** construct Stone/StoneLayout directly, a
// second stone-generating implementation -- see
// docs/specifications/RS-1008A-ImageTraceArchitectureCorrection.md.) app.js never decodes or
// processes image pixels itself: decodeImageFileToBuffer()/readFileAsDataUrl() (browser-only) run
// once at import time (from the new "Import Image..." preview-before-commit panel), and
// generateImageStonesLive() below calls the permanent engine on every regeneration from the cached
// decoded buffer (imageBufferCache, keyed by the layer's persisted imageSrc data: URL) -- the pure
// pipeline stages re-run on every threshold/invert/blur/resize edit, but the (comparatively
// expensive) browser image decode only ever runs once per distinct imageSrc value.
import './src/browser/BrowserDependencyProbe.js';
import { GeometryEngine as PermanentGeometryEngine, Stone, StoneLayout, combineManyShapeSources, combineShapeSources, BooleanPrecisionError, contourAreaAbs, MIN_CELL_SIZE_MM, SHAPE_LIBRARY_KINDS, FITTABLE_SHAPE_TYPES, computeInscribedRect, computeShapeFitScale, computeContainingShapeScale, dedupeStonesByRadius, listFrames, selectPaintTarget, absolutePolygonsToNaturalSpace, hitTestPathLayerRegion, computeNaturalContourTransform, applyNaturalContourTransform, isPointInsidePolygons, findOverlappingStonePairs, hasAnyOverlappingStonePair, measureStoneCrowding, solveLetterSpacingMm, TRACKING_XPITCH_LADDER } from './src/geometry/index.js';
import { FontManager } from './src/fonts/index.js';
import { createDefaultFontProviderRegistry, createDefaultRhinestoneFontRegistry, BoundingBox, strokeNarrowerThanOneStone } from './src/text/index.js';
import { renderProductionLayout, renderStoneLayout, fitTransform, chooseNiceStepMm } from './src/renderer/CanvasRenderer2D.js';
import { createPreview3D } from './src/preview3d/index.js';
import { circumferenceMm, frontViewFrameWidthMm, canvasXMmForRotationDeg, rotationDegForCanvasXMm, azimuthRadForCanvasXMm, wrapAngleRad } from './src/preview3d/ObjectDimensions.js';
import { STONE_COLORS } from './src/renderer/StoneColors.js';
import { listStoneSizes, findStoneSizeByDiameterMm, formatStoneSizeLabel, stoneSizeHeightMidpointMm, isHeightWithinStoneSizeRange, stoneSizeEntirelyExceedsPrintableHeight } from './src/renderer/StoneSizes.js';
import { stoneLayoutToSvg } from './src/export/SvgExporter.js';
import { computeProductionSheetLayout, productionSheetToSvg, productionSheetToPdf } from './src/export/ProductionSheetExporter.js';
import { parseSvgDocument } from './src/svg/index.js';
import { HistoryManager } from './src/history/index.js';
import { getObjectTemplate, getSafeAreaRectMm, getPlateDefaults, getPlateColorOptions, getPlateColor, normalizePlateParams, computeRimWidthMm, getPlateDesignTargetGuide, getPlateDesignTargetMeta, PLATE_ROUND_DINNER_DEFINITION, VESSEL_PRODUCT_IDS, getVesselDefaults, getVesselDimensionRange, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel } from './src/products/index.js';
import { prepareImageField, maskFieldToRgba, decodeImageFileToBuffer, decodeDataUrlToBuffer, readFileAsDataUrl, isSupportedImageFile } from './src/image/index.js';
// RS-1009 (Alignment & Snapping): src/editing/** is a new, pure, DOM-free module -- multi-select,
// align/distribute, and drag/keyboard snapping math over layer bounding boxes in mm. It has no
// dependency on src/geometry/**/StoneLayout/Stone and never generates stone positions itself;
// app.js is the only caller, and is the only place that knows a given layer's position field
// names (cx/cy vs x/y) via the new getLayerPosition()/setLayerPosition() helpers below. See
// docs/specifications/RS-1009-AlignmentSnapping.md.
import { SNAP_TOLERANCE_MM, NUDGE_STEP_MM, NUDGE_STEP_LARGE_MM, alignLayers, distributeLayers, buildSnapTargets, computeSnapOffset, selectOnly, toggleSelection, clearSelection, selectMany, computeTextPlacementOffsetMm, computeTextLayerPositionForTargetCenterMm } from './src/editing/index.js';
// UI-001 (Complete Application Redesign): src/ui/** is a new, pure, DOM-only module -- a generic
// Lightbox/dialog controller (open/close, focus trap, Escape, backdrop click). It has no knowledge
// of Project/Layer/StoneLayout/layer type; app.js is the only caller, and is the only place that
// wires a Lightbox to a top-menu button or a layer-aware "which fields to show" decision. See
// docs/specifications/UI-001-CompleteRedesign.md.
import { Lightbox, el, parseIntOr, download, exportCanvas, syncShippingFieldsFromState, wireShippingApply } from './src/ui/index.js';
import { mmToDisplayValue, displayValueToMm, unitSuffix, formatLengthDisplay } from './src/units/index.js';
// MONO-006 (Monogram Generator UI): the Monogram Lightbox is a plain front-end -- it never
// generates geometry, computes layouts, fits, or detects collisions itself. All of that is
// delegated to MonogramGenerator.generate() (MONO-005/MONO-005A), which returns ordinary project
// layers inserted through the same commitHistory()+project.layers.push() pattern
// insertLibraryItem() already uses, so undo/redo treats a generated monogram as one step. Frame
// choices come from FrameLibrary.listFrames() (imported below alongside the geometry barrel);
// layout ids/required letter counts come from MonogramLayouts.js. Both are imported through a new
// src/monogram/index.js barrel this milestone adds (src/monogram/** had none before -- only test
// files imported it directly; app.js may only import permanent modules through a src/*/index.js
// barrel, see tools/test-architecture-module-boundaries.mjs).
import { MonogramGenerator, MONOGRAM_GENERATOR_FAILURE_REASONS, MONOGRAM_LAYOUTS, MONOGRAM_LAYOUT_LETTER_COUNTS } from './src/monogram/index.js';
// RC-005 (Autosave & Crash Recovery): src/persistence/** is a new, pure, DOM-free module -- mirrors
// src/library/**'s exact "storage-adapter injected, browser-global only at app.js's edge" shape.
// It knows nothing about Project/Layer/StoneLayout; app.js is the only caller, and is the only
// place that decides *when* a meaningful edit happened (debounced below) or touches localStorage
// (via createAutosaveLocalStorageAdapter).
import { AutosaveManager, createLocalStorageAdapter as createAutosaveLocalStorageAdapter, createMemoryStorageAdapter as createAutosaveMemoryStorageAdapter } from './src/persistence/index.js';
import { validateRhsProject, toAppProjectShape, parseCatalog, search as searchGalleryCatalog, filterByCategory as filterGalleryCategory, categories as galleryCategories, featuredEntries as galleryFeaturedEntries, getEntry as getGalleryEntry } from './src/gallery/index.js';
// RS-3010 Step 1 (Drawing Board): src/drawing/** confines all direct Paper.js usage the same way
// src/preview3d/** confines Three.js -- app.js only ever calls the facade createDrawingTool()
// returns, never `paper` itself.
import { createDrawingTool, FLATTEN_TOLERANCE_MM, flattenPathToContours, createPathLayerFromContours, importSvgIntoItem } from './src/drawing/index.js';
// RS-1012 (Vector Boolean Operations): Union/Subtract/Intersect/Exclude over the current
// multi-selection (the same selectedLayerIds set RS-1009's Align/Snap already uses). No new
// geometry algorithm lives in app.js: resolveLayerShapeSource() below only asks the permanent
// engine for each selected layer's already-placed vector outline (resolveShapePolygons()/
// resolveSvgPolygons()/resolveTextPolygons()/resolvePathPolygons(), each new methods on
// GeometryEngine that share their polygon-building code with the pre-existing generate*Layout()
// stone methods -- see src/geometry/GeometryEngine.js) or, for an 'image' (Image Trace) layer, its
// raster density field directly (src/image/**'s existing prepareImageField(), unchanged); the new
// src/geometry/PathBoolean.js combines those sources and traces the result back into vector
// contours. The combined result becomes a new 'path' layer -- a generic compound-vector-shape layer
// type reusing the exact generic x/y/w/h placement-box editing (move/resize/duplicate/align/snap)
// rectangle/svg/image layers already share, and generated into stones by the permanent engine's new
// generatePathLayout(), the same "place a natural-size shape into an x/y/w/h box, then outline/fill
// sample it" shape generateSvgLayout() already uses. The source layers are removed only after the
// operation succeeds; a boolean op that cannot run (fewer than 2 layers selected, a selected layer
// with no closed vector outline, or a result with no area) fails with a specific #status /
// #booleanOpsValidation message and leaves `project` untouched. See
// docs/specifications/RS-1012-VectorBooleanOperations.md. RS-2002 (Typography & Font Library)
// expanded the bundled font manifest from 3 registry entries (2 enabled) to 10 (9 enabled),
// organized into categories (script/serif/sans-serif/display/monogram/decorative/block/
// handwritten/monospace, stored in each font's existing `role` field), and replaced the
// hardcoded TEXT_ENGINE_FONT_IDS Set below with one derived from fontManager.listFonts() once the
// manifest loads -- previously every new bundled font needed a matching app.js edit here, the exact
// "second font list" duplication docs/specifications/RS-2000A-PostMVPAudit.md flagged, and the
// manifest's `enabled` flag gated nothing real. The #font <select> (inside the Text Lightbox) is
// now populated at startup from the same fontManager.listFonts() call, grouped into <optgroup>s and
// sorted alphabetically within each group (mirroring populateStoneColorOptions()'s existing
// pattern), and a new "Browse Fonts" panel next to it adds search and favorites over the identical
// list -- both write to the same #font control, so history/save/load/export are untouched. No new
// font-management system: FontManager/the text-engine font provider/GeometryEngine are the only things that ever
// turn a fontId into stone geometry; the panel only decides which fontId to write into #font.
'use strict';
// FONT-002: RS Block (an authored Production Font) is the default -- Courier Prime remains fully
// registered/enabled (existing projects load unchanged) but is no longer offered as the default pick.
const DEFAULT_TEXT_FONT_ID='rs-block';
// RS-2002: seeded with just the default font id so text still renders if the manifest fails to
// load (see permanentEngineError below); reassigned from the live manifest immediately after
// fontManager loads successfully.
let TEXT_ENGINE_FONT_IDS=new Set([DEFAULT_TEXT_FONT_ID]);
// RS-0003.5D2: named UI-interaction constants (previously no explicit zoom clamp). ZOOM_MIN/
// ZOOM_MAX mirror the #zoom range input's min="70"/max="140" (percent) and defensively clamp zoom
// in case an out-of-range or non-finite value ever reaches it. RS-1006 removed the sibling
// CUP_ROTATION_SENSITIVITY constant along with the custom pointer-drag-to-rotate handler it drove —
// OrbitControls (src/preview3d/**) now owns pointer interaction on the cup canvas natively.
const ZOOM_MIN=0.7,ZOOM_MAX=1.4;
// RS-3017: target on-screen width (CSS px) for the scale bar's reference length -- fed into
// chooseNiceStepMm's 'atMost' mode so the bar picks the largest nice mm step that still fits.
const SCALE_BAR_TARGET_PX=100;
// S-001: how close `rotation` must be to a .viewBtn's data-view (in degrees, mod 360, so -180 and
// 180 both match Back) for that button to show as the active/highlighted view.
const VIEW_ANGLE_EPSILON_DEG=0.5;
// RS-1002: bounds HistoryManager's undo/redo depth. Undo/redo is otherwise unlimited -- normal
// editing sessions never come close to 100 steps -- this only caps worst-case memory use.
const HISTORY_MAX_SIZE=100;
// RS-1009: arrow key -> unit direction vector (mm), scaled by NUDGE_STEP_MM/NUDGE_STEP_LARGE_MM
// (src/editing/EditingConstants.js) at keydown time depending on Shift.
const ARROW_KEY_DELTAS={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
// RS-3010 Design Step B: single-letter drawing-tool shortcuts, matching the rail buttons'
// setDrawTool() modes exactly -- V/R/E/S mirror this app's own tool labels; B=Draw follows
// Photoshop's Brush convention (more recognizable than an arbitrary "D"); G=Polygon leaves P free
// for RS-3011 Step 9's Pen tool (Illustrator/Figma's near-universal "Pen" binding), per Sasha's own
// roadmap for this rail. RS-3011 Step 10b: F=Paint (confirmed free elsewhere in the global keydown
// handler below) -- Photoshop/GIMP's own Fill/Bucket-adjacent mnemonic, close enough to read
// naturally alongside B=Draw/Brush. RS-3011 Step 12: M=Stamp (confirmed free elsewhere in the global
// keydown handler below) -- every other single-letter mnemonic close to "stamp" (S) is already taken
// by Slot, so M stands in for the tool's rubber-stamp "Mark a point" action instead. RS-3011 Step 11:
// T=Trace (confirmed free elsewhere in the global keydown handler below) -- V/B/R/E/S/G/P/F/M are
// all already taken, and T is the natural mnemonic for "Trace" itself. RS-3011 Step 13: X=Eraser
// (confirmed free elsewhere in the global keydown handler below) -- V/B/R/E/S/G/P/F/M/T are all
// already taken, X reads as a "cross out/remove" mnemonic.
// RS-3013 Step 1: L=Lasso (confirmed free elsewhere in the global keydown handler below) --
// V/B/R/E/S/G/P/F/M/T/X are all already taken, L is the natural mnemonic for "Lasso" itself.
const DRAW_TOOL_SHORTCUT_KEYS={v:'select',l:'lasso',b:'freehand',r:'rect',e:'ellipse',s:'slot',g:'polygon',p:'pen',f:'paint',m:'stamp',t:'trace',x:'eraser'};
// RS-1005: pixels-per-mm used only when rasterizing the Production Sheet SVG to PNG. Fixed and
// documented (not derived from devicePixelRatio/viewport fit) so the PNG's pixel dimensions are
// always a clean, undistorted multiple of the page's mm size -- never a fit-to-viewport scale.
const PRODUCTION_SHEET_PNG_DPI=200;
// RS-1008: defaults for a freshly-imported image layer's Threshold/Maximum width/Maximum height
// controls (the preview panel and the committed layer both start here). 400px is a deliberate
// middle ground between trace fidelity and staying comfortably inside the "avoid freezing the UI"
// performance target for the documented up-to-2000x2000px source size.
const DEFAULT_IMAGE_THRESHOLD=128;
const DEFAULT_IMAGE_MAX_DIMENSION_PX=400;
// RS-1008: caches the one (comparatively expensive) browser image decode per distinct imageSrc
// data: URL, so every subsequent threshold/invert/blur/resize edit, undo/redo, or duplicate only
// re-runs the pure/fast pixel-processing stages, not the decode itself. Grows for the life of the
// page session (no eviction) -- acceptable at this milestone's scope, see
// docs/specifications/RS-1008-ImageTrace.md, "Out of Scope".
const imageBufferCache=new Map();
// RS-0003.5D2: resolves a <select>'s value by nearest numeric match instead of an exact string
// match. Fixes the #stoneSize dropdown showing blank on load: a layer's stoneSize is a plain JS
// number (e.g. 2), but String(2)==='2' matches no <option> (index.html's options are formatted
// like "2.0"), so the browser rendered no selection even though the underlying mm value was
// valid. Never mutates the numeric value itself, only the displayed selection.
function setNumericSelectValue(select,num){let best=null,bestDiff=Infinity;for(const opt of select.options){const v=parseFloat(opt.value);if(Number.isFinite(v)){const diff=Math.abs(v-num);if(diff<bestDiff){bestDiff=diff;best=opt.value}}}select.value=best!==null?best:String(num)}
// RS-1007: builds the Stone color <optgroup>s from STONE_COLORS (17 entries) grouped by each
// color's `group` field, in catalog order (Object.values() preserves insertion order for the
// string keys STONE_COLORS is built from). Called once at startup for #stoneColor, and again
// (RS-3014 Step 1) for each of Stamp/Trace/Paint's own #stampColor/#traceColor/#paintColor selects
// -- targetId defaults to 'stoneColor' so every pre-existing call site is unaffected.
function populateStoneColorOptions(targetId='stoneColor'){const groups=new Map();for(const c of Object.values(STONE_COLORS)){if(!groups.has(c.group))groups.set(c.group,[]);groups.get(c.group).push(c)}el(targetId).innerHTML=[...groups.entries()].map(([group,colors])=>`<optgroup label="${escapeHtml(group)}">${colors.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</optgroup>`).join('')}
// RS-1013: builds the #stoneSize <option> list from the Stone Library (src/renderer/StoneSizes.js)
// -- each option's value is the size's plain millimeter diameter (the same raw number a layer's
// stoneSize / a Stone's sizeMm has always been; see src/geometry/GeometryEngine.js's stoneSizeMm
// params), so reading the control back (`parseFloat(el('stoneSize').value)`, unchanged below) needs
// no new mapping step. Label shows both the commercial name and the mm value per this milestone's
// "display both" requirement. Called once at startup, mirroring populateStoneColorOptions() --
// index.html hardcodes no <option> for this select either, so adding a size later is one catalog
// entry, never an index.html/app.js change.
function populateStoneSizeOptions(){el('stoneSize').innerHTML=listStoneSizes().map(s=>`<option value="${s.diameterMm}">${escapeHtml(s.name)} — ${s.diameterMm.toFixed(1)} mm</option>`).join('')}
// RS-1013: a layer's stoneSize can be a value the Stone Library doesn't name -- a pre-existing
// project saved before this milestone (the old dropdown offered 0.8-3.0mm raw values with no
// catalog behind them), a value produced by undo/redo history, or simply a size a user typed
// before this milestone existed. Rather than silently snapping the dropdown's displayed selection
// to the nearest *different* catalog size (which would misrepresent the layer's real, unchanged
// stoneSizeMm -- a "preserve existing project compatibility" violation), this injects/updates one
// trailing "Custom" option holding the exact value, so the control always has a truthful option to
// select. Removes any previous synthetic "Custom" option first, so switching a layer back to a
// catalog size (or between two custom layers) never accumulates stale entries.
function ensureStoneSizeOption(select,diameterMm){
  const existing=select.querySelector('option[data-custom="1"]');
  if(existing)existing.remove();
  const catalogMatch=findStoneSizeByDiameterMm(diameterMm);
  if(catalogMatch)return;
  const opt=document.createElement('option');
  opt.value=String(diameterMm);opt.dataset.custom='1';
  opt.textContent=`Custom — ${(Math.round(diameterMm*100)/100)} mm`;
  select.appendChild(opt);
}
// RS-1007: keeps the small swatch next to #stoneColor showing the currently selected color's
// actual previewColor. Called from updateStats() (itself called at the end of every updateAll()),
// so the swatch always reflects the live selection after an edit, undo/redo, or import.
function updateStoneColorSwatch(){const c=STONE_COLORS[el('stoneColor').value];el('stoneColorSwatch').style.background=c?c.previewColor:'transparent'}
// RS-2002 (Typography & Font Library) -- everything below builds the font picker on top of the
// same fontManager.listFonts() call used to derive TEXT_ENGINE_FONT_IDS above. No font data lives
// in app.js: category is font.role, family is font.family, both straight from the manifest.
const FONT_CATEGORY_LABELS={script:'Script','sans-serif':'Sans Serif',serif:'Serif',display:'Display',monogram:'Monogram',decorative:'Decorative',block:'Block',handwritten:'Handwritten',monospace:'Monospace',rhinestone:'Production Fonts','rounded-sans':'Rounded Sans'};
function fontCategoryLabel(role){return FONT_CATEGORY_LABELS[role]||(role?role.charAt(0).toUpperCase()+role.slice(1):'Other')}
function groupFontsByCategory(fonts){const groups=new Map();for(const f of fonts){const key=f.role||'display';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f)}for(const list of groups.values())list.sort((a,b)=>a.family.localeCompare(b.family)||(a.weight||400)-(b.weight||400)||a.style.localeCompare(b.style));return[...groups.entries()].sort((a,b)=>fontCategoryLabel(a[0]).localeCompare(fontCategoryLabel(b[0])))}
// A font family name safe to drop into a CSS font-family value / HTML style attribute. Every
// bundled family name is plain ASCII with no quotes (see assets/fonts/manifest.json), but this
// strips quote characters defensively rather than assuming that stays true forever.
function cssFontFamily(family){return String(family).replace(/["'\\]/g,'')}
// Registers one @font-face per enabled font so both the #font <select>'s options and the Browse
// Fonts panel's rows can render live visual previews in the font's own typeface. Declaring
// @font-face does not itself download anything -- browsers fetch a given font file lazily, only
// once an actually-rendered (not display:none) element needs to paint text in that font-family, so
// this costs nothing until an option list is opened or a preview row is on-screen.
// TXT-101A: only OpenType-backed fonts have a real font file to declare -- rs-*-regular's `path` is
// a documentation-only identifier (see assets/fonts/manifest.json's notes), never an actual font
// resource, so declaring an @font-face for it would just be a silently-failing 404 fetch for no
// benefit (their Browse Fonts panel row renders a real rhinestone-layout preview instead, not a
// CSS-styled text preview -- see populateFontPreviewCanvases()).
function injectFontFaceRules(fonts){const style=document.createElement('style');style.textContent=fonts.filter(f=>f.providerId==='opentype').map(f=>`@font-face{font-family:"${cssFontFamily(f.family)}";src:url("${f.path}") format("truetype");font-display:swap;}`).join('\n');document.head.appendChild(style)}
// Builds the #fontCategoryFilter <select>'s options from the same category grouping
// populateFontOptions()/renderFontLibraryList() already use, so "category filter" never drifts
// from what the panel's own group headers show.
function populateFontCategoryFilterOptions(){if(!fontManager)return;const categories=groupFontsByCategory(productionFonts()).map(([role])=>role);el('fontCategoryFilter').innerHTML='<option value="">All categories</option>'+categories.map(role=>`<option value="${role}">${escapeHtml(fontCategoryLabel(role))}</option>`).join('')}
// Builds the #font <select>'s <optgroup>s from the live manifest, grouped by category and sorted
// alphabetically within each group -- mirrors populateStoneColorOptions()'s existing pattern.
// Disabled fonts (just the RobotoMono placeholder today) are never listed, matching
// TEXT_ENGINE_FONT_IDS above.
// FONT-002 originally offered only the authored Production Fonts (providerId 'rhinestone');
// FONT-DECISION-001 additionally let an OpenType font in once it carried `rhinestoneValidated:true`.
// FONT-LIB-002 opens the gate fully: the picker now offers every font with `enabled:true` in the
// manifest (plus the authored providerId:'rhinestone' fonts, which are enabled too). FONT-DECISION-001
// already established that an untransformed OpenType font is the production approach, so any enabled
// OpenType font is a legitimate pick. `rhinestoneValidated` is kept but demoted to a display-only
// signal -- it drives the library row's ✓ "Rated legible" badge, nothing more. `unsupportedStoneSizes`
// still drives per-font stone-size gating (updateStoneSizePrintableCapabilityUI()), unchanged.
// Disabled records (just the RobotoMono placeholder today) are still never listed -- listFonts()
// filters them out. A layer already using a disabled/unknown font is handled by
// ensureFontOptionForLayer(), not by listing it here.
function productionFonts(){return fontManager?fontManager.listFonts().filter(f=>f.providerId==='rhinestone'||f.enabled===true):[]}
function populateFontOptions(){if(!fontManager)return;el('font').innerHTML=groupFontsByCategory(productionFonts()).map(([role,fonts])=>`<optgroup label="${escapeHtml(fontCategoryLabel(role))}">${fonts.map(f=>`<option value="${f.id}" style="font-family:'${cssFontFamily(f.family)}'">${escapeHtml(f.family+(f.style&&f.style!=='Regular'?' '+f.style:''))}</option>`).join('')}</optgroup>`).join('')}
// FONT-002: a native <select> silently falls back to value='' if no <option> matches -- without
// this, a layer already using a legacy (hidden-from-the-list) font would desync #font's displayed
// value from l.font, and the very next edit's writeSelectedControlsToLayer() (l.font=el('font').value)
// would silently overwrite the layer's real font with '' on the next input event. Called from
// syncSelectedControlsFromLayer() right before el('font').value=l.font is set. The injected option is
// tagged [data-legacy-option] and replaced (never accumulated) on every call, so switching selection
// away from a legacy-fonted layer never leaves a stale entry in the list.
function ensureFontOptionForLayer(fontId){
  const select=el('font');
  const stale=select.querySelector('option[data-legacy-option]');
  if(stale)stale.remove();
  if(!fontId||select.querySelector(`option[value="${fontId}"]`))return;
  const option=document.createElement('option');
  option.value=fontId;option.dataset.legacyOption='1';
  if(isFontKnown(fontId)){
    const font=fontManager.getFont(fontId);
    option.style.fontFamily=`'${cssFontFamily(font.family)}'`;
    option.textContent=`${font.family} (Legacy)`;
  }else{
    // Genuinely unknown font id -- still give the <select> a concrete matching option (never a
    // blank/''-valued selection, which writeSelectedControlsToLayer()'s l.font=el('font').value
    // guard also defends against separately) so the picker's displayed state always matches
    // layer.font exactly, even though this id can't be resolved to real geometry.
    option.textContent=`Unavailable font (${fontId})`;
  }
  select.appendChild(option);
}
// READ-006A: Staggered/Radial/Contour were retired as TEXT fill styles (index.html dropped their
// #textMode <option>s). TEXT_MODE_TO_ENGINE_MODE still maps all five, so a project saved with one of
// the retired values still renders byte-identically -- but a native <select> would fall back to
// value='' with no matching <option>, and the next writeSelectedControlsToLayer() (l.textMode=
// el('textMode').value) would silently rewrite that layer's real mode. Mirrors
// ensureFontOptionForLayer() above exactly: called from syncSelectedControlsFromLayer() right before
// el('textMode').value=... is set, the injected option is tagged [data-retired-option] and replaced
// (never accumulated) on every call, so switching selection away never leaves a stale entry.
const RETIRED_TEXT_MODES=new Set(['staggered','radial','contour']);
const RETIRED_TEXT_MODE_LABELS={staggered:'Staggered Fill',radial:'Radial Fill',contour:'Contour Fill'};
function ensureTextModeOptionForLayer(textMode){
  const select=el('textMode');
  const stale=select.querySelector('option[data-retired-option]');
  if(stale)stale.remove();
  if(!RETIRED_TEXT_MODES.has(textMode)||select.querySelector(`option[value="${textMode}"]`))return;
  const option=document.createElement('option');
  option.value=textMode;option.dataset.retiredOption='1';
  option.textContent=`${RETIRED_TEXT_MODE_LABELS[textMode]} (retired)`;
  select.appendChild(option);
}
// Favorites are a client-side browsing preference, not project data -- stored in localStorage,
// never read/written by save/load/export/Design Library/Gallery, so they carry no compatibility
// risk and don't need to round-trip through a project file.
const FONT_FAVORITES_STORAGE_KEY='rhinestoneStudio.favoriteFontIds';
function loadFavoriteFontIds(){try{const raw=localStorage.getItem(FONT_FAVORITES_STORAGE_KEY);const arr=raw?JSON.parse(raw):[];return new Set(Array.isArray(arr)?arr.filter(id=>typeof id==='string'):[])}catch{return new Set()}}
function saveFavoriteFontIds(ids){try{localStorage.setItem(FONT_FAVORITES_STORAGE_KEY,JSON.stringify([...ids]))}catch{}}
let favoriteFontIds=loadFavoriteFontIds();
// TXT-101A: "recently used" -- same client-side-only, not-project-data convention as favorites
// above (see its own comment): most-recent-first, capped, read/written only here.
const FONT_RECENT_STORAGE_KEY='rhinestoneStudio.recentFontIds';
const FONT_RECENT_MAX=8;
function loadRecentFontIds(){try{const raw=localStorage.getItem(FONT_RECENT_STORAGE_KEY);const arr=raw?JSON.parse(raw):[];return Array.isArray(arr)?arr.filter(id=>typeof id==='string'):[]}catch{return[]}}
function saveRecentFontIds(ids){try{localStorage.setItem(FONT_RECENT_STORAGE_KEY,JSON.stringify(ids))}catch{}}
let recentFontIds=loadRecentFontIds();
function recordRecentFont(fontId){if(!fontId)return;recentFontIds=[fontId,...recentFontIds.filter(id=>id!==fontId)].slice(0,FONT_RECENT_MAX);saveRecentFontIds(recentFontIds);if(!el('fontLibraryPanel').hidden)renderFontLibraryList()}
let fontSearchQuery='';
let fontCategoryFilterValue='';
// TXT-101A: sample string for the Browse Fonts panel's live rhinestone-layout previews -- short
// enough to render quickly, covers caps/lowercase/digits (the three broadest glyph classes every
// bundled and rhinestone-native font supports).
const FONT_PREVIEW_TEXT='Ag 123';
const FONT_PREVIEW_HEIGHT_MM=9;
const fontPreviewLayoutCache=new Map(); // fontId -> StoneLayout|null, never evicted (see class doc pattern in tools/rhinestone-studio-conventions memory).
// Generates one font's preview StoneLayout through the real production pipeline
// (permanentEngine.generateTextLayout -- the exact same call generateTextStonesLive() makes for a
// real text layer), caching it so opening/filtering the panel after the first render is instant.
// Uses each rhinestone-native family's own recommended stone size/gap (RhinestoneFontRegistry
// metadata) so a preview looks like that family's actual intended production settings, not a
// generic default.
async function getFontPreviewLayout(font){
  if(fontPreviewLayoutCache.has(font.id))return fontPreviewLayoutCache.get(font.id);
  let layout=null;
  if(permanentEngine.canGenerateText){
    const meta=font.providerId==='rhinestone'?rhinestoneFontRegistry.getMetadata(font.id):null;
    const stoneSizeMm=meta?meta.recommendedStoneSizeMm:1.5;
    const gapMm=meta?meta.recommendedGapMm:0.3;
    try{
      layout=await permanentEngine.generateTextLayout({text:FONT_PREVIEW_TEXT,fontId:font.id,providerId:font.providerId,layerId:`font-preview:${font.id}`,heightMm:FONT_PREVIEW_HEIGHT_MM,stoneSizeMm,gapMm,mode:'outline',color:'crystal'});
    }catch(error){console.error(`Font preview generation failed for "${font.id}"`,error)}
  }
  fontPreviewLayoutCache.set(font.id,layout);
  return layout;
}
function renderFontPreviewCanvas(canvas,layout){
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#fbfdff';ctx.fillRect(0,0,canvas.width,canvas.height);
  if(!layout||layout.stones.length===0)return;
  const transform=fitTransform(layout.getBoundingBox(),canvas.width,canvas.height,5);
  renderStoneLayout(ctx,layout,transform,'layout');
}
function yieldToMainThread(){return new Promise(resolve=>setTimeout(resolve,0))}
// Fires after every renderFontLibraryList() re-render: finds every row's preview canvas and fills
// it in (from cache, or by generating and caching it) without blocking the list's own render.
// Deliberately sequential with a yield between rows, not Promise.all -- generating a rhinestone
// glyph outline the first time is real (if now much cheaper, see RhinestoneStrokeGeometry.js's own
// perf doc) synchronous CPU work, and awaiting a batch of async calls whose bodies never actually
// suspend does not yield to the browser between them; a tight Promise.all over ~12 fonts' worth of
// first-time glyph generation would freeze the panel (no scroll/typing) for its full duration
// instead of staying responsive while previews fill in progressively. isConnected guards against a
// canvas that's already been replaced by a subsequent re-render (a fast second search keystroke,
// say) resolving late and painting into a detached element.
async function populateFontPreviewCanvases(container){
  const canvases=[...container.querySelectorAll('[data-preview-font]')];
  for(const canvas of canvases){
    const fontId=canvas.dataset.previewFont;
    if(fontManager.hasFont(fontId)){
      const layout=await getFontPreviewLayout(fontManager.getFont(fontId));
      if(canvas.isConnected)renderFontPreviewCanvas(canvas,layout);
    }
    await yieldToMainThread();
  }
}
// FONT-LIB-002: collapses a flat font list to one entry per family. `styles` is that family's
// records lightest-weight first; `rep` is the family's Regular (or its lowest weight when there is
// no Regular) -- the style used for the row's preview and for a plain click on the row's name.
function fontFamilyEntries(fonts){
  const byFamily=new Map();
  for(const f of fonts){if(!byFamily.has(f.family))byFamily.set(f.family,[]);byFamily.get(f.family).push(f)}
  const entries=[];
  for(const[family,styles]of byFamily){
    styles.sort((a,b)=>(a.weight||400)-(b.weight||400)||a.style.localeCompare(b.style));
    const rep=styles.find(s=>s.style==='Regular')||styles[0];
    entries.push({family,role:rep.role,styles,rep});
  }
  return entries;
}
// FONT-LIB-003: the lowest-weight *enabled* font in the same family as `font` whose weight is
// strictly heavier than `font`'s -- i.e. the concrete "try a bolder weight" candidate the crowding
// hint (updateStoneSizeOverlapCapabilityUI()) offers for a thin-stroke text layer. Returns null when
// the family is single-weight or `font` is already its heaviest enabled style. Companion to
// fontFamilyEntries() above, which already sorts a family's styles lightest-first.
function findBolderSibling(fontManager,font){
  if(!fontManager||!font)return null;
  const heavier=fontManager.listFonts().filter(f=>f.family===font.family&&f.enabled===true&&(f.weight||400)>(font.weight||400));
  if(heavier.length===0)return null;
  heavier.sort((a,b)=>(a.weight||400)-(b.weight||400)||a.style.localeCompare(b.style));
  return heavier[0];
}
// Same category grouping/sorting as groupFontsByCategory(), but over fontFamilyEntries() rather than
// individual font records -- so the Browse Fonts panel shows one row per family.
function groupFamilyEntriesByCategory(entries){
  const groups=new Map();
  for(const e of entries){const key=e.role||'display';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e)}
  for(const list of groups.values())list.sort((a,b)=>a.family.localeCompare(b.family));
  return[...groups.entries()].sort((a,b)=>fontCategoryLabel(a[0]).localeCompare(fontCategoryLabel(b[0])));
}
// One Browse Fonts panel row for a whole family. `activeId` (defaults to the family's rep) is the
// style whose id the row's name-click and favorite star act on, and the one the inline style
// <select> starts on -- Recently Used / Favorites pass the specific style id that earned the pin.
// A family with >1 style gets that compact <select>; a single-style family gets none. The preview
// canvas always renders the family's rep style (its Regular / lowest weight). rhinestoneValidated
// only shows a muted "Rated legible" badge now (FONT-LIB-002) -- it no longer gates the picker.
function fontLibraryRowHtml(entry,currentFontId,activeId){
  const active=(activeId&&entry.styles.find(s=>s.id===activeId))||entry.rep;
  const isFav=favoriteFontIds.has(active.id);
  const selected=entry.styles.some(s=>s.id===currentFontId);
  const badge=active.rhinestoneValidated===true?`<span class="font-rated-badge" title="Cleared Rhinestone Studio's human + metric stone-dot legibility review (FONT-DECISION-001 / FONT-PORTFOLIO-001).">✓ Rated legible</span>`:'';
  const styleSelect=entry.styles.length>1?`<select class="font-style-select" data-style-select="${escapeHtml(entry.family)}" aria-label="${escapeHtml(entry.family)} style">${entry.styles.map(s=>`<option value="${s.id}"${s.id===active.id?' selected':''}>${escapeHtml(s.style)}</option>`).join('')}</select>`:'';
  const subtitle=`${escapeHtml(fontCategoryLabel(entry.role))}${entry.styles.length>1?` · ${entry.styles.length} styles`:''}`;
  return`<div class="font-library-row"><button type="button" class="font-fav${isFav?' active':''}" data-fav-font="${active.id}" title="${isFav?'Remove from favorites':'Add to favorites'}" aria-pressed="${isFav}">${isFav?'★':'☆'}</button><button type="button" class="font-library-item" data-pick-font="${active.id}" role="option" aria-selected="${selected}"><canvas class="font-preview-canvas" data-preview-font="${entry.rep.id}" width="160" height="36" aria-hidden="true"></canvas><span class="font-library-item-meta"><span class="font-library-item-name">${escapeHtml(entry.family)}</span>${badge}<span class="font-library-item-category">${subtitle}</span></span></button>${styleSelect}</div>`;
}
// Renders the Browse Fonts panel's list: pinned "Recently Used" then "Favorites" groups (each only
// among fonts matching the current search/category filter, and keeping per-style granularity), then
// every category group in alphabetical order, then kicks off (without awaiting) filling in every
// row's live rhinestone preview. Re-run on every search keystroke, category change, favorite toggle,
// and style pick; preview generation is cached so re-renders stay cheap.
function renderFontLibraryList(){
  if(!fontManager)return;
  const list=el('fontLibraryList');
  const query=fontSearchQuery.trim().toLowerCase();
  const fonts=productionFonts().filter(f=>(!fontCategoryFilterValue||f.role===fontCategoryFilterValue)&&(!query||f.family.toLowerCase().includes(query)||f.style.toLowerCase().includes(query)||fontCategoryLabel(f.role).toLowerCase().includes(query)));
  if(fonts.length===0){list.innerHTML='<div class="font-library-empty">No fonts match your search.</div>';return}
  const currentFontId=el('font').value;
  const entries=fontFamilyEntries(fonts);
  const entryByFamily=new Map(entries.map(e=>[e.family,e]));
  const entryForId=id=>{const f=fonts.find(x=>x.id===id);return f?entryByFamily.get(f.family):null};
  const seenRecent=new Set();
  const recents=recentFontIds.map(id=>{const e=entryForId(id);if(!e||seenRecent.has(id))return null;seenRecent.add(id);return{entry:e,activeId:id}}).filter(Boolean);
  const favorites=[];
  for(const e of entries)for(const s of e.styles)if(favoriteFontIds.has(s.id))favorites.push({entry:e,activeId:s.id});
  favorites.sort((a,b)=>a.entry.family.localeCompare(b.entry.family));
  let html='';
  if(recents.length)html+=`<div class="font-library-group">Recently Used</div>${recents.map(r=>fontLibraryRowHtml(r.entry,currentFontId,r.activeId)).join('')}`;
  if(favorites.length)html+=`<div class="font-library-group">Favorites</div>${favorites.map(r=>fontLibraryRowHtml(r.entry,currentFontId,r.activeId)).join('')}`;
  for(const[role,group]of groupFamilyEntriesByCategory(entries))html+=`<div class="font-library-group">${escapeHtml(fontCategoryLabel(role))}</div>${group.map(e=>fontLibraryRowHtml(e,currentFontId)).join('')}`;
  list.innerHTML=html;
  populateFontPreviewCanvases(list).catch(error=>console.error('Font preview rendering failed',error));
}
function openFontLibraryPanel(){el('fontLibraryPanel').hidden=false;el('fontLibraryBtn').setAttribute('aria-expanded','true');fontSearchQuery='';el('fontSearch').value='';renderFontLibraryList();el('fontSearch').focus()}
function closeFontLibraryPanel(){el('fontLibraryPanel').hidden=true;el('fontLibraryBtn').setAttribute('aria-expanded','false')}
// Writes the picked font into the one real #font control and replays the exact 'input'+'change'
// sequence a user picking from the native <select> would fire, so HISTORY_TRACKED_CONTROL_IDS'
// existing listener (openHistorySession/updateAll on input, closeHistorySession on change) runs
// unchanged -- this panel is a second way to set #font's value, never a second place that value
// is read from. Also records the pick for "Recently Used", matching what picking directly from the
// native <select> does via its own 'change' listener (see HISTORY_TRACKED_CONTROL_IDS wiring below).
function pickFont(fontId){recordRecentFont(fontId);el('font').value=fontId;el('font').dispatchEvent(new Event('input'));el('font').dispatchEvent(new Event('change'));closeFontLibraryPanel()}
function toggleFavoriteFont(fontId){if(favoriteFontIds.has(fontId))favoriteFontIds.delete(fontId);else favoriteFontIds.add(fontId);saveFavoriteFontIds(favoriteFontIds);renderFontLibraryList()}
// RS-1009 originally, RS-1012 extracted to a standalone function: a text layer has no stored
// absolute position of its own (unlike every other layer type) -- it is always auto-centered on the
// production canvas first, then offset by layer.x/layer.y on top of that. generateTextStonesLive()
// below applies this to already-generated stones; resolveLayerShapeSource()'s text branch applies
// the exact same formula to already-generated *polygons* (RS-1012 boolean input), so both stay in
// sync by construction instead of by duplicated arithmetic.
// READ-008: the minimum height-to-stone-diameter ratio (layer.height / layer.stoneSize, always the
// raw engine height -- never a cap-height-mode display value) that auto-fit and Fit Text to Shape
// will shrink text to. Measured against stone diameter ALONE, not stoneSize+gap: gap is user-editable
// and has nothing to do with legibility, so a floor expressed in stone pitch silently drifts every
// time the user edits gap (S-107's original basis -- see docs/specifications/READ-007-RatioFloorEvidence.md
// for the correction). stoneSize itself never scales down here -- it is a real catalog rhinestone
// (src/renderer/StoneSizes.js), not a continuously-adjustable display value, and shrinking it during
// auto-fit would silently produce a non-orderable size. Below this ratio there are too few stones
// across a glyph's shrunk stroke width for the letterform to read as anything but a blurred row of
// dots. Auto-fit still shrinks heightMm as much as it can within this floor; only text so long it
// would need to shrink past the floor overflows maxWidth instead of collapsing into stone soup.
//
// Value 16: READ-007's calibration set cannot locate a boundary below ratio 20 -- every ratio under
// 20 is a uniform zero-cost floor there, so it cannot distinguish 15 from 20 (READ-007 §8). 16 is
// chosen on independent evidence: StoneSizes.js's five supportedHeightRangeMm minima imply ratios of
// 17.50 / 16.07 / 16.25 / 17.02 / 16.56 (SS6..SS30) -- five independently derived minima converging
// on 16-17.5, and a floor of 20 would put SS30's entire validated range permanently in warning.
// 16-20 remains an unresolved band; see docs/specifications/READ-008-RatioFloor.md.
const MIN_HEIGHT_TO_STONE_RATIO=16;
// Computes the heightMm scale factor generateTextStonesLive()/resolveLayerShapeSource() apply for
// auto-fit text, given that text's straight (unscaled) measured widthMm. Shared by both call sites
// so their auto-fit decisions can never drift apart (mirrors computeTextPlacementOffset() above).
// `scale` is 1 (no change) whenever auto-fit is off, the text already fits, or heightMm/stoneSize is
// degenerate.
function computeAutoFitScale(layer,project,measuredWidthMm){
  if(!layer.autoFit||!(measuredWidthMm>0))return{scale:1};
  const maxWidth=project.canvas.width-10;
  if(measuredWidthMm<=maxWidth)return{scale:1};
  const fitScale=maxWidth/measuredWidthMm;
  const stoneSizeMm=layer.stoneSize||0;
  const minScale=stoneSizeMm>0&&layer.height>0?(stoneSizeMm*MIN_HEIGHT_TO_STONE_RATIO)/layer.height:fitScale;
  return{scale:Math.min(1,Math.max(fitScale,minScale))};
}
// TXT-104 step 2: solves the em-square heightMm generateTextLayout() must be called with so that a
// font's rendered capital letters come out to desiredCapHeightMm, per the design doc's section 3.1
// formula (engineHeightMm = desiredCapHeightMm / capHeightRatio(fontId)). Pure -- reads only the
// module-level fontManager (the same registry every other font lookup in this file already uses),
// no DOM, no layer/project object. Only meaningful for the four validated OpenType fonts that carry
// a capHeightRatio (FontManager.js's normalizeFontRecord()); RS Block/RS Modern (authored stone
// centers, heightMm already a no-op) and every non-validated legacy OpenType font have no
// capHeightRatio and throw here rather than silently returning NaN.
function solveEngineHeightMm({fontId,desiredCapHeightMm}){
  const font=fontManager.getFont(fontId);
  if(typeof font.capHeightRatio!=='number')throw new Error(`solveEngineHeightMm: font "${fontId}" has no capHeightRatio -- only the validated OpenType portfolio (Baloo 2, Anton, Sacramento, Dancing Script) supports cap-height-accurate sizing.`);
  return desiredCapHeightMm/font.capHeightRatio;
}
// TXT-104 step 4a: exact inverse of solveEngineHeightMm() above -- given the raw engineHeightMm a
// text layer's layer.height already holds (per this milestone's design invariant, unchanged by
// heightMode), recovers the real cap-height in mm that value renders at. Same capHeightRatio-required
// contract and throw behavior as solveEngineHeightMm(): a font with no ratio has no meaningful cap
// height to convert to/from.
function solveDesiredCapHeightMm({fontId,engineHeightMm}){
  const font=fontManager.getFont(fontId);
  if(typeof font.capHeightRatio!=='number')throw new Error(`solveDesiredCapHeightMm: font "${fontId}" has no capHeightRatio -- only the validated OpenType portfolio (Baloo 2, Anton, Sacramento, Dancing Script) supports cap-height-accurate sizing.`);
  return engineHeightMm*font.capHeightRatio;
}
// TXT-104 step 4a: the raw engineHeightMm bounds writeSelectedControlsToLayer()'s #height write-back
// clamps to (app.js:~1071, `Math.max(4,Math.min(111,...))`) -- named here so a future Letter Height
// control's real-mm bounds (computeLetterHeightBoundsMm() below) and that clamp always derive from
// the same two numbers instead of a second hardcoded copy silently drifting from the first.
const RAW_ENGINE_HEIGHT_MM_MIN=4,RAW_ENGINE_HEIGHT_MM_MAX=111;
// TXT-104 step 4a: the design doc's section 3.4 open question -- a future Letter Height control must
// NOT inherit [RAW_ENGINE_HEIGHT_MM_MIN,RAW_ENGINE_HEIGHT_MM_MAX] unmodified, since that's a raw
// em-square heightMm range, not a real cap-height range: each font's actual min/max Letter Height in
// mm differs because capHeightRatio differs per font. Runs the engine's own raw clamp constants
// through solveDesiredCapHeightMm() so the bounds always round-trip back to exactly that clamp. Same
// throw behavior as solveDesiredCapHeightMm() for a font with no capHeightRatio.
function computeLetterHeightBoundsMm(fontId){
  return{
    minMm:solveDesiredCapHeightMm({fontId,engineHeightMm:RAW_ENGINE_HEIGHT_MM_MIN}),
    maxMm:solveDesiredCapHeightMm({fontId,engineHeightMm:RAW_ENGINE_HEIGHT_MM_MAX})
  };
}
// RS-3019: #height's HTML min/max are static mm literals (index.html) and were never previously
// updated by JS -- now that #height's displayed value is unit-converted (setLengthField/
// readLengthField), its bounds must be too, mirroring #letterHeight's own dynamic bounds just below.
function refreshHeightFieldBounds(){
  el('height').min=mmToDisplayValue(RAW_ENGINE_HEIGHT_MM_MIN,project.units);
  el('height').max=mmToDisplayValue(RAW_ENGINE_HEIGHT_MM_MAX,project.units);
}
// READ-006: #letterSpacing's bounds are derived from pitchMm (stoneSize + gap), not fixed literals.
// TRACKING_XPITCH_LADDER's top rung is 4 x pitchMm -- 20.0mm at SS20, 26.8mm at SS30 (where even the
// 3x rung is 20.1mm) -- so a fixed [-2,20] cap would let the "Separate letters" button, which writes
// l.letterSpacing directly, have its own solved value silently clamped back down by the next
// tracked-control write with no undo entry. max = top rung x pitchMm; min = -pitchMm.
//
// pitchMm is read from the #stoneSize/#gap CONTROLS, not layer.stoneSize/layer.gap: in
// writeSelectedControlsToLayer() the text branch clamps l.letterSpacing *before* the shared tail
// block writes l.stoneSize/l.gap, so the layer's pitch is still stale there. Same "read the
// controls, not the possibly-stale layer" convention mixedSizeEligibleIds() documents; the
// fallbacks match that tail block's own (parseFloat(...)||2 / readLengthField('gap')||.3).
function letterSpacingBoundsMm(){
  const pitchMm=(parseFloat(el('stoneSize').value)||2)+(readLengthField('gap')||.3);
  return{minMm:-pitchMm,maxMm:TRACKING_XPITCH_LADDER[TRACKING_XPITCH_LADDER.length-1]*pitchMm};
}
function refreshLetterSpacingFieldBounds(){
  const l=selectedLayer();
  if(!l||l.type!=='text')return;
  const{minMm,maxMm}=letterSpacingBoundsMm();
  el('letterSpacing').min=mmToDisplayValue(minMm,project.units);
  el('letterSpacing').max=mmToDisplayValue(maxMm,project.units);
}
// TXT-104 step 4b: the read/display half of #letterHeight's bidirectional sync with #height -- called
// from updateTextFontCapabilityUI() (the one place guaranteed to run after every source of a #height
// value change: a direct edit, the stone-size auto-set snap, or a fresh layer selection) whenever
// #letterHeightField is shown. Pure DOM read -> solveDesiredCapHeightMm() -> DOM write; never itself
// dispatches an event, so it can never trigger #letterHeight's own write-direction listener below.
function syncLetterHeightFromHeight(fontId){
  const engineHeightMm=readLengthField('height');
  if(!Number.isFinite(engineHeightMm))return;
  el('letterHeight').value=formatLengthDisplay(solveDesiredCapHeightMm({fontId,engineHeightMm}),project.units);
}
// MONO-005A: delegates to src/editing/TextPlacement.js's own computeTextPlacementOffsetMm() -- the
// single shared source of truth for this formula, now also used by MonogramGenerator to compute a
// generated letter layer's x/y (via that module's inverse function). Behavior-preserving extraction
// only; this wrapper's own signature/return shape is unchanged.
function computeTextPlacementOffset(boundingBox,layer,project){
  const{offsetXMm,offsetYMm}=computeTextPlacementOffsetMm({boundingBoxMm:boundingBox,xMm:layer.x,yMm:layer.y,canvasWidthMm:project.canvas.width,canvasHeightMm:project.canvas.height});
  return{offsetX:offsetXMm,offsetY:offsetYMm};
}
// RS-1011 (Fill Algorithms): "Fill Style" -- Outline/Grid Fill/Staggered Fill/Radial Fill/Contour
// Fill -- for every vector layer type (text/circle/rectangle/svg/path), and the 4-mode subset
// (no Outline: a raster density field has no vector perimeter) for image. These mirror
// GeometryEngine's own SAMPLE_MODES/IMAGE_SAMPLE_MODES enums (src/geometry/GeometryEngine.js) --
// kept in sync by hand, the same way SUPPORTED_LAYER_TYPES below already mirrors the engine's own
// layer-type dispatch. Falling back to each layer type's pre-RS-1011 default for any unrecognized
// or missing value means every project saved before this milestone (no fillMode field on circle/
// rectangle/path/image; textMode/svgMode never containing these new values) generates byte-identical
// geometry. Text keeps its own pre-existing 'stroke' synonym for 'outline' (its historical
// #textMode value); every other layer type's stored value already equals the engine's own mode name
// directly, so no translation table is needed for them.
const VECTOR_FILL_MODES=new Set(['outline','fill','staggered','radial','contour']);
const IMAGE_FILL_MODES=new Set(['fill','staggered','radial','contour']);
const TEXT_MODE_TO_ENGINE_MODE={stroke:'outline',fill:'fill',staggered:'staggered',radial:'radial',contour:'contour'};
// MONO-005A: layer.authoredScale is a new, optional, additive text-layer field -- GeometryEngine's
// own normalizeTextParams() validates it strictly (throws for non-finite/non-positive), but this
// read site follows this file's existing permissive-import style for optional numeric layer fields
// (see e.g. mixedSizeParamsFor()'s '??' fallbacks): a missing, non-number, or invalid stored value
// normalizes to 1 (identity, the same default GeometryEngine itself uses when the field is absent)
// rather than surfacing as a thrown error during ordinary live editing/rendering of a possibly
// hand-edited or corrupted project file.
function resolveAuthoredScale(layer){return typeof layer.authoredScale==='number'&&Number.isFinite(layer.authoredScale)&&layer.authoredScale>0?layer.authoredScale:1}
// MONO-006A: layer.authoredScale (MONO-005A) is a persisted positional-fitting transform computed
// by MonogramGenerator for one specific text+font+stoneSize+gap combination. Editing any of those
// four fields means the stored scale describes geometry that no longer exists -- reapplying it to
// the edited combination is what produced the below-minimum-scale regression this milestone fixes
// (a stale fitted scale from a small production stone size rejected as illegal once stoneSize was
// edited up to a larger one). Removing it here makes writeSelectedControlsToLayer() fall back to
// resolveAuthoredScale()'s own absent-field default (1, the natural-layout path), so the text
// regenerates normally instead of throwing. Color and position edits don't change what was fitted,
// so they are deliberately not in this set. One centralized call site, not scattered
// `delete layer.authoredScale` statements across every field's write-back, per this milestone's own
// design requirement.
const AUTHORED_SCALE_INVALIDATING_FIELDS=new Set(['text','font','stoneSize','gap']);
function invalidateAuthoredScaleForGeometryChange(layer,changedField){
  if(layer.authoredScale===undefined||!AUTHORED_SCALE_INVALIDATING_FIELDS.has(changedField))return;
  delete layer.authoredScale;
}
function resolveTextFillMode(textMode){return TEXT_MODE_TO_ENGINE_MODE[textMode]||'outline'}
function resolveVectorFillMode(value){return VECTOR_FILL_MODES.has(value)?value:'outline'}
function resolveImageFillMode(value){return IMAGE_FILL_MODES.has(value)?value:'fill'}
// S-200 (Mixed Stone-Size Layouts): Generation Mode -- 'uniform' (every stone in the layer is the
// same size, unchanged pre-S-200 behavior) or 'mixed' (GeometryEngine.js's MixedSizeGenerator.js
// may additively fill gaps with smaller stones). Mirrors resolveVectorFillMode()'s own "unrecognized
// or missing value falls back to the pre-milestone default" convention, so every project saved
// before this milestone (no sizeMode field on any layer) generates byte-identical geometry.
const SIZE_MODES=new Set(['uniform','mixed']);
function resolveSizeMode(value){return SIZE_MODES.has(value)?value:'uniform'}
// The Mixed Stone Size inspector section's five Allowed Sizes checkboxes are static markup (see
// index.html's #sharedMixedSizeFields comment for why, vs. #stoneSize's dynamically populated
// catalog options) -- this array is the one place their ids are paired with the Stone Library
// diameters they represent, read by writeSelectedControlsToLayer()/syncSelectedControlsFromLayer()
// below. Kept in sync by hand with src/renderer/StoneSizes.js's shipped catalog, the same
// convention VECTOR_FILL_MODES above already uses for GeometryEngine's own enums.
const MIXED_ALLOWED_SIZE_CHECKBOXES=[
  {id:'mixedAllowedSs6',diameterMm:2.0},
  {id:'mixedAllowedSs10',diameterMm:2.8},
  {id:'mixedAllowedSs16',diameterMm:4.0},
  {id:'mixedAllowedSs20',diameterMm:4.7},
  {id:'mixedAllowedSs30',diameterMm:6.4}
];
// Builds the #mixedMinSize/#mixedMaxSize <option> lists from the Stone Library, mirroring
// populateStoneSizeOptions() exactly (same catalog, same "value is the plain mm diameter" contract)
// -- called once at startup alongside it.
function populateMixedSizeSelectOptions(){const optionsHtml=listStoneSizes().map(s=>`<option value="${s.diameterMm}">${escapeHtml(s.name)} — ${s.diameterMm.toFixed(1)} mm</option>`).join('');el('mixedMinSize').innerHTML=optionsHtml;el('mixedMaxSize').innerHTML=optionsHtml}
// S-110 (Expanded Shape Library): every shape kind that resolves through GeometryEngine's
// generateShapeLayout()/resolveShapePolygons() -- Circle/Rectangle plus the nine new
// ShapeLibrary.js kinds (Ellipse/Capsule/Regular Polygon/Star/Heart/Arrow/Cross/Crescent/Ring).
// Replaces the old `l.type==='circle'||l.type==='rectangle'` checks in generate()/
// resolveLayerShapeSource() below with one shared set, so a new shape kind never needs a second
// call site touched beyond this list.
const SHAPE_LAYER_TYPES=new Set(['circle','rectangle',...SHAPE_LIBRARY_KINDS]);
// Every layer type that places a *natural-size* shape into an x/y/w/h box (as opposed to Circle's
// cx/cy/r or Text's auto-centered-then-offset position) -- Rectangle/SVG/Image/Path plus every new
// S-110 shape kind. Replaces the repeated `l.type==='rectangle'||l.type==='svg'||...` unions in
// getLayerBBox()/the drag-resize handler/duplicateLayer() below with one shared set.
const XYWH_SHAPE_TYPES=new Set(['rectangle','svg','image','path',...SHAPE_LIBRARY_KINDS]);
// Every layer type with a Fill Style control backed by VECTOR_FILL_MODES above (SVG/Image have
// their own separate, dedicated Fill Style controls -- #svgMode/#imageFillMode -- so they are
// deliberately not in this set). Replaces the old `l.type==='circle'||l.type==='rectangle'||
// l.type==='path'` check (isShapeFillType, below) with one shared set that also covers the nine new
// shape kinds.
const VECTOR_FILL_MODE_TYPES=new Set(['circle','rectangle','path',...SHAPE_LIBRARY_KINDS]);
const SHAPE_DISPLAY_LABELS={
  circle:'Circle',rectangle:'Rectangle',ellipse:'Ellipse',capsule:'Capsule',polygon:'Regular Polygon',
  star:'Star',heart:'Heart',arrow:'Arrow',cross:'Cross',crescent:'Crescent',ring:'Ring',shield:'Shield'
};
// Default creation size (mm) for each non-circle shape kind, centered on the same (105,45) point
// the original circle/rectangle defaults already used (a 210x90mm default canvas's own center).
// Rectangle's own w/h here (80x30) is unchanged from its pre-S-110 default. Most kinds default to a
// square box so a Regular Polygon/Star/Ring/Cross reads as its canonical, undistorted shape at
// creation (distortion via resize is opt-in, not the default look) -- Capsule and Arrow are
// deliberately non-square since a stretched-to-square pill/arrow would no longer read as one.
const SHAPE_DEFAULT_SIZES_MM={
  rectangle:{w:80,h:30},ellipse:{w:70,h:45},capsule:{w:80,h:40},polygon:{w:60,h:60},star:{w:60,h:60},
  heart:{w:55,h:50},arrow:{w:70,h:42},cross:{w:55,h:55},crescent:{w:50,h:62},ring:{w:60,h:60},shield:{w:55,h:60}
};
// Each configurable shape kind's own extra creation-time fields (Regular Polygon's side count,
// Star's point count + inner radius, Ring's inner opening) -- everything else needs none.
function defaultShapeExtraFields(kind){
  if(kind==='polygon')return{sides:6};
  if(kind==='star')return{points:5,innerRadiusRatio:0.5};
  if(kind==='ring')return{innerRatio:0.5};
  return{};
}
// Reads a shape layer's own configurable extra fields back out (the inverse of
// defaultShapeExtraFields() above) into the shape of GeometryEngine.generateShapeLayout()'s extra
// params -- shared by generateShapeStonesLive() (live stone generation) and
// shapeLayerResolveParams() (Boolean Operations / Fit Text to Shape's polygon resolution) below, so
// a shape's configurable parameters are read out in exactly one place.
function shapeExtraParams(layer){
  if(layer.type==='polygon')return{sides:layer.sides};
  if(layer.type==='star')return{points:layer.points,innerRadiusRatio:layer.innerRadiusRatio};
  if(layer.type==='ring')return{innerRatio:layer.innerRatio};
  return{};
}
// Builds the params object permanentEngine.generateShapeLayout()/resolveShapePolygons() expect for
// any shape-kind layer (Circle's cx/cy/r, or every other kind's x/y/w/h placement box, plus that
// kind's own extra params) -- the one shared "layer -> engine params" mapping used by
// generateShapeStonesLive(), resolveLayerShapeSource(), and fitTextToShape()'s shape resolution.
function shapeLayerResolveParams(layer){
  const isCircle=layer.type==='circle';
  return{
    shape:layer.type,layerId:layer.id,
    ...(isCircle?{cxMm:layer.cx,cyMm:layer.cy,radiusMm:layer.r}:{xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h}),
    // RS-3028: '??' fallback so a pre-RS-3028 saved project (no rotationDeg on its shape layers)
    // resolves to 0, byte-identical to before this milestone.
    rotationDeg:layer.rotationDeg??0,
    ...shapeExtraParams(layer)
  };
}
// S-200: the one shared "layer -> engine mixed-size params" mapping, used by every
// generate*StonesLive() below (mirrors shapeLayerResolveParams()'s own "read once, use everywhere"
// convention). '??' fallbacks mean a layer saved before this milestone (no such fields at all)
// forwards sizeMode:'uniform', so GeometryEngine.js's normalizeMixedSizeParams() short-circuits
// immediately and every pre-S-200 project generates byte-identical geometry.
function mixedSizeParamsFor(layer){return{sizeMode:resolveSizeMode(layer.sizeMode),allowedSizesMm:layer.allowedSizesMm??[],minSizeMm:layer.minSizeMm??null,maxSizeMm:layer.maxSizeMm??null,conservativeDetail:layer.conservativeDetail}}
// MONO-006B: every field generateTextStonesLive() passes to permanentEngine.generateTextLayout()
// except authoredScale itself -- factored out so recoverStaleAuthoredScales() below can generate
// the exact same *natural* (unscaled) layout to validate a persisted authoredScale against, without
// duplicating (and risking drift from) this field list.
function buildTextLayoutBaseParams(layer){const fontId=layer.font;const authored=isAuthoredStoneFontId(fontId);const mode=resolveTextFillMode(layer.textMode);return{text:layer.text,fontId,providerId:resolveFontProviderId(fontId),layerId:layer.id,heightMm:layer.height,stoneSizeMm:layer.stoneSize,gapMm:layer.gap,mode,color:layer.color,curveEnabled:authored?false:Boolean(layer.curveEnabled),curveRadiusMm:layer.curveRadiusMm,curveDirection:layer.curveDirection,curveStartAngleDeg:layer.curveStartAngleDeg,curveSweepAngleDeg:layer.curveSweepAngleDeg,curveAlignment:layer.curveAlignment,
  // TXT-102: '??' fallbacks so a pre-TXT-102 saved project (no align/lineSpacing/rotationDeg on its
  // text layers) renders byte-identical -- 'left'/1/0 are exactly GeometryEngine's own defaults.
  align:layer.align??'left',lineSpacing:layer.lineSpacing??1,rotationDeg:layer.rotationDeg??0,
  // READ-006: added inter-glyph tracking, mm. Zeroed for authored stone fonts exactly like
  // curveEnabled above -- expectedComponentCount() has no outline to work from for rs-block/rs-modern
  // (spec §4.5). '??' fallback so a pre-READ-006 project is byte-identical.
  letterSpacingMm:authored?0:(layer.letterSpacing??0),
  // S-200: see mixedSizeParamsFor()'s own doc comment.
  ...mixedSizeParamsFor(layer)}}
class GeometryEngine{constructor(permanentEngine=null){this.permanentEngine=permanentEngine}
 // Geometry generation happens exactly once here, per docs/ARCHITECTURE.md: every layer's stones
 // come straight from the permanent engine's per-layer StoneLayout; dedupeStonesByRadius() below
 // only filters already-generated stones by proximity across layers, it invents no new positions.
 // RC-004: this used to be a single global-minDist grid filter (a weaker threshold than physical
 // stone overlap, and blind to per-layer stone-size differences); dedupeStonesByRadius() instead
 // drops a stone only when it truly physically overlaps an already-kept one, computed per pair from
 // each stone's own size -- see its doc comment in src/geometry/StoneSampler.js. The survivors are
 // wrapped into one real StoneLayout ('project' is a sentinel layerId — StoneLayout requires one
 // non-empty layerId per instance; each Stone still carries its own real layer id) so every
 // renderer/exporter downstream consumes the same canonical product.
 // MONO-006B: a persisted layer.authoredScale (MONO-005A) can become illegal for reasons the layer
 // itself was never edited for -- initial load, project import, autosave recovery, undo/redo, or
 // simply selecting a different layer all reach this generate() call without ever going through
 // writeSelectedControlsToLayer() (see updateAll(true)'s skipWrite callers), so MONO-006A's
 // invalidateAuthoredScaleForGeometryChange() -- which only fires on a live edit of the *currently
 // selected* layer -- never gets a chance to catch a value that was already stale before the first
 // successful generation. Running this once per generate() call, before any layer's stones are
 // built, means every regeneration entry path is covered by construction (this is the one place
 // "geometry generation happens exactly once", per docs/ARCHITECTURE.md) rather than needing to be
 // individually patched at each call site. Mutates `project` in place (the same live object every
 // caller already shares) so the fix -- not just this one render -- is what autosave/Save/undo-redo
 // history created afterward all see; it does not call commitHistory(), so it never manufactures an
 // extra undo step of its own.
 async recoverStaleAuthoredScales(project){
  if(!this.permanentEngine||!this.permanentEngine.canGenerateText)return;
  for(const l of project.layers){
    if(l.type!=='text'||typeof l.authoredScale!=='number'||!l.text||!isFontKnown(l.font))continue;
    // The natural (unscaled) layout for this layer's *current* text/font/stoneSize/gap --
    // authoredScale:1 is generateTextLayout()'s own default and skips its internal scaling step
    // entirely (see its doc comment), so this is exactly the layout scaleAuthoredTextLayout() below
    // needs to judge the persisted scale against. Any throw here (unknown curve combination,
    // manifest failure, etc.) is a genuine, unrelated error -- deliberately not caught, so it
    // surfaces the same way it always has through updateAll()'s own try/catch, instead of being
    // silently absorbed by this recovery pass.
    const naturalLayout=await this.permanentEngine.generateTextLayout({...buildTextLayoutBaseParams(l),authoredScale:1});
    if(naturalLayout.sourceMode!=='authored')continue; // no effect on sampled/OpenType text (MONO-002)
    // scaleAuthoredTextLayout() never throws -- it returns a structured {ok,reason,...} verdict
    // (MONO-002), the exact legality check generateTextLayout() itself uses internally. Reusing it
    // here means this can never disagree with the engine's own judgment, and never needs to parse an
    // exception message to tell a stale scale apart from any other kind of failure.
    const scaleResult=this.permanentEngine.scaleAuthoredTextLayout(naturalLayout,l.authoredScale);
    if(!scaleResult.ok)delete l.authoredScale;
  }
 }
 async generate(project){await this.recoverStaleAuthoredScales(project);let raw=[];for(const l of project.layers){if(!l.visible)continue;if(l.type==='text')raw.push(...await this.generateTextStonesLive(l,project));if(SHAPE_LAYER_TYPES.has(l.type))raw.push(...await this.generateShapeStonesLive(l));if(l.type==='svg')raw.push(...await this.generateSvgStonesLive(l));if(l.type==='image')raw.push(...await this.generateImageStonesLive(l));if(l.type==='path')raw.push(...await this.generatePathStonesLive(l));}const stones=dedupeStonesByRadius(raw).map(s=>new Stone({xMm:s.x,yMm:s.y,sizeMm:s.d,color:s.color,layerId:s.layerId}));return new StoneLayout({layerId:'project',stones})}
 // Stone Size overlap guard: the same per-type Live dispatch generate() uses just above, factored
 // out (not shared with generate() itself, to avoid touching that method's tested source shape) so
 // updateStoneSizeOverlapCapabilityUI() below can generate one layer's real stones for a *candidate*
 // stoneSize without touching the rest of the project. No new generation logic -- every branch calls
 // the exact same generateXStonesLive() method generate() already calls.
 // {includeStats=false}: when true, each branch below returns {stones,outlineStats} instead of a
 // bare array -- outlineStats is that candidate's own StoneLayout.outlineStats (null for non-outline
 // modes/layer types with no outline concept, e.g. text/image/svg-in-fill-mode). Every existing call
 // site omits this option, so its behavior/return shape is byte-for-byte unchanged.
 async generateLiveStonesForCandidateLayer(layer,project,{includeStats=false}={}){if(layer.type==='text')return this.generateTextStonesLive(layer,project,{includeStats});if(SHAPE_LAYER_TYPES.has(layer.type))return this.generateShapeStonesLive(layer,{includeStats});if(layer.type==='svg')return this.generateSvgStonesLive(layer,{includeStats});if(layer.type==='image')return this.generateImageStonesLive(layer,{includeStats});if(layer.type==='path')return this.generatePathStonesLive(layer,{includeStats});return includeStats?{stones:[],outlineStats:null}:[]}
 // FONT-002: an unknown font id (not just one hidden from the picker -- see isFontKnown()) is never
 // silently substituted for DEFAULT_TEXT_FONT_ID; that layer's stones are skipped (same shape as an
 // empty-text layer already returning []), and updateTextFontCapabilityUI() surfaces why while it's
 // selected. layer.font itself is left untouched in `project`.
 async generateTextStonesLive(layer,project,{includeStats=false}={}){if(!this.permanentEngine||!this.permanentEngine.canGenerateText||!layer.text||!isFontKnown(layer.font))return includeStats?{stones:[],outlineStats:null}:[];const base={...buildTextLayoutBaseParams(layer),
  // MONO-005A: see resolveAuthoredScale()'s own doc comment. No effect on sampled/OpenType text --
  // GeometryEngine only ever reads authoredScale inside its authored-stone-center branch.
  authoredScale:resolveAuthoredScale(layer)};let result=await this.permanentEngine.generateTextLayout(base);if(layer.autoFit){const{scale}=computeAutoFitScale(layer,project,result.widthMm);if(scale<1){const scaledHeight=Math.max(1,layer.height*scale);result=await this.permanentEngine.generateTextLayout({...base,heightMm:scaledHeight})}}const bb=result.getBoundingBox();
  // RS-1009: text layers previously had no position field -- stones were always centered on the
  // canvas. layer.x/layer.y (mm, default 0) are a further offset applied on top of that same
  // auto-centered base position, so pre-RS-1009 Project JSON (no x/y on its text layers) renders
  // byte-identical to before, and dragging/nudging/aligning a text layer just moves this offset.
  const{offsetX,offsetY}=computeTextPlacementOffset(bb,layer,project);const stones=result.stones.map(s=>({x:s.xMm+offsetX,y:s.yMm+offsetY,d:s.sizeMm,color:s.color,layerId:s.layerId}));return includeStats?{stones,outlineStats:result.outlineStats??null}:stones}
 // RS-0003.5C1: circle/rectangle layers are generated by the same permanent engine's
 // generateShapeLayout(), mirroring generateTextStonesLive() above. S-110: every new shape kind
 // (Ellipse/Capsule/Regular Polygon/Star/Heart/Arrow/Cross/Crescent/Ring) goes through this exact
 // same call, via shapeLayerResolveParams()'s shared layer->params mapping (module scope, above).
 async generateShapeStonesLive(layer,{includeStats=false}={}){if(!this.permanentEngine)return includeStats?{stones:[],outlineStats:null}:[];const params={...shapeLayerResolveParams(layer),stoneSizeMm:layer.stoneSize,gapMm:layer.gap,mode:resolveVectorFillMode(layer.fillMode),color:layer.color,...mixedSizeParamsFor(layer)};const result=this.permanentEngine.generateShapeLayout(params);const stones=result.stones.map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:s.color,layerId:s.layerId}));return includeStats?{stones,outlineStats:result.outlineStats??null}:stones}
 // RS-1001: svg layers reuse the same x/y/w/h placement box rectangle layers use; src/svg/**
 // (not app.js) does the actual SVG parsing, inside generateSvgLayout().
 async generateSvgStonesLive(layer,{includeStats=false}={}){if(!this.permanentEngine)return includeStats?{stones:[],outlineStats:null}:[];const params={svgSource:layer.svgSource,layerId:layer.id,xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h,stoneSizeMm:layer.stoneSize,gapMm:layer.gap,mode:resolveVectorFillMode(layer.mode),color:layer.color,...mixedSizeParamsFor(layer)};const result=this.permanentEngine.generateSvgLayout(params);const stones=result.stones.map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:s.color,layerId:s.layerId}));return includeStats?{stones,outlineStats:result.outlineStats??null}:stones}
 // RS-1008A: image layers go through the permanent engine's generateImageLayout(), mirroring
 // generateSvgStonesLive()/generateShapeStonesLive() above -- src/image/** only prepares the
 // decoded pixel buffer (decode/cache happens here since that's the one async, DOM-only step;
 // generateImageLayout() itself is synchronous, like generateShapeLayout()). imageBufferCache means
 // the (comparatively expensive) browser image decode only re-runs the first time a given imageSrc
 // is seen; every subsequent call here only re-runs the permanent engine's pure/fast pipeline.
 async generateImageStonesLive(layer,{includeStats=false}={}){if(!this.permanentEngine||!layer.imageSrc)return includeStats?{stones:[],outlineStats:null}:[];let buffer=imageBufferCache.get(layer.imageSrc);if(!buffer){buffer=await decodeDataUrlToBuffer(layer.imageSrc);imageBufferCache.set(layer.imageSrc,buffer)}const params={imageBuffer:buffer,layerId:layer.id,xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h,stoneSizeMm:layer.stoneSize,gapMm:layer.gap,mode:resolveImageFillMode(layer.fillMode),color:layer.color,threshold:layer.threshold,invert:layer.invert,blurRadiusPx:layer.blurRadiusPx,maxWidthPx:layer.maxWidthPx,maxHeightPx:layer.maxHeightPx,...mixedSizeParamsFor(layer)};const result=this.permanentEngine.generateImageLayout(params);const stones=result.stones.map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:s.color,layerId:s.layerId}));return includeStats?{stones,outlineStats:result.outlineStats??null}:stones}
 // RS-1012: 'path' layers (Boolean Operation results) go through the permanent engine's
 // generatePathLayout(), mirroring generateSvgStonesLive()/generateShapeStonesLive() above --
 // layer.contours is already plain (0,0)-rooted polygon data (no parsing step, unlike SVG).
 // RS-3011 Step 7: stonesGenerated===false gates a Design-drawn shape's entire stone output (base
 // fill AND Paint regions alike) until "Generate Stones" is pressed -- missing on every layer
 // predating this step (Boolean Ops results, etc.), so those keep generating live as before.
 async generatePathStonesLive(layer,{includeStats=false}={}){if(layer.stonesGenerated===false)return includeStats?{stones:[],outlineStats:null}:[];if(!this.permanentEngine)return includeStats?{stones:[],outlineStats:null}:[];const params={contours:layer.contours.map(c=>c.map(p=>({xMm:p.x,yMm:p.y}))),layerId:layer.id,xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h,stoneSizeMm:layer.stoneSize,gapMm:layer.gap,mode:resolveVectorFillMode(layer.fillMode),color:layer.color,closed:layer.closed!==false,
    // RS-3011 Step 10b: forwards a 'path' layer's Paint regions (Step 10a's own data model) into
    // live/production generation -- Step 10a wired GeometryEngine's own support for `regions` and
    // validateProject()'s pass-through, but never actually forwarded the field from a real layer
    // into a generatePathLayout() call anywhere, so a painted region silently never generated a
    // single stone until now. Defaults to [] for every layer predating this step, matching
    // GeometryEngine.normalizePathParams()'s own regions normalizer.
    regions:layer.regions||[],
    // RS-3011 Step 12: forwards a 'path' layer's Stamp placements (Step 12's own data model) into
    // live/production generation, the identical wiring-gap fix Step 10b's own `regions` line above
    // made for Paint -- defaults to [] for every layer predating this step, matching
    // GeometryEngine.normalizePathParams()'s own stampedStones normalizer.
    stampedStones:layer.stampedStones||[],
    // RS-3011 Step 13: forwards a 'path' layer's Eraser daubs (Step 13's own data model) into
    // live/production generation, the identical wiring-gap fix Step 10b/Step 12's own `regions`/
    // `stampedStones` lines above made for Paint/Stamp -- defaults to [] for every layer predating
    // this step, matching GeometryEngine.normalizePathParams()'s own eraseDaubs normalizer.
    eraseDaubs:layer.eraseDaubs||[],
    // Bugfix (permanent dead zone): forwards a 'path' layer's persistent erased-stone-position
    // snapshots (see onEraseSweep()'s own doc comment) into live/production generation, the
    // identical wiring-gap fix Step 10b/12/13's own `regions`/`stampedStones`/`eraseDaubs` lines
    // above made for their own data models -- defaults to [] for every layer predating this fix,
    // matching GeometryEngine.normalizePathParams()'s own erasedGridPositions normalizer.
    erasedGridPositions:layer.erasedGridPositions||[],
    // RS-3014 Step 3: forwards a 'path' layer's frozen natural-space reference box (set once an
    // Outline-mode Eraser cut first mutates `contours` -- see onEraseSweep()'s own doc comment)
    // into live/production generation, the identical wiring-gap fix Step 10b/12/13's own `regions`/
    // `stampedStones`/`eraseDaubs` lines above made for their own data models -- undefined for
    // every layer never cut, matching GeometryEngine.normalizePathParams()'s own
    // naturalBoundingBoxMm normalizer's safe-no-op default.
    naturalBoundingBoxMm:layer.naturalBoundingBoxMm,
    // RS-3033: forwards a 'path' layer's rotationDeg into live/production generation -- a
    // pre-existing wiring gap identical in shape to the regions/stampedStones/eraseDaubs ones above
    // (l.rotationDeg was already writable via the main canvas's own rotate handle/numeric field for
    // EVERY XYWH_SHAPE_TYPES layer including 'path', but generatePathLayout() never received it, so
    // it was stored and drawn in the selection UI yet never actually rotated a 'path' layer's own
    // stones). '??' fallback so a pre-RS-3033 saved project (no rotationDeg on its path layers)
    // resolves to 0, byte-identical to before this milestone.
    rotationDeg:layer.rotationDeg??0,
    ...mixedSizeParamsFor(layer)};const result=this.permanentEngine.generatePathLayout(params);const stones=result.stones.map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:s.color,layerId:s.layerId}));return includeStats?{stones,outlineStats:result.outlineStats??null}:stones}
 // RS-2000: the legacy bitmap text engine (FONT5 + generateText/sampleGlyphFill/
 // sampleGlyphStroke/line) and the legacy generateCircle/generateRect/bbox/layerBBox shape path
 // were deleted here -- unreachable since generateTextStonesLive/generateShapeStonesLive took over
 // (RS-0003.5B3/5C1/5C2), and confirmed production-acceptable by this milestone's end-to-end +
 // browser validation (see docs/specifications/RS-2000-MVPStabilizationValidation.md). RC-004
 // replaced the local dedupe() method that used to live here with the shared, physically-correct
 // dedupeStonesByRadius() (src/geometry/StoneSampler.js), imported above and called by generate().
}
const DEFAULT_PROJECT_NAME='Untitled Project';
// S-112: project.plate always carries a normalized plate-params bag (the JSON's own defaults for a
// fresh/non-plate project), even though it is only meaningful once product==='plate' -- this
// avoids a null-check at every call site that reads it (drawCup(), Production Sheet options, the
// plate guide overlay), exactly like project.wrap already exists (and is read) even while a
// cylindrical template that barely uses it is selected.
// RS-2010: project.vessel is the same always-present-but-only-meaningful-for-mug/tumbler/bottle
// params bag, mirroring project.plate above. A fresh project's canvas is now *derived* from the
// vessel defaults (circumference = pi*bodyDiameterMm, height = printableHeightMm) instead of a
// fixed per-template preset -- see docs/specifications/RS-2010-PhysicalProductDimensions.md.
// FONT-002: stoneSize/gap default to RS Block's own recommendedStoneSizeMm/recommendedGapMm (2.8/0.3)
// now that it's the default font, matching the family's own authored pitch (PITCH_MM=3.1 in
// families/rsBlock.js) instead of the generic pre-FONT-002 2/0.3.
// READ-008: height 25 -> 45 so the stored value is ratio-coherent with the 2.8 mm default stone
// (45/2.8 = 16.07, just above MIN_HEIGHT_TO_STONE_RATIO). RS Block is authored, so heightMm is a
// no-op for it -- identical width and stone count at 25, 45 and 60 -- and this changes no output.
function defaultProject(){const vessel=getVesselDefaults('mug');return{version:2,units:'mm',name:DEFAULT_PROJECT_NAME,product:'mug',canvas:computeCanvasFromVessel(vessel),cupColor:'#1f3556',wrap:'front',plate:getPlateDefaults(),vessel,layers:[{id:'text',type:'text',visible:true,text:'Vitalina Serbin',font:DEFAULT_TEXT_FONT_ID,height:45,heightMode:'capHeight',textMode:'stroke',stoneSize:2.8,gap:.3,color:'gold',autoFit:false,curveEnabled:false,curveRadiusMm:40,curveDirection:'outside',curveStartAngleDeg:0,curveSweepAngleDeg:180,curveAlignment:'center',align:'left',lineSpacing:1,rotationDeg:0,letterSpacing:0,x:0,y:0}]}}
// RS-0003.5D1: validates an imported Project JSON file against the exact ad hoc project/layer
// shape #exportProject already produces (JSON.stringify(project)). Throws a specific Error
// describing the first problem found instead of silently accepting a malformed project; the
// caller (the #importProjectFile change handler) surfaces that message via #status and leaves
// the current `project` untouched on failure. Returns a normalized copy on success — it never
// mutates its input.
const SUPPORTED_LAYER_TYPES=new Set(['text','circle','rectangle','svg','image','path',...SHAPE_LIBRARY_KINDS]);
// SEC-001: layer.id is written into HTML attributes (renderLayerUI()'s <option value>/data-layer)
// via innerHTML. Every internally generated id (defaultProject(), duplicateLayer(), the drag-
// duplicate path, and every "add layer" handler) is already a bare type name plus Date.now()
// digits, a strict subset of this pattern -- so this only ever rejects an id that could not have
// been produced by this app, never a legitimate one. See docs/specifications/
// SEC-001-SecureImportedProjects.md.
const LAYER_ID_PATTERN=/^[A-Za-z0-9_-]{1,64}$/;
function validateProject(obj){
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error('Project file must contain a JSON object.');
  const canvas=obj.canvas;
  if(!canvas||typeof canvas.width!=='number'||!Number.isFinite(canvas.width)||canvas.width<=0)throw new Error('project.canvas.width must be a positive number.');
  if(typeof canvas.height!=='number'||!Number.isFinite(canvas.height)||canvas.height<=0)throw new Error('project.canvas.height must be a positive number.');
  if(!Array.isArray(obj.layers)||obj.layers.length===0)throw new Error('project.layers must be a non-empty array.');
  const ids=new Set();
  for(let i=0;i<obj.layers.length;i++){
    const l=obj.layers[i];
    if(!l||typeof l!=='object'||Array.isArray(l))throw new Error(`layers[${i}] must be an object.`);
    if(typeof l.id!=='string'||l.id.length===0)throw new Error(`layers[${i}] is missing a non-empty string id.`);
    if(!LAYER_ID_PATTERN.test(l.id))throw new Error(`layers[${i}] has an invalid id "${l.id}": id must match ${LAYER_ID_PATTERN}.`);
    if(ids.has(l.id))throw new Error(`Duplicate layer id: ${l.id}`);
    ids.add(l.id);
    if(!SUPPORTED_LAYER_TYPES.has(l.type))throw new Error(`Layer "${l.id}" has unsupported type: ${l.type}`);
    if(l.type==='text'&&typeof l.text!=='string')throw new Error(`Text layer "${l.id}" is missing a string 'text' field.`);
    if(l.type==='circle'&&![l.cx,l.cy,l.r].every(n=>typeof n==='number'&&Number.isFinite(n)))throw new Error(`Circle layer "${l.id}" is missing numeric cx/cy/r fields.`);
    // S-110: Rectangle/SVG/Image/Path and every new shape kind (Ellipse/Capsule/Regular Polygon/
    // Star/Heart/Arrow/Cross/Crescent/Ring) all place a natural shape into one x/y/w/h box -- one
    // shared check via XYWH_SHAPE_TYPES, replacing what were four separate identical checks.
    if(XYWH_SHAPE_TYPES.has(l.type)&&![l.x,l.y,l.w,l.h].every(n=>typeof n==='number'&&Number.isFinite(n)))throw new Error(`"${l.type}" layer "${l.id}" is missing numeric x/y/w/h fields.`);
    if(l.type==='svg'&&(typeof l.svgSource!=='string'||l.svgSource.length===0))throw new Error(`SVG layer "${l.id}" is missing a non-empty 'svgSource' string.`);
    // RS-1008: image layers mirror the svg case above (a non-empty self-contained source string),
    // plus their own threshold/blurRadiusPx/maxWidthPx/maxHeightPx pipeline fields. 'invert' is a
    // plain boolean UI toggle, not strictly validated here, matching this function's existing
    // permissive style for other boolean-ish fields (e.g. layer.visible/autoFit).
    if(l.type==='image'&&(typeof l.imageSrc!=='string'||l.imageSrc.length===0))throw new Error(`Image layer "${l.id}" is missing a non-empty 'imageSrc' string.`);
    if(l.type==='image'&&(typeof l.threshold!=='number'||!Number.isFinite(l.threshold)||l.threshold<0||l.threshold>255))throw new Error(`Image layer "${l.id}" is missing a valid 'threshold' (0-255).`);
    if(l.type==='image'&&(typeof l.blurRadiusPx!=='number'||!Number.isFinite(l.blurRadiusPx)||l.blurRadiusPx<0))throw new Error(`Image layer "${l.id}" is missing a valid non-negative 'blurRadiusPx'.`);
    if(l.type==='image'&&![l.maxWidthPx,l.maxHeightPx].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0))throw new Error(`Image layer "${l.id}" is missing valid positive 'maxWidthPx'/'maxHeightPx'.`);
    // RS-1012: a 'path' layer (a Boolean Operation result) stores its shape directly as contours --
    // an array of (0,0)-rooted polygons, each a numeric {x,y}[] with 3+ points.
    if(l.type==='path'&&!(Array.isArray(l.contours)&&l.contours.length>0&&l.contours.every(c=>Array.isArray(c)&&c.length>=3&&c.every(p=>p&&typeof p.x==='number'&&Number.isFinite(p.x)&&typeof p.y==='number'&&Number.isFinite(p.y)))))throw new Error(`Path layer "${l.id}" is missing a valid non-empty 'contours' array.`);
    // RS-3011: 'closed' is a plain boolean, not strictly validated here, matching this function's
    // existing permissive style for other boolean-ish fields (e.g. image.invert above,
    // textMode/svgMode/curveEnabled elsewhere). Absent (every pre-freehand-stroke saved project) or
    // any non-false value defaults to closed:true at the GeometryEngine layer -- see
    // normalizePathParams()'s own doc comment.
    // RS-3011 Step 10a: 'regions' (Paint) is a 'path' layer's own optional array of
    // {id,contour,stoneSizeMm,gapMm,color,fill mode} sub-areas, not strictly validated here either --
    // same permissive precedent as 'closed' above and curveEnabled elsewhere. Passed
    // through untouched by the `{...l}` spread below either way; absent or empty on every layer
    // predating this step, which GeometryEngine.normalizePathParams()'s own regions normalizer
    // treats as a safe no-op (see its doc comment).
    // RS-3011 Step 12: 'stampedStones' (Stamp) is a 'path' layer's own optional array of
    // {id,xMm,yMm,sizeMm,color} manually-placed stones, following the identical "not strictly
    // validated here" convention as 'regions' immediately above -- absent/empty on every layer
    // predating this step, a safe no-op per GeometryEngine.normalizePathParams()'s own
    // stampedStones normalizer.
    // S-110: Regular Polygon/Star/Ring's own configurable extra parameters, matching
    // GeometryEngine's own assertIntegerInRange()/assertNumberInRange() validation ranges (see
    // src/geometry/GeometryEngine.js's normalizeShapeParams()) so a malformed saved value is caught
    // here, at load time, rather than surfacing later as a thrown error during generation.
    if(l.type==='polygon'&&!(Number.isInteger(l.sides)&&l.sides>=3&&l.sides<=12))throw new Error(`Regular Polygon layer "${l.id}" is missing a valid integer 'sides' field (3-12).`);
    if(l.type==='star'&&!(Number.isInteger(l.points)&&l.points>=3&&l.points<=12))throw new Error(`Star layer "${l.id}" is missing a valid integer 'points' field (3-12).`);
    if(l.type==='star'&&!(typeof l.innerRadiusRatio==='number'&&Number.isFinite(l.innerRadiusRatio)&&l.innerRadiusRatio>=0.1&&l.innerRadiusRatio<=0.9))throw new Error(`Star layer "${l.id}" is missing a valid 'innerRadiusRatio' field (0.1-0.9).`);
    if(l.type==='ring'&&!(typeof l.innerRatio==='number'&&Number.isFinite(l.innerRatio)&&l.innerRatio>=0.1&&l.innerRatio<=0.9))throw new Error(`Ring layer "${l.id}" is missing a valid 'innerRatio' field (0.1-0.9).`);
    if(typeof l.stoneSize!=='number'||!Number.isFinite(l.stoneSize)||l.stoneSize<=0)throw new Error(`Layer "${l.id}" is missing a positive numeric stoneSize.`);
    if(typeof l.gap!=='number'||!Number.isFinite(l.gap)||l.gap<0)throw new Error(`Layer "${l.id}" is missing a non-negative numeric gap.`);
  }
  // RS-1004: product is normalized through getObjectTemplate()'s own permissive fallback (unknown
  // or missing ids resolve to 'mug'), so project.product is always a real, known template id —
  // matching this function's existing permissive style for cupColor/wrap (never throws for
  // unrecognized values).
  // RS-1005: project.name follows the exact same permissive-default style — a missing/non-string
  // name (e.g. every pre-RS-1005 Project JSON file) resolves to DEFAULT_PROJECT_NAME rather than
  // throwing, so old files keep importing cleanly.
  // S-112: project.plate is a new, optional top-level field, present/meaningful only when
  // product==='plate'. Every pre-S-112 Project JSON (Mug/Tumbler/Bottle) has no such field at all;
  // normalizePlateParams(undefined) returns the JSON's own defaults, so this never throws and never
  // needs obj.plate to exist. Backward compatible by construction — see
  // docs/specifications/S-112-RoundDinnerPlate.md, "Project Schema Impact".
  // RS-2010: project.vessel is the mug/tumbler/bottle counterpart of project.plate above, but with
  // one extra wrinkle -- a *legacy* project (no obj.vessel at all) must never have its canvas
  // recomputed from vessel defaults (that would silently change project.canvas.width/height, and so
  // GeometryEngine's output, for every old save). Instead deriveLegacyVesselParams() reverses
  // today's existing ratio/circumference formulas from the project's own (untouched) canvas.width/
  // height, so project.vessel is populated with values that describe that exact canvas, not a
  // fresh product default. project.canvas itself is never touched here — only the two live-editing
  // call sites (object-type switch, vessel-field edit in writeSelectedControlsToLayer()) ever derive
  // canvas *from* vessel. See docs/specifications/RS-2010-PhysicalProductDimensions.md, "Migration &
  // compatibility strategy".
  const productId=getObjectTemplate(obj.product).id;
  const hasExplicitVessel=obj.vessel&&typeof obj.vessel==='object';
  const vessel=VESSEL_PRODUCT_IDS.includes(productId)
    ?(hasExplicitVessel?normalizeVesselParams(productId,obj.vessel):deriveLegacyVesselParams(productId,getObjectTemplate(productId),canvas.width,canvas.height))
    :(hasExplicitVessel?normalizeVesselParams('mug',obj.vessel):getVesselDefaults('mug'));
  return{version:Number(obj.version)||2,units:obj.units==='in'?'in':'mm',name:typeof obj.name==='string'&&obj.name.length>0?obj.name:DEFAULT_PROJECT_NAME,product:productId,canvas:{width:canvas.width,height:canvas.height},cupColor:typeof obj.cupColor==='string'?obj.cupColor:'#1f3556',wrap:typeof obj.wrap==='string'?obj.wrap:'front',plate:normalizePlateParams(obj.plate),vessel,layers:obj.layers.map(l=>({...l,visible:l.visible!==false}))}
}
// TXT-101A: pure construction data (no fetch), so it's always available even if the desktop-font
// manifest fetch below fails -- the Browse Fonts panel's category/metadata lookups for RS Block/RS
// Modern/RS Script never depend on network success.
const rhinestoneFontRegistry=createDefaultRhinestoneFontRegistry();
let fontProviderRegistry=null,permanentEngineError=null,fontManager=null;
try{fontManager=await FontManager.fromUrl('./assets/fonts/manifest.json');fontProviderRegistry=createDefaultFontProviderRegistry(fontManager,{rhinestoneFontRegistry});TEXT_ENGINE_FONT_IDS=new Set(fontManager.listFonts().map(f=>f.id))}catch(error){permanentEngineError=error;console.error('Font manifest failed to load; text layers will render empty until this is resolved. Shape layers are unaffected.',error)}
// TXT-101A: given a fontId already known-valid against TEXT_ENGINE_FONT_IDS (see the fallback
// pattern at every generateTextStonesLive()/resolveLayerShapeSource()/fitTextToShape() call site),
// resolves which FontProviderRegistry provider should render it. Falls back to 'opentype' (the
// registry's own default) for any font predating this field or if fontManager never loaded.
function resolveFontProviderId(fontId){return fontManager&&fontManager.hasFont(fontId)?fontManager.getFont(fontId).providerId:'opentype'}
// FONT-002: the one shared predicate every authored-stone-font capability gate (curve, Fill Style,
// Text height/Auto fit, Fit Text to Shape, Boolean Operations messaging) reads, so "which text
// features don't apply to this font" is decided in exactly one place. True for any font whose
// provider supplies FontProviderResult.stoneCenters instead of a vector outline (currently just the
// 'rhinestone' provider -- see RhinestoneFontProvider.js/stone-map-technique memory).
function isAuthoredStoneFontId(fontId){return resolveFontProviderId(fontId)==='rhinestone'}
// True only for a font id FontManager actually has a record for -- distinct from "is it offered in
// the normal picker" (productionFonts() above is a stricter subset). A layer can have a known-but-
// legacy font (isFontKnown true, isAuthoredStoneFontId false, not in productionFonts()) or a
// genuinely unknown one (isFontKnown false) -- see generateTextStonesLive()'s handling of the latter.
function isFontKnown(fontId){return Boolean(fontManager&&fontManager.hasFont(fontId))}
const permanentEngine=new PermanentGeometryEngine({fontProviderRegistry});
// MONO-006: MonogramGenerator needs generateTextLayout()/scaleAuthoredTextLayout()/
// generatePathLayout() directly -- the *permanent* engine, not the local GeometryEngine wrapper
// below (which only exposes app.js's own live-regeneration helpers).
const monogramGenerator=new MonogramGenerator({geometryEngine:permanentEngine});
const engine=new GeometryEngine(permanentEngine);let project=defaultProject(),selectedLayerId='text',layout=null,rotation=0,zoom=1,layoutTransform=null,drag=null,generationToken=0;const layoutCanvas=el('layout'),cupCanvas=el('cup');
// RS-3011 Step 13: Eraser's own brush-size preference -- NOT project data, NOT per-layer (a
// brush-size preference persists across whatever the user erases next, the same way brush size
// behaves in any raster tool). radiusMm is seeded from the selected layer's own stoneSize (mirrors
// getStoneDefaults()'s own `base.stoneSize||2` convention below) the FIRST time Eraser mode is
// entered in this session -- see seedEraserRadiusIfNeeded() below -- then left exactly as the user
// sets it afterward via #eraserRadiusMm or the '['/']' shortcuts, regardless of which layer they
// later erase on.
const eraserSettings={radiusMm:1,mode:'stones'};
let eraserRadiusSeeded=false;
// RS-3014 Step 1: Stamp/Trace/Paint's own independent tool-level style preferences -- same
// "NOT project data, NOT per-layer" precedent as eraserSettings just above, mirrored three times.
// Each is seeded from the selected layer's own stoneSize/gap/color (the same `base.stoneSize||2` /
// `base.gap||.3` / `base.color||'gold'` convention getStoneDefaults() below uses) the FIRST time
// its own tool is entered in this session -- see seedStampStyleIfNeeded()/seedTraceStyleIfNeeded()/
// seedPaintStyleIfNeeded() below -- then left exactly as the user sets it afterward via its own
// panel fields, regardless of which layer they next act on. The three are deliberately independent
// of each other and of eraserSettings -- not a single shared "draw style" object.
const stampSettings={sizeMm:2,color:'gold'};
let stampStyleSeeded=false;
const traceSettings={sizeMm:2,gapMm:0.3,color:'gold'};
let traceStyleSeeded=false;
const paintSettings={sizeMm:2,gapMm:0.3,color:'gold'};
let paintStyleSeeded=false;
// Bugfix (BooleanPrecisionError at the gesture boundary): the sentinel resolvePaintTargetTwoPass()
// returns when a selectPaintTarget() call below throws BooleanPrecisionError (a small/precise
// stroke against a much larger candidate shape -- see PathBoolean.js's own computeAdaptiveCellSizeMm()
// doc comment) instead of resolving normally. Deliberately NOT null: null already means "genuinely
// overlaps nothing," a different case that must keep its own existing (silent/no-status-change)
// handling -- callers duck-type on `.precisionError` (a plain object, not a class/Symbol, so
// DrawingCanvasTool.js can recognize it without importing anything from this module, matching this
// codebase's existing resolveSelectionTarget/hitTestRegion plain-object-contract convention).
const PAINT_TARGET_PRECISION_ERROR=Object.freeze({precisionError:true});
// RS-3013 Step 1: the target-shape resolution Paint's own onPaintStroke below needs (best-overlap-
// by-area, two-pass: a fallback-spacing pass to pick a winner, then that winner's own stoneSize+gap
// for a precise intersection) is the EXACT SAME resolution Select's rectangle-drag and Lasso's own
// drag need too (see the new resolveSelectionTarget hook below) -- extracted here so both go
// through one implementation rather than two copies of the same selectPaintTarget() choreography.
// Returns null wherever either pass would have (no candidate overlaps at all, or the second pass's
// own intersection comes back empty) -- callers that want a console message for the common "lasso
// touched nothing" case (onPaintStroke) log it themselves. Bugfix: returns the distinct
// PAINT_TARGET_PRECISION_ERROR sentinel above instead of null when either selectPaintTarget() call
// throws BooleanPrecisionError -- any other error type is rethrown unchanged, this function only
// ever absorbs this one specific, known error class.
function resolvePaintTargetTwoPass(polygonsAbsoluteMm){
  if(!permanentEngine)return null;
  const candidates=project.layers.filter(l=>l.type==='path'&&l.visible!==false).map(l=>({
    layerId:l.id,
    // RS-3014 Step 3: naturalBoundingBoxMm forwarded so a previously-cut layer's candidate
    // polygon reflects its true (frozen-box-anchored) visible shape, not one stretched back to
    // its unchanged x/y/w/h -- without this, selectPaintTarget()'s own intersection below would
    // compute against a shape wider than what's actually on screen, letting a region extend past
    // the shape's real (cut) boundary even after absolutePolygonsToNaturalSpace()'s own fix.
    polygons:permanentEngine.resolvePathPolygons({
      contours:l.contours.map(c=>c.map(p=>({xMm:p.x,yMm:p.y}))),
      layerId:l.id,xMm:l.x,yMm:l.y,widthMm:l.w,heightMm:l.h,naturalBoundingBoxMm:l.naturalBoundingBoxMm
    }).polygons
  }));
  // First pass: which candidate does the stroke/rectangle overlap most? The exact grid resolution
  // barely matters for THIS decision (only for the stored contour's precision, refined below once
  // the target is known) -- the currently-selected layer's own stone spacing is a reasonable,
  // already-established fallback (same convention getStoneDefaults() above uses for a brand-new
  // shape).
  const fallback=selectedLayer();
  let firstPass;
  try{
    firstPass=selectPaintTarget(polygonsAbsoluteMm,candidates,{targetSpacingMm:(fallback.stoneSize||2)+(fallback.gap||.3)});
  }catch(error){
    if(!(error instanceof BooleanPrecisionError))throw error;
    return PAINT_TARGET_PRECISION_ERROR;
  }
  if(!firstPass)return null;
  const targetLayer=project.layers.find(l=>l.id===firstPass.layerId);
  const targetCandidate=candidates.find(c=>c.layerId===firstPass.layerId);
  if(!targetLayer||!targetCandidate)return null;
  // Second pass, against ONLY the winning candidate, at ITS OWN stone spacing -- once a target is
  // known, its own stoneSize+gap are authoritative for grid resolution (per Paint's own original
  // step prompt), not the fallback used to pick it above. One extra combineShapeSources() call per
  // gesture (not per frame) is an accepted cost -- see PaintRegionSelection.js's own targetSpacingMm
  // doc comment.
  let result;
  try{
    result=selectPaintTarget(polygonsAbsoluteMm,[targetCandidate],{targetSpacingMm:targetLayer.stoneSize+targetLayer.gap});
  }catch(error){
    if(!(error instanceof BooleanPrecisionError))throw error;
    return PAINT_TARGET_PRECISION_ERROR;
  }
  if(!result)return null;
  return{layerId:targetLayer.id,contours:result.contours};
}
// RS-3012 Step 1: Stamp/Trace's own selection-boundary test -- called with the raw click/drag
// point (absolute project-mm) and DrawingCanvasTool.js's own live `activeSelection` value (passed
// straight through, not re-read via drawingTool.activeSelection, since the caller already has it
// in scope the same way onStampPlace/onTracePlace's own layerId is already resolved by the time
// they're called). Mirrors hitTestRegion's own architecture split immediately above: a region's
// geometry lives in project.layers[].regions, so 'region'-kind selections resolve through the SAME
// layer/region lookup + computeNaturalContourTransform()/applyNaturalContourTransform() chain
// onRegionMoved above already uses, deriving the region's CURRENT absolute polygon (a region's own
// contour is natural-space and can shift with its parent shape) before testing with
// isPointInsidePolygons() (single ring, wrapped as [polygon], same convention
// hitTestPathLayerRegion() itself uses internally via isPointNearPolygon()). 'draft'-kind
// selections carry their own already-absolute-mm geometry directly on boundsOrContour -- no
// project.layers lookup needed -- so a rect draft gets a plain axis-aligned bounds test and a
// lasso draft's boundsOrContour (already the clipped {xMm,yMm}[][] contours
// resolveSelectionTarget's own selectPaintTarget() resolution produced at creation time) goes
// straight into isPointInsidePolygons() unwrapped, preserving any holes exactly like the region
// case. No margin/tolerance anywhere here (unlike REGION_HIT_MARGIN_PX's own click-forgiveness) --
// a hard interior test, since this gates whether a stone gets placed at all, not whether a click
// located something to select.
// Bulk-delete-by-area: pulled out to a standalone top-level function (was previously only an inline
// arrow function inside the drawingTool hooks object below) so deleteCurrentSelection()'s new
// 'draft' branch can call the exact same test app.js already hands to DrawingCanvasTool.js as its
// isPointInActiveSelection hook, instead of a second reimplementation. The hooks object below now
// just references this by shorthand.
function isPointInActiveSelection(pointAbsoluteMm,selection){
  if(!selection)return true;
  if(selection.kind==='region'){
    const targetLayer=project.layers.find(l=>l.id===selection.layerId&&l.type==='path');
    if(!targetLayer)return false;
    const region=(targetLayer.regions||[]).find(r=>r.id===selection.regionId);
    if(!region)return false;
    const naturalContours=targetLayer.contours.map(contour=>contour.map(p=>({xMm:p.x,yMm:p.y})));
    const transform=computeNaturalContourTransform(naturalContours,targetLayer.x,targetLayer.y,targetLayer.w,targetLayer.h,targetLayer.naturalBoundingBoxMm);
    if(!transform)return false;
    const polygon=applyNaturalContourTransform(region.contour,transform);
    return isPointInsidePolygons(pointAbsoluteMm,[polygon]);
  }
  if(selection.kind==='draft'){
    if(selection.shapeKind==='rect'){
      const b=selection.boundsOrContour;
      return pointAbsoluteMm.xMm>=b.left&&pointAbsoluteMm.xMm<=b.left+b.width&&pointAbsoluteMm.yMm>=b.top&&pointAbsoluteMm.yMm<=b.top+b.height;
    }
    if(selection.shapeKind==='lasso'){
      return isPointInsidePolygons(pointAbsoluteMm,selection.boundsOrContour);
    }
  }
  return true;
}
// RS-3010 Step 1: one drawing tool bound to layoutCanvas for the app's lifetime -- it lazily calls
// paper.setup() on first enter() and only pauses/resumes afterward (see DrawingCanvasTool.js's own
// header comment for why), so constructing it eagerly here does not touch the canvas until the
// user actually enables Draw mode.
// RS-3011 Step 1: hooks let DrawingCanvasTool.js construct+push each shape's 'path' layer the
// instant it finalizes (freehand stroke end, a preset's drag-end, polygon close) without touching
// project state itself -- app.js stays the only owner of `project`, matching this file's own
// "never touches project state" doc comment on the old commit()/DrawingBoard.js.
const drawingTool=createDrawingTool(layoutCanvas,{
  // stoneSize/gap/color default from the currently-selected layer, the same convention
  // createShapeLayer()/the SVG-import handler elsewhere in this file already use for a brand-new
  // shape.
  getStoneDefaults:()=>{const base=selectedLayer();return{stoneSize:base.stoneSize||2,gap:base.gap||.3,color:base.color||'gold'}},
  // Hands the constructed layer (same object shape app.js's Boolean Operations code already
  // produces, RS-1012) to the existing project.layers/updateAll() pipeline unchanged --
  // commitHistory() before the push, exactly like every other single-shape creation path in this
  // file (addRect, duplicateLayer, the SVG-import handler, ...).
  onShapeCommitted:(layer)=>{
    commitHistory();
    project.layers.push(layer);
    selectedLayerId=layer.id;
    selectedLayerIds=selectOnly(layer.id);
    syncSelectedControlsFromLayer();
    updateAll(true);
    // RS-3011 issue #4a fix: DrawingCanvasTool.js already reverted its own internal mode to
    // 'select' before calling this hook (see commitFinalizedShape()) -- sync the rail buttons'
    // aria-pressed state to match, or Rect/Ellipse/Slot/Polygon would keep looking active after
    // the shape that finalized them already returned Design to Select.
    updateDrawToolButtons();
    el('status').textContent='Added shape as new Path layer.';
  },
  // RS-3026: fires every time DrawingCanvasTool.js's applyViewport() runs (zoom change, pan,
  // initial Design-mode entry, resize) -- keeps the scale bar live while Design mode is active.
  // drawingTool.pxPerMm (Paper's own view.zoom) is already CSS-px-per-mm, unlike the plain
  // canvas's device-px-per-mm layoutTransform.s, so this passes 1 in place of dpr -- passing the
  // real devicePixelRatio here would make the bar render dpr× too narrow.
  onViewportChanged:()=>{
    if(!drawingTool.isActive)return;
    updateScaleBar(drawingTool.pxPerMm,1);
    el('scaleBar').style.display='flex';
  },
  // RS-3011 Step 10b: Paint's own finalize hook -- fires once per finished lasso stroke (see
  // DrawingCanvasTool.js's own onPaintStroke doc comment for exactly when/what `lassoPolygons` is).
  // Per this milestone's architecture split, this module owns every selectPaintTarget()/
  // absolutePolygonsToNaturalSpace() call and every project.layers mutation; DrawingCanvasTool.js's
  // own involvement ends at handing over the closed lasso polygon. RS-3011 issue #4a fix precedent
  // applies here too: DrawingCanvasTool.js already reverted its own internal mode to 'select'
  // before calling this hook (see its onMouseUp 'paint' branch) -- updateDrawToolButtons() below
  // syncs the rail to match, unconditionally, even on the silent-discard path, for the same reason
  // onShapeCommitted() above always calls it.
  onPaintStroke:async(lassoPolygons)=>{
    updateDrawToolButtons();
    const resolved=resolvePaintTargetTwoPass(lassoPolygons);
    // Bugfix: distinct from the "genuinely overlaps nothing" case right below -- this stroke DID
    // overlap a candidate, but the intersection couldn't be computed at a safe precision (see
    // PAINT_TARGET_PRECISION_ERROR's own doc comment). No region created, no history entry, same
    // "no mutation happened" behavior as the null case, just a status message that tells the user
    // WHY instead of leaving Paint looking unresponsive.
    if(resolved===PAINT_TARGET_PRECISION_ERROR){
      el('status').textContent='Paint: this stroke is too small/precise for a shape this large — try a bigger area.';
      return;
    }
    if(!resolved){console.info('Paint: lasso overlaps no path layer, discarding stroke.');return;}
    const targetLayer=project.layers.find(l=>l.id===resolved.layerId);
    if(!targetLayer)return;
    // RS-3011 Step 10b DECISION (Sasha delegated, confirmed during scoping): a lasso crossing a
    // concave notch or a hole can genuinely intersect its target in multiple disjoint pieces --
    // create ONE region per disjoint contour rather than keeping only the largest piece or
    // rejecting the whole stroke, so the result matches what the user actually painted. The
    // region data model is already an array, so this is more of an existing capability, not a new
    // one. All new regions share the same stone spec and land in the SAME commitHistory() below, so
    // the whole stroke is one undo step. absolutePolygonsToNaturalSpace() is called once with every
    // contour together (not once per contour) since it applies the identical transform to each ring
    // regardless -- an efficiency choice, not a behavior difference from calling it per-contour.
    const naturalContours=absolutePolygonsToNaturalSpace(resolved.contours,targetLayer);
    // RS-3014 Step 1: the new region(s)' own decoration style now comes from Paint's own independent
    // paintSettings, NOT targetLayer's current stoneSize/gap/color -- unlike the two
    // targetSpacingMm calls above (selectPaintTarget()'s boolean-geometry grid resolution, a
    // precision concern this milestone deliberately leaves reading the real target layer's live
    // values).
    const newRegions=naturalContours.map((contour,index)=>({
      id:'region'+Date.now()+index,
      contour,
      stoneSizeMm:paintSettings.sizeMm,
      gapMm:paintSettings.gapMm,
      color:paintSettings.color,
      fillMode:'fill'
    }));
    commitHistory();
    if(!Array.isArray(targetLayer.regions))targetLayer.regions=[];
    targetLayer.regions.push(...newRegions);
    drawingTool.refreshStoneGroupForLayer(targetLayer.id);
    await updateAll(true);
    el('status').textContent=`Painted ${newRegions.length} region${newRegions.length===1?'':'s'} on ${layerLabel(targetLayer)}.`;
  },
  // RS-3013 Step 1: Select's rectangle-drag and Lasso's own drag both resolve their target shape
  // through this hook -- the EXACT SAME selectPaintTarget() two-pass resolution onPaintStroke()
  // above uses (resolvePaintTargetTwoPass(), shared rather than duplicated), just returning the
  // result instead of ever touching project.layers: this milestone's drag gestures only produce a
  // transient in-memory selection (activeSelection, DrawingCanvasTool.js's own state), never a real
  // region -- that stays Paint's job alone. DrawingCanvasTool.js clips the returned `contours` to
  // build Lasso's own draft polygon (this milestone's clip-at-creation decision for Lasso); Select's
  // own rectangle-drag reuses only `.layerId` and stores the drawn rectangle unclipped -- see that
  // file's own onMouseUp 'lasso'/'selectRect' branches for exactly how each consumes this result.
  // Bugfix: a straight passthrough of resolvePaintTargetTwoPass()'s own return value, so the
  // PAINT_TARGET_PRECISION_ERROR sentinel (see that function's own doc comment) reaches
  // DrawingCanvasTool.js unchanged, never collapsed into null here -- that file's own onMouseUp
  // 'lasso'/'selectRect' branches duck-type on `.precisionError` to call the new
  // onSelectionTargetPrecisionError hook below instead of silently discarding.
  resolveSelectionTarget:(polygonsAbsoluteMm)=>resolvePaintTargetTwoPass(polygonsAbsoluteMm),
  // Bugfix: mirrors onStampRejected/onTraceRejected below -- fires instead of resolveSelectionTarget's
  // own {layerId,contours}/null outcomes when that call hit the PAINT_TARGET_PRECISION_ERROR sentinel
  // (a small/precise Select-rectangle-drag or Lasso stroke against a much larger candidate shape). No
  // draft selection created, no history entry -- same "no mutation happened" behavior as a genuine
  // no-overlap result, just a status message distinct from both that one and each other.
  onSelectionTargetPrecisionError:()=>{
    el('status').textContent='Select/Lasso: this selection is too small/precise for a shape this large — try a larger area.';
  },
  // RS-3013 Step 1: region click-select's own hit-test. DrawingCanvasTool.js never touches
  // project.layers directly (this milestone's own architecture split, same rule Paint's
  // onPaintStroke above already follows) -- a region lives entirely in project.layers[].regions, so
  // resolving "which region does this point land on" has to happen here, delegated in one line to
  // hitTestPathLayerRegion() (src/geometry/PaintRegionSelection.js), the same natural-to-absolute
  // placement transform GeometryEngine's own _applyPathRegions() uses to place a region for stone
  // generation. marginMm arrives already converted from screen-px by the caller (DrawingCanvasTool.js's
  // own screen-px-to-project-mm convention, see that file's REGION_HIT_MARGIN_PX).
  hitTestRegion:(pointAbsoluteMm,marginMm)=>hitTestPathLayerRegion(pointAbsoluteMm,project.layers.filter(l=>l.type==='path'&&l.visible!==false),marginMm),
  // RS-3013 Step 2: region-drag's own commit hook -- fires once, at mouseup only, on a real
  // (non-zero-offset) region-move drag. Synchronous and returns the region's updated absolute-mm
  // polygon (or null), NOT async/awaited like onPaintStroke/onStampPlace/onTracePlace/onEraseSweep
  // above -- DrawingCanvasTool.js's own onMouseUp reads this return value immediately to rebuild
  // activeSelectionItem's outline, so it can't be a Promise (updateAll(true) below is fired the same
  // "call, don't await" way nudgeSelection()/runAlign()/runDistribute() already do elsewhere in this
  // file). Derives the region's CURRENT absolute polygon via the SAME computeNaturalContourTransform()/
  // applyNaturalContourTransform() pair hitTestPathLayerRegion() itself uses internally (never an
  // independently-recomputed transform), translates it by (dxMm,dyMm), then writes it back through
  // the EXISTING absolutePolygonsToNaturalSpace() -- the same inverse-transform path onPaintStroke's
  // own region creation above already relies on, just run once more on an existing region's contour.
  // DECIDED (this milestone's own scoping): no clipping/rejection against the parent shape's current
  // outline here -- GeometryEngine's own _applyPathRegions() already filters every region's stone
  // candidates against the shape's live outline at every regen, so a region moved partly or fully
  // outside its shape simply renders fewer/zero stones there, self-correcting the moment it's moved
  // back, with zero new boundary code needed.
  onRegionMoved:(layerId,regionId,dxMm,dyMm)=>{
    const targetLayer=project.layers.find(l=>l.id===layerId&&l.type==='path');
    if(!targetLayer)return null;
    const region=(targetLayer.regions||[]).find(r=>r.id===regionId);
    if(!region)return null;
    const naturalContours=targetLayer.contours.map(contour=>contour.map(p=>({xMm:p.x,yMm:p.y})));
    const transform=computeNaturalContourTransform(naturalContours,targetLayer.x,targetLayer.y,targetLayer.w,targetLayer.h,targetLayer.naturalBoundingBoxMm);
    if(!transform)return null;
    const currentPolygon=applyNaturalContourTransform(region.contour,transform);
    const translatedPolygon=currentPolygon.map(p=>({xMm:p.xMm+dxMm,yMm:p.yMm+dyMm}));
    const [naturalContour]=absolutePolygonsToNaturalSpace([translatedPolygon],targetLayer);
    if(!naturalContour)return null;
    commitHistory();
    region.contour=naturalContour;
    drawingTool.refreshStoneGroupForLayer(targetLayer.id);
    updateAll(true);
    el('status').textContent=`Moved region on ${layerLabel(targetLayer)}.`;
    return translatedPolygon;
  },
  // RS-3013 Step 5: fires whenever DrawingCanvasTool.js settles on a new activeSelection (a region
  // click, a region losing selection, a draft rect/lasso selection, or a clear) -- the one place the
  // Inspector panel needs to resync for a region-vs-shape selection change, since neither gesture
  // routes through onSelectionChanged above (that hook only ever reports shape/multi-selection
  // changes via selectedIds, never activeSelection). syncSelectedControlsFromLayer() reads
  // drawingTool.activeSelection itself (not a parameter here) to decide whether to show the region
  // branch or fall through to today's layer-based population, same live-read convention
  // writeSelectedControlsToLayer()'s own new region branch uses. Mirrors the exact
  // sync+render+editingUI+regen sequence onSelectionChanged already runs for a shape selection
  // change (line ~1368) -- updateAll(true) is a no-op regen (skipWrite) here since nothing in
  // project.layers changed, only the display.
  onActiveSelectionChanged:()=>{
    syncSelectedControlsFromLayer();renderLayerUI();updateEditingUI();updateAll(true);
  },
  // RS-3011 Step 12: Stamp's own finalize hook -- fires once per click (see DrawingCanvasTool.js's
  // own onStampPlace doc comment for the exact {xMm,yMm,layerId} contract; layerId is already
  // resolved there via the same hitTestShapeId() Select's own click-to-pick-a-shape branch uses).
  // Mirrors onPaintStroke's own architecture split immediately above: this module owns the
  // absolute-to-natural-space absolutePolygonsToNaturalSpace() conversion and every project.layers
  // mutation; DrawingCanvasTool.js's own involvement ends at resolving the target and handing over
  // the click point. A null layerId (click hit no shape) discards silently, matching Paint's own "no
  // target -> discard" precedent -- no history session opened, no status message. Unlike Paint/every
  // draw preset, `mode` is deliberately left at 'stamp' either way: Stamp is a repeatable
  // click-to-place action (like an image editor's own stamp tool), not a one-shot commit-then-
  // revert-to-Select gesture, so there's no updateDrawToolButtons() call here either.
  // RS-3012 Step 1 / bulk-delete-by-area: now a standalone top-level function (see its own doc
  // comment above, near resolvePaintTargetTwoPass) referenced here by shorthand so
  // deleteCurrentSelection()'s new 'draft' branch can call the exact same test.
  isPointInActiveSelection,
  // RS-3012 Step 1: fires instead of onStampPlace when a click resolves outside the active
  // selection's own boundary -- no history session, no stone placed, matching decided item 2's
  // "reject with feedback" contract (never silent, never "allow anyway").
  onStampRejected:()=>{
    el('status').textContent='Stamp: click is outside the current selection.';
  },
  // RS-3012 Step 1: fires instead of onTracePlace when EVERY point of a committed Trace drag falls
  // outside the active selection's own boundary (the filtered placements list is empty) -- no
  // history session, no stones placed. Deliberately distinct from today's pre-existing "fewer than 2
  // buffered points" silent discard (DrawingCanvasTool.js's own trace mouseup branch) -- that discard
  // has no message; a selection-caused empty result must not be silent, per decided item 2.
  onTraceRejected:()=>{
    el('status').textContent='Trace: entire stroke was outside the selection.';
  },
  onStampPlace:async({xMm,yMm,layerId})=>{
    if(!layerId)return;
    const targetLayer=project.layers.find(l=>l.id===layerId&&l.type==='path');
    if(!targetLayer)return;
    // Feeds absolutePolygonsToNaturalSpace() a single-point "polygon" ([[{xMm,yMm}]]) rather than
    // duplicating computeNaturalContourTransform/applyNaturalContourTransform logic here -- same
    // precedent as onPaintStroke's own call just above, just with a 1-point ring instead of a real
    // lasso contour. Returns [] (not a per-point null) when targetLayer has no placeable transform
    // (empty contours) -- guarded the same way a missing target is above.
    const naturalPolygons=absolutePolygonsToNaturalSpace([[{xMm,yMm}]],targetLayer);
    if(naturalPolygons.length===0)return;
    const naturalPoint=naturalPolygons[0][0];
    const stamp={
      id:'stamp'+Date.now(),
      xMm:naturalPoint.xMm,
      yMm:naturalPoint.yMm,
      // RS-3014 Step 1: sizeMm/color now come from Stamp's own independent stampSettings, seeded
      // from the target layer's stoneSize/color the first time Stamp is used this session (see
      // seedStampStyleIfNeeded() below) and left alone afterward, superseding RS-3011 Step 12's
      // "read the target layer's CURRENT fields at click time" convention.
      sizeMm:stampSettings.sizeMm,
      color:stampSettings.color
    };
    commitHistory();
    if(!Array.isArray(targetLayer.stampedStones))targetLayer.stampedStones=[];
    targetLayer.stampedStones.push(stamp);
    drawingTool.refreshStoneGroupForLayer(targetLayer.id);
    await updateAll(true);
    el('status').textContent=`Placed a stone on ${layerLabel(targetLayer)}.`;
  },
  // RS-3011 Step 11: Trace's own finalize hook -- fires once per committed drag (see
  // DrawingCanvasTool.js's own onTracePlace doc comment for the exact (placements,layerId) contract;
  // layerId is already resolved there via the same target-hit-test resolveStampTargetLayerId() uses).
  // Mirrors onStampPlace's own architecture split immediately above, just plural: this module owns
  // the absolute-to-natural-space absolutePolygonsToNaturalSpace() conversion and every project.layers
  // mutation, DrawingCanvasTool.js's own involvement ends at computing the spaced points and
  // resolving the target. A null layerId or empty placements list discards silently, matching Stamp's
  // own "no target -> discard" precedent -- no history session opened, no status message. Every
  // placement in `placements` becomes one src/geometry/lineStampSpacing.js-spaced stone, pushed into
  // the SAME layer.stampedStones array Stamp itself uses (RS-3011 Step 11's own key simplification --
  // no new layer field, no GeometryEngine.js changes), all in the ONE commitHistory() below so one
  // drawn line is one undo step (mirrors Paint's own "one lasso -> N regions -> one commit"
  // precedent). Like Stamp, `mode` is deliberately left at 'trace' either way -- Trace stays active
  // after each committed line, so there's no updateDrawToolButtons() call here either.
  // RS-3012 Step 1: droppedCount is a new, optional 3rd argument -- how many of the drag's own
  // originally-spaced points DrawingCanvasTool.js filtered out for landing outside an active
  // selection, before this hook ever saw them (0/undefined when no selection was active, the
  // byte-identical-to-before case). Only changes the status message below; every mutation/placement
  // path is otherwise untouched from RS-3011 Step 11.
  onTracePlace:async(placements,layerId,droppedCount=0)=>{
    if(!layerId||!placements.length)return;
    const targetLayer=project.layers.find(l=>l.id===layerId&&l.type==='path');
    if(!targetLayer)return;
    // Feeds absolutePolygonsToNaturalSpace() the whole placements array as one "polygon" -- it's
    // purely a coordinate transform, so an open polyline in place of a closed ring is fine (same
    // precedent as onStampPlace's own 1-point-ring call just above).
    const naturalPolygons=absolutePolygonsToNaturalSpace([placements],targetLayer);
    if(naturalPolygons.length===0)return;
    const naturalPoints=naturalPolygons[0];
    const stamps=naturalPoints.map((p,index)=>({
      id:'stamp'+Date.now()+'-'+index,
      xMm:p.xMm,
      yMm:p.yMm,
      // RS-3014 Step 1: sizeMm/color now come from Trace's own independent traceSettings, seeded
      // from the target layer's stoneSize/color the first time Trace is used this session (see
      // seedTraceStyleIfNeeded() below) and left alone afterward, superseding RS-3011 Step 11
      // decision 2's "read the target layer's CURRENT fields at release time" convention.
      sizeMm:traceSettings.sizeMm,
      color:traceSettings.color
    }));
    commitHistory();
    if(!Array.isArray(targetLayer.stampedStones))targetLayer.stampedStones=[];
    targetLayer.stampedStones.push(...stamps);
    drawingTool.refreshStoneGroupForLayer(targetLayer.id);
    await updateAll(true);
    el('status').textContent=droppedCount>0
      ?`Traced ${stamps.length} stone${stamps.length===1?'':'s'} (${droppedCount} outside selection, skipped).`
      :`Traced ${stamps.length} stone${stamps.length===1?'':'s'} on ${layerLabel(targetLayer)}.`;
  },
  // RS-3011 Step 13: Eraser's own finalize hook -- fires once per committed click/drag sweep (see
  // DrawingCanvasTool.js's own onEraseSweep doc comment for the exact (daubsAbsoluteMm,layerId)
  // contract; layerId is always a real project.layers id there -- a null/no-target resolution
  // discards the whole gesture silently before this hook is ever called, same "always call with a
  // real layerId" contract onTracePlace's own doc comment establishes). Mirrors onTracePlace's own
  // architecture split immediately above: this module owns the absolute-to-natural-space
  // absolutePolygonsToNaturalSpace() conversion and every project.layers mutation.
  // DrawingCanvasTool.js deliberately has no opinion on daub radius -- decision 4: it's a TOOL
  // setting (eraserSettings.radiusMm), not a stone property, so unlike onStampPlace/onTracePlace's
  // own sizeMm/color (read from the target layer's CURRENT fields), it's attached here from this
  // module's own runtime state instead. Everything the 'stones' branch below mutates lands inside
  // the ONE commitHistory() there, so one sweep is one undo step (mirrors Trace's own "one gesture,
  // one undo step" precedent -- NOT Stamp's per-click commit). Unlike Paint/every draw preset,
  // `mode` is deliberately left at 'eraser' either way (decision 7: Eraser stays active after each
  // committed sweep), so there's no updateDrawToolButtons() call here either.
  // RS-3014 Step 3 (Dual-mode Eraser): `mode` is DrawingCanvasTool.js's own per-gesture snapshot
  // (its onEraseSweep hooks-param doc comment above explains why it's captured at gesture-start
  // rather than read live from eraserSettings.mode here) -- branches into either this same 'stones'
  // path or the 'outline' path, which cuts `corridorPolygonsAbsoluteMm` into the layer's own
  // `contours` via the raster boolean-subtraction engine (src/geometry/PathBoolean.js's
  // combineShapeSources()) instead.
  // Bugfix (permanent dead zone): the 'stones' branch below no longer pushes a live-forever radius
  // exclusion into layer.eraseDaubs -- that turned every erase into a permanent dead zone that
  // silently swallowed any LATER Stamp/Trace placed in the same spot, since eraseDaubs was applied
  // as a geometric test on every regeneration, over whatever stone list existed AT THAT TIME, not
  // scoped to what existed when the daub was drawn. Two mechanisms now replace it, matching the two
  // stone categories GeometryEngine.js's own generatePathLayout() already treats differently:
  // stampedStones entries under the sweep are spliced out of targetLayer.stampedStones directly (a
  // real removal -- a later Stamp/Trace at the same spot is a structurally different array entry
  // with a new id, nothing here ever touches it again); base-fill/region-patch stones have no
  // individual identity (recomputed fresh every regen), so their OWN current positions are
  // snapshotted into targetLayer.erasedGridPositions, an accumulating list GeometryEngine.js
  // excludes by position match on every future regen (see its own doc comment above the
  // erasedGridPositions exclusion block for the tolerance/healing-on-regrid rationale). A project
  // saved before this fix keeps any existing layer.eraseDaubs entries applying exactly as before
  // (GeometryEngine.js's own eraseDaubs block is intentionally left running, unmodified) -- this
  // hook simply never adds to that array anymore. The two mechanisms are independent and additive,
  // so an old project's eraseDaubs and a brand-new erasedGridPositions-based erase on the same layer
  // coexist correctly with no special-case code.
  onEraseSweep:async(daubsAbsoluteMm,layerId,corridorPolygonsAbsoluteMm,mode)=>{
    if(!layerId||!daubsAbsoluteMm.length)return;
    const targetLayer=project.layers.find(l=>l.id===layerId&&l.type==='path');
    if(!targetLayer)return;
    if(mode==='outline'){
      // An open Pen/freehand path has no interior to cut -- same graceful-failure precedent
      // RS-1012's own resolveLayerShapeSource()/runBooleanOp() already establish for a shape with
      // no closed outline (there: "no closed shape to combine"; here: nothing to cut into).
      if(targetLayer.closed===false){
        el('status').textContent=`${layerLabel(targetLayer)} has no closed outline to cut.`;
        return;
      }
      // RS-3011 Step 10a/10b's own absolutePolygonsToNaturalSpace() (PaintRegionSelection.js) --
      // reused unchanged, not a second coordinate-conversion implementation. It already honors
      // pathLayer.naturalBoundingBoxMm when present (its own fix, RS-3014 Step 3 follow-up), so a
      // SECOND+ outline cut on the same layer stays anchored to the frozen box too, not just the
      // first.
      const naturalCorridorPolygons=absolutePolygonsToNaturalSpace(corridorPolygonsAbsoluteMm,targetLayer);
      if(naturalCorridorPolygons.length===0)return;
      // RS-3014 Step 3 freeze point (see Part 1 / computeNaturalContourTransform()'s own doc
      // comment): set exactly once, from the contours as they exist right before this, the FIRST
      // cut, ever mutates them. Every later cut leaves this untouched, so every existing region/
      // stamp/daub stays anchored to the shape's original extent regardless of how much further
      // cutting shrinks `contours` itself.
      if(!targetLayer.naturalBoundingBoxMm){
        const allPoints=targetLayer.contours.flat();
        targetLayer.naturalBoundingBoxMm={
          minXmm:Math.min(...allPoints.map(p=>p.x)),
          minYmm:Math.min(...allPoints.map(p=>p.y)),
          maxXmm:Math.max(...allPoints.map(p=>p.x)),
          maxYmm:Math.max(...allPoints.map(p=>p.y))
        };
      }
      const subjectPolygons=targetLayer.contours.map(c=>c.map(p=>({xMm:p.x,yMm:p.y})));
      let combined;
      try{
        combined=combineShapeSources(
          {kind:'polygons',polygons:subjectPolygons},
          {kind:'polygons',polygons:naturalCorridorPolygons},
          'subtract',
          {targetSpacingMm:targetLayer.stoneSize+targetLayer.gap}
        );
      }catch(error){
        if(!(error instanceof BooleanPrecisionError))throw error;
        // Leaves targetLayer.contours untouched -- error.message is already a clear, user-facing
        // explanation (RS-1012's own runBooleanOp() precedent), not rewritten here.
        el('status').textContent=error.message;
        return;
      }
      // Mirrors PaintRegionSelection.js's own OVERLAP_AREA_EPSILON_MM2: combineShapeSources()'s
      // marching-squares tracer already discards any contour below (cellSize**2)/4 as tracing
      // noise, and actualCellSizeMm is always >= MIN_CELL_SIZE_MM, so a total result area at or
      // below this floor is indistinguishable from "nothing left," not a bare `=== 0` check.
      const resultAreaMm2=combined.contours.reduce((sum,c)=>sum+contourAreaAbs(c),0);
      const areaEpsilonMm2=(MIN_CELL_SIZE_MM*MIN_CELL_SIZE_MM)/4;
      if(combined.contours.length===0||resultAreaMm2<=areaEpsilonMm2){
        el('status').textContent='That would erase the entire shape — nothing changed.';
        return;
      }
      commitHistory();
      targetLayer.contours=combined.contours.map(c=>c.map(p=>({x:p.xMm,y:p.yMm})));
      // RS-3014 Step 3: unlike every other project.layers write that reaches Design's live canvas
      // (stoneSize/gap/color/regions/stampedStones/eraseDaubs, a resize), this one changes the
      // shape's own outline SEGMENTS, not just its placement box or a non-geometric style field --
      // refreshStoneGroupForLayer() alone only rebuilds the stone dots against whatever outline
      // Item is already on the canvas, which would keep showing the PRE-cut boundary forever (see
      // refreshShapeGeometryForLayer()'s own doc comment). This re-materializes the outline Item
      // from the layer's own new `contours` too, then rebuilds the stone Group against it.
      drawingTool.refreshShapeGeometryForLayer(targetLayer);
      await updateAll(true);
      el('status').textContent=`Cut into ${layerLabel(targetLayer)}'s outline.`;
      return;
    }
    // Absolute-space circle test, identical shape to the legacy eraseDaubs test this replaces (same
    // eraserSettings.radiusMm brush, same "within radius of ANY daub point" rule) -- stones-mode
    // deliberately keeps testing against daubsAbsoluteMm's own points rather than switching to
    // corridorPolygonsAbsoluteMm (that field is only meaningful to Outline mode's own boolean cut,
    // per DrawingCanvasTool.js's own onEraseSweep doc comment).
    const daubRadiusMm=eraserSettings.radiusMm;
    const withinSweep=(xMm,yMm)=>daubsAbsoluteMm.some(d=>{
      const dx=xMm-d.xMm;const dy=yMm-d.yMm;
      return dx*dx+dy*dy<=daubRadiusMm*daubRadiusMm;
    });
    // Bulk-delete-by-area: the splice-stampedStones/snapshot-erasedGridPositions/commitHistory body
    // that used to live inline here is now the shared eraseStonesWithinTest() (see its own doc
    // comment near deleteRegionFromPathLayer/deleteCurrentSelection below) -- this call is
    // behavior-identical to the old inline body, just passing withinSweep as the interior test
    // instead of it being hardcoded.
    const result=await eraseStonesWithinTest(targetLayer,withinSweep);
    if(!result){
      el('status').textContent=`Nothing to erase on ${layerLabel(targetLayer)}.`;
      return;
    }
    el('status').textContent=`Erased on ${layerLabel(targetLayer)}.`;
  },
  // Freehand is a continuous interaction (many pointermove samples before the stroke ends) --
  // DrawingCanvasTool.js opens a session at drag-start and closes it at drag-end so one stroke is
  // one undo step, the same session-coalescing convention HISTORY_TRACKED_CONTROL_IDS' input/change
  // pair below already uses for continuous field edits.
  openHistorySession,
  closeHistorySession,
  // RS-3011 Step 1 write-through fix: a shape already committed to project.layers (per
  // onShapeCommitted above) can still be moved/resized/deleted afterward via Design's own Select
  // tool -- these three keep that project.layers entry in sync, called once each when the
  // interaction finishes (DrawingCanvasTool.js's onMouseUp/deleteSelected()), not per drag frame.
  onShapeMoved:(layerId,dxMm,dyMm)=>{
    const l=project.layers.find(x=>x.id===layerId);
    if(!l)return;
    // Same one-commitHistory()-call-per-drag convention as the main-canvas drag-move code above
    // (see "starting its drag. Exactly one commitHistory() call happens per drag" ) and
    // nudgeSelection()'s identical getLayerPosition()/setLayerPosition() delta-apply pattern --
    // reused here rather than reimplemented, just scoped to the one shape id DrawingCanvasTool.js
    // already resolved.
    commitHistory();
    const p=getLayerPosition(l);
    setLayerPosition(l,p.xMm+dxMm,p.yMm+dyMm);
    updateAll(true);
  },
  onShapeResized:(layerId,boundsMm)=>{
    const l=project.layers.find(x=>x.id===layerId);
    if(!l)return;
    // Every Design-drawn layer is type 'path' (XYWH_SHAPE_TYPES, x/y/w/h fields) -- GeometryEngine's
    // generatePathLayout()/_placeNaturalContours() re-scales the layer's stored (0,0)-rooted
    // `contours` into this x/y/w/h box on every generate() call, so writing the new bounds here is
    // sufficient; `contours` itself never needs touching.
    commitHistory();
    // RS-3012 Step 4: a circle layer (cx/cy/r, not x/y/w/h) resizes by radius-from-center drag --
    // DrawingCanvasTool.js's own circle branch keeps the center pinned and reports a centered
    // 2r-by-2r square, so half its width is the new radius. Matches the main-canvas circle resize's
    // own Math.max(2,...) radius floor (see the drag.kind==='resize' l.type==='circle' branch); cx/cy
    // stay untouched.
    if(l.type==='circle'){l.r=Math.max(2,boundsMm.width/2);updateAll(true);return}
    l.x=boundsMm.left;l.y=boundsMm.top;l.w=boundsMm.width;l.h=boundsMm.height;
    updateAll(true);
  },
  // RS-3033: mirrors onShapeMoved/onShapeResized's own body shape exactly -- fires once, at mouseup
  // only, when a rotate-handle drag on Design's own Select tool completes with a non-zero net
  // rotation (see DrawingCanvasTool.js's own onShapeRotated hooks-param doc comment for the exact
  // contract). rotationDeg arrives already normalized into [0,360) (see that file's own onMouseUp
  // 'rotate' branch), the same convention #rotationDeg/#shapeRotationDeg's own writeSelectedControlsToLayer()
  // normalization already establishes for the main canvas's rotate handle.
  onShapeRotated:(layerId,rotationDeg)=>{
    const l=project.layers.find(x=>x.id===layerId);
    if(!l)return;
    commitHistory();
    l.rotationDeg=rotationDeg;
    updateAll(true);
  },
  onShapeDeleted:(layerId)=>{
    const l=project.layers.find(x=>x.id===layerId);
    if(!l)return true;
    // Reuses deleteLayer() outright -- same commitHistory()-then-filter pattern, same "Cannot
    // delete the last layer" guard, same selection/updateAll() follow-through, no second copy of
    // any of that logic. Its return value tells deleteSelected() (DrawingCanvasTool.js) whether the
    // guard blocked this -- when it did, the shape must stay on the Design canvas too, or it would
    // vanish from Design while its project.layers entry (correctly) survives.
    return deleteLayer(l.id);
  },
  // RS-3011 Step 2: Design's own selection (click/shift-click/marquee/clear -- see
  // DrawingCanvasTool.js's own onSelectionChanged doc comment for exactly which gestures fire this)
  // feeds the same selectedLayerIds/selectedLayerId every other selection-driving code path in this
  // file already sets, so the already-visible Align/Distribute/Duplicate/rotate-handle system stops
  // being inert for Design shapes. layerIds' last entry (most-recently-interacted-with, per
  // DrawingCanvasTool.js's own ordering) becomes selectedLayerId, matching every other multi-select
  // site's own `ids[ids.length-1]` convention (e.g. the boolean-ops result-selection below).
  onSelectionChanged:(layerIds)=>{
    if(!layerIds.length){
      // Same empty-selection handling as an empty-canvas click on the main layoutCanvas pointerdown
      // handler above (S-003/RS-1009): selectedLayerId is left pointing at whatever it last did
      // (still a valid layer -- selectedLayer() falls back to project.layers[0] regardless), only
      // the multi-selection itself clears.
      if(selectedLayerIds.size){selectedLayerIds=clearSelection();renderLayerUI();updateEditingUI();drawLayout()
        // RS-3011 Step 3a: clearing the selection also drops it below designStoneTarget's
        // size===1 requirement, so the stone fields must return to their Inspector home slot --
        // this branch returns before reaching syncSelectedControlsFromLayer()'s own
        // relocateFieldGroups() call below, so it needs its own.
        relocateFieldGroups()}
      return;
    }
    selectedLayerIds=selectMany(layerIds);
    selectedLayerId=layerIds[layerIds.length-1];
    syncSelectedControlsFromLayer();renderLayerUI();updateEditingUI();updateAll(true);
  },
  // RS-3011 Step 3b: the two hooks the live Design-canvas stone preview needs. DrawingCanvasTool.js
  // still never touches project.layers directly (unchanged rule from Step 1/2 above) -- it re-
  // flattens its OWN live Paper.js item for the contour (already does this for commitFinalizedShape,
  // see FLATTEN_TOLERANCE_MM there) and asks app.js only for the non-geometric "style" params a
  // path layer carries (stoneSize/gap/color/fillMode/mixed-size), then asks app.js to run those
  // params through the exact same GeometryEngine call generatePathStonesLive() above already makes
  // -- the SAME permanentEngine instance, never a second GeometryEngine.
  getLayerStoneParams:(layerId)=>{
    const l=project.layers.find(x=>x.id===layerId);
    if(!l||l.type!=='path')return null;
    // RS-3011 Step 7: same stonesGenerated===false gate as generatePathStonesLive() above -- null
    // is already this hook's "no stones" return (see rebuildStoneGroupForShape()'s own null-check),
    // so Design's live preview drops the shape's stone Group entirely until the button is pressed.
    if(l.stonesGenerated===false)return null;
    // RS-3011 Step 10b: regions (Paint) joins the rest of a path layer's "style" params here so the
    // live Design-canvas stone preview reflects a painted region immediately, the same wiring-gap
    // fix as generatePathStonesLive()'s own new `regions` line above. RS-3011 Step 12: stampedStones
    // (Stamp) joins it the same way, so a placed stamp shows up on the live canvas the instant it's
    // clicked, not only once "Generate Stones"/an export re-runs generatePathStonesLive().
    // RS-3011 Step 13: eraseDaubs (Eraser) joins them the same way, so an erase sweep shows up on
    // the live canvas the instant it's committed, not only once "Generate Stones"/an export
    // re-runs generatePathStonesLive().
    // RS-3011 resize-repositioning fix: contours/closed are the layer's own FIXED, author-time
    // natural-space contour ({x,y}->{xMm,yMm} remapped, same convention generatePathStonesLive()
    // above already uses) -- the SAME natural reference absolutePolygonsToNaturalSpace() (Stamp/
    // Trace/Eraser/Paint's own click-to-natural-space conversion) inverts to store a
    // stampedStone/region/eraseDaub position in the first place. rebuildStoneGroupForShape()
    // (DrawingCanvasTool.js) needs this exact reference now too -- see its own doc comment for why
    // substituting the shape's LIVE re-flattened geometry here instead silently broke stamped/
    // region/erase-daub placement after any resize.
    // RS-3014 Step 3: naturalBoundingBoxMm joins them the same way, the identical wiring-gap fix
    // generatePathStonesLive()'s own new line makes for the production pipeline. staticXMm/
    // staticYMm/staticWidthMm/staticHeightMm (the layer's own x/y/w/h, distinct from
    // rebuildStoneGroupForShape()'s own `flattened.xMm` etc. -- see its own doc comment) ride
    // alongside: once a layer has been cut, that call site must use THESE, not the shape's live
    // re-flattened Paper.js item, when computing its natural-space transform -- combining the
    // frozen (pre-cut) box with the live item's own ALREADY-shrunk width would shrink the base
    // fill a second time, and marching squares re-traces the WHOLE boundary (not just the cut
    // edge) at finite grid resolution, so even the live item's untouched edges carry a little
    // sub-mm quantization noise that would otherwise very slightly reposition stamps/regions/
    // daubs on the Design canvas -- exactly what the frozen box exists to prevent. Named
    // differently from xMm/yMm/widthMm/heightMm (which this object does NOT otherwise define) so
    // there's no ambiguity about which one a naive `...styleParams` spread would pick up.
    return{stoneSizeMm:l.stoneSize,gapMm:l.gap,mode:resolveVectorFillMode(l.fillMode),color:l.color,regions:l.regions||[],stampedStones:l.stampedStones||[],eraseDaubs:l.eraseDaubs||[],
    // Bugfix (permanent dead zone): erasedGridPositions joins the rest of a path layer's "style"
    // params here so a Stones-mode erase reflects on the live Design-canvas preview immediately,
    // the same wiring-gap fix generatePathStonesLive()'s own new line makes for the production
    // pipeline.
    erasedGridPositions:l.erasedGridPositions||[],naturalBoundingBoxMm:l.naturalBoundingBoxMm,staticXMm:l.x,staticYMm:l.y,staticWidthMm:l.w,staticHeightMm:l.h,
    // RS-3033: joins the rest of a path layer's "style" params here, the same wiring-gap fix
    // generatePathStonesLive()'s own new `rotationDeg` line makes for the production pipeline --
    // rebuildStoneGroupForShape() (DrawingCanvasTool.js) forwards this straight through to its own
    // generatePathLayout() call, and (like naturalBoundingBoxMm above) also uses its mere presence
    // to decide when the shape's STATIC box (staticXMm etc., not the shape's own live re-flattened
    // Paper.js item bounds) must be used instead -- a rotated item's own AABB is generally NOT the
    // unrotated placement box GeometryEngine's rotation step itself expects to rotate around (see
    // that call site's own doc comment).
    rotationDeg:l.rotationDeg??0,
    contours:l.contours.map(c=>c.map(p=>({xMm:p.x,yMm:p.y}))),closed:l.closed!==false,...mixedSizeParamsFor(l)};
  },
  // Mirrors generatePathStonesLive()'s own result mapping exactly (color:s.color, the raw
  // STONE_COLORS key, e.g. 'gold') -- rs-design-crystal-dots: DrawingCanvasTool.js's stone dots now
  // go through the same faceted drawCrystalStone() look CanvasRenderer2D.js uses, which resolves a
  // stone's color key itself (STONE_COLORS[colorKey]) and needs that raw key, not a pre-resolved
  // previewColor hex.
  generatePathLayout:(params)=>{
    if(!permanentEngine)return[];
    const result=permanentEngine.generatePathLayout(params);
    return result.stones.map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:s.color}));
  },
  // RS-3032 Step A: the one new dependency DrawingCanvasTool.js needs to materialize a
  // SHAPE_LIBRARY_KINDS layer (Star/Ring/Heart/...) as a real Paper.js item -- unlike a 'path'
  // layer, these have no stored `contours` to read, only a shape formula that lives inside
  // GeometryEngine. Reuses the SAME permanentEngine.resolveShapePolygons() call/params
  // (shapeLayerResolveParams()) every other consumer (Boolean Operations, Fit Text to Shape)
  // already goes through, so this never becomes a second contour-generation implementation.
  resolveShapeLibraryPolygons:(layer)=>{
    if(!permanentEngine)return null;
    return permanentEngine.resolveShapePolygons(shapeLayerResolveParams(layer));
  },
  // RS-3012 Step 2: the 'svg'-layer counterpart of resolveShapeLibraryPolygons above, so
  // DrawingCanvasTool.js can materialize an 'svg' layer's real vector outline as a Paper.js item
  // (see its own materializeSvgImageItemFromLayer() doc comment) -- the SAME permanentEngine.
  // resolveSvgPolygons() call resolveLayerShapeSource() already uses for Boolean Operations, never
  // a second SVG-parsing implementation.
  resolveSvgPolygons:(layer)=>{
    if(!permanentEngine||!layer.svgSource)return null;
    return permanentEngine.resolveSvgPolygons({svgSource:layer.svgSource,layerId:layer.id,xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h});
  },
  // RS-3012 Step 3: the 'text'-layer counterpart of getLayerStoneParams above, but for stones
  // directly rather than settings -- a text layer's real stones are never regenerated here, only
  // filtered out of the `layout` global engine.generate() already produced this same updateAll()
  // tick (Design-active or not, per that function's own unconditional per-layer loop), so Design's
  // own canvas never becomes a second place stones can be computed. Mirrors generatePathLayout()'s
  // own {x,y,d,color} return shape exactly, from the real Stone.xMm/yMm/sizeMm/color fields.
  getTextLayerStones:(layerId)=>layout.stones.filter(s=>s.layerId===layerId).map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:s.color}))
});
// RS-3010 Step 2d: exposes drawingTool's own debugGrid/debugHitTestShapeId QA-only surface for
// automated verification of the Design canvas's background grid layering -- same "read-only,
// never used to drive any application logic" precedent as window.__preview3D above.
window.__drawingTool=drawingTool;
// RS-3013 Step 2: exposes the live `project` reference itself, read-only, so automated verification
// can read project.layers[...].regions[...].contour (natural-space, on-disk data) after a region-move
// commit -- same "QA-only, never drives app logic" precedent as window.__drawingTool/window.__preview3D
// above; DrawingCanvasTool.js's own activeSelection getter only exposes the transient absolute-mm
// selection outline, not the committed natural-space storage this verifies. A getter (not a static
// assignment) since `project` itself is reassigned wholesale on undo/redo/import/autosave-recovery
// (applyHistorySnapshot() etc.) -- a plain assignment here would silently go stale the first time any
// of those ran.
Object.defineProperty(window,'__project',{get:()=>project,configurable:true});
// M14: read-only view of the current module-level StoneLayout, so automated verification can assert
// the move-drag fast path's mid-drag translation and its end-of-drag canonical regeneration (that
// `layout` after pointerup/pointercancel matches a fresh engine.generate(project)). Same "QA-only,
// never drives app logic" precedent as window.__project above; `layout` is likewise reassigned
// wholesale on every updateAll(), so this must be a getter, not a static snapshot.
Object.defineProperty(window,'__layout',{get:()=>layout,configurable:true});
// RS-1009: the one multi-selection model (src/editing/Selection.js is the only place that
// computes a new Set from an old one). selectedLayerId (above, pre-existing) keeps driving the
// single-layer property panel exactly as before -- it always points at the most recently
// interacted-with layer, even when selectedLayerIds is empty (clicking empty canvas clears the
// multi-selection but intentionally leaves the panel showing the last-edited layer's fields, the
// same way it already did before this milestone). snapEnabled/activeGuides are view-only editor
// state (like rotation/zoom): never part of `project`, never undo/redo-tracked, never exported.
// RS-1010: snapToleranceMm/showSnapGuides join them as the same kind of view-only state --
// snapToleranceMm is the configurable replacement for the fixed SNAP_TOLERANCE_MM default (still
// imported and used as the fallback/reset value), showSnapGuides gates only the temporary guide
// *lines drawn* while snapping (snapping itself stays governed by snapEnabled alone).
let selectedLayerIds=new Set([selectedLayerId]),snapEnabled=true,snapToleranceMm=SNAP_TOLERANCE_MM,showSnapGuides=true,activeGuides=[];
// UI-001: safe-area guide visibility is view-only editor state, exactly like snapEnabled/rotation/
// zoom above -- never part of `project`, never undo/redo-tracked, never exported. It gates the
// pre-existing app.js-local drawSafeAreaGuide() call only; default true, so leaving it untouched
// renders byte-identical to before UI-001. (A reference-grid toggle was considered but is not
// wired to anything real: the grid is drawn unconditionally inside the permanent
// src/renderer/CanvasRenderer2D.js, and this milestone deliberately does not touch permanent
// renderer/export/geometry modules to build one UI toggle -- see
// docs/specifications/UI-001-CompleteRedesign.md, "Known Limitations".)
let showSafeArea=true;
// RS-1006: createPreview3D() returns a synchronous facade immediately -- Three.js itself loads
// lazily inside it, so this line never blocks app.js's own startup.
const preview3D=createPreview3D(cupCanvas);
// RS-2011: exposes the facade's getRenderCount() instrumentation for QA/automated verification of
// invalidation-based rendering (confirming the scene is idle vs. actively re-rendering by polling a
// number instead of eyeballing the canvas) -- read-only in practice (nothing in app.js itself reads
// window.__preview3D back), never used to drive any application logic.
window.__preview3D=preview3D;
// S-107 (requirement 2, "rotating the Object Preview must move the Front View Frame"): fires
// whenever the operator free-orbits the Object Preview with the mouse/touch (Preview3DRenderer.js's
// OrbitControls 'change' listener; never fires for our own slider/frame-drag-driven camera moves --
// see that file's _onControlsChange() for why). Mirrors the frame-drag branch in the pointermove
// handler below: updates `rotation` and does a cheap 2D-canvas-only redraw, no layout regeneration.
preview3D.onAzimuthChange=deg=>{
  rotation=deg;
  el('rotation').value=rotation;
  drawLayout();
  updateViewButtons();
  updateStats();
};
function selectedLayer(){return project.layers.find(l=>l.id===selectedLayerId)||project.layers[0]}
// RS-1004: resolves project.product (the pre-existing, previously-unread ad hoc field) to its real
// ObjectTemplate record. getObjectTemplate() itself falls back to 'mug' for any unknown/missing id,
// so this never throws.
function currentObjectTemplate(){return getObjectTemplate(project.product)}
// RS-1002: undo/redo history. HistoryManager (src/history/**) stores only serialized
// {project,selectedLayerId} snapshots -- never the generated StoneLayout -- so history never
// duplicates geometry, and geometry is always regenerated fresh from the restored project via
// updateAll() inside applyHistorySnapshot(). commitHistory() is used for discrete actions
// (add/duplicate/delete/visibility/SVG-import/drag-start), one call per action; openHistorySession/
// closeHistorySession coalesce every keystroke/slider-tick of one continuous field edit (text,
// font, stone size, gap, color, wrap, text mode, shape x/y/w/h, svg mode) into a single undo step,
// opened on the field's first 'input' event and closed on its 'change' event. `rotation`/`zoom` are
// view-only (not part of `project`, not in the required undoable-operation list) and are
// deliberately excluded. Importing a Project JSON file clears history entirely (a fresh project,
// not an undoable edit); exporting never touches history at all.
const history=new HistoryManager({maxSize:HISTORY_MAX_SIZE});
// RC-005: Autosave & Crash Recovery. AUTOSAVE_STORAGE_KEY is a new, separate localStorage slot
// (never shared with LIBRARY_STORAGE_KEY/FONT_FAVORITES_STORAGE_KEY below) holding exactly one
// recovery record -- the same {project,selectedLayerId} shape currentSnapshot() already produces
// for undo/redo -- overwritten on every autosave. Falls back to an in-memory adapter (this session
// only) if localStorage is unavailable, mirroring the Design Library's own fallback further down.
const AUTOSAVE_STORAGE_KEY='rhinestone-studio:autosave';
const AUTOSAVE_DEBOUNCE_MS=1200;
let autosave;
try{
  autosave=new AutosaveManager({storageAdapter:createAutosaveLocalStorageAdapter(AUTOSAVE_STORAGE_KEY)});
}catch(error){
  console.warn('Autosave: localStorage is unavailable in this environment; using in-memory storage for this session only.',error);
  autosave=new AutosaveManager({storageAdapter:createAutosaveMemoryStorageAdapter()});
}
// Crash/refresh recovery: runs once, here, before any UI wiring below reads `project` -- restoring
// (or not) is the only thing that ever replaces `project` outside of an explicit user action
// (Import/Open, Design Library "New Project", Gallery "Open as copy"). autosave.load() already
// discards anything unusable (corrupt/wrong-schema/older than 24h -- see AutosaveManager) and
// returns null in that case, so a missing/stale/corrupt recovery record silently falls back to the
// freshly constructed defaultProject() above, exactly like a first-ever visit. validateProject()
// re-runs the exact same normalization #importProjectFile already uses, so a recovered project
// saved under an older Project JSON shape restores exactly as compatibly as re-importing that same
// file would.
let bootStatusMessage=null;
try{
  const recovered=autosave.load();
  if(recovered){
    project=validateProject(recovered.project);
    selectedLayerId=project.layers.some(l=>l.id===recovered.selectedLayerId)?recovered.selectedLayerId:project.layers[0].id;
    selectedLayerIds=selectOnly(selectedLayerId);
    bootStatusMessage='Restored unsaved changes from autosave (crash/refresh recovery).';
  }
}catch(error){
  console.error('Autosave recovery failed; starting from a fresh project instead.',error);
  try{autosave.clear()}catch{}
}
let cleanProjectJson=JSON.stringify(project);
refreshUnitLabels();
refreshAllFieldSteps();
// lastAutosavedProjectJson tracks what's actually in the autosave slot right now -- starts equal to
// the just-decided boot project (restored or default) so nothing is redundantly re-written on the
// very first updateAll(). scheduleAutosave() (called from updateAll(), so it runs after every
// regeneration -- every keystroke, every drag frame, every discrete action) only (re)starts
// autosaveTimer when the live project actually differs from this. That diff, plus the debounce
// itself, is what keeps autosave firing only after a meaningful edit settles, never on every
// keystroke or mouse move.
let lastAutosavedProjectJson=cleanProjectJson,autosaveTimer=null;
function flushAutosaveNow(){
  if(autosaveTimer){clearTimeout(autosaveTimer);autosaveTimer=null}
  const json=JSON.stringify(project);
  if(json===lastAutosavedProjectJson)return;
  try{autosave.save({project,selectedLayerId});lastAutosavedProjectJson=json}catch(error){console.error('Autosave failed',error)}
}
function scheduleAutosave(){
  if(JSON.stringify(project)===lastAutosavedProjectJson)return;
  if(autosaveTimer)clearTimeout(autosaveTimer);
  autosaveTimer=setTimeout(flushAutosaveNow,AUTOSAVE_DEBOUNCE_MS);
}
// A refresh/crash mid-debounce (before AUTOSAVE_DEBOUNCE_MS elapses) must not lose the pending
// write -- 'pagehide' (fires on tab close/navigation/reload, including bfcache cases 'beforeunload'
// can miss) flushes it synchronously; localStorage.setItem() is synchronous, so this reliably
// completes before the page actually unloads.
window.addEventListener('pagehide',flushAutosaveNow);
function currentSnapshot(){return{project:JSON.parse(JSON.stringify(project)),selectedLayerId}}
function commitHistory(){history.commit(currentSnapshot());updateHistoryUI()}
function openHistorySession(){if(history.sessionOpen)return;history.beginSession(currentSnapshot());updateHistoryUI()}
function closeHistorySession(){history.endSession()}
function applyHistorySnapshot(snap){project=snap.project;selectedLayerId=snap.selectedLayerId;syncSelectedControlsFromLayer();updateAll(true,true)}
function performUndo(){closeHistorySession();const snap=history.undo(currentSnapshot());if(!snap){el('status').textContent='Nothing to undo';updateHistoryUI();return}applyHistorySnapshot(snap);el('status').textContent='Undo'}
function performRedo(){closeHistorySession();const snap=history.redo(currentSnapshot());if(!snap){el('status').textContent='Nothing to redo';updateHistoryUI();return}applyHistorySnapshot(snap);el('status').textContent='Redo'}
function updateHistoryUI(){const undoBtn=el('undoBtn'),redoBtn=el('redoBtn'),dirtyEl=el('dirtyIndicator');if(undoBtn)undoBtn.disabled=!history.canUndo;if(redoBtn)redoBtn.disabled=!history.canRedo;if(dirtyEl)dirtyEl.textContent=JSON.stringify(project)!==cleanProjectJson?'Unsaved changes':'Saved';
  // UI-001: the left panel's Actions-section Undo/Redo buttons mirror the top bar's undoBtn/redoBtn
  // disabled state exactly -- both call the same performUndo()/performRedo(), never a second history.
  const actionUndoBtn=el('actionUndo'),actionRedoBtn=el('actionRedo');if(actionUndoBtn)actionUndoBtn.disabled=!history.canUndo;if(actionRedoBtn)actionRedoBtn.disabled=!history.canRedo;
}
// RS-3013 Step 5: a selected REGION (drawingTool.activeSelection.kind==='region') branches first,
// populating #stoneSize/#gap/#stoneColor/#regionFillMode from the REGION's own fields (not the
// parent layer's) and hiding the shape-geometry (#sharedPositionFields) / #shapeFillMode fields a
// region has no independent version of -- same "region wins" precedent performClickDispatch()
// (DrawingCanvasTool.js) already established for click-selection itself. Falls through to today's
// selectedLayer()-based behavior below when activeSelection isn't a region, or is a stale one whose
// layer/region no longer exist (e.g. after an undo past the region's own creation).
function syncSelectedControlsFromLayer(){
  const regionSelection=drawingTool.activeSelection;
  if(regionSelection&&regionSelection.kind==='region'){
    const regionLayer=project.layers.find(x=>x.id===regionSelection.layerId&&x.type==='path');
    const region=regionLayer&&(regionLayer.regions||[]).find(r=>r.id===regionSelection.regionId);
    if(regionLayer&&region){
      el('sharedPositionFields').style.display='none';
      el('shapeFillModeField').style.display='none';
      el('regionFillModeField').style.display='block';
      ensureStoneSizeOption(el('stoneSize'),region.stoneSizeMm);
      setNumericSelectValue(el('stoneSize'),region.stoneSizeMm);
      setLengthField('gap',region.gapMm);
      el('stoneColor').value=region.color;
      el('regionFillMode').value=region.fillMode==='outline'?'outline':'fill';
      return;
    }
  }
  const l=selectedLayer();el('selectedLayer').value=l.id;const isText=l.type==='text';el('textControls').style.display=isText?'block':'none';el('shapeControls').style.display=isText?'none':'block';
  // UI-001: sharedPositionFields (shapeX/Y/W/H) is relocated between the inspector and a Lightbox
  // slot (see relocateFieldGroups()) and is no longer always a child of #shapeControls, so it needs
  // its own visibility toggle mirroring the exact same isText condition #shapeControls already uses.
  el('sharedPositionFields').style.display=isText?'none':'block';
  el('svgControls').style.display=l.type==='svg'?'block':'none';el('imageControls').style.display=l.type==='image'?'block':'none';
  // RS-1011: Fill Style. #shapeFillModeField (circle/rectangle/path, inside the Shapes Lightbox's
  // #shapeControls) and #imageFillMode (image, inside the Image Trace Lightbox's #imageControls)
  // are the two genuinely new controls -- these three layer types never had any fill-mode UI
  // before this milestone. #textMode/#svgMode already existed and only gain new <option>s.
  const isShapeFillType=VECTOR_FILL_MODE_TYPES.has(l.type);
  el('shapeFillModeField').style.display=isShapeFillType?'block':'none';
  if(isShapeFillType)el('shapeFillMode').value=resolveVectorFillMode(l.fillMode);
  // RS-3013 Step 5: mutually exclusive with #shapeFillMode above, same as sharedPositionFields'
  // region-vs-layer split -- only shown by the region branch at this function's own top.
  el('regionFillModeField').style.display='none';
  // S-110: per-shape "Shape options" -- only the fields relevant to the selected shape kind are
  // shown (Regular Polygon's side count; Star's point count + inner radius; Ring's inner opening),
  // matching this function's existing shapeHField (Circle vs. everything else) visibility pattern.
  const showSidesField=l.type==='polygon',showStarFields=l.type==='star',showRingField=l.type==='ring';
  el('shapeSidesField').style.display=showSidesField?'block':'none';
  el('shapeStarFields').style.display=showStarFields?'block':'none';
  el('shapeRingField').style.display=showRingField?'block':'none';
  if(showSidesField)el('shapeSides').value=l.sides??6;
  if(showStarFields){el('shapePoints').value=l.points??5;el('shapeInnerRadius').value=l.innerRadiusRatio??0.5}
  if(showRingField)el('shapeRingInner').value=l.innerRatio??0.5;
  if(l.type==='image')el('imageFillMode').value=resolveImageFillMode(l.fillMode);
  if(isText){el('text').value=l.text;ensureFontOptionForLayer(l.font);el('font').value=l.font;setLengthField('height',l.height);el('heightAutoAdjustedHint').style.display='none';el('autoFit').value=l.autoFit?'on':'off';el('autoFitOnHint').style.display='none';ensureTextModeOptionForLayer(l.textMode);el('textMode').value=l.textMode||'stroke';el('curveEnabled').value=l.curveEnabled?'on':'off';setLengthField('curveRadiusMm',l.curveRadiusMm??40);el('curveDirection').value=l.curveDirection||'outside';el('curveStartAngleDeg').value=l.curveStartAngleDeg??0;el('curveSweepAngleDeg').value=l.curveSweepAngleDeg??180;el('curveAlignment').value=l.curveAlignment||'center';el('curveControls').style.display=l.curveEnabled?'block':'none';setLengthField('textX',l.x||0);setLengthField('textY',l.y||0);
  // TXT-102: '??'/'||' fallbacks so a pre-TXT-102 project (no align/lineSpacing/rotationDeg stored)
  // displays GeometryEngine's own defaults, matching this line's existing curve-field convention.
  el('textAlign').value=l.align||'left';el('lineSpacing').value=l.lineSpacing??1;el('rotationDeg').value=l.rotationDeg??0;
  // READ-006: '??' fallback so a pre-READ-006 layer displays 0. The hint is written by
  // #separateLettersBtn and cleared on selection change, exactly like #heightAutoAdjustedHint.
  setLengthField('letterSpacing',l.letterSpacing??0);el('letterSpacingHint').style.display='none'}else{setLengthField('shapeX',l.type==='circle'?l.cx:l.x);setLengthField('shapeY',l.type==='circle'?l.cy:l.y);setLengthField('shapeW',l.type==='circle'?l.r:l.w);setLengthField('shapeH',l.type==='circle'?'':l.h);el('shapeWLabel').textContent=(l.type==='circle'?'Radius':'Width')+' ('+unitSuffix(project.units)+')';el('shapeHField').style.display=l.type==='circle'?'none':'';el('shapeRotationDeg').value=l.rotationDeg??0;if(l.type==='svg')el('svgMode').value=resolveVectorFillMode(l.mode);if(l.type==='image'){el('imgThreshold').value=l.threshold??DEFAULT_IMAGE_THRESHOLD;el('imgInvert').value=l.invert?'on':'off';el('imgBlurRadius').value=l.blurRadiusPx??0;el('imgMaxWidth').value=l.maxWidthPx??DEFAULT_IMAGE_MAX_DIMENSION_PX;el('imgMaxHeight').value=l.maxHeightPx??DEFAULT_IMAGE_MAX_DIMENSION_PX}}ensureStoneSizeOption(el('stoneSize'),l.stoneSize);setNumericSelectValue(el('stoneSize'),l.stoneSize);setLengthField('gap',l.gap);el('stoneColor').value=l.color;
  // S-200: Mixed Stone Size -- applies uniformly to every layer type, same as stoneSize/gap/color
  // just above. allowedSizesMm is only ever catalog values (see MIXED_ALLOWED_SIZE_CHECKBOXES'
  // doc comment), so each checkbox is simply checked when its own diameter is present in the
  // layer's stored array -- no nearest-match/custom-value handling is needed here the way
  // ensureStoneSizeOption() needs for the single #stoneSize picker. minSizeMm/maxSizeMm fall back to
  // the layer's own stoneSize when unset (a fresh Mixed-mode layer, or a legacy layer with no such
  // field), matching normalizeMixedSizeParams()'s own default derivation.
  const sizeMode=resolveSizeMode(l.sizeMode);el('sizeMode').value=sizeMode;el('mixedSizeDetailFields').style.display=sizeMode==='mixed'?'block':'none';
  const allowedSizesMm=Array.isArray(l.allowedSizesMm)?l.allowedSizesMm:[];
  for(const cb of MIXED_ALLOWED_SIZE_CHECKBOXES)el(cb.id).checked=allowedSizesMm.some(v=>Math.abs(v-cb.diameterMm)<0.005);
  setNumericSelectValue(el('mixedMinSize'),l.minSizeMm??l.stoneSize);setNumericSelectValue(el('mixedMaxSize'),l.maxSizeMm??l.stoneSize);
  el('conservativeDetail').value=l.conservativeDetail??0.3;
  // RS-2012 (Part 3): Advanced starts collapsed, matching the "reduce default cognitive load" goal
  // -- except it auto-expands when this layer already carries a non-default Minimum/Maximum Size or
  // Conservative Detail, so switching to an already-tuned layer never hides that tuning silently.
  // Only set here (per selection change), never from the live updateMixedSizeCapabilityUI() below,
  // so manually toggling Advanced open/closed while editing is never fought by the next keystroke.
  const hasCustomAdvanced=(l.minSizeMm!=null&&Math.abs(l.minSizeMm-l.stoneSize)>0.005)
    ||(l.maxSizeMm!=null&&Math.abs(l.maxSizeMm-l.stoneSize)>0.005)
    ||(l.conservativeDetail!=null&&Math.abs(l.conservativeDetail-0.3)>0.001);
  el('mixedAdvancedSection').open=sizeMode==='mixed'&&hasCustomAdvanced;
  // RS-1002: project.cupColor/project.wrap are project-level (not per-layer) fields, so they must
  // be resynced here too -- otherwise an undo/redo restore (or a Project JSON import) leaves these
  // two dropdowns stale, and the *next* edit's writeSelectedControlsToLayer() would silently write
  // the stale displayed value back into `project`, undoing the very restore that just happened.
  el('cupColor').value=project.cupColor;el('wrap').value=project.wrap;
  // RS-1004: project.product is likewise project-level, not per-layer -- resync on every selection
  // change/undo/redo/import for the same reason cupColor/wrap are resynced above.
  el('objectType').value=project.product;
  // S-112: project.plate is likewise project-level -- resync every plate field for the same reason
  // (undo/redo restore, Project JSON import, or a template switch away-and-back must never leave
  // these inputs showing a stale value that a later edit would silently write back).
  setLengthField('plateOuterDiameter',project.plate.outerDiameterMm);setLengthField('plateInnerWellDiameter',project.plate.innerWellDiameterMm);setLengthField('plateOverallHeight',project.plate.overallHeightMm);setLengthField('plateCenterDepth',project.plate.centerDepthMm);el('plateColor').value=project.plate.colorId;el('plateDesignTarget').value=project.plate.designTarget;
  // RS-2010: project.vessel is likewise project-level -- resync for the same reason as project.plate
  // just above.
  setLengthField('vesselBodyDiameter',project.vessel.bodyDiameterMm);setLengthField('vesselBodyHeight',project.vessel.bodyHeightMm);setLengthField('vesselTopDiameter',project.vessel.topDiameterMm);
  // RS-1005: project.name is likewise project-level -- resync for the same reason.
  el('projectName').value=project.name;
  // S-105 follow-up: a type-specific Lightbox (Text/Import/Image Trace) that stays open (non-modal
  // + persistent, S-105) while the selection changes to a different, incompatible layer type must
  // never sit there empty (isText/etc. above already hide its per-layer content for the wrong
  // type, and none of these three has any always-visible fallback content once that happens).
  // activeFieldLightbox is only non-null while one of the four type-specific Lightboxes is open, so
  // this never fires when no type-specific Lightbox is open (e.g. Settings/Export/Help untouched).
  // lightboxForLayerType(l.type).open() both switches to the correct Lightbox for the new selection
  // and -- via the existing single-primary-Lightbox exclusivity in src/ui/Lightbox.js -- closes the
  // now-incompatible one automatically; a no-op if the correct one is already open.
  //
  // Shapes is deliberately excluded from this auto-switch-away: (1) it can never actually go empty
  // -- its "Add a shape"/"Boolean Operations" sections (index.html #shapesPanelDesign) are always
  // visible regardless of the selected layer's type, unlike Text/Import/Image Trace, whose entire
  // body is gated behind a single type check; (2) Boolean Ops (S-101) deliberately Shift-selects a
  // mixed-type selection (any combination of shapes/text/SVG/image, per its own hint text) while
  // Shapes stays open -- and a Shift-click multi-select always starts with one plain click (a
  // genuine single-selection, indistinguishable in the moment from an ordinary single-select), so
  // auto-switching away on that first click would close Shapes before the operator can Shift-click
  // the second layer. Switching *into* Shapes from Text/Import/Image Trace is unaffected -- only
  // switching *away* from an already-open Shapes is skipped.
  // Also guarded to a single-layer selection, so a multi-selection built any other way never
  // triggers a switch either.
  if(activeFieldLightbox&&activeFieldLightbox!=='shapes'&&selectedLayerIds.size<=1){
    const target=lightboxForLayerType(l.type);
    if(target&&!target.isOpen)target.open();
  }
  // RS-3011 Step 3a: this function already runs on every selection change (canvas click, Layers
  // list click, Design's own onSelectionChanged, undo/redo, etc.) -- reusing that as the one place
  // that re-evaluates the stone group's designSlot target, rather than adding a relocateFieldGroups()
  // call at each of those sites individually.
  relocateFieldGroups();
}
// RS-3013 Step 5: same "region-first, early return" structure as syncSelectedControlsFromLayer()
// above -- a selected REGION writes #stoneSize/#gap/#stoneColor/#regionFillMode straight onto the
// region object (region.stoneSizeMm/gapMm/color/fillMode), not the parent layer. commitHistory()/
// session-open semantics are already handled by the caller (HISTORY_TRACKED_CONTROL_IDS' own
// 'input'->openHistorySession()+updateAll() wiring, which is what invokes this function in the
// first place) -- no separate history call needed here, same as the unbranched function below never
// calling commitHistory() itself either. drawingTool.refreshStoneGroupForLayer(regionLayer.id) is
// the EXACT post-write regen call the existing 'path'-layer branch below already uses (see
// `if(l.type==='path')drawingTool.refreshStoneGroupForLayer(l.id)` further down) -- no updateAll()
// call here, since this function is itself already running from inside one.
function writeSelectedControlsToLayer(){
  const regionSelection=drawingTool.activeSelection;
  if(regionSelection&&regionSelection.kind==='region'){
    const regionLayer=project.layers.find(x=>x.id===regionSelection.layerId&&x.type==='path');
    const region=regionLayer&&(regionLayer.regions||[]).find(r=>r.id===regionSelection.regionId);
    if(regionLayer&&region){
      region.stoneSizeMm=parseFloat(el('stoneSize').value)||2;
      region.gapMm=readLengthField('gap')||.3;
      region.color=el('stoneColor').value;
      region.fillMode=el('regionFillMode').value==='outline'?'outline':'fill';
      drawingTool.refreshStoneGroupForLayer(regionLayer.id);
      return;
    }
  }
  const l=selectedLayer();
  // S-112A: detected here, before project.plate is overwritten further down in this same function
  // (project.plate.designTarget still holds the *previous* target, el('plateDesignTarget').value the
  // one the user just picked) -- true exactly once, on the edit that switches Design Target to Rim
  // Band while a plate is active.
  const enteringRimBand=currentObjectTemplate().preview.kind==='plate'&&el('plateDesignTarget').value==='rimBand'&&project.plate.designTarget!=='rimBand';
  if(l.type==='text'){
    // S-112A: Rim Band Intelligent Default -- the most common rim-band use case is curved text
    // following the rim, so selecting Rim Band pre-fills the curve controls (and shows them) with a
    // geometrically-correct path *before* the normal el('curveEnabled')/el('curveRadiusMm')/
    // el('curveDirection') reads below pick them up, exactly as if the operator had set them by hand.
    // Center Well/Full Top Surface never run this block, so their text behavior is untouched, and the
    // operator can still freely edit every curve field afterward -- this only seeds a default.
    if(enteringRimBand){el('curveEnabled').value='on';setLengthField('curveRadiusMm',rimBandCurveRadiusMm());el('curveDirection').value='outside';el('curveControls').style.display='block'}
    // FONT-002: '||l.font' guards against a select somehow reporting '' (should not happen now that
    // ensureFontOptionForLayer() always gives it a matching option, but this is the one write site
    // that could otherwise silently corrupt layer.font to an empty string on the next edit).
    // TXT-103: clamp to the #height input's own declared min/max (index.html), matching every sibling
    // numeric field in this function (shapeW/shapeH/shapeSides/lineSpacing/etc. all clamp to their own
    // declared HTML bounds) -- previously the only unclamped one, so a manually-typed value below the
    // legibility floor silently produced sparse/empty glyphs instead of the field's advertised range.
    const nextText=el('text').value;if(nextText!==l.text)invalidateAuthoredScaleForGeometryChange(l,'text');l.text=nextText;
    const nextFont=el('font').value||l.font;if(nextFont!==l.font)invalidateAuthoredScaleForGeometryChange(l,'font');l.font=nextFont;
    // FONT-DECISION-001 (Studio Integration follow-up): ceiling raised from TXT-103's original 80 to
    // 111 -- the true max across every catalog size's supportedHeightRangeMm (StoneSizes.js's SS30
    // entry, [106,111]) -- so the largest validated stone sizes' own auto-set midpoints (see
    // #stoneSize's 'input' listener below) are never clamped back down below their own valid range.
    l.height=Math.max(RAW_ENGINE_HEIGHT_MM_MIN,Math.min(RAW_ENGINE_HEIGHT_MM_MAX,readLengthField('height')||25));l.autoFit=el('autoFit').value==='on';l.textMode=el('textMode').value;
    // FONT-002: a Production Font has no curve support (GeometryEngine.generateTextLayout() throws
    // for authored-stone-center fonts with curveEnabled) -- force it off in the stored layer data too
    // (not just the disabled control) so switching *to* an authored font from a curved legacy layer
    // can never leave curveEnabled:true sitting in the data.
    l.curveEnabled=isAuthoredStoneFontId(l.font)?false:el('curveEnabled').value==='on';l.curveRadiusMm=Math.max(0.1,readLengthField('curveRadiusMm')||40);l.curveDirection=el('curveDirection').value==='inside'?'inside':'outside';l.curveStartAngleDeg=parseFloat(el('curveStartAngleDeg').value)||0;l.curveSweepAngleDeg=parseFloat(el('curveSweepAngleDeg').value)||180;l.curveAlignment=el('curveAlignment').value;el('curveControls').style.display=l.curveEnabled?'block':'none';
  // UI-001: manual X/Y mm fields for the Text Lightbox, writing to the same layer.x/layer.y fields
  // RS-1009 already added (previously settable only by drag/nudge/align/distribute).
  l.x=readLengthField('textX')||0;l.y=readLengthField('textY')||0;
  // TXT-102: align/lineSpacing mirror curveAlignment/curveRadiusMm's own clamp-on-write convention
  // just above -- lineSpacing clamped to the same [0.5,3] range the #lineSpacing input itself allows,
  // rotationDeg normalized into [0,360) exactly like GeometryEngine's own normalizeRotationDeg().
  l.align=el('textAlign').value;l.lineSpacing=Math.max(0.5,Math.min(3,parseFloat(el('lineSpacing').value)||1));l.rotationDeg=(((parseFloat(el('rotationDeg').value)||0)%360)+360)%360;
  // READ-006: clamped to the pitch-derived bounds letterSpacingBoundsMm() computes from the
  // #stoneSize/#gap controls (NOT l.stoneSize/l.gap -- those are written by the shared tail block
  // below, after this line) -- the SAME values refreshLetterSpacingFieldBounds() writes onto
  // #letterSpacing's min/max. Same clamp-on-write convention as lineSpacing just above.
  const lsBounds=letterSpacingBoundsMm();l.letterSpacing=Math.max(lsBounds.minMm,Math.min(lsBounds.maxMm,readLengthField('letterSpacing')||0))}else if(l.type==='circle'){l.cx=readLengthField('shapeX')||105;l.cy=readLengthField('shapeY')||45;l.r=Math.max(1,readLengthField('shapeW')||18);l.fillMode=resolveVectorFillMode(el('shapeFillMode').value)}else if(l.type==='rectangle'){l.x=readLengthField('shapeX')||65;l.y=readLengthField('shapeY')||30;l.w=Math.max(1,readLengthField('shapeW')||80);l.h=Math.max(1,readLengthField('shapeH')||30);l.fillMode=resolveVectorFillMode(el('shapeFillMode').value)}else if(SHAPE_LIBRARY_KINDS.has(l.type)){
  // S-110: every new shape kind shares Rectangle's x/y/w/h + Fill Style write-back, plus its own
  // configurable extra fields (Regular Polygon/Star/Ring only).
  l.x=readLengthField('shapeX')||0;l.y=readLengthField('shapeY')||0;l.w=Math.max(1,readLengthField('shapeW')||60);l.h=Math.max(1,readLengthField('shapeH')||60);l.fillMode=resolveVectorFillMode(el('shapeFillMode').value);
  if(l.type==='polygon')l.sides=Math.max(3,Math.min(12,parseIntOr(el('shapeSides').value,6)));
  if(l.type==='star'){l.points=Math.max(3,Math.min(12,parseIntOr(el('shapePoints').value,5)));l.innerRadiusRatio=Math.max(0.1,Math.min(0.9,parseFloat(el('shapeInnerRadius').value)||0.5))}
  if(l.type==='ring')l.innerRatio=Math.max(0.1,Math.min(0.9,parseFloat(el('shapeRingInner').value)||0.5));
}else if(l.type==='svg'){l.x=readLengthField('shapeX')||0;l.y=readLengthField('shapeY')||0;l.w=Math.max(1,readLengthField('shapeW')||10);l.h=Math.max(1,readLengthField('shapeH')||10);l.mode=resolveVectorFillMode(el('svgMode').value)}else if(l.type==='image'){l.x=readLengthField('shapeX')||0;l.y=readLengthField('shapeY')||0;l.w=Math.max(1,readLengthField('shapeW')||10);l.h=Math.max(1,readLengthField('shapeH')||10);l.threshold=Math.max(0,Math.min(255,parseIntOr(el('imgThreshold').value,DEFAULT_IMAGE_THRESHOLD)));l.invert=el('imgInvert').value==='on';l.blurRadiusPx=Math.max(0,parseIntOr(el('imgBlurRadius').value,0));l.maxWidthPx=Math.max(8,parseIntOr(el('imgMaxWidth').value,DEFAULT_IMAGE_MAX_DIMENSION_PX));l.maxHeightPx=Math.max(8,parseIntOr(el('imgMaxHeight').value,DEFAULT_IMAGE_MAX_DIMENSION_PX));l.fillMode=resolveImageFillMode(el('imageFillMode').value)}else if(l.type==='path'){l.x=readLengthField('shapeX')||0;l.y=readLengthField('shapeY')||0;l.w=Math.max(2,readLengthField('shapeW')||10);l.h=Math.max(2,readLengthField('shapeH')||10);l.fillMode=resolveVectorFillMode(el('shapeFillMode').value)}
  const nextStoneSize=parseFloat(el('stoneSize').value)||2;if(nextStoneSize!==l.stoneSize)invalidateAuthoredScaleForGeometryChange(l,'stoneSize');l.stoneSize=nextStoneSize;
  const nextGap=readLengthField('gap')||.3;if(nextGap!==l.gap)invalidateAuthoredScaleForGeometryChange(l,'gap');l.gap=nextGap;
  l.color=el('stoneColor').value;
  // RS-3029: shape rotation write-back, mirroring text's own #rotationDeg normalize-into-[0,360)
  // just above -- this tail block runs once after all six shape branches, so it only ever writes
  // l.rotationDeg for a non-text (shape) layer, never double-writing text's own already-correct value.
  if(l.type!=='text')l.rotationDeg=(((parseFloat(el('shapeRotationDeg').value)||0)%360)+360)%360;
  // S-200: Mixed Stone Size -- read back exactly like stoneSize/gap/color just above, applying to
  // every layer type uniformly. allowedSizesMm is rebuilt from the checkbox states on every write
  // (not merged with any prior stored value), matching this app's general "the UI is authoritative
  // for the fields it displays" convention (see e.g. l.fillMode above).
  l.sizeMode=resolveSizeMode(el('sizeMode').value);
  // Mirrors #curveControls' own live show/hide (see the enteringRimBand block above): progressive
  // disclosure must react to every edit of #sizeMode itself, not only to switching the selected
  // layer (syncSelectedControlsFromLayer() already handles that case).
  el('mixedSizeDetailFields').style.display=l.sizeMode==='mixed'?'block':'none';
  l.allowedSizesMm=MIXED_ALLOWED_SIZE_CHECKBOXES.filter(cb=>el(cb.id).checked).map(cb=>cb.diameterMm);
  l.minSizeMm=parseFloat(el('mixedMinSize').value)||null;
  l.maxSizeMm=parseFloat(el('mixedMaxSize').value)||null;
  l.conservativeDetail=Math.max(0,Math.min(1,parseFloat(el('conservativeDetail').value)||0));
  // RS-3011 Step 3b: every field write above (stoneSize/gap/color/fillMode/mixed-size) can change
  // a 'path' layer's live stone preview on the Design canvas -- rebuild it here, the one place all
  // of those writes have already landed on `l`. A no-op for every other layer type, and a no-op for
  // a 'path' layer with no matching board.shapes item (Design not active / a different shape
  // selected), per drawingTool.refreshStoneGroupForLayer()'s own findShapeByLayerId() guard --
  // same write-through convention as onShapeMoved/onShapeResized/onShapeDeleted above.
  if(l.type==='path')drawingTool.refreshStoneGroupForLayer(l.id);
  project.cupColor=el('cupColor').value;project.wrap=el('wrap').value;
  // S-112: plate fields only read/written while the Round Dinner Plate template is active
  // (mirroring how e.g. bottle-only fields are template-gated) -- normalizePlateParams() clamps
  // every value into the JSON's approved range and re-derives a consistent inner/outer diameter
  // pair, so a malformed typed value can never desync rimWidthMm or leave project.plate
  // inconsistent. project.canvas is kept a square exactly matching the live outer diameter (the
  // plate's production canvas IS its top-down footprint, unlike the cylindrical templates' unwrapped
  // wall), and project.cupColor is kept resolved from the selected plate color id so drawCup()/the
  // Object Preview need no plate-specific color plumbing.
  if(currentObjectTemplate().preview.kind==='plate'){
    project.plate=normalizePlateParams({outerDiameterMm:readLengthField('plateOuterDiameter'),innerWellDiameterMm:readLengthField('plateInnerWellDiameter'),overallHeightMm:readLengthField('plateOverallHeight'),centerDepthMm:readLengthField('plateCenterDepth'),footRingOuterDiameterMm:project.plate.footRingOuterDiameterMm,footRingHeightMm:project.plate.footRingHeightMm,colorId:el('plateColor').value,designTarget:el('plateDesignTarget').value});
    project.canvas={width:project.plate.outerDiameterMm,height:project.plate.outerDiameterMm};
    project.cupColor=getPlateColor(project.plate.colorId).hex;
  }
  // RS-2010: vessel fields only read/written while a Mug/Tumbler/Bottle template is active,
  // mirroring the plate block just above. normalizeVesselParams() clamps every typed value into
  // that product's approved commercial range and forces topDiameterMm===bodyDiameterMm for the
  // straight-wall products (tumbler, bottle), so a malformed value can never desync project.vessel.
  // project.canvas is re-derived from the live vessel params every edit (circumference/printable
  // height), the vessel counterpart of the plate's own canvas-follows-outer-diameter line above.
  if(VESSEL_PRODUCT_IDS.includes(currentObjectTemplate().id)){
    const vesselProductId=currentObjectTemplate().id;
    project.vessel=normalizeVesselParams(vesselProductId,{bodyDiameterMm:readLengthField('vesselBodyDiameter'),topDiameterMm:readLengthField('vesselTopDiameter'),bodyHeightMm:readLengthField('vesselBodyHeight')});
    project.canvas=computeCanvasFromVessel(project.vessel);
  }
  project.name=el('projectName').value||DEFAULT_PROJECT_NAME;rotation=parseFloat(el('rotation').value)||0;zoom=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,(parseFloat(el('zoom').value)||100)/100))}
// M14 (perf/move-drag-translate-fast-path): pure translation of an existing StoneLayout for the
// move-drag fast path. Returns a NEW StoneLayout whose stones are fresh Stone copies of baseLayout's:
// stones whose layerId is in movedLayerIds are shifted by (dxMm,dyMm); every other stone is carried
// over with identical values. baseLayout and its Stone instances are never mutated.
//
// Why this is geometrically exact per layer: every GeometryEngine sampling grid is anchored to its
// own layer's box (text placement offset, shape x/y, svg/image x/y, path natural-space transform),
// so translating the layer's box by (dx,dy) translates every one of that layer's sampled stone
// centers by exactly (dx,dy) -- nothing about the intra-layer sampling depends on absolute canvas
// position. The one cross-layer stage, dedupeStonesByRadius() in engine.generate(), is NOT reproduced
// here: in overlap zones where the moved layer transiently covers another mid-drag, this preview can
// differ slightly from a true regeneration. That is the milestone's known, by-design approximation --
// see the end-of-drag regeneration in endActiveDrag() below, which restores the canonical set before
// anything can persist or export.
function translateLayoutForMoveDrag(baseLayout,movedLayerIds,dxMm,dyMm){
  const moved=movedLayerIds instanceof Set?movedLayerIds:new Set(movedLayerIds);
  const stones=baseLayout.stones.map(s=>{
    const shift=moved.has(s.layerId);
    return new Stone({
      xMm:shift?s.xMm+dxMm:s.xMm,
      yMm:shift?s.yMm+dyMm:s.yMm,
      sizeMm:s.sizeMm,
      color:s.color,
      layerId:s.layerId,
      index:s.index,
      metadata:s.metadata
    });
  });
  return new StoneLayout({layerId:baseLayout.layerId,stones,sourceMode:baseLayout.sourceMode,outlineStats:baseLayout.outlineStats});
}
// M14 precondition #1 (verified by reading, not assumed) -- fitTextToShape(): it is a ONE-SHOT
// action, not a live cross-layer dependency. applyTextFitPlan() bakes the computed heightMm/xMm/yMm
// straight into the text layer's own fields, and fitTextToShape() is only ever called from three UI
// entry points (createShapeLayer(), addText(), the #fitTextToShapeBtn click) -- never from
// engine.generate() or generateTextStonesLive(). So a move drag can never invalidate a stored fit,
// and the fast path needs no fit-related fallback.
async function updateAll(skipWrite=false,forceStoneRebuild=false){if(!skipWrite)writeSelectedControlsToLayer();const token=++generationToken;let generated;try{generated=await engine.generate(project)}catch(error){if(token!==generationToken)return;console.error('Layout generation failed',error);el('status').textContent=`Text generation failed: ${error.message}`;return}if(token!==generationToken)return;layout=generated;
  // MONO-006A: a prior failed generation (e.g. a stale authoredScale rejected by GeometryEngine)
  // leaves this exact status message behind -- once generation succeeds again, it must not keep
  // reading as broken even though the canvas has already recovered.
  if(el('status').textContent.startsWith('Text generation failed'))el('status').textContent='Ready';
  // RS-3010 Step 1: while drawing mode owns layoutCanvas, drawLayout() itself is a no-op (see its
  // own guard below) -- calling it here would do nothing useful, and every real trigger that lands
  // in updateAll() while active (a window resize, a workspace-tab switch reflowing the panel, or
  // any other edit that happens to run updateAll() concurrently) still needs layoutCanvas's *size*
  // kept in sync, just through drawingTool's own resync path instead of the normal renderer.
  renderLayerUI();if(drawingTool.isActive){drawingTool.resize(38*Math.max(1,devicePixelRatio||1));
  // Canvas-desync fix: reconciles Design's live Paper.js shapes against project.layers on every
  // updateAll() call while Design is active -- resize() above only keeps the viewport in sync, it
  // never did this. Covers undo/redo (applyHistorySnapshot() swaps `project` wholesale) and the
  // Layers-list trash-icon delete (deleteLayer() there is called directly, bypassing
  // drawingTool.deleteSelected()/onShapeDeleted entirely) -- see syncFromProjectLayers()'s own doc
  // comment for why this is a no-op after an ordinary Design-originated commit/move/resize/delete,
  // and for why applyHistorySnapshot()/deleteLayer()'s trash-icon path pass forceStoneRebuild=true.
  // RS-3032 Step A: widened from 'path'-only to also include every SHAPE_LIBRARY_KINDS layer (Star/
  // Ring/Heart/... from the "More Shapes" popover/Shapes panel) -- syncFromProjectLayers() itself
  // branches on layer.type internally to materialize/track the two categories separately. RS-3012
  // Step 2: widened again to include 'svg'/'image' -- both already use the same x/y/w/h/rotationDeg
  // box model as every other XYWH_SHAPE_TYPES layer, so they get the same on-canvas click-to-select/
  // drag/resize/rotate presence in Design that 'path'/SHAPE_LIBRARY_KINDS layers already have. RS-3012
  // Step 3: widened once more to include 'text' -- unlike every other type
  // here, it has no x/y/w/h box or vector outline at all, only real stone positions (already computed
  // by the engine.generate() call just above, Design-active or not); syncFromProjectLayers() takes a
  // dedicated code path for it (see its own doc comment) rather than forcing it through the
  // XYWH_SHAPE_TYPES box model the others share. RS-3012 Step 4: widened a final time to include
  // 'circle' -- like 'text' it has no x/y/w/h box (cx/cy/r data model, deliberately not migrated), so
  // syncFromProjectLayers() takes its own dedicated code path for it too; the resize write-back below
  // (onShapeResized) converts the reported bounds back to l.r.
  drawingTool.syncFromProjectLayers(project.layers.filter(l=>l.type==='path'||SHAPE_LIBRARY_KINDS.has(l.type)||l.type==='svg'||l.type==='image'||l.type==='text'||l.type==='circle'),forceStoneRebuild)}else{drawLayout()}drawCup();updateStats();updateHistoryUI();updateEditingUI();updateViewButtons();updateTextOutsidePrintableWarning();scheduleAutosave();if(permanentEngineError)el('status').textContent=`Font manifest failed to load (${permanentEngineError.message}); text layers are empty. Shape layers are unaffected.`}
// RS-3011 freehand-close-and-clear-all-layers fix: deleting the last remaining layer no longer
// blocks (see deleteLayer()) -- the per-row trash icon and the sidebar "Delete selected layer"
// button are therefore never disabled for layer count anymore.
function renderLayerUI(){el('selectedLayer').innerHTML=project.layers.map(l=>`<option value="${escapeHtml(l.id)}">${escapeHtml(layerLabel(l))}</option>`).join('');el('selectedLayer').value=selectedLayerId;el('layersList').innerHTML=project.layers.map(l=>`<div class="layer ${selectedLayerIds.has(l.id)?'selected':''}" data-layer="${escapeHtml(l.id)}"><input type="checkbox" ${l.visible?'checked':''} data-action="visible"><div class="name" data-action="select" title="${escapeHtml(layerLabel(l))}">${escapeHtml(layerLabel(l))}</div><div class="type">${l.type.toUpperCase()}</div><button data-action="select">✎</button><button data-action="duplicate">⧉</button><button data-action="delete">🗑</button></div>`).join('');
  // UI-001: keep the right inspector's layer name and the left panel's project/template summary
  // in sync on every render (add/delete/duplicate/undo/redo/import/selection change).
  // RS-3013 Step 5: a selected REGION outranks the underlying layer's own label here, same
  // "region wins" precedent syncSelectedControlsFromLayer()'s own new branch follows -- checked live
  // against drawingTool.activeSelection (not cached) since renderLayerUI() re-runs on every
  // updateAll(), including every keystroke while editing a region's own fields, and must not let the
  // header flicker back to the parent layer's label mid-edit.
  el('inspectorLayerName').textContent=drawingTool.activeSelection?.kind==='region'?'Region':layerLabel(selectedLayer());updateObjectTemplateDetail();
}function layerLabel(l){if(l.type==='text')return l.text||'Text';if(l.type==='svg')return l.svgName||'SVG';if(l.type==='image')return l.imageName||'Image';if(l.type==='path')return l.pathName||'Path';return SHAPE_DISPLAY_LABELS[l.type]||'Shape'}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function resizeCanvas(c){const r=c.getBoundingClientRect(),dpr=Math.max(1,devicePixelRatio||1),w=Math.floor(r.width*dpr),h=Math.floor(r.height*dpr);if(c.width!==w||c.height!==h){c.width=w;c.height=h}return{w,h,dpr}}
function layoutMmToPx(p){return{x:layoutTransform.ox+p.x*layoutTransform.s,y:layoutTransform.oy+p.y*layoutTransform.s}}function layoutPxToMm(x,y){return{x:(x-layoutTransform.ox)/layoutTransform.s,y:(y-layoutTransform.oy)/layoutTransform.s}}
// RS-3017: on-canvas scale bar, bottom-right of #panel2D. `s` (from layoutTransform) is device-px
// per mm -- resizeCanvas() sizes the canvas backing store by devicePixelRatio, but the scale bar's
// DOM element widths are CSS px, so dividing by dpr here is required to avoid a dpr-x-too-wide bar
// on high-DPI screens.
function updateScaleBar(s,dpr){
  const stepMm=chooseNiceStepMm(s/dpr,SCALE_BAR_TARGET_PX,'atMost',project.units);
  const barPx=stepMm*s/dpr;
  el('scaleBarTrack').style.width=barPx+'px';
  el('scaleBarLabel').textContent=`${formatLengthDisplay(stepMm,project.units)} ${unitSuffix(project.units)}`;
}
function drawLayout(){
  // RS-3010 Step 1: "canvas interaction owned by exactly one thing at a time" also covers who
  // *draws* to layoutCanvas, not just pointer/keyboard input -- while drawingTool.isActive, Paper.js
  // owns rendering (its own autoUpdate loop) and resizeCanvas() below would fight it: changing
  // canvas.width/height resets the 2D context, wiping Paper's own devicePixelRatio ctx.scale() and
  // corrupting whatever Paper draws next. A blanket guard here (rather than patching each call
  // site -- the window resize listener, setWorkspaceMode(), the Settings panel's Apply handler,
  // ...) means every existing and future drawLayout() caller is automatically safe; setDrawMode(false)'s own explicit
  // drawLayout() call runs *after* drawingTool.exit() has already flipped isActive off, so it isn't
  // blocked by this guard.
  if(drawingTool.isActive)return;
  const{w,h,dpr}=resizeCanvas(layoutCanvas),ctx=layoutCanvas.getContext('2d');const{s,ox,oy}=renderProductionLayout(ctx,layout,{widthPx:w,heightPx:h,paddingPx:38*dpr,units:project.units});layoutTransform={s,ox,oy,dpr};
  updateScaleBar(s,dpr);el('scaleBar').style.display=drawingTool.isActive?'none':'flex';
  // S-112: the plate template draws its own circular/annular design-target guide instead of the
  // cylindrical Front View Frame + rectangular safe-area guide -- neither applies to a flat
  // top-down disc (see drawPlateDesignTargetGuide()'s own header comment).
  const isPlate=currentObjectTemplate().preview.kind==='plate';
  if(isPlate){drawPlateDesignTargetGuide(ctx,s,ox,oy,dpr)}else{drawFrontViewFrame(ctx,s,ox,oy,dpr);if(showSafeArea)drawSafeAreaGuide(ctx,s,ox,oy,dpr,getSafeAreaRectMm(currentObjectTemplate(),project.canvas.width,project.canvas.height))}
  drawSelection(ctx,s,ox,oy,dpr);drawGuides(ctx,s,ox,oy,dpr);ctx.fillStyle='#516071';ctx.font=`${12*dpr}px Arial`;ctx.fillText(`${layout.count} stones · ${formatLengthDisplay(layout.widthMm,project.units,1)}×${formatLengthDisplay(layout.heightMm,project.units,1)} ${unitSuffix(project.units)} · ${selectedLayer().textMode||''}`,20*dpr,h-18*dpr);el('fitNotice').textContent=isPlate?'Drag to move (Shift = constrain, Alt = duplicate) · Shift-click to multi-select · click empty canvas to clear · Arrow keys nudge (Shift = larger step) · Blue guide shows the selected Design Target’s printable boundary.':'Drag to move (Shift = constrain, Alt = duplicate) · Shift-click to multi-select · click empty canvas to clear · Arrow keys nudge (Shift = larger step) · Drag the amber Front View Frame to rotate the Object Preview.'}
// RS-1004: a dashed guide rectangle for the active object template's safe design area, derived from
// the current project.canvas size. This is a layer-agnostic editor overlay (like drawSelection()
// below), not a CanvasRenderer2D.js change -- it reuses the exact mm->px transform
// renderProductionLayout() already returned, drawn before the selection outline so selection always
// reads on top.
function drawSafeAreaGuide(ctx,s,ox,oy,dpr,rectMm){const rx=ox+rectMm.xMm*s,ry=oy+rectMm.yMm*s,rw=rectMm.widthMm*s,rh=rectMm.heightMm*s;ctx.save();ctx.strokeStyle='rgba(20,120,255,.45)';ctx.lineWidth=1.25*dpr;ctx.setLineDash([5*dpr,4*dpr]);ctx.strokeRect(rx,ry,rw,rh);ctx.setLineDash([]);ctx.restore()}
// S-112: the Round Dinner Plate's own printable-boundary guide -- a circle (Center Well/Full Top
// Surface) or true annulus (Rim Band), replacing the cylindrical Front View Frame (drawFrontViewFrame()
// below is skipped entirely for the plate template, see drawLayout()) since a flat top-down disc has
// no "currently facing the viewer" wrap-position concept. Reuses getPlateDesignTargetGuide()
// (src/products/PlateGuides.js, kept plate-specific and outside GeometryEngine per the milestone
// brief) for the pure geometry; this function only turns that into drawn circles with the existing
// mm->px transform every other overlay here already uses. Purely advisory (like drawSafeAreaGuide()) --
// never clips/hides a stone, and the design-target selection never regenerates the StoneLayout.
function drawPlateDesignTargetGuide(ctx,s,ox,oy,dpr){
  const guide=getPlateDesignTargetGuide(project.plate.designTarget,project.plate,project.canvas.width,project.canvas.height);
  const cx=ox+guide.cxMm*s,cy=oy+guide.cyMm*s;
  const strokeCircle=(radiusMm,dashed)=>{ctx.beginPath();ctx.arc(cx,cy,radiusMm*s,0,Math.PI*2);ctx.setLineDash(dashed?[5*dpr,4*dpr]:[]);ctx.stroke()};
  ctx.save();
  ctx.lineWidth=1.75*dpr;
  ctx.strokeStyle='rgba(20,120,255,.6)';
  if(guide.kind==='annulus'){
    strokeCircle(guide.outerRadiusMm,false);
    strokeCircle(guide.innerRadiusMm,false);
  }else{
    strokeCircle(guide.radiusMm,false);
    if(guide.transitionRadiusMm!=null){ctx.strokeStyle='rgba(20,120,255,.35)';strokeCircle(guide.transitionRadiusMm,true)}
  }
  ctx.setLineDash([]);
  ctx.font=`bold ${12*dpr}px Arial`;
  ctx.fillStyle='#1478ff';
  ctx.fillText(`${guide.label} · printable boundary`,ox+6*dpr,oy+16*dpr);
  ctx.restore();
}
// S-112A: Rim Band's printable annulus midline, in mm -- reuses the exact outer/inner radii
// getPlateDesignTargetGuide() already derives (no second radius calculation), giving curved text "the
// correct circular text path" for the rim: centered between the well/rim transition and the outer
// edge, so default-length rim text neither overlaps the well nor runs past the plate's edge.
function rimBandCurveRadiusMm(){const guide=getPlateDesignTargetGuide('rimBand',project.plate,project.canvas.width,project.canvas.height);return(guide.outerRadiusMm+guide.innerRadiusMm)/2}
// S-107 (Front View Frame & Long Text Workflow): normalizes a radian angle delta to (-PI, PI], the
// signed "how far around the object" distance used by isPointerOnFrontViewFrame() and the frame
// drag math below. A tiny local helper (not exported from ObjectDimensions.js) since it operates on
// a difference of two already-computed azimuths, not a canvas-x<->azimuth conversion itself.
function normalizeAngleDeltaRad(deltaRad){let d=deltaRad%(2*Math.PI);if(d>Math.PI)d-=2*Math.PI;if(d<-Math.PI)d+=2*Math.PI;return d}
// The Front View Frame (requirement 1): a movable, always-drawn overlay on the 2D canvas showing
// the portion of the object currently facing the viewer in the Object Preview. Unlike
// drawSafeAreaGuide() (a fixed dashed outline marking print-safety margins), this is a filled,
// solid-bordered amber band spanning the full canvas height, deliberately different in both color
// and style (requirement 1: "must be visually different from the printable-area guides") and
// clearly a *viewing window*, not a boundary. Reuses canvasXMmForRotationDeg()/
// frontViewFrameWidthMm() (ObjectDimensions.js) -- the exact same mm-accurate, wrap-independent
// mapping ObjectGeometryBuilder.js's applyAzimuthUv() uses for the object mesh's own texture, so the
// 2D canvas and the Object Preview can never disagree about which portion is "facing the viewer"
// (requirement: "2D Canvas and Object Preview become synchronized views of the same wrapped
// design"). Never clips/hides any stone -- this is drawn on top of the already-complete production
// layout (requirement 4), purely a highlight.
function frontViewFrameGeometry(){
  const canvasWidthMm=project.canvas.width;
  const frameWidthMm=Math.min(canvasWidthMm,frontViewFrameWidthMm(project.wrap,canvasWidthMm));
  const centerXmm=canvasXMmForRotationDeg(rotation,canvasWidthMm);
  return{canvasWidthMm,frameWidthMm,centerXmm};
}
function drawFrontViewFrame(ctx,s,ox,oy,dpr){
  const{canvasWidthMm,frameWidthMm,centerXmm}=frontViewFrameGeometry();
  const halfW=frameWidthMm/2;
  // Requirement 3: wrap continuously across the canvas's left/right edges -- x=0 and x=canvasWidthMm
  // are the same physical point on the object (ObjectDimensions.js), so a frame that spans past
  // either edge is split into on-canvas segments, each re-entering (mod canvasWidthMm) at the
  // opposite edge, with no gap or jump between them.
  const segments=[];
  let startXmm=centerXmm-halfW,remainingMm=frameWidthMm;
  while(remainingMm>1e-6){
    const wrappedX=((startXmm%canvasWidthMm)+canvasWidthMm)%canvasWidthMm;
    const segLen=Math.min(remainingMm,canvasWidthMm-wrappedX);
    segments.push({x0:wrappedX,x1:wrappedX+segLen});
    startXmm+=segLen;remainingMm-=segLen;
  }
  ctx.save();
  ctx.fillStyle='rgba(255,140,0,.16)';
  ctx.strokeStyle='#ff8c00';
  ctx.lineWidth=2.5*dpr;
  ctx.setLineDash([]);
  for(const seg of segments){
    const rx=ox+seg.x0*s,ry=oy,rw=(seg.x1-seg.x0)*s,rh=project.canvas.height*s;
    ctx.fillRect(rx,ry,rw,rh);
    ctx.strokeRect(rx,ry,rw,rh);
  }
  const label=`Front View · ${formatLengthDisplay(frameWidthMm,project.units,1)} ${unitSuffix(project.units)}`;
  const labelSeg=segments[0];
  const labelY=oy>16*dpr?oy-8*dpr:oy+16*dpr;
  ctx.font=`bold ${12*dpr}px Arial`;
  ctx.fillStyle='#ff8c00';
  ctx.fillText(label,ox+labelSeg.x0*s+6*dpr,labelY);
  ctx.restore();
}
// Hit-test for starting a frame drag (requirement 2): true when `mm` sits inside the current Front
// View Frame band -- the same wrap-aware angular window drawFrontViewFrame() renders, expressed as
// an angular distance so it needs no per-segment mm math and handles the edge-wrap case for free.
function isPointerOnFrontViewFrame(mm){
  // S-112: the plate has no Front View Frame (drawLayout() never draws one for it -- see
  // drawPlateDesignTargetGuide()'s header comment), so it can never be the target of a frame drag.
  if(currentObjectTemplate().preview.kind==='plate')return false;
  if(mm.y<0||mm.y>project.canvas.height)return false;
  const canvasWidthMm=project.canvas.width;
  const pointerAzimuthRad=azimuthRadForCanvasXMm(mm.x,canvasWidthMm);
  const rotationRad=(rotation*Math.PI)/180;
  const deltaRad=normalizeAngleDeltaRad(pointerAzimuthRad-rotationRad);
  return Math.abs(deltaRad)<=wrapAngleRad(project.wrap)/2;
}
// fix/rotated-layer-bbox-hittest: rotates a box's four corners clockwise around the box's own
// center by rotationDeg, via rotatePointDeg() below (module-private verbatim replica of
// GeometryEngine's rotatePointsAroundCenter() -- reused here rather than re-derived, exactly like
// every other rotation-aware computation in this file), and returns the corners' axis-aligned
// bounding box. A 0/360 rotation returns the input box unchanged (byte-identical output for every
// unrotated layer, matching this file's existing 0-rotation-is-a-no-op convention).
function rotatedCornersAABB(x,y,w,h,rotationDeg){
  if(((rotationDeg||0)%360+360)%360===0)return{x,y,width:w,height:h,x2:x+w,y2:y+h};
  const cx=x+w/2,cy=y+h/2;
  const corners=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([px,py])=>rotatePointDeg(px,py,cx,cy,rotationDeg));
  const xs=corners.map(c=>c.x),ys=corners.map(c=>c.y);
  const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  return{x:x0,y:y0,x2:x1,y2:y1,width:x1-x0,height:y1-y0};
}
// Text layers have no plain layer fields to compute a bbox from directly (unlike circle/
// rectangle), so their selection bbox is derived from the already-generated StoneLayout, filtered
// to this layer's stones and wrapped in a fresh StoneLayout to reuse its getBoundingBox() math.
// fix/rotated-layer-bbox-hittest: the XYWH branch now returns the TRUE rotated-corners AABB
// (rotatedCornersAABB() above) instead of the raw unrotated x/y/w/h box, so every caller that wants
// a layer's actual visible/production footprint (hitTest's move-containment check, align/snap,
// marquee-adjacent tooling, the rotate handle's own AABB-top-edge placement, etc.) gets it correctly
// for a rotated shape. The one caller that must NOT get the rotated AABB is any call feeding this
// box into rotatedHandlesFor() (which itself rotates whatever box it's given around that box's own
// center) -- doing so would rotate an already-rotated box a second time. hitTest() below captures
// its own raw box explicitly for that reason; drawSelection() does the same for its
// drawSelectionBox() call (see that function's own comment) while still using this AABB, unchanged,
// for its rotate-handle placement. Audited every other getLayerBBox( call site in this file
// (unionBBoxOfLayers/selectionBoundsText/groupBBox0, selectedItemsForEditing's align/distribute,
// the drag-move snap-target list, computeShapeAroundText, rotateHandlePositionMm) -- all either
// operate on text layers only (untouched by this branch) or genuinely want the visible AABB, which
// is the point of this fix.
function getLayerBBox(l){if(l.type==='circle')return{x:l.cx-l.r,y:l.cy-l.r,width:l.r*2,height:l.r*2,x2:l.cx+l.r,y2:l.cy+l.r};if(XYWH_SHAPE_TYPES.has(l.type))return rotatedCornersAABB(l.x,l.y,l.w,l.h,l.rotationDeg||0);const stones=layout.stones.filter(s=>s.layerId===l.id);if(!stones.length)return{x:0,y:0,x2:0,y2:0,width:0,height:0};const b=new StoneLayout({layerId:l.id,stones}).getBoundingBox();return{x:b.minXmm,y:b.minYmm,x2:b.maxXmm,y2:b.maxYmm,width:b.widthMm,height:b.heightMm}}
// RS-1009: the one pair of functions that know a layer's position field names (cx/cy for circle,
// x/y for everything else, including the new text-layer offset fields) -- src/editing/** never
// sees a layer `type`, it only ever returns a translation delta; these two functions turn that
// delta into the right field write for drag, keyboard nudge, align, and distribute alike.
function getLayerPosition(l){if(l.type==='circle')return{xMm:l.cx,yMm:l.cy};return{xMm:l.x||0,yMm:l.y||0}}
function setLayerPosition(l,xMm,yMm){if(l.type==='circle'){l.cx=xMm;l.cy=yMm}else{l.x=xMm;l.y=yMm}}
function unionBBoxOfLayers(layers){let x=Infinity,y=Infinity,x2=-Infinity,y2=-Infinity;for(const l of layers){const b=getLayerBBox(l);x=Math.min(x,b.x);y=Math.min(y,b.y);x2=Math.max(x2,b.x2);y2=Math.max(y2,b.y2)}return{x,y,x2,y2,width:x2-x,height:y2-y}}
// RS-1009: adapts a live project layer into the plain {id,bbox:{xMm,yMm,widthMm,heightMm}} shape
// src/editing/AlignmentEngine.js expects, for every currently multi-selected layer.
function selectedItemsForEditing(){return[...selectedLayerIds].map(id=>project.layers.find(l=>l.id===id)).filter(Boolean).map(l=>{const b=getLayerBBox(l);return{id:l.id,bbox:{xMm:b.x,yMm:b.y,widthMm:b.width,heightMm:b.height}}})}
// RS-3011 Step 2 fix: repositionShapeForLayer() keeps a Design-drawn shape's Paper.js item (in
// drawingTool's own board.shapes) in sync with the project.layers x/y this loop just wrote --
// Align/Distribute previously bypassed DrawingCanvasTool.js entirely (unlike the main-canvas drag
// code, which already writes through via onShapeMoved/onShapeResized), leaving the two visibly out
// of sync until Design was closed and reopened. A no-op for every non-Design layer type (its own
// internal lookup finds no matching item.data.layerId).
function applyPositionDeltas(deltas){for(const[id,{dxMm,dyMm}]of deltas){const l=project.layers.find(x=>x.id===id);if(!l)continue;const p=getLayerPosition(l);const xMm=p.xMm+dxMm,yMm=p.yMm+dyMm;setLayerPosition(l,xMm,yMm);drawingTool.repositionShapeForLayer(l.id,xMm,yMm)}}
// UI-001B: align/distribute were the only two mutating editor actions with no #status confirmation
// at all (every other action -- import/export/duplicate/delete/undo/redo -- already reports what it
// did); a click that moves a layer by a subtle, easy-to-miss amount could look like nothing happened.
const ALIGN_DIRECTION_LABELS={left:'left edges',centerH:'horizontal centers',right:'right edges',top:'top edges',centerV:'vertical centers',bottom:'bottom edges'};
function runAlign(direction){const items=selectedItemsForEditing();if(items.length<2)return;commitHistory();applyPositionDeltas(alignLayers(items,direction));syncSelectedControlsFromLayer();updateAll(true);el('status').textContent=`Aligned ${items.length} layers to ${ALIGN_DIRECTION_LABELS[direction]||direction}`}
function runDistribute(axis){const items=selectedItemsForEditing();if(items.length<3)return;commitHistory();applyPositionDeltas(distributeLayers(items,axis));syncSelectedControlsFromLayer();updateAll(true);el('status').textContent=`Distributed ${items.length} layers ${axis==='horizontal'?'horizontally':'vertically'}`}
// S-104: recovers a text layer dragged fully outside the visible printable (safe) area. Text has no
// stored absolute position -- computeTextPlacementOffset() above already auto-centers its bbox on
// the production canvas before adding layer.x/layer.y on top (world bbox center = canvas center +
// layer.x/y), so centering on the printable area is a pure function of the safe-area rect and the
// canvas size, independent of the text's own content/font/size. Only l.x/l.y are ever written here --
// every other text property (font, size, rotation/curve, spacing, fill, stone size) is untouched.
function centerSelectedTextOnObject(){
  const l=selectedLayer();if(!l||l.type!=='text')return;
  const safe=getSafeAreaRectMm(currentObjectTemplate(),project.canvas.width,project.canvas.height);
  const targetX=safe.xMm+safe.widthMm/2-project.canvas.width/2,targetY=safe.yMm+safe.heightMm/2-project.canvas.height/2;
  commitHistory();
  l.x=targetX;l.y=targetY;
  syncSelectedControlsFromLayer();updateAll(true);
  el('status').textContent='Centered text on the printable area';
}
// S-104 (audited/corrected after real-mouse-drag verification): "no longer meaningfully visible on
// the printable object" is a PARTIAL-overlap test against the printable safe area, not a full-
// disjoint one. Coordinate-space audit behind this: layer.x/y and getLayerBBox()'s bbox are both in
// the flat production-canvas mm frame (the same frame stones are generated in); getSafeAreaRectMm()
// is that same frame's inset rectangle. The 3D preview (Preview3DRenderer.js's
// _updateInstancedStones(), fed canvasWidthMm/canvasHeightMm from this exact project.canvas by
// update()) places every stone's instance by mapping its flat canvas xMm/yMm through
// ObjectDimensions.js's azimuthRadForCanvasXMm() (U 0..1-equivalent = canvas x 0..canvasWidthMm)
// around the object's true, wrap-mode-independent circumference (S-109) -- so anything within the
// flat canvas's mm bounds is always on the object at the same mm position regardless of wrap mode
// or camera rotation, and stones outside those mm bounds are height-clamped rather than placed off
// the body (see _updateInstancedStones()'s clampedYMm). The flat canvas-mm safe-area comparison is
// therefore already the correct coordinate space for "visible on the object" -- no 3D projection
// math is needed or was touched. What was wrong was the *threshold*: the first version only warned once the bbox had zero
// overlap with the safe area at all. Real-mouse verification (raw CDP drag, see the S-104 spec's
// audit) showed that is too lenient for text wider than the safe area (the default project's own
// auto-fit text is 199.4mm wide vs. a 182mm-wide safe area) -- a drag that pushes most, but not
// 100%, of the text out still leaves a sliver of overlap, so the old check stayed silent exactly
// when a real user already could not read their text. TEXT_PRINTABLE_VISIBILITY_RATIO (50%) instead
// warns once *most* of the text's own bounding-box area has left the safe area: a real overlap-area
// ratio, not a boundary touch, so it degrades gracefully with drag distance and direction alike (down,
// sideways, or diagonal) and cannot be fooled by a wide layer that still grazes the edge. Layer bbox
// comes from getLayerBBox() (RS-1009, already the single source of truth for every layer's rendered
// extent) -- no new geometry. An empty/unrendered text layer (zero stones) has nothing to warn about.
const TEXT_PRINTABLE_VISIBILITY_RATIO=0.5;
function isTextOutsidePrintableArea(l){
  if(!l||l.type!=='text')return false;
  const b=getLayerBBox(l);
  const bboxArea=b.width*b.height;
  if(bboxArea<=0)return false;
  const safe=getSafeAreaRectMm(currentObjectTemplate(),project.canvas.width,project.canvas.height);
  const overlapWidth=Math.max(0,Math.min(b.x2,safe.xMm+safe.widthMm)-Math.max(b.x,safe.xMm));
  const overlapHeight=Math.max(0,Math.min(b.y2,safe.yMm+safe.heightMm)-Math.max(b.y,safe.yMm));
  const visibleRatio=(overlapWidth*overlapHeight)/bboxArea;
  return visibleRatio<TEXT_PRINTABLE_VISIBILITY_RATIO;
}
// S-107 (Front View Frame & Long Text Workflow): a cylindrical object is treated as an unwrapped
// surface -- ObjectDimensions.js's circumferenceMm() is, by construction, exactly
// project.canvas.width (the flat production canvas maps exactly once around the object's full
// 360-degree circumference; see that module's own top-of-file comment). "Too long" is therefore a
// genuine manufacturing limitation -- the generated design would overlap itself once wrapped fully
// around the object -- not a viewing-window/wrap-mode concern: wrap mode only sizes the Front View
// Frame highlight (frontViewFrameWidthMm()), it never changes the object's circumference. Reuses
// getLayerBBox() (RS-1009's single source of truth for a layer's rendered mm extent, already the
// same StoneLayout-derived bbox isTextOutsidePrintableArea() above uses) instead of tracking a
// parallel per-layer map, so this can never disagree with what was actually generated.
function printableCircumferenceMm(){return circumferenceMm(project.canvas.width)}
function isTextTooLongForObject(l){
  if(!l||l.type!=='text'||!l.text)return false;
  // S-112: a plate is a flat surface, never wrapped around a circumference -- "too long to wrap
  // around the object" is not a real manufacturing limitation for it (see printableCircumferenceMm()'s
  // own header comment: this check exists only for cylindrical/revolved-vessel templates).
  if(currentObjectTemplate().preview.kind==='plate')return false;
  return getLayerBBox(l).width>printableCircumferenceMm();
}
// Builds the too-long warning's detail copy (requirement 5: "must describe a real manufacturing
// limitation... must not describe the current viewing angle"): states the actual generated width
// against the object's actual printable circumference, then lists the three remedies that actually
// change that comparison -- shortening the text, reducing the stone size (lowers the auto-fit
// legibility floor's required heightMm, see computeAutoFitScale()), or choosing a wider object
// (a larger project.canvas.width, and so a larger circumference). Wrap mode is deliberately never
// offered as a remedy: it cannot change either side of this comparison.
function textTooLongDetailMessage(l){
  const b=getLayerBBox(l),circumference=printableCircumferenceMm();
  return`This design is ${b.width.toFixed(1)}mm wide -- ${(b.width-circumference).toFixed(1)}mm more than the ${currentObjectTemplate().displayName.toLowerCase()}'s ${circumference.toFixed(1)}mm printable circumference, so it would overlap itself once wrapped fully around the object. Try: shortening the text, reducing the stone size, or choosing a wider object.`;
}
// S-104 (audited): the Text Lightbox is a modal (`position:fixed;inset:0`) that is normally CLOSED
// while the operator drags text on the canvas -- a warning that only lives inside it is therefore
// never seen during the one interaction it exists to catch. #workspaceTextOutsideWarning lives in the
// always-visible right Inspector panel (`#rightInspector`, never covered by a modal, already the
// persistent per-selection status surface this app reuses for Stone Size/Gap/Stone Color/More
// Options) so it is on screen throughout a drag with the Lightbox closed. #textOutsidePrintableWarning
// (inside the Lightbox) is kept too -- when the Lightbox *is* open it covers the Inspector, so that
// copy is what stays visible in that state. Both read the exact same isTextOutsidePrintableArea()
// result; toggled together so they can never disagree. Called from updateAll() (after `layout` is
// regenerated) so both are always in sync with the layer's true current position/extent -- live
// during a drag (pointermove already calls updateAll() on every move), immediately after Undo/Redo,
// and on every keystroke while editing #textX/#textY directly.
// S-107 follow-up: isTextTooLongForObject() takes priority over isTextOutsidePrintableArea() -- a
// structural "this can never fit" failure must never be shown alongside (or masked by) a "just
// recenter it" suggestion that would not actually fix it. The two warnings are therefore mutually
// exclusive, exactly like the too-long/outside-area distinction they represent.
function updateTextOutsidePrintableWarning(){
  const l=selectedLayer();
  const tooLong=isTextTooLongForObject(l);
  const outside=!tooLong&&isTextOutsidePrintableArea(l);
  el('textOutsidePrintableWarning').classList.toggle('visible',outside);
  el('workspaceTextOutsideWarning').classList.toggle('visible',outside);
  const detail=tooLong?textTooLongDetailMessage(l):'';
  el('textTooLongWarningDetail').textContent=detail;
  el('textTooLongWarning').classList.toggle('visible',tooLong);
  el('workspaceTextTooLongWarningDetail').textContent=detail;
  el('workspaceTextTooLongWarning').classList.toggle('visible',tooLong);
}
// RS-1012: Boolean Operations. BOOLEAN_OPERATION_LABELS is the exact user-facing vocabulary the
// milestone brief requires ("Exclude", not "XOR"), reused for the result layer's default name and
// every status/validation message so the wording stays consistent everywhere it appears.
const BOOLEAN_OPERATION_LABELS={union:'Union',subtract:'Subtract',intersect:'Intersect',xor:'Exclude'};

// Resolves one layer into the {kind:'polygons',polygons} | {kind:'field',...} shape
// combineManyShapeSources() (src/geometry/PathBoolean.js) expects, or null if this layer has no
// closed/fillable vector outline to combine (empty text, an SVG made only of open lines, an
// unplaced Image Trace). Mirrors GeometryEngine.generate()'s per-type dispatch above, but asks the
// permanent engine to *resolve* each shape's outline (resolveShapePolygons()/resolveSvgPolygons()/
// resolveTextPolygons()/resolvePathPolygons()) instead of *sampling* it into stones -- the same
// polygons the matching generate*Layout() stone method would flatten, so a layer's boolean input is
// always identical to what it already renders as.
async function resolveLayerShapeSource(layer){
  if(SHAPE_LAYER_TYPES.has(layer.type)){
    const{polygons,boundingBox}=permanentEngine.resolveShapePolygons(shapeLayerResolveParams(layer));
    return boundingBox?{kind:'polygons',polygons}:null;
  }
  if(layer.type==='svg'){
    const{polygons,boundingBox}=permanentEngine.resolveSvgPolygons({svgSource:layer.svgSource,layerId:layer.id,xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h});
    return boundingBox?{kind:'polygons',polygons}:null;
  }
  if(layer.type==='path'){
    // RS-3014 Step 3: naturalBoundingBoxMm forwarded so a Boolean Operation combining a
    // previously-cut layer resolves its TRUE (frozen-box-anchored) visible shape, not one
    // stretched back to its unchanged x/y/w/h -- same wiring-gap fix as onPaintStroke()'s own
    // candidate-resolution call above.
    const{polygons,boundingBox}=permanentEngine.resolvePathPolygons({contours:layer.contours.map(c=>c.map(p=>({xMm:p.x,yMm:p.y}))),layerId:layer.id,xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h,naturalBoundingBoxMm:layer.naturalBoundingBoxMm});
    return boundingBox?{kind:'polygons',polygons}:null;
  }
  if(layer.type==='text'){
    if(!permanentEngine.canGenerateText||!layer.text||!isFontKnown(layer.font))return null;
    const fontId=layer.font;
    // FONT-002: a Production Font supplies authored stone centers, not a vector outline
    // (GeometryEngine.resolveTextPolygons() documents/throws for this) -- treated as "no closed
    // shape to combine" here rather than letting that throw surface, so runBooleanOp()'s existing
    // missing-shape message (extended below to name Production Fonts) is what the user sees.
    if(isAuthoredStoneFontId(fontId))return null;
    // READ-006 (spec §3.1 item 4): this branch builds its OWN params for resolveTextPolygons(), so
    // letterSpacingMm has to be forwarded here too or a tracked text layer resolves untracked
    // polygons in boolean ops. '??' fallback so a pre-READ-006 layer is byte-identical.
    const base={text:layer.text,fontId,providerId:resolveFontProviderId(fontId),layerId:layer.id,heightMm:layer.height,letterSpacingMm:layer.letterSpacing??0,curveEnabled:Boolean(layer.curveEnabled),curveRadiusMm:layer.curveRadiusMm,curveDirection:layer.curveDirection,curveStartAngleDeg:layer.curveStartAngleDeg,curveSweepAngleDeg:layer.curveSweepAngleDeg,curveAlignment:layer.curveAlignment};
    let resolved=await permanentEngine.resolveTextPolygons(base);
    if(layer.autoFit&&resolved.boundingBox){
      const{scale}=computeAutoFitScale(layer,project,resolved.boundingBox.widthMm);
      if(scale<1){
        resolved=await permanentEngine.resolveTextPolygons({...base,heightMm:Math.max(1,layer.height*scale)});
      }
    }
    if(!resolved.boundingBox)return null;
    const{offsetX,offsetY}=computeTextPlacementOffset(resolved.boundingBox,layer,project);
    return{kind:'polygons',polygons:resolved.polygons.map(poly=>poly.map(p=>({xMm:p.xMm+offsetX,yMm:p.yMm+offsetY})))};
  }
  if(layer.type==='image'){
    if(!layer.imageSrc||!(layer.w>0)||!(layer.h>0))return null;
    let buffer=imageBufferCache.get(layer.imageSrc);
    if(!buffer){buffer=await decodeDataUrlToBuffer(layer.imageSrc);imageBufferCache.set(layer.imageSrc,buffer)}
    const field=prepareImageField(buffer,{threshold:layer.threshold,invert:layer.invert,blurRadiusPx:layer.blurRadiusPx,maxWidthPx:layer.maxWidthPx,maxHeightPx:layer.maxHeightPx});
    return{kind:'field',field,xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h};
  }
  return null;
}

function showBooleanOpsError(message){
  el('status').textContent=message;
  const validationEl=el('booleanOpsValidation');
  if(validationEl){validationEl.textContent=message;validationEl.style.display='block'}
}
function clearBooleanOpsError(){
  const validationEl=el('booleanOpsValidation');
  if(validationEl){validationEl.textContent='';validationEl.style.display='none'}
}

// RS-1012: runs a Union/Subtract/Intersect/Exclude over the current multi-selection
// (selectedLayerIds, the same RS-1009 set Align/Snap already uses). Layers are resolved in
// project.layers' own z-order (back to front -- the same "last in the array is topmost" convention
// hitTest()'s [...].reverse() already relies on), so Subtract has one predictable meaning
// regardless of click order: the backmost selected layer minus everything selected in front of it,
// matching Illustrator's "Minus Front"/Affinity's "Subtract". The source layers are removed, and the
// new 'path' layer is inserted, only after every step below succeeds -- any failure leaves `project`
// completely untouched and reports a specific message via #status/#booleanOpsValidation.
async function runBooleanOp(operation){
  clearBooleanOpsError();
  const label=BOOLEAN_OPERATION_LABELS[operation]||operation;
  const ids=[...selectedLayerIds];
  const layers=project.layers.filter(l=>ids.includes(l.id));
  if(layers.length<2){
    showBooleanOpsError('Select two or more layers (Shift-click on the canvas or in the Layers list) to use Boolean Operations.');
    return;
  }

  let sources;
  try{
    sources=await Promise.all(layers.map(l=>resolveLayerShapeSource(l)));
  }catch(error){
    console.error('Boolean operation failed while resolving layer geometry',error);
    showBooleanOpsError(`${label} failed: ${error.message}`);
    return;
  }
  const missingIndex=sources.findIndex(s=>!s);
  if(missingIndex!==-1){
    showBooleanOpsError(`"${layerLabel(layers[missingIndex])}" has no closed shape to combine — Boolean Operations need a solid outline (not an empty text layer, a Production Font like RS Block or RS Modern, an SVG made only of open lines, or an unplaced Image Trace).`);
    return;
  }

  // RS-1012A: the backmost selected layer's own stone pitch is passed as a resolution hint --
  // combineManyShapeSources() tightens its raster grid so boundary error stays a bounded fraction
  // of the *actual* stone spacing this result will be sampled at (see src/geometry/PathBoolean.js),
  // rather than a fixed resolution unaware of how fine or coarse the destination stones are.
  const targetSpacingMm=(layers[0].stoneSize||2)+(layers[0].gap??0.3);
  let combined;
  try{
    combined=combineManyShapeSources(sources,operation,{targetSpacingMm});
  }catch(error){
    console.error('Boolean operation failed',error);
    showBooleanOpsError(`${label} failed: ${error.message}`);
    return;
  }
  if(!combined.contours.length){
    const why=operation==='intersect'?'don’t overlap':operation==='subtract'?'fully cancel out':'don’t combine into a visible shape';
    showBooleanOpsError(`${label} produced an empty shape — the selected layers ${why}. Nothing was changed.`);
    return;
  }

  const box=combined.boundingBox;
  const base=layers[0];
  const localContours=combined.contours.map(poly=>poly.map(p=>({x:p.xMm-box.minXmm,y:p.yMm-box.minYmm})));
  const newLayer={
    id:'path'+Date.now(),type:'path',visible:true,pathName:`${label} Result`,
    contours:localContours,x:box.minXmm,y:box.minYmm,w:Math.max(2,box.maxXmm-box.minXmm),h:Math.max(2,box.maxYmm-box.minYmm),
    stoneSize:base.stoneSize||2,gap:base.gap||.3,color:base.color||'gold'
  };

  commitHistory();
  const insertAt=Math.min(...layers.map(l=>project.layers.indexOf(l)));
  project.layers=project.layers.filter(l=>!ids.includes(l.id));
  project.layers.splice(Math.min(insertAt,project.layers.length),0,newLayer);
  selectedLayerId=newLayer.id;
  selectedLayerIds=selectOnly(newLayer.id);
  syncSelectedControlsFromLayer();
  await updateAll(true);
  el('status').textContent=`${label}: combined ${layers.length} layers into one editable shape (${combined.contours.length} contour${combined.contours.length===1?'':'s'}).`;
}

function nudgeSelection(dxMm,dyMm){if(selectedLayerIds.size===0)return;commitHistory();for(const id of selectedLayerIds){const l=project.layers.find(x=>x.id===id);if(!l)continue;const p=getLayerPosition(l);setLayerPosition(l,p.xMm+dxMm,p.yMm+dyMm)}syncSelectedControlsFromLayer();updateAll(true)}
// RS-1009: keeps the Align/Snap sidebar section in sync with the current selection count -- align
// needs 2+, distribute needs 3+, matching this milestone's required outcome exactly. Called from
// updateAll() so it never goes stale after an edit/undo/redo/import.
function updateEditingUI(){const n=selectedLayerIds.size;el('selectionSummary').textContent=n===0?'No layers selected':n===1?'1 layer selected':`${n} layers selected`;const alignDisabled=n<2;for(const id of['alignLeft','alignCenterH','alignRight','alignTop','alignCenterV','alignBottom'])el(id).disabled=alignDisabled;const distDisabled=n<3;el('distributeH').disabled=distDisabled;el('distributeV').disabled=distDisabled;
  // RS-1012: Boolean Operations need 2+ layers, exactly like Align above -- disabling the buttons
  // (rather than only erroring on click) keeps the "why can't I click this" answer visible at a
  // glance, matching this sidebar's existing Align/Distribute affordance.
  const boolDisabled=n<2;for(const id of['boolUnion','boolSubtract','boolIntersect','boolExclude'])el(id).disabled=boolDisabled;
  el('booleanOpsHint').style.display=boolDisabled?'block':'none';
  // S-110: Fit Text to Shape needs exactly one text layer + one other layer selected, mirroring
  // Boolean Operations' own disabled-button + hint pattern above.
  const fitPair=fitTextToShapeSelection();
  // FONT-002: a Production Font is a fixed size (see isAuthoredStoneFontId()) -- Fit Text to Shape
  // is disabled for it with its own explanation, distinct from "wrong/missing selection".
  const fitAuthored=Boolean(fitPair&&isAuthoredStoneFontId(fitPair.text.font));
  const fitDisabled=!fitPair||fitAuthored;
  el('fitTextToShapeBtn').disabled=fitDisabled;
  el('fitTextToShapeHint').style.display=fitPair?'none':'block';
  el('fitTextToShapeFixedSizeHint').style.display=fitAuthored?'block':'none';
  if(!fitDisabled)clearFitTextToShapeError();
  updateTextFontCapabilityUI();
  updateMixedSizeCapabilityUI();
  updateStoneSizePrintableCapabilityUI();
  updateStoneSizeOverlapCapabilityUI();
  // FONT-LIB-004: deliberately last, and NOT between updateTextFontCapabilityUI() and
  // updateMixedSizeCapabilityUI() -- tools/test-rs2012-text-gap-mixed-size-ux.mjs asserts those two
  // stay adjacent. Order is otherwise irrelevant here: this reads only the layer's own
  // height/stoneSize/font and touches only its own warning element.
  updateTextHeightReadabilityUI();
}
// FONT-002: keeps every Text Lightbox control that doesn't apply to the selected layer's font
// (Fill Style, Text height/Auto fit, Curved text) in a disabled/hidden + explained state, and shows
// the legacy-font / unavailable-font banners -- the one place all of that gating lives, called from
// updateEditingUI() so it's always in sync (selection change, undo/redo, import, or a font pick).
function updateTextFontCapabilityUI(){
  const l=selectedLayer();
  const isText=Boolean(l&&l.type==='text');
  const fontId=isText?l.font:null;
  const known=isText&&isFontKnown(fontId);
  const authored=known&&isAuthoredStoneFontId(fontId);
  // FONT-LIB-002: the picker now offers every enabled OpenType font, so "legacy" no longer tracks
  // "unvalidated". A font is legacy only if it is neither authored nor `enabled` in the manifest --
  // i.e. a project references a font id whose record has been disabled (or a still-known but retired
  // font). `validated` stays as its own separate flag: it no longer gates the picker, but TXT-104's
  // capHeight letter-height mode below still keys off it (a rhinestoneValidated font is the one that
  // carries capHeightRatio).
  const validated=known&&!authored&&fontManager.getFont(fontId).rhinestoneValidated===true;
  const legacy=known&&!authored&&fontManager.getFont(fontId).enabled!==true;
  const unknown=isText&&!known;
  el('textModeField').style.display=authored?'none':'block';
  // READ-006A: the selected text layer still carries one of the three retired fill styles
  // (Staggered/Radial/Contour). #textMode shows it via ensureTextModeOptionForLayer()'s injected
  // "(retired)" option; this hint explains the state. Nothing is auto-switched.
  el('retiredTextModeHint').style.display=(isText&&RETIRED_TEXT_MODES.has(l.textMode))?'block':'none';
  // TXT-104 step 4b: a capHeight-mode layer on a validated (capHeightRatio-bearing) font displays
  // #letterHeight -- a derived view of #height in real cap-height mm -- instead of raw #height
  // itself; every other combination (raw mode, authored font, legacy/unknown font) keeps showing
  // #height exactly as before. `validated` already excludes authored/legacy/unknown fonts, so this
  // is the one gate needed for the capHeight-mode-but-unvalidated-font fallback the design doc calls
  // for (e.g. a capHeight-mode layer switched to RS Block or a legacy font falls straight back to
  // #height with its existing raw value).
  const capHeightMode=isText&&l.heightMode==='capHeight';
  const showLetterHeight=validated&&capHeightMode;
  el('heightField').style.display=showLetterHeight?'none':'block';
  el('letterHeightField').style.display=showLetterHeight?'block':'none';
  refreshHeightFieldBounds();
  refreshLetterSpacingFieldBounds();
  if(showLetterHeight){
    const bounds=computeLetterHeightBoundsMm(fontId);
    el('letterHeight').min=mmToDisplayValue(bounds.minMm,project.units);el('letterHeight').max=mmToDisplayValue(bounds.maxMm,project.units);
    syncLetterHeightFromHeight(fontId);
  }
  // Mode-switch affordance (design doc section 3.3): only offered for a validated font, since a
  // heightMode the UI can never display (no capHeightRatio to convert with) isn't a real choice.
  // Only l.heightMode flips here -- l.height itself is untouched, so nothing about the rendered
  // output changes at the moment of switching, only which field/units the operator edits from then on.
  el('heightModeToggleHint').style.display=validated?'block':'none';
  if(validated)el('heightModeToggleBtn').textContent=capHeightMode?'Switch to raw engine height':'Switch to letter height';
  el('height').disabled=authored;
  el('autoFit').disabled=authored;
  el('textSizeFixedHint').style.display=authored?'block':'none';
  el('curveEnabled').disabled=authored;
  el('curveUnavailableHint').style.display=authored?'block':'none';
  if(authored)el('curveControls').style.display='none';
  el('legacyFontHint').style.display=legacy?'block':'none';
  el('unknownFontHint').style.display=unknown?'block':'none';
  // RS-2012: Gap (mm) is baked into an authored font's stone positions and has no effect for it --
  // disable the shared #gap control (see #sharedStoneFields; also used by every non-text layer type,
  // where Gap remains fully editable since `authored` is always false there) and explain why via
  // #gapFixedHint, exactly like height/autoFit/curveEnabled just above. A future font whose provider
  // supports adjustable spacing (e.g. OpenType) is simply not authored -- this leaves that font's Gap
  // control untouched with zero architectural changes.
  el('gap').disabled=authored;
  el('gapFixedHint').style.display=authored?'block':'none';
  // READ-006: an authored stone font has no vector outline for expectedComponentCount() to work
  // from, so the ladder solve is undefined for it (spec §4.5) -- disable the field and the button
  // and explain why, exactly like #gap/#gapFixedHint just above.
  el('letterSpacing').disabled=authored;
  el('separateLettersBtn').disabled=authored;
  el('letterSpacingFixedHint').style.display=authored?'block':'none';
  // RS-3011 Step 7: "Generate Stones" only for a Design-drawn 'path' layer whose stones are still
  // deferred -- hidden for every other layer type/state (including a path layer that already has
  // stones), matching #gapFixedHint's own per-layer-type/state visibility toggle just above.
  el('generateStonesField').style.display=(l.type==='path'&&l.stonesGenerated===false)?'block':'none';
}
// RS-2012: mirrors MixedSizeGenerator.js's normalizeMixedSizeParams() eligibility rule exactly
// (value < stoneSizeMm && value >= minSizeMm && value <= maxSizeMm), computed live from the
// currently displayed controls (#stoneSize/#mixedMinSize/#mixedMaxSize) -- the same "read the
// controls, not the possibly-stale layer" convention writeSelectedControlsToLayer() itself uses --
// so the UI's disabled/warning story can never drift from what the Geometry Engine will actually
// place. Returns the set of MIXED_ALLOWED_SIZE_CHECKBOXES ids that are currently eligible.
function mixedSizeEligibleIds(){
  const stoneSizeMm=parseFloat(el('stoneSize').value)||0;
  const minSizeMm=parseFloat(el('mixedMinSize').value)||0;
  const maxSizeMmRaw=parseFloat(el('mixedMaxSize').value);
  const maxSizeMm=Number.isFinite(maxSizeMmRaw)?maxSizeMmRaw:Infinity;
  const ids=new Set();
  for(const cb of MIXED_ALLOWED_SIZE_CHECKBOXES){
    if(cb.diameterMm<stoneSizeMm&&cb.diameterMm>=minSizeMm&&cb.diameterMm<=maxSizeMm)ids.add(cb.id);
  }
  return ids;
}
// RS-2012 (Part 2 -- Mixed Stone Size usability): the mixed-size generator itself was already
// correct (S-200); the problem was purely that a user could check an Allowed Size that can never
// actually be used (too large, or outside Minimum/Maximum Size) and see no feedback at all. This
// disables (+ dims + explains via title) every currently-ineligible checkbox and shows one
// actionable #mixedNoEligibleHint message distinguishing "nothing is checked yet" from "no size can
// ever be eligible with these settings" from "what's checked doesn't qualify" -- called from
// updateEditingUI() so it reacts live to every relevant edit (sizeMode, Stone size, Min/Max Size,
// or the checkboxes themselves), matching updateTextFontCapabilityUI()'s own call site just above.
// MONO-006C: the count of already-generated secondary (infill) stones belonging to layer `l` --
// reads the live, already-computed global `layout` (the same StoneLayout drawLayout()/updateStats()
// already render from) rather than recomputing anything, so this can never disagree with what's on
// screen. A stone counts as secondary when it's smaller than the layer's own primary size; every
// infill stone is strictly smaller by construction (MixedSizeGenerator.js's eligibility filter,
// `value < stoneSizeMm`), so this is an exact, not approximate, count.
function mixedSizeSecondaryStoneCountFor(l){
  if(!l||!layout||!Array.isArray(layout.stones))return 0;
  return layout.stones.filter(s=>s.layerId===l.id&&s.sizeMm<l.stoneSize).length;
}
function updateMixedSizeCapabilityUI(){
  const l=selectedLayer();
  let mixed=resolveSizeMode(el('sizeMode').value)==='mixed';
  const stoneSizeMm=parseFloat(el('stoneSize').value)||0;

  // MONO-006C: Mixed mode can never place a secondary stone once the primary Stone size is already
  // the smallest size in the catalog (there is nothing smaller left to fill a gap with) -- disabling
  // the <option> itself (same disable+dim+explain idiom the 5 checkboxes below already use) prevents
  // ever selecting that dead-end configuration in the first place. If a layer is already Mixed when
  // Stone size is lowered into this state, it's corrected back to Uniform here -- safe to do
  // silently and without a fresh regeneration, since eligibleSizesMm is provably always empty at the
  // smallest catalog size (MixedSizeGenerator.js's own filter requires `value < stoneSizeMm`), so
  // Mixed and Uniform already produce byte-identical geometry in this state.
  const smallestStoneSizeMm=Math.min(...listStoneSizes().map(s=>s.diameterMm));
  const atSmallestStone=stoneSizeMm>0&&stoneSizeMm<=smallestStoneSizeMm;
  const mixedOption=el('sizeMode').querySelector('option[value="mixed"]');
  if(mixedOption){
    mixedOption.disabled=atSmallestStone;
    mixedOption.title=atSmallestStone?`Mixed mode has no effect at the smallest available stone size (${stoneSizeMm} mm) — there is no smaller size left to fill gaps with.`:'';
  }
  if(atSmallestStone&&mixed&&l){
    el('sizeMode').value='uniform';l.sizeMode='uniform';mixed=false;
    el('mixedSizeDetailFields').style.display='none';
  }

  const eligibleIds=mixedSizeEligibleIds();
  let anyChecked=false,anyCheckedEligible=false;
  for(const cb of MIXED_ALLOWED_SIZE_CHECKBOXES){
    const input=el(cb.id);
    const row=input.closest('label');
    const eligible=eligibleIds.has(cb.id);
    input.disabled=!eligible;
    row.classList.toggle('ineligible',!eligible);
    row.title=eligible?''
      :(cb.diameterMm>=stoneSizeMm
        ?`Not smaller than the primary Stone size (${stoneSizeMm} mm) above, so it can never fill a gap.`
        :'Outside the Minimum/Maximum Size range set in Advanced below.');
    if(input.checked){anyChecked=true;if(eligible)anyCheckedEligible=true}
  }
  const hint=el('mixedNoEligibleHint');
  if(!mixed){
    hint.classList.remove('visible');hint.textContent='';
  }else if(eligibleIds.size===0){
    hint.textContent='No secondary size is eligible with the current Stone size and Minimum/Maximum Size settings — increase Stone size above, or widen the Minimum/Maximum Size range in Advanced.';
    hint.classList.add('visible');
  }else if(!anyChecked){
    hint.textContent="Select at least one Allowed Size above — Mixed mode won't add any stones until one is checked.";
    hint.classList.add('visible');
  }else if(!anyCheckedEligible){
    hint.textContent="None of the checked Allowed Sizes are currently eligible (dimmed above) — check an eligible size, or adjust Stone size / Minimum-Maximum Size in Advanced.";
    hint.classList.add('visible');
  }else if(mixedSizeSecondaryStoneCountFor(l)===0){
    // MONO-006C: configuration is valid (eligible sizes checked, range sane) but the generator
    // legitimately placed zero secondary stones for this design (e.g. no gap large enough to fit
    // one at the required spacing) -- without this branch, Mixed mode looks broken instead of
    // correctly reporting that nothing was needed.
    hint.textContent='No secondary stones are required for this design.';
    hint.classList.add('visible');
  }else{
    hint.classList.remove('visible');hint.textContent='';
  }
}
// FONT-LIB-004: the readability check the font library was missing. An audit of all 29 enabled
// OpenType fonts through FONT-CERT-001/002's real analysis pipeline
// (tools/font-certification/audit-manifest-readability.mjs) found ZERO font/stone-size combinations
// that fail at each size's own validated default height -- but a broad, font-independent collapse
// as soon as the height-to-stone-diameter ratio drops too low. Readability here is governed by that
// ratio, not by which font is selected, so the right gate is this one height check rather than
// per-font `unsupportedStoneSizes` entries (which stay exactly as FONT-PORTFOLIO-001's human raters
// set them -- see that milestone's own spec).
// READ-008: rebased from the catalog size's supportedHeightRangeMm[0] (which never fired for a
// non-catalog stone diameter -- findStoneSizeByDiameterMm() returned null and the check was skipped
// entirely) to the shared MIN_HEIGHT_TO_STONE_RATIO floor, so it now fires at ANY stone diameter.
// applyStoneSizeHeightAutoSet() already enforces the catalog range on a *stone size* change; this
// covers every other route to an out-of-range height (a direct #height edit, a loaded project, an
// Auto Fit shrink, TXT-104's capHeight conversion). Warning only, never a clamp -- see index.html's
// own comment on #heightBelowReadableWarning for why.
// FONT-LIB-004: shared predicate -- non-null when `layer` is a text layer whose height sits below
// the MIN_HEIGHT_TO_STONE_RATIO floor for its current stone diameter. Used by BOTH the height
// warning below and updateStoneSizeOverlapCapabilityUI()'s crowding hint, which suppresses its own
// font-blaming message whenever this is true (the height is the root cause there; naming the font
// would send the user after a fix that cannot work -- see the crowding hint's own comment).
function textHeightBelowReadableMinimum(layer){
  // Authored Production Fonts (RS Block/RS Modern) are a fixed size with their own baked-in stone
  // pitch -- this ratio floor is an OpenType-sizing concept that does not apply to them (same
  // exclusion #textModeField/#gapFixedHint already make).
  if(!layer||layer.type!=='text'||isAuthoredStoneFontId(layer.font))return null;
  const stoneSizeMm=layer.stoneSize;
  const heightMm=layer.height;
  if(!Number.isFinite(stoneSizeMm)||stoneSizeMm<=0||!Number.isFinite(heightMm))return null;
  const minHeightMm=stoneSizeMm*MIN_HEIGHT_TO_STONE_RATIO;
  return heightMm<minHeightMm?{stoneSizeMm,heightMm,minHeightMm}:null;
}
// READ-003: shared predicate, beside textHeightBelowReadableMinimum() -- non-null when `layer` is a
// text layer whose font's dominant stroke, at the layer's current height, is physically narrower
// than a single stone AND the layer fills the letter interior with stones.
//
// This is Layer 1 of the readability program in
// docs/specifications/READ-000-readability-architecture.md -- the live physical-impossibility check
// that needs no baked data (Layer 3 / READ-006 will later supersede FONT-LIB-004's height rule with
// font- and mode-aware readability floors on this same warning surface).
//
// READ-004 moved the arithmetic and the mode gate out to src/text/StrokeWidthGate.js
// (strokeNarrowerThanOneStone()) so signal A of the offline recognition harness and this live
// warning share one source of truth -- see that module's doc for the impossibility argument, why
// only the interior-fill modes count, and every case that returns null. This wrapper does only what
// the shared function cannot: resolve the layer's font and fill mode, skip authored/unknown fonts,
// and build the user-facing label.
//
// When it does fire it is the STRONGEST readability signal -- geometry, not a quality judgement (see
// the precedence note on updateTextHeightReadabilityUI()). O(1): no geometry at runtime.
function textStrokeNarrowerThanOneStone(layer){
  if(!layer||layer.type!=='text'||isAuthoredStoneFontId(layer.font)||!isFontKnown(layer.font))return null;
  const font=fontManager.getFont(layer.font);
  const hit=strokeNarrowerThanOneStone({
    stemWidthRatio:font.stemWidthRatio,
    heightMm:layer.height,
    stoneSizeMm:layer.stoneSize,
    mode:resolveTextFillMode(layer.textMode)
  });
  if(!hit)return null;
  const fontLabel=font.style&&font.style!=='Regular'?`${font.family} ${font.style}`:font.family;
  return{stemWidthMm:hit.stemWidthMm,stoneSizeMm:hit.stoneSizeMm,fontLabel};
}
// Both readability signals share the single #heightBelowReadableWarning element, and exactly one
// message shows. Precedence, strongest first:
//   1. READ-003  stroke narrower than one stone   (physically impossible to render)
//   2. FONT-LIB-004  height below the MIN_HEIGHT_TO_STONE_RATIO floor for this stone diameter
// FONT-LIB-003's crowding hint is the weakest and defers to whichever of these is active (see
// updateStoneSizeOverlapCapabilityUI()). Warning, not a clamp -- an existing project may already
// hold such a layer, and the fix (taller text or smaller stones) belongs to the user.
function updateTextHeightReadabilityUI(){
  const warning=el('heightBelowReadableWarning');
  const layer=selectedLayer();
  const stroke=textStrokeNarrowerThanOneStone(layer);
  const below=stroke?null:textHeightBelowReadableMinimum(layer);
  const u=unitSuffix(project.units);
  let message='';
  if(stroke){
    message=`${stroke.fontLabel}'s strokes are about ${formatLengthDisplay(stroke.stemWidthMm,project.units,2)} ${u} wide at this height — narrower than one ${formatLengthDisplay(stroke.stoneSizeMm,project.units,1)} ${u} stone, so stones would overhang the letters on both sides. Use a taller text height or a smaller stone size.`;
  }else if(below){
    message=`At ${formatLengthDisplay(below.stoneSizeMm,project.units,1)} ${u} stones, text this short (${formatLengthDisplay(below.heightMm,project.units,1)} ${u}) won't read clearly — ${formatLengthDisplay(below.minHeightMm,project.units,1)} ${u} or taller is the minimum for this stone diameter. Use a taller text height or a smaller stone size.`;
  }
  warning.textContent=message;
  warning.classList.toggle('visible',Boolean(message));
}
// FONT-DECISION-001 (Studio Integration follow-up): disables + dims + explains (via title) every
// #stoneSize <option> whose entire FONT-DECISION-001-validated supportedHeightRangeMm (StoneSizes.js)
// is taller than the currently-selected object shape can print, mirroring
// updateMixedSizeCapabilityUI()'s mixedOption.disabled/.title idiom just above. Shape-aware, not
// font-aware: keys off getSafeAreaRectMm(currentObjectTemplate(), project.canvas.width,
// project.canvas.height) -- the exact same safe-area rectangle isTextOutsidePrintableArea() already
// checks text against -- so switching shape (or editing a vessel's live body height/diameter, which
// re-derives project.canvas) always re-evaluates against the real, current printable height, never a
// stale/static per-template preset. Only meaningful for text layers (supportedHeightRangeMm is a text
// legibility range, not a general geometry constraint) -- every option is left fully enabled for
// every other layer type, exactly like #sharedStoneFields' Gap field has no such text-only gating.
//
// FONT-PORTFOLIO-001: also gates on the selected font itself -- some fonts' own human rating pass
// collapsed at a size no shape constraint would otherwise rule out (e.g. Anton/Sacramento/Dancing
// Script all fail at SS30 even on a shape whose printable height comfortably fits it). This second
// gate reads manifest.json's per-font `unsupportedStoneSizes` (FontManager.js) -- purely
// data-driven, so re-enabling a size later (once FONT-POLICY-001 resolves the underlying SS30
// height-ceiling issue) is a manifest edit, never a code change. A size disabled by either gate is
// disabled; the title explains whichever reason applies (shape wins if somehow both do).
function updateStoneSizePrintableCapabilityUI(){
  const l=selectedLayer();
  const isText=Boolean(l&&l.type==='text');
  const template=currentObjectTemplate();
  const safe=isText?getSafeAreaRectMm(template,project.canvas.width,project.canvas.height):null;
  const font=isText&&isFontKnown(l.font)?fontManager.getFont(l.font):null;
  for(const size of listStoneSizes()){
    const option=el('stoneSize').querySelector(`option[value="${size.diameterMm}"]`);
    if(!option)continue;
    const exceedsShape=isText&&stoneSizeEntirelyExceedsPrintableHeight(size,safe.heightMm);
    const unsupportedByFont=Boolean(font&&font.unsupportedStoneSizes.includes(size.id));
    option.disabled=exceedsShape||unsupportedByFont;
    option.title=exceedsShape
      ?`${size.name} needs ${size.supportedHeightRangeMm[0]}-${size.supportedHeightRangeMm[1]}mm height — doesn't fit this ${template.displayName}'s printable area (${safe.heightMm.toFixed(0)}mm available).`
      :unsupportedByFont
        ?`${size.name} isn't recommended with ${font.family} — readability testing showed poor results at this size (pending a height-calibration fix).`
        :'';
  }
}
// Stone Size overlap guard: greys out any #stoneSize <option> that would produce genuine physical
// overlap (findOverlappingStonePairs(), the same check tools/test-geometry-stone-overlap-same-
// contour.mjs's regression suite runs) for the CURRENT layer's real dimensions/gap/fillMode, by
// actually generating that candidate size's real layout and checking it -- no heuristic, no
// shape-kind branching, works identically for every layer type and both Outline/Fill mode.
//
// Composes with updateStoneSizePrintableCapabilityUI() just above rather than fighting it: an
// option already disabled for that function's own (shape/font) reason is left exactly as-is here
// (its title kept, this function only adds overlap-disabling on top for options still enabled).
//
// The currently-selected size is deliberately never disabled here even when it overlaps (see
// currentStoneSizeTarget()'s caller below) -- confirmed live in Chrome (tools/scratch/
// feature-stone-size-overlap-guard-verify/select-disabled-check.mjs) that disabling a <select>'s
// own currently-selected <option> blocks ArrowDown/ArrowUp keyboard navigation off it entirely,
// while still displaying as selected -- a real trap, not a hypothetical. Instead, an invalid
// current selection is left alone but flagged: #stoneSize gets an .overlap-invalid border and
// #stoneSizeOverlapWarning becomes visible, the same "disabled/dimmed control + separate hint
// paragraph" idiom #gapFixedHint/#mixedNoEligibleHint already use.
//
// RS-3013 Step 5: a selected Paint region has its own stoneSizeMm (see syncSelectedControlsFromLayer()'s
// "region wins" branch) -- resolved here the same way, so the guard checks the region's own real
// generated stones, not the parent layer's.
function currentStoneSizeTarget(){
  const regionSelection=drawingTool.activeSelection;
  if(regionSelection&&regionSelection.kind==='region'){
    const regionLayer=project.layers.find(x=>x.id===regionSelection.layerId&&x.type==='path');
    const region=regionLayer&&(regionLayer.regions||[]).find(r=>r.id===regionSelection.regionId);
    if(regionLayer&&region)return{layer:regionLayer,region};
  }
  const l=selectedLayer();
  return l?{layer:l,region:null}:null;
}
// Builds the one changed field (stoneSize on a plain layer clone, or stoneSizeMm on a cloned
// region within a cloned layer's regions[]) and runs it through the exact same Live generation
// generate() itself uses (via engine.generateLiveStonesForCandidateLayer() above). For a text
// layer, strips a stale authoredScale when the candidate size differs from the layer's real
// current stoneSize -- mirrors invalidateAuthoredScaleForGeometryChange()'s own rule (authoredScale
// is a MONO-005A fit computed for one specific stoneSize; reusing it for a different candidate size
// would silently mis-scale the candidate layout, corrupting the very check this function exists to run).
async function stonesForCandidateStoneSize(target,sizeMm,project){
  const{layer,region}=target;
  let candidateLayer;
  if(region){
    candidateLayer={...layer,regions:(layer.regions||[]).map(r=>r.id===region.id?{...r,stoneSizeMm:sizeMm}:r)};
  }else{
    candidateLayer={...layer,stoneSize:sizeMm};
    if(sizeMm!==layer.stoneSize)delete candidateLayer.authoredScale;
  }
  return engine.generateLiveStonesForCandidateLayer(candidateLayer,project,{includeStats:true});
}
// Only reachable when there's no layer to check at all (currentStoneSizeTarget() found neither a
// selected region nor a selected layer) -- updateStoneSizePrintableCapabilityUI() already leaves
// every option enabled in that same state (isText false, font null), so there is nothing to undo
// on the options themselves, only this function's own warning/border to clear.
function clearStoneSizeOverlapUI(){
  el('stoneSize').classList.remove('overlap-invalid');
  el('stoneSizeOverlapWarning').classList.remove('visible');el('stoneSizeOverlapWarning').textContent='';
  el('stoneSizeCrowdingHint').style.display='none';el('stoneSizeCrowdingHint').textContent='';
  lastStoneSizeAvailabilityTargetKey=undefined; // PERF-005: force a fresh sweep next time a target exists again
}
// PERF-005: `stoneSizeOverlapCheckToken` also guards updateStoneSizeOptionAvailabilityUI() below --
// both run the real Live generation pipeline and must never let a stale, slower-to-resolve check
// overwrite a newer one's result.
let stoneSizeOverlapCheckToken=0;
// Crowding/attrition warning thresholds (Prompt 4), calibrated against Prompt 3's measureStoneCrowding()
// sweep and the three screenshot regimes (healthy / crowded-not-overlapping / genuinely-overlapping)
// reviewed in chat. Deliberately looser than "any measurable crowding" -- pavé-style intentional tight
// packing is legitimate, so this only fires for the denser end of the sweep's observed range.
const STONE_SIZE_CROWDING_FRACTION_THRESHOLD=0.25;
const STONE_SIZE_ATTRITION_RATIO_THRESHOLD=0.75;
// PERF-005: which target (layer id + region id, or null) updateStoneSizeOptionAvailabilityUI()
// last actually swept every stone size for -- lets updateStoneSizeOverlapCapabilityUI() below skip
// re-running that sweep on every keystroke of an unrelated control (font, fill mode, height, text,
// ...) and only re-run it when the selection itself changed, or #stoneSize is about to be opened
// (see its own 'focus' listener). A stale sweep just leaves the *other* options' disabled/title
// state slightly behind until the next legitimate trigger -- never wrong about the option the user
// currently has selected, which the cheap per-call path below always keeps fresh.
let lastStoneSizeAvailabilityTargetKey=undefined;
function stoneSizeTargetKey(target){return target?`${target.layer.id}:${target.region?target.region.id:''}`:null}
// PERF-005: the expensive half of the old updateStoneSizeOverlapCapabilityUI() -- generates a
// candidate layout for every *other* catalog stone size (not just the current one) purely to decide
// which #stoneSize <option>s should be disabled (would-overlap) and their tooltip. This used to run
// unconditionally on every HISTORY_TRACKED_CONTROL_IDS edit (font pick, fill-mode change, height
// edit, ...); it's now called only when the selection actually changed (see
// updateStoneSizeOverlapCapabilityUI() below) or when #stoneSize is about to be opened, cutting the
// per-keystroke cost of switching fonts/fill on an already-selected layer from up to 6 full Live
// generations down to 1.
async function updateStoneSizeOptionAvailabilityUI(target,currentSizeMm){
  const token=++stoneSizeOverlapCheckToken;
  const select=el('stoneSize');
  const diametersToCheck=new Set(listStoneSizes().map(s=>s.diameterMm));
  diametersToCheck.delete(currentSizeMm); // the current size's own overlap state is the cheap path's job, not this sweep's
  for(const diameterMm of diametersToCheck){
    const{stones}=await stonesForCandidateStoneSize(target,diameterMm,project);
    if(token!==stoneSizeOverlapCheckToken)return;
    const overlaps=hasAnyOverlappingStonePair(stones.map(s=>({xMm:s.x,yMm:s.y,sizeMm:s.d})));
    const size=listStoneSizes().find(s=>s.diameterMm===diameterMm);
    const option=select.querySelector(`option[value="${diameterMm}"]`);
    if(!option||!size)continue;
    // updateStoneSizePrintableCapabilityUI() (called just before this function, see
    // updateEditingUI()) always runs first and unconditionally resets every option's .disabled --
    // so option.disabled read here is exactly that gate's own fresh verdict, not a stale leftover
    // from this function's own previous pass. Only add overlap-disabling on top of it.
    const otherGateDisabled=option.disabled;
    option.disabled=otherGateDisabled||overlaps;
    if(!otherGateDisabled)option.title=overlaps?`${size.name} would overlap on the current shape.`:'';
  }
  lastStoneSizeAvailabilityTargetKey=stoneSizeTargetKey(target);
}
// FONT-LIB-003: the crowding hint's *firing* (thresholds, measureStoneCrowding(), outlineStats
// attrition -- all above) is unchanged. Only its wording changes for a text layer: instead of the
// generic "try a smaller size", it names the layer's font family and, when that family has a
// heavier enabled sibling than the current style (findBolderSibling()), suggests that bolder weight
// by name -- plus "a larger stone size" and "a taller letter height", both of which scale a thin
// stroke up proportionally. All still informational only (dense packing is sometimes intentional):
// no button, no auto-apply. Non-text layers (shape/path/svg/image) keep the original generic wording.
// PERF-005: this now generates exactly one candidate layout (the current stone size) per call,
// instead of one per catalog stone size -- see updateStoneSizeOptionAvailabilityUI() above for the
// other options' disabled/title state, which is swept separately and less often.
async function updateStoneSizeOverlapCapabilityUI(){
  const target=currentStoneSizeTarget();
  if(!target){clearStoneSizeOverlapUI();return}
  const token=++stoneSizeOverlapCheckToken;
  const select=el('stoneSize'),warning=el('stoneSizeOverlapWarning');
  const currentSizeMm=target.region?target.region.stoneSizeMm:target.layer.stoneSize;
  const{stones:currentStones,outlineStats:currentOutlineStats}=await stonesForCandidateStoneSize(target,currentSizeMm,project);
  if(token!==stoneSizeOverlapCheckToken)return;
  const currentOverlaps=hasAnyOverlappingStonePair(currentStones.map(s=>({xMm:s.x,yMm:s.y,sizeMm:s.d})));
  select.classList.toggle('overlap-invalid',currentOverlaps);
  warning.textContent=currentOverlaps?"This stone size isn't suitable for this shape — it won't form a uniform figure.":'';
  warning.classList.toggle('visible',currentOverlaps);
  // PERF-005: the other catalog sizes' disabled/title state only needs refreshing when the
  // selection itself changed since the last sweep -- an edit to font/fill/height/etc. on the same
  // already-selected layer reuses whatever the last sweep found, which #stoneSize's own 'focus'
  // listener (below) also refreshes right before the user actually opens the dropdown.
  if(stoneSizeTargetKey(target)!==lastStoneSizeAvailabilityTargetKey){
    updateStoneSizeOptionAvailabilityUI(target,currentSizeMm).catch(error=>console.error('Stone size availability sweep failed',error));
  }
  // Crowding/attrition warning: informational only, for the CURRENT size only (not a per-option gate
  // like updateStoneSizeOptionAvailabilityUI() above) -- dense packing is sometimes exactly what the
  // user wants (pavé), so this never disables an option. Skipped entirely whenever currentOverlaps is
  // already true: genuine overlap is the more severe, actionable problem, and showing both at once is
  // noise, not more information.
  const crowdingHint=el('stoneSizeCrowdingHint');
  let crowded=false;
  if(!currentOverlaps){
    const gapMm=target.region?target.region.gapMm:target.layer.gap;
    const crowding=measureStoneCrowding(currentStones.map(s=>({xMm:s.x,yMm:s.y,sizeMm:s.d})),{gapMm});
    const attritionRatio=currentOutlineStats?currentOutlineStats.keptCount/currentOutlineStats.rawSampleCount:1;
    crowded=crowding.fractionBelowHalfGap>STONE_SIZE_CROWDING_FRACTION_THRESHOLD||attritionRatio<STONE_SIZE_ATTRITION_RATIO_THRESHOLD;
  }
  const genericCrowdingText='This stone size may pack tightly on this shape — try a smaller size for more even spacing.';
  let crowdingText='';
  if(crowded){
    // Text-layer case (FONT-LIB-003, reworded by FONT-LIB-004): name the font family, and suggest a
    // bolder sibling weight when one exists. Falls back to the generic wording for a text layer
    // whose font id can't be resolved (legacy/unknown font) and for every non-text layer type.
    //
    // Precedence: suppressed entirely when a stronger readability signal already owns
    // #heightBelowReadableWarning -- READ-003 stroke-narrower-than-one-stone
    // (textStrokeNarrowerThanOneStone()) or FONT-LIB-004 height-below-validated-minimum
    // (textHeightBelowReadableMinimum()). FONT-LIB-004's audit showed crowding in the height regime
    // is driven by the height-to-stone-diameter ratio, NOT the font (a bold geometric sans crowds at
    // 15mm/SS16 exactly as a fine script does), and READ-003's stroke case is a geometric
    // impossibility no font switch fixes -- so naming the font in either regime misattributes the
    // cause. #heightBelowReadableWarning is already on screen saying the accurate thing, and two
    // warnings blaming two different causes is worse than one correct one. Same mutual-exclusivity
    // idiom this function already applies for currentOverlaps above.
    const layer=target.layer;
    const strongerSignalActive=Boolean(textStrokeNarrowerThanOneStone(layer))||Boolean(textHeightBelowReadableMinimum(layer));
    const font=!strongerSignalActive&&layer&&layer.type==='text'&&layer.font&&fontManager&&fontManager.hasFont(layer.font)?fontManager.getFont(layer.font):null;
    if(strongerSignalActive){
      crowdingText='';
    }else if(font){
      // Wording (FONT-LIB-004): describes the stroke rather than the typeface ("strokes are narrow
      // at this stone size", not "Great Vibes is thin"). At a height already inside the validated
      // range the font's own stroke geometry genuinely is the differentiator, so naming it is fair
      // -- but the phrasing should point at the fixable property rather than read as a verdict on
      // the font, and should present all three remedies as equals rather than leading with a font
      // switch.
      const bolder=findBolderSibling(fontManager,font);
      crowdingText=bolder
        ? `${font.family} ${font.style}'s strokes are narrow at this stone size — a heavier weight (${font.family} ${bolder.style}), a larger stone size, or a taller letter height would each give more even coverage.`
        : `${font.family}'s strokes are narrow at this stone size — a larger stone size or a taller letter height would give more even coverage.`;
    }else{
      crowdingText=genericCrowdingText;
    }
  }
  crowdingHint.textContent=crowdingText;
  // FONT-LIB-004: keyed off crowdingText, not `crowded` -- the height-root-cause branch above
  // deliberately produces an empty message while `crowded` is still true, and an empty but *shown*
  // <p> would render as a stray blank gap in the Lightbox.
  crowdingHint.style.display=crowdingText?'block':'none';
}
// RS-0003.5D2: SELECTION_HANDLE_SIZE_PX enlarges the resize handles slightly (was a bare 10px
// square) and a white halo is stroked behind the dashed outline so the selection reads clearly
// against any background (light grid, light/dark stones), not just against the plain canvas.
const SELECTION_HANDLE_SIZE_PX=11;
// RS-1009: draws one selection box (+ optional resize handles); drawSelection() below calls this
// once per multi-selected layer. Handles only ever draw when exactly one layer is selected
// (multi-layer resize is out of scope for this milestone) -- unchanged single-selection visuals.
// RS-3030: rotationDeg (default 0, so every pre-existing call site/project renders byte-identical)
// makes the dashed outline itself a rotated quadrilateral through the box's TRUE rotated corners
// (via rotatedHandlesFor()) instead of the axis-aligned strokeRect, and draws handles at their
// rotated positions -- otherwise handles would visually float away from a still-axis-aligned box.
function drawSelectionBox(ctx,s,ox,oy,dpr,b,showHandles,rotationDeg=0){const rx=ox+b.x*s,ry=oy+b.y*s,rw=b.width*s,rh=b.height*s;ctx.save();if(!rotationDeg){ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=4*dpr;ctx.setLineDash([]);ctx.strokeRect(rx,ry,rw,rh);ctx.strokeStyle='#1478ff';ctx.lineWidth=1.75*dpr;ctx.setLineDash([6*dpr,3*dpr]);ctx.strokeRect(rx,ry,rw,rh);ctx.setLineDash([]);}else{const corners=['nw','ne','se','sw'].map(name=>rotatedHandlesFor(b,rotationDeg).find(h=>h.name===name));const strokeQuad=()=>{ctx.beginPath();ctx.moveTo(ox+corners[0].x*s,oy+corners[0].y*s);for(let i=1;i<corners.length;i++)ctx.lineTo(ox+corners[i].x*s,oy+corners[i].y*s);ctx.closePath()};ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=4*dpr;ctx.setLineDash([]);strokeQuad();ctx.stroke();ctx.strokeStyle='#1478ff';ctx.lineWidth=1.75*dpr;ctx.setLineDash([6*dpr,3*dpr]);strokeQuad();ctx.stroke();ctx.setLineDash([]);}if(showHandles){for(const h of rotatedHandlesFor(b,rotationDeg)){const hs=SELECTION_HANDLE_SIZE_PX*dpr;ctx.shadowColor='rgba(20,30,50,.35)';ctx.shadowBlur=3*dpr;ctx.fillStyle='white';ctx.strokeStyle='#1478ff';ctx.lineWidth=1.75*dpr;ctx.beginPath();ctx.rect(ox+h.x*s-hs/2,oy+h.y*s-hs/2,hs,hs);ctx.fill();ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.stroke()}}ctx.restore()}
// fix/rotated-layer-bbox-hittest: drawSelectionBox()'s rotated-outline branch calls
// rotatedHandlesFor(b,rotationDeg) itself, which rotates whatever box it is given a second time --
// so it needs the raw unrotated x/y/w/h box for XYWH layers, not getLayerBBox()'s now-rotated AABB
// (see that function's own comment), exactly like hitTest() below. drawRotateHandle() is the
// opposite: it wants the AABB unchanged, since its handle sits a fixed gap above the AABB's own top
// edge (rotateHandlePositionMm()'s header comment) -- so only the drawSelectionBox() call below is
// adjusted, drawRotateHandle() keeps using `b`.
function drawSelection(ctx,s,ox,oy,dpr){const selected=project.layers.filter(l=>selectedLayerIds.has(l.id));const single=selected.length===1;for(const l of selected){const b=getLayerBBox(l);const outlineBox=XYWH_SHAPE_TYPES.has(l.type)?{x:l.x,y:l.y,width:l.w,height:l.h,x2:l.x+l.w,y2:l.y+l.h}:b;drawSelectionBox(ctx,s,ox,oy,dpr,outlineBox,single&&l.type!=='text',l.rotationDeg||0);
  // TXT-102: text has no resize handles (see drawSelectionBox's showHandles above), but gets its own
  // single rotate handle instead, only while it is the sole selection -- matching the existing
  // single-selection-only precedent resize handles already set.
  // RS-3029: generalized from text-only to every layer type -- a selected shape now shows BOTH its
  // resize handles (still on its unrotated bbox, unchanged) AND this rotate handle. The two handle
  // sets are intentionally not geometrically consistent with each other yet for a rotated shape;
  // reconciling that is a separate, later step (see RS-3029's scope doc), not this one.
  if(single)drawRotateHandle(ctx,s,ox,oy,dpr,b)}}
// TXT-102: rotate handle geometry -- a small fixed mm gap directly above the bbox's own top-center,
// independent of the layer's current rotationDeg. (An earlier version orbited the bbox center at a
// radius derived from the bbox diagonal, matching Illustrator/Figma's "handle stays attached to the
// shape's own rotated top" behavior -- but for ordinary single-line text, whose bbox is far wider
// than it is tall, half the diagonal is dominated by half the *width*, placing the handle tens of mm
// above the text: a real, confirmed-by-screenshot bug, not just a cosmetic quibble. A fixed gap above
// the AABB's current top edge has no such blowup for any aspect ratio, at the cost of the handle not
// visually orbiting with rotation -- an acceptable, simpler tradeoff.) Returns null for a degenerate
// (zero-area) bbox -- nothing to rotate around yet (e.g. a text layer with no stones generated).
const ROTATE_HANDLE_GAP_MM=10;
const ROTATE_HANDLE_RADIUS_PX=7;
const ROTATE_HANDLE_HIT_TOLERANCE_MM=4;
// TXT-102: Shift-drag snap step for the rotate handle -- 15° divides evenly into every angle named
// in the spec (0/15/30/45/60/90/...), matching Illustrator/Figma's own default rotation snap.
const ROTATION_SNAP_STEP_DEG=15;
// RS-3030: replicates GeometryEngine.js's rotatePointsAroundCenter() formula verbatim -- clockwise,
// since this engine's mm space is Y-down (see that function's own comment for why). A local copy
// rather than an import because that function is module-private and app.js is the UI/interaction
// layer, a separate concern from GeometryEngine by this codebase's own convention. Used by every
// resize-handle/selection-outline/resize-drag computation below so they all rotate identically to
// the actual stone geometry.
function rotatePointDeg(x,y,cx,cy,rotationDeg){
  const radians=rotationDeg*(Math.PI/180),cos=Math.cos(radians),sin=Math.sin(radians);
  const dx=x-cx,dy=y-cy;
  return{x:cx+dx*cos-dy*sin,y:cy+dx*sin+dy*cos};
}
function rotateHandlePositionMm(b){
  if(b.width<=0&&b.height<=0)return null;
  const topCenterX=b.x+b.width/2;
  return{x:topCenterX,y:b.y-ROTATE_HANDLE_GAP_MM,anchorX:topCenterX,anchorY:b.y,cx:(b.x+b.x2)/2,cy:(b.y+b.y2)/2};
}
function drawRotateHandle(ctx,s,ox,oy,dpr,b){
  const h=rotateHandlePositionMm(b);if(!h)return;
  const hx=ox+h.x*s,hy=oy+h.y*s,ax=ox+h.anchorX*s,ay=oy+h.anchorY*s,r=ROTATE_HANDLE_RADIUS_PX*dpr;
  ctx.save();
  ctx.strokeStyle='rgba(20,120,255,.55)';ctx.lineWidth=1.25*dpr;ctx.setLineDash([3*dpr,3*dpr]);
  ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(hx,hy);ctx.stroke();ctx.setLineDash([]);
  ctx.shadowColor='rgba(20,30,50,.35)';ctx.shadowBlur=3*dpr;
  ctx.fillStyle='white';ctx.strokeStyle='#1478ff';ctx.lineWidth=1.75*dpr;
  ctx.beginPath();ctx.arc(hx,hy,r,0,Math.PI*2);ctx.fill();
  ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.stroke();
  ctx.restore();
}
// RS-1009: temporary drag-snap guide lines (magenta, full canvas span), populated only while a
// move-drag is actively snapped and cleared on pointerup -- never persisted, never a user-created
// guide (out of scope).
function drawGuides(ctx,s,ox,oy,dpr){if(!activeGuides.length)return;ctx.save();ctx.strokeStyle='#ff3b8d';ctx.lineWidth=1.25*dpr;ctx.setLineDash([4*dpr,3*dpr]);for(const g of activeGuides){ctx.beginPath();if(g.axis==='vertical'){const x=ox+g.valueMm*s;ctx.moveTo(x,oy);ctx.lineTo(x,oy+project.canvas.height*s)}else{const y=oy+g.valueMm*s;ctx.moveTo(ox,y);ctx.lineTo(ox+project.canvas.width*s,y)}ctx.stroke()}ctx.restore()}
function handlesFor(b){return[{name:'nw',x:b.x,y:b.y},{name:'ne',x:b.x2,y:b.y},{name:'se',x:b.x2,y:b.y2},{name:'sw',x:b.x,y:b.y2},{name:'n',x:b.x+b.width/2,y:b.y},{name:'e',x:b.x2,y:b.y+b.height/2},{name:'s',x:b.x+b.width/2,y:b.y2},{name:'w',x:b.x,y:b.y+b.height/2}]}
// RS-3030: each handle's unit offset from the box's own center (nw=(-1,-1), n=(0,-1), etc.), implicit
// in handlesFor() above -- used by the resize-drag algorithm to find a handle's ANCHOR (the opposite
// corner/edge, i.e. this offset negated) without per-handle-name branching.
const HANDLE_UNIT_OFFSET={nw:{x:-1,y:-1},ne:{x:1,y:-1},se:{x:1,y:1},sw:{x:-1,y:1},n:{x:0,y:-1},e:{x:1,y:0},s:{x:0,y:1},w:{x:-1,y:0}};
// RS-3030: handlesFor(b)'s 8 positions rotated around the box's own center by rotationDeg, via
// rotatePointDeg() above -- so a rotated shape's resize handles (and, via drawSelectionBox(), its
// selection outline) track its TRUE rotated corners instead of floating on the unrotated axis-
// aligned box (Step 2's known, explicitly-scoped-out limitation). handlesFor() itself is untouched
// (other callers, e.g. getLayerBBox()-derived tooling, still want the plain axis-aligned version).
// A 0 rotation returns handlesFor(b) itself unchanged, guaranteeing byte-identical output for every
// project saved before this milestone.
function rotatedHandlesFor(b,rotationDeg){
  const handles=handlesFor(b);
  if(!rotationDeg)return handles;
  const cx=(b.x+b.x2)/2,cy=(b.y+b.y2)/2;
  return handles.map(h=>{const p=rotatePointDeg(h.x,h.y,cx,cy,rotationDeg);return{name:h.name,x:p.x,y:p.y}});
}
// RS-1006: the 3D preview manages its own canvas sizing (a ResizeObserver inside
// Preview3DRenderer.js), so unlike drawLayout() there is no resizeCanvas()/2D-context call here.
// update() only rebuilds the mesh/texture when the StoneLayout or display options actually
// changed; syncView() only repositions the camera when rotation/zoom actually changed -- neither
// call disturbs a manual orbit/pan the operator has mid-way through with the mouse.
// S-109: `wrap` is no longer passed to preview3D.update() -- the object mesh's texture UV is
// wrap-mode independent (true circumference scale, matching the 2D Canvas), so the Object Preview
// consuming the same StoneLayout as the 2D canvas is now sufficient for the two to agree on
// position/scale/orientation/proportions, subject only to normal cylindrical perspective. Wrap mode
// still controls the Front View Frame overlay (drawFrontViewFrame(), frontViewFrameGeometry()) on
// the 2D canvas, unchanged.
function drawCup(){preview3D.update(layout,{cupColor:project.cupColor,objectTemplate:currentObjectTemplate(),canvasWidthMm:project.canvas.width,canvasHeightMm:project.canvas.height,plateParams:project.plate,vesselParams:project.vessel});preview3D.syncView(rotation,zoom)}
// S-001: keeps the Front/Left/Right/Back buttons' highlighted state synchronized with `rotation`
// regardless of how it changed (view-button click, reset, slider, or manual cup-drag), since this
// is called from updateAll() rather than duplicated at each rotation-changing call site.
function angleDiffDeg(a,b){const norm=x=>((x%360)+360)%360;const d=Math.abs(norm(a)-norm(b))%360;return Math.min(d,360-d)}
function updateViewButtons(){document.querySelectorAll('.viewBtn').forEach(b=>b.classList.toggle('primary',angleDiffDeg(rotation,parseFloat(b.dataset.view))<VIEW_ANGLE_EPSILON_DEG))}
// RS-1006: dropped the previous `rotation ${Math.round(rotation)}°` readout here -- now that
// OrbitControls allows free mouse orbit, that number only ever reflected the last preset/slider
// value, not the camera's actual live orientation, so displaying it would be misleading.
// UI-001: workspace status strip now also reports canvas size, units, safe-area size, and (when
// any layers are selected) the current selection's bounding box -- purely additional display text,
// computed from data updateAll() already has (project.canvas, getSafeAreaRectMm(), unionBBoxOfLayers()).
function selectionBoundsText(){if(!selectedLayerIds.size)return'';const sel=[...selectedLayerIds].map(id=>project.layers.find(x=>x.id===id)).filter(Boolean);if(!sel.length)return'';const b=unionBBoxOfLayers(sel);return`<span>selection: ${formatLengthDisplay(b.width,project.units,1)}×${formatLengthDisplay(b.height,project.units,1)} ${unitSuffix(project.units)}</span>`}
// S-107 (requirement 6, "Show useful information associated with the Front View Frame"): reuses
// the existing #cupStats workspace-status bar (already showing per-object/preview info) rather
// than adding new markup -- Front View width and printable circumference come straight from
// frontViewFrameGeometry()/printableCircumferenceMm(), the exact same functions that draw the
// frame and gate the too-long warning, so this can never disagree with either. Viewing position is
// the live rotation angle, signed the same way the Rotation slider/view buttons already are.
// S-112: the plate has no Front View Frame/printable-circumference concept (see
// isPointerOnFrontViewFrame()/isTextTooLongForObject()'s own S-112 guards) -- its cupStats line
// instead reports the plate's own physical metadata: design target, outer/inner diameter, rim
// width, and approximate weight.
function plateCupStatsHtml(t){const rimWidthMm=computeRimWidthMm(project.plate.outerDiameterMm,project.plate.innerWellDiameterMm);return`<span>${escapeHtml(t.displayName)}</span><span>same generated layout</span><span>${STONE_COLORS[selectedLayer().color]?.name||''}</span><span>design target: ${escapeHtml(getPlateDesignTargetMeta(project.plate.designTarget).name)}</span><span>outer diameter: ${formatLengthDisplay(project.plate.outerDiameterMm,project.units,1)} ${unitSuffix(project.units)}</span><span>inner well diameter: ${formatLengthDisplay(project.plate.innerWellDiameterMm,project.units,1)} ${unitSuffix(project.units)}</span><span>rim width: ${formatLengthDisplay(rimWidthMm,project.units,1)} ${unitSuffix(project.units)}</span><span>approx. weight: ${PLATE_ROUND_DINNER_DEFINITION.weightGrams.average} g</span>`}
function cylindricalCupStatsHtml(t){const{frameWidthMm}=frontViewFrameGeometry();return`<span>${escapeHtml(t.displayName)}</span><span>same generated layout</span><span>${STONE_COLORS[selectedLayer().color]?.name||''}</span><span>Front View width: ${formatLengthDisplay(frameWidthMm,project.units,1)} ${unitSuffix(project.units)}</span><span>printable circumference: ${formatLengthDisplay(printableCircumferenceMm(),project.units,1)} ${unitSuffix(project.units)}</span><span>viewing position: ${Math.round(rotation)}°</span>`}
// RS-3011 Step 5: #layoutStats is the 2D-Canvas-view status bar, but it's shared/always-wired
// regardless of the active view (see the Step 4 investigation) -- while Design is active, showing a
// non-'path' selected layer's stats (e.g. the seed text layer) is confusing, since that layer has no
// presence on Design's own canvas (drawingTool only draws/tracks 'path' layers). Falls back to a
// neutral canvas/safe-area-only summary in that one case; every other view+selection combination,
// including a 'path' layer selected and visible while Design is active, keeps the full stats.
function updateStats(){const t=currentObjectTemplate(),isPlate=t.preview.kind==='plate';const safe=getSafeAreaRectMm(t,project.canvas.width,project.canvas.height);const sel=selectedLayer();const u=unitSuffix(project.units);if(drawingTool.isActive&&sel.type!=='path'){el('layoutStats').innerHTML=`<span>canvas: ${formatLengthDisplay(project.canvas.width,project.units,1)}×${formatLengthDisplay(project.canvas.height,project.units,1)} ${u}</span><span>safe area: ${formatLengthDisplay(safe.widthMm,project.units,1)}×${formatLengthDisplay(safe.heightMm,project.units,1)} ${u}</span><span>units: ${u}</span>`}else{el('layoutStats').innerHTML=`<b>${layout.count}</b> stones <span>${formatLengthDisplay(layout.widthMm,project.units,1)}×${formatLengthDisplay(layout.heightMm,project.units,1)} ${u}</span><span>canvas: ${formatLengthDisplay(project.canvas.width,project.units,1)}×${formatLengthDisplay(project.canvas.height,project.units,1)} ${u}</span><span>safe area: ${formatLengthDisplay(safe.widthMm,project.units,1)}×${formatLengthDisplay(safe.heightMm,project.units,1)} ${u}</span><span>units: ${u}</span>${selectionBoundsText()}<span>selected: ${escapeHtml(layerLabel(sel))}</span>`}el('cupStats').innerHTML=isPlate?plateCupStatsHtml(t):cylindricalCupStatsHtml(t);updateStoneColorSwatch()}
// S-106: Combined Visual Preview PNG. Composites the two already-rendered, always-mounted canvas
// elements (layoutCanvas/cupCanvas -- both keep a real, non-zero pixel backing store at all times
// regardless of the active workspace tab, per the .tab-hidden/dual-mode invariant documented at
// index.html's .canvas-panel rule) side by side onto one offscreen canvas, drawn at each source
// canvas's own native pixel size (no rescale/stretch) so the capture is byte-for-byte what the
// operator currently sees, including whatever 3D rotation/zoom OrbitControls is mid-orbit on. No
// new render pass, no GeometryEngine/StoneLayout/renderer call -- pure canvas-to-canvas copy, the
// same "capture, not a standalone exporter" shape #exportPNG/#exportCup already use.
function composeCombinedPreviewCanvas(){
  const dpr=Math.max(1,devicePixelRatio||1),margin=48*dpr,gap=48*dpr;
  const w1=layoutCanvas.width,h1=layoutCanvas.height,w2=cupCanvas.width,h2=cupCanvas.height;
  const maxH=Math.max(h1,h2);
  const c=document.createElement('canvas');
  c.width=margin*2+gap+w1+w2;c.height=margin*2+maxH;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,c.width,c.height);
  ctx.drawImage(layoutCanvas,margin,margin+(maxH-h1)/2);
  ctx.drawImage(cupCanvas,margin+w1+gap,margin+(maxH-h2)/2);
  return c;
}
// RS-3013 Step 3: region-level duplicate, a plain app.js-owned function (not a DrawingCanvasTool.js
// hook) since project.layers/regions data already lives here -- called directly from
// el('actionDuplicate').onclick below, matching duplicateLayer() immediately below in spirit
// (commitHistory() first, cloned geometry, a fixed 8mm/8mm offset, new copy becomes the selection)
// but scoped to one region on the SAME layer rather than a whole layer. Mirrors onRegionMoved()'s
// own computeNaturalContourTransform()/applyNaturalContourTransform()/absolutePolygonsToNaturalSpace()
// chain exactly -- region.contour is stored in NATURAL space, a different scale per layer (per
// computeNaturalContourTransform()'s own scaleX/scaleY), so the 8mm/8mm offset must be applied in
// ABSOLUTE space via this chain, not added directly to the natural contour's own coordinates.
// applyNaturalContourTransform()/absolutePolygonsToNaturalSpace() both already return fresh Point2D
// objects (see GeometryEngine.js), never references into region.contour's own array, so the chain's
// own output is already an independent clone -- no separate JSON.parse(JSON.stringify()) step is
// needed on top of it, same as onRegionMoved() itself never adding one before writing its own
// translated polygon back. Copies stoneSizeMm/gapMm/color/fillMode verbatim from the source region
// (this milestone's own decided rule: a region copy is a duplicate, not a new paint stroke routed
// through paintSettings). New id is `'region'+Date.now()+'copy'` -- a non-numeric suffix, so it can
// never collide with onPaintStroke's own `'region'+Date.now()+index` scheme (index is always a plain
// integer there, never the string 'copy'), even for a copy and a fresh paint stroke landing in the
// same millisecond. Returns {newRegionId, polygon} (polygon: the new region's absolute-mm outline,
// for DrawingCanvasTool.js's own setActiveSelectionToRegion() to draw immediately without a second
// hit-test round-trip), or null if the layer/region no longer exists -- same defensive no-op
// precedent onRegionMoved() already established.
function duplicateRegionInPathLayer(layerId,regionId){
  const targetLayer=project.layers.find(l=>l.id===layerId&&l.type==='path');
  if(!targetLayer)return null;
  const region=(targetLayer.regions||[]).find(r=>r.id===regionId);
  if(!region)return null;
  const naturalContours=targetLayer.contours.map(contour=>contour.map(p=>({xMm:p.x,yMm:p.y})));
  const transform=computeNaturalContourTransform(naturalContours,targetLayer.x,targetLayer.y,targetLayer.w,targetLayer.h,targetLayer.naturalBoundingBoxMm);
  if(!transform)return null;
  const currentPolygon=applyNaturalContourTransform(region.contour,transform);
  const translatedPolygon=currentPolygon.map(p=>({xMm:p.xMm+8,yMm:p.yMm+8}));
  const [naturalContour]=absolutePolygonsToNaturalSpace([translatedPolygon],targetLayer);
  if(!naturalContour)return null;
  commitHistory();
  const newRegion={
    id:'region'+Date.now()+'copy',
    contour:naturalContour,
    stoneSizeMm:region.stoneSizeMm,
    gapMm:region.gapMm,
    color:region.color,
    fillMode:region.fillMode
  };
  targetLayer.regions.push(newRegion);
  drawingTool.refreshStoneGroupForLayer(targetLayer.id);
  updateAll(true);
  el('status').textContent=`Duplicated region on ${layerLabel(targetLayer)}.`;
  return{newRegionId:newRegion.id,polygon:translatedPolygon};
}
// RS-3013 Step 4: region-level delete, a plain app.js-owned function (not a DrawingCanvasTool.js
// hook) since project.layers/regions data already lives here -- mirrors duplicateRegionInPathLayer()
// immediately above in structure (same layer/region lookup, same defensive no-op if either is
// missing, commitHistory() first) but removes the region entirely instead of cloning it. Unlike
// deleteLayer()'s own "last remaining layer" guard (which replaces the last layer with a blank text
// layer rather than truly deleting it), no analogous guard is needed here: a layer with zero regions
// is already the normal, default state before any region is ever painted (onPaintStroke's own
// `if(!Array.isArray(targetLayer.regions))targetLayer.regions=[]` already handles this), so deleting
// the last region on a layer just leaves it with an empty regions array. No return value -- unlike
// move/duplicate, there's no new geometry for the caller to use afterward.
function deleteRegionFromPathLayer(layerId,regionId){
  const targetLayer=project.layers.find(l=>l.id===layerId&&l.type==='path');
  if(!targetLayer)return;
  const region=(targetLayer.regions||[]).find(r=>r.id===regionId);
  if(!region)return;
  commitHistory();
  targetLayer.regions=targetLayer.regions.filter(r=>r.id!==regionId);
  drawingTool.refreshStoneGroupForLayer(targetLayer.id);
  updateAll(true);
  el('status').textContent=`Deleted region on ${layerLabel(targetLayer)}.`;
}
// Bulk-delete-by-area: extracted out of onEraseSweep's own 'stones' branch below -- that branch's
// entire body (Item 1/Item 2 splice+snapshot, single commitHistory()) is now this shared function,
// parameterized by an arbitrary (xMm,yMm)=>boolean interior test instead of the circle-radius test
// hardcoded there before. onEraseSweep passes its own daub-radius test; deleteCurrentSelection's new
// 'draft' branch below passes isPointInActiveSelection's own rect-bounds/lasso-polygon test instead --
// same two mechanisms (stampedStones splice for stamps, erasedGridPositions snapshot for everything
// else), same regeneration-time exclusion contract, just a different shape of "is this point inside."
// Returns null and mutates nothing when withinTest matches no stone at all (the no-op guard the
// original branch already had); otherwise commits history, mutates targetLayer, refreshes the canvas,
// and returns {removedCount} so each caller can word its own status message.
async function eraseStonesWithinTest(targetLayer,withinTest){
  const naturalContours=targetLayer.contours.map(c=>c.map(p=>({xMm:p.x,yMm:p.y})));
  const transform=computeNaturalContourTransform(naturalContours,targetLayer.x,targetLayer.y,targetLayer.w,targetLayer.h,targetLayer.naturalBoundingBoxMm);
  const existingStampedStones=targetLayer.stampedStones||[];
  const survivingStampedStones=existingStampedStones.filter(stamp=>{
    if(!transform)return true;
    const[placed]=applyNaturalContourTransform([{xMm:stamp.xMm,yMm:stamp.yMm}],transform);
    return!withinTest(placed.xMm,placed.yMm);
  });
  const currentResult=permanentEngine.generatePathLayout({
    contours:naturalContours,
    layerId:targetLayer.id,
    xMm:targetLayer.x,yMm:targetLayer.y,widthMm:targetLayer.w,heightMm:targetLayer.h,
    stoneSizeMm:targetLayer.stoneSize,gapMm:targetLayer.gap,
    mode:resolveVectorFillMode(targetLayer.fillMode),color:targetLayer.color,
    closed:targetLayer.closed!==false,
    regions:targetLayer.regions||[],
    naturalBoundingBoxMm:targetLayer.naturalBoundingBoxMm,
    erasedGridPositions:targetLayer.erasedGridPositions||[],
    eraseDaubs:targetLayer.eraseDaubs||[],
    ...mixedSizeParamsFor(targetLayer)
  });
  const newlyErasedAbsolutePoints=currentResult.stones
    .filter(stone=>withinTest(stone.xMm,stone.yMm))
    .map(stone=>({xMm:stone.xMm,yMm:stone.yMm}));
  const removedCount=(existingStampedStones.length-survivingStampedStones.length)+newlyErasedAbsolutePoints.length;
  if(removedCount===0)return null;
  commitHistory();
  targetLayer.stampedStones=survivingStampedStones;
  if(newlyErasedAbsolutePoints.length>0){
    const[naturalPoints]=absolutePolygonsToNaturalSpace([newlyErasedAbsolutePoints],targetLayer);
    if(naturalPoints){
      if(!Array.isArray(targetLayer.erasedGridPositions))targetLayer.erasedGridPositions=[];
      targetLayer.erasedGridPositions.push(...naturalPoints.map(p=>({xMm:p.xMm,yMm:p.yMm})));
    }
  }
  drawingTool.refreshStoneGroupForLayer(targetLayer.id);
  await updateAll(true);
  return{removedCount};
}
// RS-3011 Step 2 fix: for a Design-drawn 'path' layer, duplicateShapeForLayer() clones the matching
// Paper.js item in drawingTool's own board.shapes too -- previously only project.layers gained a
// new entry, leaving the copy invisible on the Design canvas until it was closed and reopened. Uses
// the SAME dx/dy this function already applies to copy.x/copy.y (not a second offset convention);
// a no-op for every non-'path' layer type via drawingTool's own internal lookup.
function duplicateLayer(id){const l=project.layers.find(x=>x.id===id);if(!l)return;commitHistory();const copy=JSON.parse(JSON.stringify(l));copy.id=l.type+Date.now();
  // RS-3011 Step 3b: pushed here, before drawingTool.duplicateShapeForLayer() below, instead of
  // after every branch (as before this step) -- duplicateShapeForLayer() now builds the clone's own
  // stone Group immediately via the getLayerStoneParams(newLayerId) hook, which reads project.layers,
  // so `copy` must already be in the array by the time that call happens. `copy` is pushed by
  // reference; the circle/text branches below still freely mutate it afterward, same as before.
  project.layers.push(copy);
  if(copy.type==='circle'){copy.cx+=8;copy.cy+=8}if(XYWH_SHAPE_TYPES.has(copy.type)){const dx=8,dy=8;copy.x+=dx;copy.y+=dy;drawingTool.duplicateShapeForLayer(l.id,copy.id,dx,dy)}if(copy.type==='text'){copy.text+=' copy';copy.x=(copy.x||0)+8;copy.y=(copy.y||0)+8}selectedLayerId=copy.id;selectedLayerIds=selectOnly(copy.id);syncSelectedControlsFromLayer();updateAll()}// RS-3011 Step 1 write-through fix: returns true/false so onShapeDeleted() (below) knows whether
// the guard blocked the delete, without duplicating any guard logic itself -- every pre-existing
// caller already discards the return value, so this stays backward-compatible. RS-3011 freehand-
// close-and-clear-all-layers fix: deleting the last remaining layer is no longer blocked -- it is
// replaced in place with a fresh, blank text layer (same shape defaultProject()'s own seed text
// layer uses, just with text:''), giving the user a genuinely blank project instead of a wall.
// generateTextStonesLive() already guards `!layer.text` and returns zero stones for empty text --
// the exact same thing that already happens today if a user manually clears the text field -- so
// this is an already-proven-safe state, not a new code path.
function deleteLayer(id){
  commitHistory();
  if(project.layers.length<=1){
    const blank={id:'text'+Date.now(),type:'text',visible:true,text:'',font:DEFAULT_TEXT_FONT_ID,height:25,heightMode:'capHeight',textMode:'stroke',stoneSize:2.8,gap:.3,color:'gold',autoFit:false,curveEnabled:false,curveRadiusMm:40,curveDirection:'outside',curveStartAngleDeg:0,curveSweepAngleDeg:180,curveAlignment:'center',align:'left',lineSpacing:1,rotationDeg:0,letterSpacing:0,x:0,y:0};
    project.layers=[blank];
    selectedLayerId=blank.id;selectedLayerIds=selectOnly(selectedLayerId);syncSelectedControlsFromLayer();updateAll(true,true);return true
  }
  project.layers=project.layers.filter(l=>l.id!==id);selectedLayerId=project.layers[0].id;selectedLayerIds=selectOnly(selectedLayerId);syncSelectedControlsFromLayer();updateAll(true,true);return true}
function pointerToLayout(e){const r=layoutCanvas.getBoundingClientRect(),dpr=layoutTransform.dpr;return layoutPxToMm((e.clientX-r.left)*dpr,(e.clientY-r.top)*dpr)}
// TXT-102: checked before the generic per-layer loop below -- the rotate handle only ever exists
// for the single currently-selected layer (matching drawRotateHandle()'s own single gate, RS-3029
// generalized from text-only to every type), and it is drawn outside the layer's own bbox, so it
// would never be reached by the bbox-contains 'move' check below anyway.
function rotateHandleHitTest(mm){
  if(selectedLayerIds.size!==1)return null;
  const l=project.layers.find(x=>selectedLayerIds.has(x.id));
  if(!l)return null;
  const b=getLayerBBox(l);
  const h=rotateHandlePositionMm(b);
  if(!h)return null;
  if(Math.abs(mm.x-h.x)<ROTATE_HANDLE_HIT_TOLERANCE_MM&&Math.abs(mm.y-h.y)<ROTATE_HANDLE_HIT_TOLERANCE_MM){
    return{layer:l,kind:'rotate',b0:b,center:{x:h.cx,y:h.cy}};
  }
  return null;
}
// fix/rotated-layer-bbox-hittest: for XYWH layers, `b` is now the raw stored x/y/w/h box, not
// getLayerBBox()'s rotated-corners AABB -- rotatedHandlesFor(b,rotationDeg) rotates whatever box
// it's given around that box's own center, so feeding it the already-rotated AABB would rotate a
// rotated shape's handles a second time. b0 (captured on both the 'resize' and 'move' return paths)
// must stay this same raw box: the resize-drag code in pointermove reads drag.b0.x/y/x2/y2 (axis-
// aligned case) and drag.b0.width/height (rotated-local-axis case), both of which assume an
// unrotated box. The move-containment check below is the one place that needs the TRUE rotated
// footprint, so it does its own inverse-rotation test against the raw box instead of using an AABB
// derived from `b`. Circle/text layers are untouched: `b` for those is still getLayerBBox(l)
// unchanged, exactly as before this fix.
function hitTest(mm){
  const rotateHit=rotateHandleHitTest(mm);if(rotateHit)return rotateHit;
  const layers=[...project.layers].reverse();
  for(const l of layers){
    const rotationDeg=l.rotationDeg||0;
    const isXywh=XYWH_SHAPE_TYPES.has(l.type);
    const b=isXywh?{x:l.x,y:l.y,width:l.w,height:l.h,x2:l.x+l.w,y2:l.y+l.h}:getLayerBBox(l);
    for(const h of rotatedHandlesFor(b,rotationDeg)){
      if(Math.abs(mm.x-h.x)<3&&Math.abs(mm.y-h.y)<3&&l.type!=='text')return{layer:l,kind:'resize',handle:h.name,b0:b}
    }
    let inside;
    if(isXywh&&(rotationDeg%360+360)%360!==0){
      const cx=l.x+l.w/2,cy=l.y+l.h/2;
      const p=rotatePointDeg(mm.x,mm.y,cx,cy,-rotationDeg);
      inside=p.x>=l.x&&p.x<=l.x+l.w&&p.y>=l.y&&p.y<=l.y+l.h;
    }else{
      inside=mm.x>=b.x&&mm.x<=b.x2&&mm.y>=b.y&&mm.y<=b.y2;
    }
    if(inside)return{layer:l,kind:'move',b0:b}
  }
  return null;
}
// S-104: a move-drag previously mapped pointer movement to mm 1:1 (rawDx/rawDy applied verbatim),
// which made small, precise placements -- text in particular, since it has no resize handles to
// fall back on -- hard to land exactly. LAYER_MOVE_DRAG_SENSITIVITY scales the pointer's
// displacement from drag.start down before it becomes a position delta, the same named-constant
// pattern this file already uses for pointer-driven tuning (see the removed CUP_ROTATION_SENSITIVITY
// precedent in docs/ARCHITECTURE.md). Applied once, before snapping/shift-lock, so both keep working
// against the already-scaled delta; resize-drag (mm-under-cursor, not delta-based) is unaffected.
const LAYER_MOVE_DRAG_SENSITIVITY=0.5;
// RS-1009: pointerdown now resolves one of three outcomes: (1) empty canvas -> clear selection;
// (2) a resize handle -> unchanged single-layer resize (never snaps, never multi-selects); (3) a
// layer body -> Shift toggles it in the multi-selection (no drag starts on that click, matching
// this milestone's spec), a plain click on a layer already in the current multi-selection starts
// a *group* drag of the whole selection, and a plain click on any other layer collapses the
// selection to just that layer first (preserving pre-existing single-selection behavior) before
// starting its drag. Exactly one commitHistory() call happens per drag, at drag start.
layoutCanvas.addEventListener('pointerdown',e=>{
  // MONO-006C (UI-001 tool activation): Monogram is the one top-level tool whose Lightbox both (a)
  // needs no canvas interaction to function (unlike Shapes/Import/Image Trace, which rely on canvas
  // clicks to choose which shape's relocated fields show) and (b) generates whole new layers that
  // must not be disturbed mid-generation by a concurrent canvas selection/drag/resize/rotate.
  // Lightbox's own primary-exclusivity (src/ui/Lightbox.js) already closes the Text dialog when
  // Monogram opens, but both dialogs are non-modal (canvas stays clickable underneath) -- this is
  // the other half of "only one top-level tool is active": while Monogram is open, canvas selection
  // is inert.
  if(lightboxes.monogram.isOpen)return;
  // RS-3010 Step 1: the same "only one top-level tool is active" rule -- while drawing mode owns
  // layoutCanvas (its own Paper.js Tool, wired in toggleDrawMode() below), the normal hit-test/
  // select/drag pointerdown flow below must not also fire on the same click.
  if(drawingTool.isActive)return;
  const mm=pointerToLayout(e);const hit=hitTest(mm);
  // S-107: an empty-canvas click that lands inside the Front View Frame starts a frame drag
  // instead of clearing the selection -- a click on an actual layer/stone still takes priority
  // (hit is checked first, above) and moves that layer exactly as before.
  if(!hit&&isPointerOnFrontViewFrame(mm)){
    drag={kind:'frontFrame',startPointerXmm:mm.x,startRotation:rotation};
    layoutCanvas.setPointerCapture(e.pointerId);
    return;
  }
  if(!hit){if(selectedLayerIds.size){selectedLayerIds=clearSelection();renderLayerUI();updateEditingUI();drawLayout()}return}
  if(hit.kind==='resize'){
    selectedLayerIds=selectOnly(hit.layer.id);selectedLayerId=hit.layer.id;
    syncSelectedControlsFromLayer();renderLayerUI();updateEditingUI();
    commitHistory();
    // RS-3030: rotationDeg + anchorAbs snapshotted once at drag-start, alongside b0/handle/layerId --
    // resize math needs both on every subsequent pointermove (recomputing anchorAbs live would let
    // it drift as l.rotationDeg/l.x/l.y/l.w/l.h change mid-drag, when it must stay fixed in place).
    // anchorAbs is the handle's own ANCHOR (opposite corner/edge, via HANDLE_UNIT_OFFSET negated) at
    // its true rotated position -- the point that must stay visually fixed while resizing.
    const rotationDeg0=hit.layer.rotationDeg||0;
    const cx0=(hit.b0.x+hit.b0.x2)/2,cy0=(hit.b0.y+hit.b0.y2)/2;
    const off=HANDLE_UNIT_OFFSET[hit.handle];
    const anchorLocal={x:cx0-off.x*(hit.b0.width/2),y:cy0-off.y*(hit.b0.height/2)};
    const anchorAbs=rotationDeg0?rotatePointDeg(anchorLocal.x,anchorLocal.y,cx0,cy0,rotationDeg0):anchorLocal;
    drag={kind:'resize',handle:hit.handle,layerId:hit.layer.id,start:mm,b0:hit.b0,l0:JSON.parse(JSON.stringify(hit.layer)),rotationDeg:rotationDeg0,anchorAbs,handleOffset:off};
    layoutCanvas.setPointerCapture(e.pointerId);updateAll(true);return;
  }
  if(hit.kind==='rotate'){
    // TXT-102: the layer is already the sole selection (rotateHandleHitTest() only ever matches the
    // single selected text layer), so no selection-state change is needed here, unlike 'resize'
    // above (which can start from a click that first changes selection). startPointerAngleDeg is
    // the pointer's own angle from the bbox center at drag-start, in the same clockwise-from-up
    // convention rotateHandlePositionMm()/rotateTextPoints() use -- pointermove below only ever
    // needs the *change* in pointer angle from this reference, added to the layer's own starting
    // rotationDeg, so the handle tracks the pointer exactly with no jump at drag-start.
    commitHistory();
    const dxMm=mm.x-hit.center.x,dyMm=mm.y-hit.center.y;
    const startPointerAngleDeg=Math.atan2(dxMm,-dyMm)*180/Math.PI;
    // start:mm is unused by the 'rotate' branch itself (it re-derives its own dxMm/dyMm from
    // drag.center every move) but is still required here: pointermove's shared preamble
    // (`rawDx=mm.x-drag.start.x`) runs unconditionally before branching on drag.kind, exactly like
    // it already does for 'resize' (whose branch also ignores rawDx/rawDy in favor of raw mm).
    drag={kind:'rotate',layerId:hit.layer.id,start:mm,center:hit.center,startRotationDeg:hit.layer.rotationDeg||0,startPointerAngleDeg};
    layoutCanvas.setPointerCapture(e.pointerId);updateAll(true);return;
  }
  if(e.shiftKey){
    selectedLayerIds=toggleSelection(selectedLayerIds,hit.layer.id);
    if(selectedLayerIds.has(hit.layer.id))selectedLayerId=hit.layer.id;else if(selectedLayerIds.size)selectedLayerId=[...selectedLayerIds][selectedLayerIds.size-1];
    syncSelectedControlsFromLayer();renderLayerUI();updateEditingUI();updateAll(true);
    return;
  }
  if(!selectedLayerIds.has(hit.layer.id))selectedLayerIds=selectOnly(hit.layer.id);
  selectedLayerId=hit.layer.id;
  syncSelectedControlsFromLayer();renderLayerUI();updateEditingUI();
  commitHistory();
  let dragIds=[...selectedLayerIds];
  // RS-1010: Alt/Option-drag duplicates the current selection in place and drags the copies,
  // leaving the originals untouched -- one undo step covers duplicate+move together (the
  // commitHistory() above already opened it), matching the existing "one commit per completed
  // drag" convention. Preserves pre-existing behavior for a plain (non-Alt) drag entirely.
  if(e.altKey){
    const copies=dragIds.map((id,i)=>{const l=project.layers.find(x=>x.id===id);const copy=JSON.parse(JSON.stringify(l));copy.id=`${l.type}${Date.now()}${i}`;return copy});
    project.layers.push(...copies);
    dragIds=copies.map(c=>c.id);
    selectedLayerIds=selectMany(dragIds);selectedLayerId=dragIds[dragIds.length-1];
    renderLayerUI();
  }
  const l0Map=new Map(dragIds.map(id=>[id,JSON.parse(JSON.stringify(project.layers.find(x=>x.id===id)))]));
  const groupBBox0=unionBBoxOfLayers(dragIds.map(id=>project.layers.find(x=>x.id===id)));
  // M14: baseLayout is the current module-level StoneLayout snapshotted as-is at drag start -- the
  // move-drag fast path translates a copy of it every pointermove instead of regenerating every
  // layer. l0Map already captures each moved layer's drag-start position fields (x/y or cx/cy), so it
  // doubles as the per-layer base-position snapshot the fast path derives its delta from -- no
  // separate baseLayerPositionsById is needed. `layout` can be null here (generation never succeeded
  // yet); the pointermove fast path guards on drag.baseLayout and falls back to updateAll(true).
  drag={kind:'move',layerIds:dragIds,start:mm,l0Map,groupBBox0,baseLayout:layout};
  layoutCanvas.setPointerCapture(e.pointerId);updateAll(true);
});
layoutCanvas.addEventListener('pointermove',e=>{
  if(!drag)return;
  // S-107: dragging the Front View Frame rotates the Object Preview live. Deliberately cheap --
  // no engine.generate()/updateAll() (the layout itself never changes here, only the viewing
  // angle) -- so this stays immediate and smooth even while the pointer moves every frame.
  // canvasXMmForRotationDeg()/rotationDegForCanvasXMm() are exact inverses of each other, so
  // re-deriving the absolute rotation from the total pointer displacement each move is drift-free
  // (never an accumulated per-frame delta).
  if(drag.kind==='frontFrame'){
    const mm=pointerToLayout(e);
    const dxMm=mm.x-drag.startPointerXmm;
    const targetXmm=canvasXMmForRotationDeg(drag.startRotation,project.canvas.width)+dxMm;
    rotation=rotationDegForCanvasXMm(targetXmm,project.canvas.width);
    el('rotation').value=rotation;
    preview3D.syncView(rotation,zoom);
    drawLayout();
    updateViewButtons();
    updateStats();
    return;
  }
  const mm=pointerToLayout(e),rawDx=mm.x-drag.start.x,rawDy=mm.y-drag.start.y;
  if(drag.kind==='move'){
    let dx=rawDx*LAYER_MOVE_DRAG_SENSITIVITY,dy=rawDy*LAYER_MOVE_DRAG_SENSITIVITY;
    activeGuides=[];
    // RS-1009: snapping is drag-only (never keyboard nudge/align/distribute), independently
    // computed on x/y, and only ever checked against OTHER visible layers -- the dragged
    // selection's own pre-drag bbox (groupBBox0, captured once at pointerdown) is what moves,
    // never a snap target for itself.
    if(snapEnabled){
      const dragBBoxMm={xMm:drag.groupBBox0.x+dx,yMm:drag.groupBBox0.y+dy,widthMm:drag.groupBBox0.width,heightMm:drag.groupBBox0.height};
      const others=project.layers.filter(l=>l.visible&&!drag.layerIds.includes(l.id)).map(l=>{const b=getLayerBBox(l);return{layerId:l.id,xMm:b.x,yMm:b.y,widthMm:b.width,heightMm:b.height}});
      const targets=buildSnapTargets({canvasWidthMm:project.canvas.width,canvasHeightMm:project.canvas.height,safeAreaRectMm:getSafeAreaRectMm(currentObjectTemplate(),project.canvas.width,project.canvas.height),layerBBoxes:others});
      const snap=computeSnapOffset(dragBBoxMm,targets,snapToleranceMm);
      dx+=snap.dxMm;dy+=snap.dyMm;
      activeGuides=showSnapGuides?snap.guides:[];
    }
    // RS-1010: Shift constrains movement to whichever axis has moved further from the drag start,
    // applied after snapping so the locked axis lands exactly on its start position (never nudged
    // by a nearby snap target) -- matches Illustrator/Figma's shift-drag axis lock.
    if(e.shiftKey){
      if(Math.abs(dx)>=Math.abs(dy)){dy=0;activeGuides=activeGuides.filter(g=>g.axis!=='horizontal')}
      else{dx=0;activeGuides=activeGuides.filter(g=>g.axis!=='vertical')}
    }
    for(const id of drag.layerIds){
      const l=project.layers.find(x=>x.id===id);if(!l)continue;
      const p0=getLayerPosition(drag.l0Map.get(id));
      setLayerPosition(l,p0.xMm+dx,p0.yMm+dy);
    }
  }else if(drag.kind==='resize'){
    const l=project.layers.find(x=>x.id===drag.layerId);if(!l)return;
    if(l.type==='circle'){l.r=Math.max(2,Math.hypot(mm.x-drag.l0.cx,mm.y-drag.l0.cy))}
    else if(XYWH_SHAPE_TYPES.has(l.type)&&!drag.rotationDeg){let x0=drag.b0.x,y0=drag.b0.y,x1=drag.b0.x2,y1=drag.b0.y2;if(drag.handle.includes('w'))x0=mm.x;if(drag.handle.includes('e'))x1=mm.x;if(drag.handle.includes('n'))y0=mm.y;if(drag.handle.includes('s'))y1=mm.y;l.x=Math.min(x0,x1);l.y=Math.min(y0,y1);l.w=Math.max(2,Math.abs(x1-x0));l.h=Math.max(2,Math.abs(y1-y0))}
    else if(XYWH_SHAPE_TYPES.has(l.type)){
      // RS-3030: rotated resize -- drag the handle along the shape's own LOCAL (rotated) axes, per
      // the Illustrator/Figma convention, keeping the opposite corner/edge (anchorAbs, fixed at
      // drag-start) visually pinned in place. See this milestone's own doc for the full derivation.
      const rotationDeg=drag.rotationDeg,anchor=drag.anchorAbs,off=drag.handleOffset;
      // Inverse-rotate the pointer's offset from the anchor into the shape's local, unrotated axes
      // -- the same space l.w/l.h are already defined in.
      const local=rotatePointDeg(mm.x-anchor.x,mm.y-anchor.y,0,0,-rotationDeg);
      let newW=drag.b0.width,newH=drag.b0.height;
      if(off.x!==0)newW=Math.max(2,Math.abs(local.x));
      if(off.y!==0)newH=Math.max(2,Math.abs(local.y));
      // New center sits newW/2,newH/2 (signed by the dragged handle's own unit offset) away from the
      // anchor in local space; rotate that offset forward back into absolute space and add to the
      // anchor's fixed absolute position to get the new absolute center.
      const centerAbsOffset=rotatePointDeg(off.x*newW/2,off.y*newH/2,0,0,rotationDeg);
      const newCx=anchor.x+centerAbsOffset.x,newCy=anchor.y+centerAbsOffset.y;
      l.x=newCx-newW/2;l.y=newCy-newH/2;l.w=newW;l.h=newH;
    }
  }else if(drag.kind==='rotate'){
    const l=project.layers.find(x=>x.id===drag.layerId);if(!l)return;
    const dxMm=mm.x-drag.center.x,dyMm=mm.y-drag.center.y;
    const pointerAngleDeg=Math.atan2(dxMm,-dyMm)*180/Math.PI;
    let rotationDeg=drag.startRotationDeg+(pointerAngleDeg-drag.startPointerAngleDeg);
    // TXT-102: "Shift snaps to common angles (0°, 15°, 30°, 45°, 60°, 90°, etc.)" -- snapping the
    // live drag value to the nearest 15° multiple covers every angle the spec calls out by name.
    if(e.shiftKey)rotationDeg=Math.round(rotationDeg/ROTATION_SNAP_STEP_DEG)*ROTATION_SNAP_STEP_DEG;
    l.rotationDeg=((rotationDeg%360)+360)%360;
  }
  syncSelectedControlsFromLayer();
  // M14 (perf/move-drag-translate-fast-path): move drags take the translation fast path -- translate a
  // copy of the drag-start layout (drag.baseLayout) instead of calling engine.generate() for every
  // layer on every pointermove. Resize and rotate drags are deliberately out of scope for this
  // milestone and keep their existing full per-frame updateAll(true).
  //
  // Approximation contract: translation is geometrically EXACT per layer (every sampling grid is
  // anchored to its own layer's box -- see translateLayoutForMoveDrag()). The only difference from a
  // true regeneration is the project-level dedupeStonesByRadius() that runs ACROSS layers: where the
  // moved layer transiently overlaps another mid-drag, this preview's overlap zone can differ
  // slightly. endActiveDrag() runs exactly one canonical updateAll(true) at drag end, on every
  // termination path, so nothing the fast path shows ever persists into project state or an export.
  if(drag.kind==='move'&&drag.baseLayout){
    const base0=drag.l0Map.get(drag.layerIds[0]),liveLayer=project.layers.find(x=>x.id===drag.layerIds[0]);
    if(base0&&liveLayer){
      // Every dragged layer shares one delta -- the move branch above applies the same dx/dy to all
      // of them (see the `for(const id of drag.layerIds)` loop) -- so the first layer's drag-start
      // -> current offset is the whole moved set's translation. Derived from base positions, not
      // accumulated per-event, so it can never drift.
      const p0=getLayerPosition(base0),p1=getLayerPosition(liveLayer);
      layout=translateLayoutForMoveDrag(drag.baseLayout,drag.layerIds,p1.xMm-p0.xMm,p1.yMm-p0.yMm);
      drawLayout();
      // Same per-frame 3D-preview refresh updateAll()'s tail performs (drawCup() -> preview3D.update).
      drawCup();
    }else{
      updateAll(true);
    }
  }else{
    updateAll(true);
  }
});
window.addEventListener('pointerup',endActiveDrag);
window.addEventListener('pointercancel',endActiveDrag);
// M14: EVERY way a layoutCanvas drag can end runs through here. Precondition #2 (verified by grepping
// app.js, not assumed): the ONLY listener that cleared `drag` was the old `pointerup` handler -- there
// is no blur/visibilitychange/lostpointercapture handler, and the only `Escape` handling
// (drawingTool.isActive keydown branch, the #moreShapesPopover close) never touches layoutCanvas
// `drag`. `pointercancel` was previously unhandled entirely (a canceled drag left `drag` stuck -- a
// pre-existing latent bug); it is wired here now so the fast-path preview can never survive a cancel.
// A move drag ran the translation fast path on its pointermoves instead of updateAll(true), so it
// MUST end with exactly one canonical full regeneration before the layout can persist or export.
// updateAll(true) commits no history (that happened once at drag start), so there is no double-commit
// on any path; a plain click with no pointermove is already canonical from pointerdown's own
// updateAll(true) and the extra regeneration here is idempotent.
function endActiveDrag(){
  const ended=drag;
  drag=null;
  if(activeGuides.length){activeGuides=[];drawLayout()}
  if(ended&&ended.kind==='move')updateAll(true);
}
window.addEventListener('keydown',e=>{
  const key=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
  // RS-1002: app-level undo/redo takes precedence over any native browser input-level undo, so
  // these fire (and preventDefault) even while a text/number field has focus.
  if(mod&&key==='z'){e.preventDefault();if(e.shiftKey)performRedo();else performUndo();return}
  if(mod&&key==='y'){e.preventDefault();performRedo();return}
  // MONO-006C (UI-001 tool activation): layer-editing shortcuts are inert while the Monogram
  // Lightbox is open (see the matching pointerdown gate above for the full rationale). Undo/redo
  // above stay global -- they act on the whole project, not on canvas layer editing.
  if(lightboxes.monogram.isOpen)return;
  // RS-3010 Step 1/2a: layer-editing shortcuts (arrow-nudge) are inert while drawing mode owns
  // the canvas, mirroring the pointerdown gate above -- but Step 2a's Delete/Backspace removes
  // the current drawn-shape selection instead of just being blocked, so it must not fall through
  // to the project.layers deleteLayer() path below.
  if(drawingTool.isActive){
    if(e.key==='Delete'||e.key==='Backspace'){
      const t=document.activeElement?.tagName;if(t==='INPUT'||t==='SELECT')return;
      e.preventDefault();
      deleteCurrentSelection();
    }
    // RS-3010 Step 2c: Escape cancels whatever drag or in-progress polygon drawingTool.cancelPath()
    // now covers (see DrawingCanvasTool.js's resetInProgressDrawing()) -- this block's own `return`
    // below already keeps drawing mode from falling through to any other Escape handler while it
    // owns the canvas. RS-3011 Step 11: cancelPath() can now also revert mode to 'select' when
    // Escape is pressed on an idle click-to-place tool (Stamp/Trace, see its own doc comment) --
    // updateDrawToolButtons() syncs the rail's aria-pressed state to match, the same convention
    // every other mode-reverting commit (onShapeCommitted, onPaintStroke) already follows.
    if(e.key==='Escape'){
      e.preventDefault();
      drawingTool.cancelPath();
      updateDrawToolButtons();
    }
    // RS-3010 Design Step B: plain-keypress tool shortcuts (no Cmd/Ctrl/Alt/Shift) -- calls the
    // exact same setDrawTool() the rail buttons use, no new dispatch path. Guarded like
    // Delete/Backspace above so typing in the Slot width field never gets hijacked.
    if(!mod&&!e.altKey&&!e.shiftKey&&DRAW_TOOL_SHORTCUT_KEYS[key]){
      const t=document.activeElement?.tagName;if(t==='INPUT'||t==='SELECT')return;
      e.preventDefault();
      setDrawTool(DRAW_TOOL_SHORTCUT_KEYS[key]);
    }
    // RS-3011 Step 13 decision 4b: '[' / ']' nudge eraserSettings.radiusMm down/up by 0.5mm while
    // Eraser is active (standard brush-size convention in Photoshop/Procreate/GIMP) -- clamped at
    // a 0.5mm floor, no ceiling. Guarded like the shortcuts above so typing '[' or ']' into
    // #eraserRadiusMm itself (or any other field) is never hijacked. The first of the two required
    // radius-adjustment paths; #eraserRadiusMm's own oninput handler is the second.
    if((e.key==='['||e.key===']')&&drawingTool.mode==='eraser'){
      const t=document.activeElement?.tagName;if(t==='INPUT'||t==='SELECT')return;
      e.preventDefault();
      eraserSettings.radiusMm=Math.max(0.5,eraserSettings.radiusMm+(e.key===']'?0.5:-0.5));
      drawingTool.setEraserRadiusMm(eraserSettings.radiusMm);
      setLengthField('eraserRadiusMm',eraserSettings.radiusMm);
    }
    // RS-3010 Design Step B: space-held temporary pan. e.repeat filters OS key-repeat spam (so
    // setSpaceHeld(true) fires once per physical press, not per repeat tick); same input-focus
    // guard as the shortcuts/Delete above so a space typed into the Slot width field is never
    // hijacked. Matching keyup listener (below, outside this isActive block since a key can be
    // released after focus/mode changes) ends the hold.
    if(e.code==='Space'&&!e.repeat){
      const t=document.activeElement?.tagName;if(t==='INPUT'||t==='SELECT')return;
      e.preventDefault();
      drawingTool.setSpaceHeld(true);
    }
    return;
  }
  if(e.key==='Delete'||e.key==='Backspace'){const t=document.activeElement?.tagName;if(t==='INPUT'||t==='SELECT')return;deleteLayer(selectedLayerId)}
  // RS-1009: arrow keys nudge the current multi-selection by a named mm step (NUDGE_STEP_MM,
  // src/editing/EditingConstants.js); Shift+Arrow uses the larger step. Guarded exactly like
  // Delete/Backspace above so typing in a text/number field or using a <select> is never hijacked.
  if(ARROW_KEY_DELTAS[e.key]){const t=document.activeElement?.tagName;if(t==='INPUT'||t==='SELECT')return;e.preventDefault();const step=e.shiftKey?NUDGE_STEP_LARGE_MM:NUDGE_STEP_MM;const[ux,uy]=ARROW_KEY_DELTAS[e.key];nudgeSelection(ux*step,uy*step)}
});
// RS-3010 Design Step B: ends the spacebar-held temporary pan started by the keydown handler
// above. Deliberately not gated on document.activeElement -- releasing a key while focus already
// moved (e.g. tabbing away mid-hold) must still end the hold, unlike the keydown side which only
// needs to avoid *starting* one from within an input.
window.addEventListener('keyup',e=>{
  if(!drawingTool.isActive)return;
  if(e.code==='Space')drawingTool.setSpaceHeld(false);
});
// RS-1002: these controls edit `project` fields, so one undo step is committed per edit session
// (opened on the first 'input' event, closed on 'change'). `rotation`/`zoom` are view-only (not
// part of `project`) and keep their original plain 'input' listener, untouched.
// UI-001: 'textX'/'textY' are the new manual Text Lightbox position fields (see writeSelectedControlsToLayer()).
// S-200: Mixed Stone Size controls (sizeMode/allowedSizesMm checkboxes/min-max size/conservative
// detail) get the exact same generic undo/redo wiring as every other inspector control below. The
// five checkbox ids are spelled out literally here (hand-synced with MIXED_ALLOWED_SIZE_CHECKBOXES
// above, the same "kept in sync by hand" convention VECTOR_FILL_MODES already uses for
// GeometryEngine's SAMPLE_MODES) rather than derived via `...MIXED_ALLOWED_SIZE_CHECKBOXES.map(...)`
// -- this array's source text is a flat list of string literals other tooling reasonably treats as
// JSON-parseable (e.g. tools/test-crystal-color-integration.mjs's own history-tracking check), and a
// computed spread broke that. See docs/specifications/S-200-MixedStoneSizeLayouts.md, "Results".
// RS-2010: 'vesselBodyDiameter'/'vesselBodyHeight'/'vesselTopDiameter' (added by that milestone) are
// the Mug/Tumbler/Bottle physical-dimension controls -- merged in alongside the S-200 ids above,
// same generic undo/redo wiring, no interaction between the two milestones' fields.
// MONO-006C: Minimum/Maximum Size must never invert (Minimum > Maximum) -- auto-adjusts the other
// control's value the instant one crosses the other, via setNumericSelectValue() (the same
// nearest-option helper syncSelectedControlsFromLayer() already uses for these two selects).
// Registered here, before HISTORY_TRACKED_CONTROL_IDS' own 'input' listener on these same elements
// below, so listener execution order (same event, same element -> registration order) guarantees
// this clamp runs first: by the time the generic write+regenerate listener reads these controls,
// the pair is already valid, and normalizeMixedSizeParams()'s own minSizeMm>maxSizeMm RangeError
// (MixedSizeGenerator.js) can never be reached from the UI.
el('mixedMinSize').addEventListener('input',()=>{
  const minMm=parseFloat(el('mixedMinSize').value),maxMm=parseFloat(el('mixedMaxSize').value);
  if(Number.isFinite(minMm)&&Number.isFinite(maxMm)&&minMm>maxMm)setNumericSelectValue(el('mixedMaxSize'),minMm);
});
el('mixedMaxSize').addEventListener('input',()=>{
  const minMm=parseFloat(el('mixedMinSize').value),maxMm=parseFloat(el('mixedMaxSize').value);
  if(Number.isFinite(minMm)&&Number.isFinite(maxMm)&&maxMm<minMm)setNumericSelectValue(el('mixedMinSize'),maxMm);
});
// FONT-DECISION-001 (Studio Integration follow-up): the auto-set/snap decision behind #stoneSize's
// listener below, factored into its own named function -- mirroring this file's existing "pure
// decision function + thin DOM listener" split (e.g. mixedSizeEligibleIds(),
// updateStoneSizePrintableCapabilityUI() above) -- so tools/test-font-decision-001-stone-size-ux.mjs
// can extract and directly execute it against a stub el()/layer.
//
// Sets Text height to the newly-selected stone size's own validated midpoint
// (StoneSizes.js's stoneSizeHeightMidpointMm(), sourced from tools/font-generator/config/SS*.json's
// supportedHeightRangeMm -- the single source of truth for both this and
// updateStoneSizePrintableCapabilityUI() above) -- unless the operator has already manually typed a
// height for *this* layer (l.heightManuallyEdited, set by #height's own listener below) AND that
// height is still within the newly-selected size's valid range, in which case their choice is left
// alone. An out-of-range manual height is still corrected (with a brief #heightAutoAdjustedHint note
// explaining why), since an invalid height is never a legitimate choice to preserve.
//
// Never called for an authored Production Font (see the #stoneSize listener's own isAuthoredStoneFontId()
// guard below) -- FONT-002 already disables #height entirely for one (a fixed-pitch character grid
// scaled only by stoneSizeMm, not a resizable outline), so supportedHeightRangeMm -- calibrated for
// OpenType/vision-validated fonts, see tools/font-generator's whole pipeline -- has nothing to say
// about it, and auto-setting a value the operator can neither see take effect nor override would be
// pure noise.
function applyStoneSizeHeightAutoSet(l,size){
  const currentHeight=readLengthField('height');
  const staysValid=l.heightManuallyEdited&&Number.isFinite(currentHeight)&&isHeightWithinStoneSizeRange(size,currentHeight);
  el('heightAutoAdjustedHint').style.display='none';
  if(staysValid)return;
  setLengthField('height',stoneSizeHeightMidpointMm(size));
  // Only surface the note when this overrides an existing manual choice -- the very first auto-set
  // on a fresh/never-edited layer is expected, unannounced behavior (matching #height's own
  // un-explained "25" default), not a correction that needs calling out.
  if(l.heightManuallyEdited){
    el('heightAutoAdjustedHint').textContent=`Height adjusted for ${size.name} (${size.supportedHeightRangeMm[0]}-${size.supportedHeightRangeMm[1]}mm).`;
    el('heightAutoAdjustedHint').style.display='block';
  }
}
// Registered here, before HISTORY_TRACKED_CONTROL_IDS' own 'input' listener on #stoneSize below
// (same element/event -> registration order), so #height already holds the auto-set/snapped value
// by the time the generic write+regenerate listener reads it into l.height.
el('stoneSize').addEventListener('input',()=>{
  const l=selectedLayer();
  if(!l||l.type!=='text'||isAuthoredStoneFontId(l.font))return;
  const size=findStoneSizeByDiameterMm(parseFloat(el('stoneSize').value));
  if(!size)return;
  applyStoneSizeHeightAutoSet(l,size);
});
// PERF-005: updateStoneSizeOptionAvailabilityUI()'s per-option-disabled sweep is otherwise only
// re-run when the selection itself changes (see updateStoneSizeOverlapCapabilityUI()) -- this
// refreshes it right before the user actually opens the dropdown, so an edit made to the selected
// layer since the last sweep (font, fill mode, height, ...) is reflected by the time they pick a
// size, without paying that sweep's cost on every one of those other edits.
el('stoneSize').addEventListener('focus',()=>{
  const target=currentStoneSizeTarget();
  if(!target)return;
  const currentSizeMm=target.region?target.region.stoneSizeMm:target.layer.stoneSize;
  updateStoneSizeOptionAvailabilityUI(target,currentSizeMm).catch(error=>console.error('Stone size availability sweep failed',error));
});
// Marks this layer's height as a deliberate manual choice so the Stone size listener above stops
// silently overriding it on future changes (as long as it stays valid for the newly-selected size).
// Only a genuine user edit of #height reaches this -- programmatic value assignment (e.g. the
// auto-set above, or syncSelectedControlsFromLayer() on a selection switch) never dispatches an
// 'input' event, so neither can ever mark a layer manual on its own.
el('height').addEventListener('input',()=>{
  const l=selectedLayer();
  if(l&&l.type==='text')l.heightManuallyEdited=true;
  el('heightAutoAdjustedHint').style.display='none';
});
// TXT-104 step 4b: #letterHeight's write direction -- only ever reachable while #letterHeightField is
// shown (capHeight mode + a validated font, see updateTextFontCapabilityUI()), so l.font is guaranteed
// to carry a capHeightRatio here. Converts the entered cap-height mm back to the raw engine-facing
// em-square height via solveEngineHeightMm(), clamps it to the exact same
// [RAW_ENGINE_HEIGHT_MM_MIN,RAW_ENGINE_HEIGHT_MM_MAX] range #height's own write-back clamps to
// (writeSelectedControlsToLayer()), writes that into #height, then dispatches a real 'input' event on
// #height so the entire existing #height chain -- heightManuallyEdited marking just above,
// HISTORY_TRACKED_CONTROL_IDS' write+regenerate listener below -- fires exactly as it does for a direct
// #height edit today. #letterHeight is deliberately NOT one of HISTORY_TRACKED_CONTROL_IDS: it never
// writes to a layer field directly, only ever drives #height, which is already tracked there.
el('letterHeight').addEventListener('input',()=>{
  const l=selectedLayer();
  if(!l||l.type!=='text')return;
  const desiredCapHeightMm=readLengthField('letterHeight');
  if(!Number.isFinite(desiredCapHeightMm))return;
  const engineHeightMm=solveEngineHeightMm({fontId:l.font,desiredCapHeightMm});
  setLengthField('height',Math.max(RAW_ENGINE_HEIGHT_MM_MIN,Math.min(RAW_ENGINE_HEIGHT_MM_MAX,engineHeightMm)));
  el('height').dispatchEvent(new Event('input'));
});
el('letterHeight').addEventListener('change',()=>{
  el('height').dispatchEvent(new Event('change'));
});
// TXT-104 step 4b: heightMode mode-switch affordance (design doc section 3.3) -- flips only
// l.heightMode, never l.height itself, so nothing about the rendered output changes at the moment of
// switching, only which field/units the operator edits from then on. Mirrors the layersList visibility
// checkbox's own direct-mutation pattern just above (commitHistory() then mutate then updateAll(true))
// since this is a single discrete click, not a continuous typing/dragging session. updateAll(true)
// already calls updateEditingUI()->updateTextFontCapabilityUI() internally, which both re-shows the
// correct field and (via syncLetterHeightFromHeight()) refreshes #letterHeight's displayed value.
el('heightModeToggleBtn').addEventListener('click',()=>{
  const l=selectedLayer();
  if(!l||l.type!=='text')return;
  commitHistory();
  l.heightMode=l.heightMode==='capHeight'?'raw':'capHeight';
  updateAll(true);
});
// RS-3011 Step 7: one-time gate release -- once pressed, stonesGenerated flips to true and this
// layer regenerates live on every subsequent edit forever after, exactly like any other path layer
// (no code re-suppresses it). Mirrors onPaintStroke()'s own commitHistory()/mutate/
// refreshStoneGroupForLayer/updateAll(true) sequence so Design's live preview and the main layout/
// stats both pick up the newly generated stones in the same call.
el('generateStonesBtn').addEventListener('click',async()=>{
  const l=selectedLayer();
  if(!l||l.type!=='path'||l.stonesGenerated!==false)return;
  commitHistory();
  l.stonesGenerated=true;
  drawingTool.refreshStoneGroupForLayer(l.id);
  await updateAll(true);
});
// READ-006: the one-shot letter-spacing solve (docs/specifications/READ-006-LetterSpacing.md §4, §5).
// NOT a HISTORY_TRACKED_CONTROL_IDS id -- it is a discrete action that commits its own history entry
// before mutating, exactly like #objectType's change listener (commitHistory() then mutate then
// updateAll()), never the continuous-session pattern. Contour mode takes ~2s (spec §2.1); the busy
// state is expected. Three outcomes per spec §4.2/§4.4: apply, refuse under Auto Fit, or never
// separated -- the last two write only the hint and leave l.letterSpacing/l.height untouched.
el('separateLettersBtn').addEventListener('click',async()=>{
  const l=selectedLayer();
  if(!l||l.type!=='text'||isAuthoredStoneFontId(l.font))return;
  const btn=el('separateLettersBtn'),hint=el('letterSpacingHint'),u=unitSuffix(project.units);
  const restore=()=>{btn.disabled=false;btn.textContent='Separate letters'};
  btn.disabled=true;btn.textContent='Separating…';hint.style.display='none';
  let res;
  try{
    // Matches the validated experiment (spec §4.1): generateTextLayout() directly, Auto Fit off,
    // the SAME permanentEngine. buildTextLayoutBaseParams() supplies text/font/provider/height/
    // stoneSize/gap/mode; solveLetterSpacingMm() overrides letterSpacingMm per ladder rung.
    const pitchMm=(l.stoneSize||0)+(l.gap||0);
    res=await solveLetterSpacingMm({engine:permanentEngine,layerParams:buildTextLayoutBaseParams(l),pitchMm});
  }catch(error){
    console.error('Separate letters failed',error);
    restore();
    hint.textContent='Could not work out a letter spacing for this text.';hint.style.display='block';
    return;
  }
  restore();
  // Outcome 3 (spec §4.4): no rung reached the 0.95 target. Apply nothing -- clamping to 4x pitch
  // and presenting it as a fix would be a false guarantee (2 of the 24 calibration cases hit this).
  if(!res.separationAchieved){
    hint.textContent='These letters can’t be separated at this text height and font. Try a taller text height, a different font, or a smaller stone size.';
    hint.style.display='block';
    return;
  }
  const zeroWidthMm=res.untrackedWidthMm;
  const trackedWidthMm=res.widthMm;
  const spacingText=`${formatLengthDisplay(res.letterSpacingMm,project.units,2)} ${u}`;
  // Outcome 2 (spec §4.2): with Auto Fit on, the solved spacing would push the measured width past
  // canvas.width - 10. Auto Fit converts that added width into lost height -- the very quantity
  // separation exists to protect -- so apply nothing and name the remedies that change the
  // comparison. Copy modelled on textTooLongDetailMessage().
  const widthLimitMm=project.canvas.width-10;
  if(res.letterSpacingMm>0&&l.autoFit&&trackedWidthMm!=null&&trackedWidthMm>widthLimitMm){
    const shortfallMm=trackedWidthMm-widthLimitMm;
    hint.textContent=`Separating the letters needs ${spacingText} of spacing, making this text ${formatLengthDisplay(trackedWidthMm,project.units,1)} ${u} wide -- ${formatLengthDisplay(shortfallMm,project.units,1)} ${u} more than fits with Auto Fit on. Turn Auto Fit off and shorten the text, or drop a stone size.`;
    hint.style.display='block';
    return;
  }
  // Outcome 1 (spec §4.4): solved and it fits. One undoable edit; the hint states the new spacing,
  // the new width, and the growth over the untracked (zero-spacing) width.
  commitHistory();
  l.letterSpacing=res.letterSpacingMm;
  await updateAll(true);
  setLengthField('letterSpacing',l.letterSpacing);
  const growthPct=(zeroWidthMm>0&&trackedWidthMm!=null)?((trackedWidthMm-zeroWidthMm)/zeroWidthMm*100):null;
  hint.textContent=`Letter spacing set to ${spacingText}. This text is now ${formatLengthDisplay(trackedWidthMm,project.units,1)} ${u} wide`+(growthPct!=null?`, ${growthPct>=0?'+':''}${growthPct.toFixed(0)}% over the untracked width.`:'.');
  hint.style.display='block';
});
// Auto Fit now defaults to Off for new layers (Text height reflects the actual rendered size), so
// switching it back On is a deliberate, easy-to-miss trade-off -- Auto Fit can shrink text below the
// height needed for reliable readability at the selected stone size. Surfaced every time the operator
// flips Off->On (registered before HISTORY_TRACKED_CONTROL_IDS' own generic listener on the same
// element/event below -- registration order -- so l.autoFit here still holds the pre-toggle value).
// Never shown for On->Off, nor for a layer that was already On before this edit (loaded from a saved
// project, or from switching selection -- syncSelectedControlsFromLayer() above always hides it first).
el('autoFit').addEventListener('input',()=>{
  const l=selectedLayer();
  const turningOn=el('autoFit').value==='on';
  el('autoFitOnHint').style.display=(l&&l.type==='text'&&!l.autoFit&&turningOn)?'block':'none';
});
const HISTORY_TRACKED_CONTROL_IDS=['projectName','text','font','height','stoneSize','gap','stoneColor','cupColor','autoFit','wrap','textMode','shapeX','shapeY','shapeW','shapeH','svgMode','shapeFillMode','regionFillMode','imageFillMode','curveEnabled','curveRadiusMm','curveDirection','curveStartAngleDeg','curveSweepAngleDeg','curveAlignment','imgThreshold','imgInvert','imgBlurRadius','imgMaxWidth','imgMaxHeight','textX','textY','textAlign','lineSpacing','letterSpacing','rotationDeg','shapeRotationDeg','shapeSides','shapePoints','shapeInnerRadius','shapeRingInner','plateOuterDiameter','plateInnerWellDiameter','plateOverallHeight','plateCenterDepth','plateColor','plateDesignTarget','vesselBodyDiameter','vesselBodyHeight','vesselTopDiameter','sizeMode','mixedAllowedSs6','mixedAllowedSs10','mixedAllowedSs16','mixedAllowedSs20','mixedAllowedSs30','mixedMinSize','mixedMaxSize','conservativeDetail'];
for(const id of HISTORY_TRACKED_CONTROL_IDS){el(id).addEventListener('input',()=>{openHistorySession();updateAll()});el(id).addEventListener('change',()=>closeHistorySession())}
for(const id of ['rotation','zoom'])el(id).addEventListener('input',()=>updateAll());
// RS-2002: Browse Fonts panel wiring. Toggling/closing never touches history (it only decides
// which fontId #font's native 'input'/'change' events -- wired above via HISTORY_TRACKED_CONTROL_IDS
// -- will fire for); only pickFont()'s dispatched events do.
el('fontLibraryBtn').addEventListener('click',()=>{if(el('fontLibraryPanel').hidden)openFontLibraryPanel();else closeFontLibraryPanel()});
el('fontSearch').addEventListener('input',()=>{fontSearchQuery=el('fontSearch').value;renderFontLibraryList()});
el('fontCategoryFilter').addEventListener('change',()=>{fontCategoryFilterValue=el('fontCategoryFilter').value;renderFontLibraryList()});
el('fontLibraryList').addEventListener('click',e=>{const favBtn=e.target.closest('[data-fav-font]');if(favBtn){toggleFavoriteFont(favBtn.dataset.favFont);return}const pickBtn=e.target.closest('[data-pick-font]');if(pickBtn)pickFont(pickBtn.dataset.pickFont)});
// FONT-LIB-002: choosing a weight/style from a family row's inline <select> applies it exactly like
// clicking the row's name -- pickFont() replays #font's input+change and closes the panel.
el('fontLibraryList').addEventListener('change',e=>{const styleSel=e.target.closest('[data-style-select]');if(styleSel)pickFont(styleSel.value)});
// TXT-101A: "Recently Used" also tracks picks made directly from the native <select> (not just the
// Browse Fonts panel) -- a second, independent listener on the same 'change' event
// HISTORY_TRACKED_CONTROL_IDS already listens to above, not a replacement for it.
el('font').addEventListener('change',()=>recordRecentFont(el('font').value));
el('selectedLayer').addEventListener('change',()=>{selectedLayerId=el('selectedLayer').value;selectedLayerIds=selectOnly(selectedLayerId);syncSelectedControlsFromLayer();updateAll(true)});
// RS-1004: switching the object template is one discrete, undoable action (matching addCircle/
// addRect/deleteLayer's commitHistory()-then-mutate pattern below), not a continuous-session field
// -- it also resets project.canvas/project.wrap to the new template's own defaults, so those two
// resets are always committed together with the switch, never independently.
el('objectType').addEventListener('change',()=>{commitHistory();const template=getObjectTemplate(el('objectType').value);project.product=template.id;project.wrap=template.wrap.default;
  // RS-2010: switching to a Mug/Tumbler/Bottle resets project.vessel to that product's own
  // defaults and derives project.canvas from them (circumference/printable height) -- the vessel
  // counterpart of the plate reset just below. Falls back to the plain template preset for 'plate'
  // (project.canvas is set again, differently, by the plate branch immediately below).
  if(VESSEL_PRODUCT_IDS.includes(template.id)){project.vessel=getVesselDefaults(template.id);project.canvas=computeCanvasFromVessel(project.vessel)}else{project.canvas={width:template.productionWidthMm,height:template.productionHeightMm}}
  // S-112: switching to the Round Dinner Plate also resets project.plate to the JSON's own
  // defaults (mirroring how project.canvas/project.wrap already reset above) and seeds
  // project.cupColor from the plate's default color id so the Object Preview immediately shows
  // the approved White, not whatever cupColor the previous template left behind.
  if(template.id==='plate'){project.plate=getPlateDefaults();project.cupColor=getPlateColor(project.plate.colorId).hex}
  syncSelectedControlsFromLayer();updateAll(true)});el('layersList').addEventListener('click',e=>{const row=e.target.closest('.layer');if(!row)return;const id=row.dataset.layer,action=e.target.dataset.action;
  // RS-3013 Step 5 follow-up: a selected REGION (drawingTool.activeSelection) is Design-canvas-local
  // state that must be cleared here too whenever this row click actually MOVES the selection --
  // matching performClickDispatch()'s own `if(activeSelection) setActiveSelection(null);` precedent
  // for a canvas shape-click -- but NOT on every row click regardless of what it does; scoped per
  // action below rather than once at the top, since the four actions differ in whether they touch
  // selection at all:
  // - 'visible': never reassigns selectedLayerId/selectedLayerIds (a checkbox toggle on ANY row,
  //   related or not, is orthogonal to what's selected) -- no clear.
  // - 'duplicate': duplicateLayer(id) always reassigns selectedLayerId to the new copy, regardless of
  //   which row's icon was clicked -- clear unconditionally, mirroring that unconditional reassign.
  // - 'delete': deleteLayer(id) actually reassigns selectedLayerId unconditionally on every call
  //   (to project.layers[0].id, regardless of which id was removed) -- but that reassignment is an
  //   orthogonal, pre-existing quirk of deleteLayer() itself (unrelated to regions, unchanged by this
  //   fix) and never overrides an active region selection anyway, since the region branch at the top
  //   of syncSelectedControlsFromLayer()/writeSelectedControlsToLayer() always outranks
  //   selectedLayerId when drawingTool.activeSelection is still set. What actually matters here is
  //   only the REGION's own layer identity: clear only when the deleted id is the SAME layer the
  //   active region belongs to (drawingTool.activeSelection?.layerId===id) -- deleting a truly
  //   unrelated row leaves that region's own layer, and therefore its selection, untouched.
  // - plain click / Shift-click (the fallthrough below): always reassigns selectedLayerId/
  //   selectedLayerIds to the clicked row -- clear unconditionally, the original reported gap.
  if(action==='visible'){const l=project.layers.find(x=>x.id===id);commitHistory();l.visible=e.target.checked;updateAll(true);return}
  if(action==='duplicate'){if(drawingTool.activeSelection)drawingTool.clearActiveSelection();duplicateLayer(id);return}
  if(action==='delete'){if(drawingTool.activeSelection&&drawingTool.activeSelection.layerId===id)drawingTool.clearActiveSelection();deleteLayer(id);return}
  if(drawingTool.activeSelection)drawingTool.clearActiveSelection();
  // RS-1009: Shift-click toggles a layer row in the multi-selection, the same shared toggle a
  // canvas Shift-click uses (src/editing/Selection.js) -- a plain click still selects only that
  // one layer, preserving pre-existing single-selection behavior.
  if(e.shiftKey){selectedLayerIds=toggleSelection(selectedLayerIds,id);if(selectedLayerIds.has(id))selectedLayerId=id;else if(selectedLayerIds.size)selectedLayerId=[...selectedLayerIds][selectedLayerIds.size-1]}else{selectedLayerIds=selectOnly(id);selectedLayerId=id}
  syncSelectedControlsFromLayer();updateEditingUI();updateAll(true)});el('deleteSelected').onclick=()=>deleteLayer(selectedLayerId);document.querySelectorAll('.viewBtn').forEach(b=>b.onclick=()=>{rotation=parseFloat(b.dataset.view);el('rotation').value=rotation;updateAll()});el('resetView').onclick=()=>{rotation=0;zoom=1;el('rotation').value=0;el('zoom').value=100;preview3D.resetView();updateAll()};el('undoBtn').onclick=()=>performUndo();el('redoBtn').onclick=()=>performRedo();
// RS-1009: Align/Snap sidebar section. snapEnabled is view-only editor state (like rotation/zoom
// above) -- not part of `project`, not undo/redo-tracked, not exported.
el('centerTextOnObject').onclick=()=>centerSelectedTextOnObject();
// S-104: the workspace warning's own "Center Text" button -- same shared function, so it can only
// ever move x/y (never any other property), exactly like the Text Lightbox's Center on Object.
el('workspaceCenterTextBtn').onclick=()=>centerSelectedTextOnObject();
el('alignLeft').onclick=()=>runAlign('left');el('alignCenterH').onclick=()=>runAlign('centerH');el('alignRight').onclick=()=>runAlign('right');el('alignTop').onclick=()=>runAlign('top');el('alignCenterV').onclick=()=>runAlign('centerV');el('alignBottom').onclick=()=>runAlign('bottom');el('distributeH').onclick=()=>runDistribute('horizontal');el('distributeV').onclick=()=>runDistribute('vertical');el('snapEnabled').addEventListener('change',()=>{snapEnabled=el('snapEnabled').value==='on';el('status').textContent=snapEnabled?'Snap Enabled':'Snap Disabled'});
// RS-1012: Boolean Operations, in the Shapes Lightbox (see index.html's #booleanOpsSection).
el('boolUnion').onclick=()=>runBooleanOp('union');el('boolSubtract').onclick=()=>runBooleanOp('subtract');el('boolIntersect').onclick=()=>runBooleanOp('intersect');el('boolExclude').onclick=()=>runBooleanOp('xor');
// S-110: singleOtherSelectedLayer() looks at the selection as it stood *before* the layer about to
// be created is added -- exactly one other selected layer of the right type is what "initial
// automatic fitting" keys off of in both createShapeLayer()/addText() below.
function singleOtherSelectedLayer(){const ids=[...selectedLayerIds];if(ids.length!==1)return null;return project.layers.find(x=>x.id===ids[0])||null}
// S-110: circle's own hardcoded default radius (createShapeLayer() below) -- named here too so
// S-110A's referenceShapeLayer() never has to duplicate the literal.
const DEFAULT_CIRCLE_RADIUS_MM=18;
// S-110A (Smart Shape-to-Text Creation): a shape `kind` at its own canonical default proportions
// (SHAPE_DEFAULT_SIZES_MM, the exact same defaults createShapeLayer() itself uses when there is no
// text to size around), centered at the origin. This is a *reference* layer purely for measuring
// how that kind's largest-inscribed-rectangle-at-a-given-aspect-ratio scales with overall shape
// size -- resolveShapeLayerPolygonsForFitting() (and its Ring-inner-circle special case) is reused
// unchanged, so the "shape contains text" direction can never disagree with the existing "text fits
// shape" direction about what a shape's usable region is.
function referenceShapeLayer(kind){
  if(kind==='circle')return{id:'reference',type:'circle',cx:0,cy:0,r:DEFAULT_CIRCLE_RADIUS_MM};
  const{w,h}=SHAPE_DEFAULT_SIZES_MM[kind]||{w:60,h:60};
  return{id:'reference',type:kind,x:-w/2,y:-h/2,w,h,...defaultShapeExtraFields(kind)};
}
// S-110A: computes the smallest shape of `kind` (at its own canonical proportions) that fully
// contains textLayer's current *rendered* bounding box (getLayerBBox() -- the same single source of
// truth for a layer's mm extent every other editing feature already uses, so this reflects the
// text's true on-canvas size, including any S-107 auto-fit shrink already applied) plus one full
// stone-pitch of production margin on every side. The margin is stoneSize+gap -- the same physical
// pitch quantity that already governs stone spacing everywhere else -- not an arbitrary pixel value:
// it is the minimum gap needed so the shape's own outline stones don't crowd the text's outermost
// stones. Reuses computeContainingShapeScale() (src/geometry/ShapeFit.js) -- the exact inverse of
// the math fitTextToShape() already uses -- rather than a second fitting algorithm. Returns null
// when the text has no rendered extent yet (nothing to size a shape around).
function computeShapeAroundText(kind,textLayer){
  const textBBox=getLayerBBox(textLayer);
  if(!(textBBox.width>0)||!(textBBox.height>0))return null;
  const marginMm=(textLayer.stoneSize||0)+(textLayer.gap||0);
  const requiredWidthMm=textBBox.width+marginMm*2;
  const requiredHeightMm=textBBox.height+marginMm*2;
  const{polygons,boundingBox}=resolveShapeLayerPolygonsForFitting(referenceShapeLayer(kind));
  if(!boundingBox)return null;
  const fit=computeContainingShapeScale(polygons,boundingBox,requiredWidthMm,requiredHeightMm);
  if(!fit)return null;
  const centerXmm=textBBox.x+textBBox.width/2,centerYmm=textBBox.y+textBBox.height/2;
  if(kind==='circle'){
    const radiusMm=DEFAULT_CIRCLE_RADIUS_MM*fit.scale;
    return{widthMm:radiusMm*2,heightMm:radiusMm*2,centerXmm,centerYmm,cxMm:centerXmm,cyMm:centerYmm,radiusMm};
  }
  const{w,h}=SHAPE_DEFAULT_SIZES_MM[kind]||{w:60,h:60};
  const widthMm=w*fit.scale,heightMm=h*fit.scale;
  return{widthMm,heightMm,centerXmm,centerYmm,xMm:centerXmm-widthMm/2,yMm:centerYmm-heightMm/2};
}
// S-110A: whether a shape of the given centered size (as returned by computeShapeAroundText() above)
// sits completely within the current object template's printable area -- reusing
// getSafeAreaRectMm() (src/products/index.js), the same printable-area rectangle
// isTextOutsidePrintableArea()/drawSafeAreaGuide() already use, rather than a second notion of
// "printable". A full containment check (every edge inside the safe rect), not merely "smaller
// than" -- the shape is centered on the text's own current position, which may itself already sit
// off-center, so only the actual placed bounds can answer "fits completely inside".
function shapeAroundTextFitsPrintableArea(sized){
  const safe=getSafeAreaRectMm(currentObjectTemplate(),project.canvas.width,project.canvas.height);
  const halfW=sized.widthMm/2,halfH=sized.heightMm/2;
  const EPS=1e-6;
  return sized.centerXmm-halfW>=safe.xMm-EPS&&sized.centerXmm+halfW<=safe.xMm+safe.widthMm+EPS&&
    sized.centerYmm-halfH>=safe.yMm-EPS&&sized.centerYmm+halfH<=safe.yMm+safe.heightMm+EPS;
}
// S-110: Design Shapes' single, unified shape-creation function -- replaces the old separate
// addCircle/addRect click handlers (RS-2000's own commitHistory()-then-push-then-select pattern,
// preserved exactly) with one function for all 11 shapes. Circle keeps its historical cx/cy/r
// defaults byte-for-byte; every other kind gets a default x/y/w/h box (SHAPE_DEFAULT_SIZES_MM,
// centered on the same (105,45) point Circle/Rectangle's own pre-S-110 defaults already used) plus
// its own configurable extra fields (defaultShapeExtraFields()).
//
// S-110A: when exactly one other selected layer is an uncurved, fittable-compatible text layer,
// the new shape no longer always has the text fitted into it -- computeShapeAroundText() first
// asks "can a shape sized to contain this text, centered on it, still fit the printable area?". If
// yes, the shape is created at that size/position and the text is left completely untouched (font,
// stone size, gap, fill style, color, curve, position -- literally none of it is written), which is
// the "preserve the text whenever possible" requirement satisfied structurally, not by a special
// case. Only when the required shape would spill outside the printable area does this fall back to
// S-110's original behavior: a normal/default-size shape with the text fitted into it via
// fitTextToShape(), so the legibility floor and every other S-110 guarantee still apply unchanged.
async function createShapeLayer(kind,extraFieldsOverride={},displayLabelOverride=null){
  const l=selectedLayer();
  const other=singleOtherSelectedLayer();
  const fitPartnerText=(other&&other.type==='text'&&!other.curveEnabled&&FITTABLE_SHAPE_TYPES.has(kind))?other:null;
  let shapeAroundText=null,shapeAroundTextRejected=false;
  if(fitPartnerText){
    const sized=computeShapeAroundText(kind,fitPartnerText);
    if(sized&&shapeAroundTextFitsPrintableArea(sized))shapeAroundText=sized;
    else if(sized)shapeAroundTextRejected=true;
  }
  commitHistory();
  let layer;
  if(kind==='circle'){
    layer=shapeAroundText
      ?{id:'circle'+Date.now(),type:'circle',visible:true,cx:shapeAroundText.cxMm,cy:shapeAroundText.cyMm,r:shapeAroundText.radiusMm,stoneSize:l.stoneSize||2,gap:l.gap||.3,color:l.color||'gold',rotationDeg:0}
      :{id:'circle'+Date.now(),type:'circle',visible:true,cx:105,cy:45,r:DEFAULT_CIRCLE_RADIUS_MM,stoneSize:l.stoneSize||2,gap:l.gap||.3,color:l.color||'gold',rotationDeg:0};
  }else{
    const{w,h}=shapeAroundText?{w:shapeAroundText.widthMm,h:shapeAroundText.heightMm}:(SHAPE_DEFAULT_SIZES_MM[kind]||{w:60,h:60});
    const x=shapeAroundText?shapeAroundText.xMm:105-w/2,y=shapeAroundText?shapeAroundText.yMm:45-h/2;
    layer={id:kind+Date.now(),type:kind,visible:true,x,y,w,h,stoneSize:l.stoneSize||2,gap:l.gap||.3,color:l.color||'gold',rotationDeg:0,...defaultShapeExtraFields(kind),...extraFieldsOverride};
  }
  project.layers.push(layer);
  selectedLayerId=layer.id;selectedLayerIds=selectOnly(layer.id);
  let statusText=`Added ${displayLabelOverride||SHAPE_DISPLAY_LABELS[kind]||kind}`;
  if(shapeAroundText){
    statusText+=` sized around "${layerLabel(fitPartnerText)}" (text unchanged)`;
  }else if(fitPartnerText){
    const fallbackNote=shapeAroundTextRejected?` (a shape sized around "${layerLabel(fitPartnerText)}" would not fit the printable area, so it was created at the default size instead)`:'';
    const plan=await fitTextToShape(fitPartnerText,layer);
    if(plan.ok){applyTextFitPlan(fitPartnerText,plan);statusText+=`${fallbackNote} and fit "${layerLabel(fitPartnerText)}" inside it`}
    else statusText+=`${fallbackNote} (could not auto-fit "${layerLabel(fitPartnerText)}": ${plan.message})`;
  }
  syncSelectedControlsFromLayer();
  await updateAll(true);
  el('status').textContent=statusText;
}
// S-110: the Text Lightbox's "+ Add Text" button -- previously there was no way to create a second
// text layer at all (only Duplicate on the existing one), which left "create a shape, then create
// text" with no entry point. Mirrors createShapeLayer()'s exact pattern/defaults (matching
// defaultProject()'s own initial text layer's field set), including the same single-other-selected-
// layer auto-fit hook, symmetric to createShapeLayer()'s.
async function addText(){
  const l=selectedLayer();
  const other=singleOtherSelectedLayer();
  const fitPartnerShape=(other&&FITTABLE_SHAPE_TYPES.has(other.type))?other:null;
  commitHistory();
  // READ-008: born at exactly the MIN_HEIGHT_TO_STONE_RATIO floor for the inherited stone diameter,
  // never the old fixed 25 mm (which was below the floor for any stone >= ~1.6 mm).
  const inheritedStoneSize=l.stoneSize||2.8;
  const layer={id:'text'+Date.now(),type:'text',visible:true,text:'New Text',font:TEXT_ENGINE_FONT_IDS.has(l.font)?l.font:DEFAULT_TEXT_FONT_ID,height:inheritedStoneSize*MIN_HEIGHT_TO_STONE_RATIO,heightMode:'capHeight',textMode:'stroke',stoneSize:inheritedStoneSize,gap:l.gap||.3,color:l.color||'gold',autoFit:false,curveEnabled:false,curveRadiusMm:40,curveDirection:'outside',curveStartAngleDeg:0,curveSweepAngleDeg:180,curveAlignment:'center',align:'left',lineSpacing:1,rotationDeg:0,letterSpacing:0,x:0,y:0};
  project.layers.push(layer);
  selectedLayerId=layer.id;selectedLayerIds=selectOnly(layer.id);
  let statusText='Added text layer';
  if(fitPartnerShape){
    const plan=await fitTextToShape(layer,fitPartnerShape);
    if(plan.ok){applyTextFitPlan(layer,plan);statusText+=` and fit it inside "${layerLabel(fitPartnerShape)}"`}
    else statusText+=` (could not auto-fit inside "${layerLabel(fitPartnerShape)}": ${plan.message})`;
  }
  syncSelectedControlsFromLayer();
  await updateAll(true);
  el('status').textContent=statusText;
}
// S-110: Smart Text-to-Shape Fitting. A pure "compute a fit plan" function -- it never mutates
// textLayer itself (matching runBooleanOp()'s own "validate everything, only mutate on success"
// convention below); callers apply a successful plan via applyTextFitPlan(). Resolves shapeLayer's
// polygons via the same shapeLayerResolveParams()/resolveShapePolygons() call
// resolveLayerShapeSource() already uses for Boolean Operations, measures textLayer's current
// (unscaled) size via the same resolveTextPolygons() call generateTextStonesLive()/
// resolveLayerShapeSource()'s text branch already use, finds the largest inscribed rectangle of the
// text's own aspect ratio via ShapeFit.computeInscribedRect(), then the required scale via
// ShapeFit.computeShapeFitScale() -- reusing S-107's own MIN_HEIGHT_TO_STONE_RATIO legibility floor
// (READ-008: height / stone diameter, gap excluded) so the two features can never disagree on "how
// small is too small". Never
// touches font/stoneSize/gap/fillMode/color/curve fields, and never converts curved text to
// straight text (aborts instead, with a specific message).
async function fitTextToShape(textLayer,shapeLayer){
  if(textLayer.curveEnabled){
    return{ok:false,reason:'curved',message:'Curved text can’t be automatically fit to a shape — turn off Curved text first, or position it manually.'};
  }
  if(!FITTABLE_SHAPE_TYPES.has(shapeLayer.type)){
    return{ok:false,reason:'incompatible',message:`${SHAPE_DISPLAY_LABELS[shapeLayer.type]||layerLabel(shapeLayer)} doesn’t provide a predictable region for automatic text fitting — position text manually.`};
  }
  const{polygons,boundingBox}=resolveShapeLayerPolygonsForFitting(shapeLayer);
  if(!boundingBox){
    return{ok:false,reason:'empty-shape',message:`"${layerLabel(shapeLayer)}" has no usable area to fit text into.`};
  }
  if(!permanentEngine.canGenerateText||!textLayer.text||!isFontKnown(textLayer.font)){
    return{ok:false,reason:'empty-text',message:'This text layer has no content to fit.'};
  }
  const fontId=textLayer.font;
  // FONT-002: closes the audit-flagged gap (TXT-103A) where this call threw an *unhandled* error for
  // any Production Font -- GeometryEngine.resolveTextPolygons() explicitly rejects authored-stone-
  // center fonts (they have no vector outline to measure), and none of this function's three call
  // sites ever caught that. Rejected upfront here, mirroring the curveEnabled check above, and the
  // call itself is still wrapped in try/catch as defense-in-depth so this can never throw unhandled.
  if(isAuthoredStoneFontId(fontId)){
    return{ok:false,reason:'fixed-size',message:`"${layerLabel(textLayer)}" uses a Production Font, which is a fixed size and can’t be automatically fit to a shape — position it manually, or switch to a different font.`};
  }
  let measured;
  try{
    measured=await permanentEngine.resolveTextPolygons({text:textLayer.text,fontId,providerId:resolveFontProviderId(fontId),layerId:textLayer.id,heightMm:textLayer.height,curveEnabled:false});
  }catch(error){
    console.error('Fit Text to Shape: measuring text failed',error);
    return{ok:false,reason:'measure-failed',message:`Could not measure "${layerLabel(textLayer)}" to fit it: ${error.message}`};
  }
  if(!measured.boundingBox){
    return{ok:false,reason:'empty-text',message:'This text layer has no content to fit.'};
  }
  const aspectRatio=measured.boundingBox.widthMm/measured.boundingBox.heightMm;
  const inscribed=computeInscribedRect(polygons,boundingBox,aspectRatio);
  if(!inscribed||!(inscribed.widthMm>0)){
    return{ok:false,reason:'no-region',message:`"${layerLabel(shapeLayer)}" has no usable region to fit text into.`};
  }
  const scaleResult=computeShapeFitScale({
    currentHeightMm:textLayer.height,measuredWidthMm:measured.boundingBox.widthMm,measuredHeightMm:measured.boundingBox.heightMm,
    stoneSizeMm:textLayer.stoneSize||0,targetWidthMm:inscribed.widthMm,targetHeightMm:inscribed.heightMm,minHeightToStoneRatio:MIN_HEIGHT_TO_STONE_RATIO
  });
  if(!scaleResult.ok){
    return{ok:false,reason:'legibility',message:`This text can’t fit inside "${layerLabel(shapeLayer)}" at the current stone size and gap without becoming unreadable. Its previous size and position were kept. Try a smaller stone size/gap, shorter text, or a larger shape.`};
  }
  // MONO-005A: delegates to src/editing/TextPlacement.js's computeTextLayerPositionForTargetCenterMm()
  // -- the same "solve for x/y that lands the bbox center on a target point" identity this call site
  // already relied on inline (see that module's own doc comment for the algebra), now the single
  // shared source of truth instead of a second, independently-typed copy of it.
  const{xMm,yMm}=computeTextLayerPositionForTargetCenterMm({
    targetCenterXMm:inscribed.xMm+inscribed.widthMm/2,
    targetCenterYMm:inscribed.yMm+inscribed.heightMm/2,
    canvasWidthMm:project.canvas.width,
    canvasHeightMm:project.canvas.height
  });
  return{
    ok:true,
    heightMm:Math.max(1,textLayer.height*scaleResult.scale),
    xMm,
    yMm
  };
}
function applyTextFitPlan(textLayer,plan){textLayer.height=plan.heightMm;textLayer.x=plan.xMm;textLayer.y=plan.yMm}
// S-110: resolves a shape layer's polygons for FITTING purposes specifically -- identical to
// resolveLayerShapeSource()'s shape branch (shared shapeLayerResolveParams()), except for Ring: a
// donut's sensible "fit text into it" region is its inner opening (a monogram inside a ring is a
// common real-world design), not the annulus band the true two-contour geometry describes -- fit a
// rectangle centered on the *annulus's* bbox center and every candidate would sit inside the hole
// itself (the even-odd rule correctly treats the inner circle as excluded), so a Ring's fittable
// region is deliberately just its inner circle, treated as an ordinary filled disk. Boolean
// Operations (resolveLayerShapeSource()) are unaffected -- they still combine the real annulus.
function resolveShapeLayerPolygonsForFitting(shapeLayer){
  const{polygons,boundingBox}=permanentEngine.resolveShapePolygons(shapeLayerResolveParams(shapeLayer));
  if(shapeLayer.type==='ring'&&polygons.length===2){
    const innerPolygon=polygons[1];
    return{polygons:[innerPolygon],boundingBox:BoundingBox.fromPoints(innerPolygon)};
  }
  return{polygons,boundingBox};
}
// S-110: mirrors clearBooleanOpsError()/showBooleanOpsError()'s exact pattern below for the new
// Fit Text to Shape section's own validation message.
function showFitTextToShapeError(msg){el('fitTextToShapeValidation').textContent=msg}
function clearFitTextToShapeError(){el('fitTextToShapeValidation').textContent=''}
// The two currently-selected layers eligible for an explicit "Fit Text to Shape" click: exactly one
// text layer + one other (shape) layer, in either selection order.
function fitTextToShapeSelection(){
  const sel=[...selectedLayerIds].map(id=>project.layers.find(x=>x.id===id)).filter(Boolean);
  if(sel.length!==2)return null;
  const text=sel.find(x=>x.type==='text');
  const shape=sel.find(x=>x!==text);
  if(!text||!shape)return null;
  return{text,shape};
}
el('fitTextToShapeBtn').onclick=async()=>{
  const pair=fitTextToShapeSelection();
  if(!pair)return;
  clearFitTextToShapeError();
  const plan=await fitTextToShape(pair.text,pair.shape);
  if(!plan.ok){
    showFitTextToShapeError(plan.message);
    el('status').textContent=`Fit Text to Shape failed: ${plan.message}`;
    return;
  }
  commitHistory();
  applyTextFitPlan(pair.text,plan);
  syncSelectedControlsFromLayer();
  await updateAll(true);
  el('status').textContent=`Fit "${layerLabel(pair.text)}" to "${layerLabel(pair.shape)}"`;
};
el('shapeGrid').addEventListener('click',e=>{const btn=e.target.closest('[data-shape-kind]');if(!btn)return;createShapeLayer(btn.dataset.shapeKind)});
// RS-3027: "More shapes" popover on the Design toolbar's right rail -- a second, faster entry point
// to 10 of #shapeGrid's own shapes, via the exact same createShapeLayer(). Pentagon/Hexagon/Octagon
// share data-shape-kind="polygon" with a data-shape-sides preset + a data-shape-label status-text
// override, read generically here rather than three hardcoded id branches.
function closeMoreShapesPopover(){el('moreShapesPopover').hidden=true;el('railMoreShapesToggle').setAttribute('aria-expanded','false')}
function openMoreShapesPopover(){
  const rail=el('designToolRailRight');
  el('moreShapesPopover').hidden=false;
  el('railMoreShapesToggle').setAttribute('aria-expanded','true');
  el('moreShapesPopover').style.top=`${rail.offsetTop+rail.offsetHeight+8}px`;
}
el('railMoreShapesToggle').addEventListener('click',e=>{
  e.stopPropagation();
  if(el('moreShapesPopover').hidden)openMoreShapesPopover();else closeMoreShapesPopover();
});
el('moreShapesPopover').addEventListener('click',e=>{
  const btn=e.target.closest('[data-shape-kind]');
  if(!btn)return;
  const extraFields=btn.dataset.shapeSides?{sides:parseInt(btn.dataset.shapeSides,10)}:{};
  createShapeLayer(btn.dataset.shapeKind,extraFields,btn.dataset.shapeLabel||null);
  // RS-3032 Step A supersedes the RS-3031 workaround here: Design's own canvas now tracks/renders
  // every SHAPE_LIBRARY_KINDS layer directly (see syncFromProjectLayers()'s widened call site
  // above), so a shape created via this popover -- itself only ever reachable while Design is
  // active, since #designToolRailRight is hidden otherwise -- is already visible on Design's own
  // canvas without leaving it. Forcing revealDualWorkspaceForLightbox()'s exit-to-Dual-Workspace
  // here would just needlessly kick the operator out of Design mode for a shape that no longer
  // needs it.
  closeMoreShapesPopover();
});
document.addEventListener('mousedown',e=>{
  if(el('moreShapesPopover').hidden)return;
  if(e.target.closest('#moreShapesPopover, #railMoreShapesToggle'))return;
  closeMoreShapesPopover();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!el('moreShapesPopover').hidden)closeMoreShapesPopover();
});
el('addTextBtn').onclick=()=>addText();
el('importProject').onclick=()=>el('importProjectFile').click();
el('importProjectFile').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;
  // UI-001B fix: the Import Lightbox is a full-viewport overlay (position:fixed;inset:0), so it
  // covers #status (in the left panel) the whole time this dialog is open -- writing only to
  // #status left both success and failure completely invisible to the user while the modal was up,
  // which is what made Project Import look broken. #importProjectValidation already existed in the
  // markup for exactly this (built by UI-001, never wired up); this handler now writes into it too.
  const validationEl=el('importProjectValidation');validationEl.textContent='';validationEl.style.display='none';
  try{const parsed=validateProject(JSON.parse(await file.text()));project=parsed;selectedLayerId=project.layers[0].id;selectedLayerIds=selectOnly(selectedLayerId);
  // RS-1002: loading a project is a fresh start, not an undoable edit -- clear history entirely
  // (matches "history cleared on project load") and reset the dirty baseline to this load.
  history.clear();cleanProjectJson=JSON.stringify(project);
  // RC-005: loading a project (Import/Open, Design Library "New Project", Gallery "Open as copy")
  // is a fresh start -- immediately re-baseline the autosave slot to this project so a crash right
  // after loading still recovers *this* project, not stale content from before it loaded. Also
  // guards "never overwrite a manually saved/opened project": invalidating
  // lastAutosavedProjectJson first forces flushAutosaveNow() to actually write (it no-ops when the
  // live project already matches what's stored), so the old record is always replaced here, never
  // left to linger and get offered as a stale "recovery" on some later boot.
  lastAutosavedProjectJson=null;flushAutosaveNow();
  // RC-003: close the Import Lightbox *before* syncing selection controls -- syncSelectedControlsFromLayer()'s
  // S-105-follow-up auto-switch (see its own comment) treats a still-open activeFieldLightbox as "the operator
  // is mid-edit with a type-specific Lightbox open", and a fresh whole-project replacement is not that. Closing
  // first clears activeFieldLightbox so the auto-switch is a no-op here, regardless of the imported first layer's type.
  lightboxes.importBox.close();
  refreshUnitLabels();refreshAllFieldSteps();syncSelectedControlsFromLayer();await updateAll(true);el('status').textContent=`Imported ${file.name}: ${project.layers.length} layer(s)`}catch(error){console.error('Project import failed',error);el('status').textContent=`Import failed: ${error.message}`;validationEl.textContent=`Import failed: ${error.message} The current project was left untouched.`;validationEl.style.display='block'}});
el('importSvg').onclick=()=>el('importSvgFile').click();
// RS-1001: parseSvgDocument() here only validates/measures the file (naturalWidthMm/heightMm,
// shape count, warnings) — it invents no stone positions, so this direct src/svg call does not
// violate "only the Geometry Engine generates stone positions". Actual stone generation for the
// new layer still runs through generate() -> generateSvgStonesLive() -> permanentEngine.generateSvgLayout().
el('importSvgFile').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{const svgSource=await file.text();const parsed=parseSvgDocument(svgSource);const maxW=project.canvas.width-20,maxH=project.canvas.height-20;let w=parsed.naturalWidthMm,h=parsed.naturalHeightMm;if(w>maxW||h>maxH){const s=Math.min(maxW/w,maxH/h);w*=s;h*=s}const x=(project.canvas.width-w)/2,y=(project.canvas.height-h)/2;const base=selectedLayer();const layer={id:'svg'+Date.now(),type:'svg',visible:true,svgSource,svgName:file.name,x,y,w,h,mode:'outline',stoneSize:base.stoneSize||2,gap:base.gap||.3,color:base.color||'gold',rotationDeg:0};commitHistory();project.layers.push(layer);selectedLayerId=layer.id;selectedLayerIds=selectOnly(layer.id);syncSelectedControlsFromLayer();await updateAll(true);const warningNote=parsed.warnings.length?` (${parsed.warnings.length} element(s) skipped, see console)`:'';if(parsed.warnings.length)console.warn('SVG import warnings for',file.name,parsed.warnings);el('status').textContent=`Imported ${file.name}: ${parsed.shapes.length} shape(s)${warningNote}`}catch(error){console.error('SVG import failed',error);el('status').textContent=`SVG import failed: ${error.message}`}});
// RS-1008: Image Trace import. Unlike SVG import (which commits a layer directly on file select),
// this opens a "preview before commit" panel first -- the milestone brief's own required control --
// since threshold/invert/blur/resize meaningfully change the traced result and are worth seeing
// before adding a layer. pendingImageImport holds the decoded buffer + persisted data: URL +
// default placement between file-select and Import/Cancel; nothing is written to `project` until
// Import is clicked.
let pendingImageImport=null;
function computeDefaultImagePlacement(naturalWidthPx,naturalHeightPx){
  const PX_PER_MM=96/25.4; // CSS px/inch, the same fallback src/svg/** uses for unitless SVG sizing
  const maxW=project.canvas.width-20,maxH=project.canvas.height-20;
  let w=naturalWidthPx/PX_PER_MM,h=naturalHeightPx/PX_PER_MM;
  if(w>maxW||h>maxH){const s=Math.min(maxW/w,maxH/h);w*=s;h*=s}
  return{x:(project.canvas.width-w)/2,y:(project.canvas.height-h)/2,w,h}
}
function currentImagePreviewParams(){
  return{
    threshold:Math.max(0,Math.min(255,parseIntOr(el('imgPreviewThreshold').value,DEFAULT_IMAGE_THRESHOLD))),
    invert:el('imgPreviewInvert').value==='on',
    blurRadiusPx:Math.max(0,parseIntOr(el('imgPreviewBlur').value,0)),
    maxWidthPx:Math.max(8,parseIntOr(el('imgPreviewMaxWidth').value,DEFAULT_IMAGE_MAX_DIMENSION_PX)),
    maxHeightPx:Math.max(8,parseIntOr(el('imgPreviewMaxHeight').value,DEFAULT_IMAGE_MAX_DIMENSION_PX))
  }
}
// RS-1008A: recomputes the live density preview canvas (prepareImageField() -- src/image/**'s
// pure field-preparation only, never a re-decode) and an approximate stone count (via the real
// permanent engine's generateImageLayout(), the exact code path a real commit uses, with a
// throwaway 'preview' layerId). This stays fast enough to call on every slider 'input' event even
// at the full documented working resolution.
function updateImagePreview(){
  if(!pendingImageImport)return;
  const{threshold,invert,blurRadiusPx,maxWidthPx,maxHeightPx}=currentImagePreviewParams();
  const field=prepareImageField(pendingImageImport.buffer,{threshold,invert,blurRadiusPx,maxWidthPx,maxHeightPx});
  const canvas=el('imageImportPreviewCanvas');
  canvas.width=field.widthPx;canvas.height=field.heightPx;
  canvas.getContext('2d').putImageData(new ImageData(maskFieldToRgba(field),field.widthPx,field.heightPx),0,0);
  const base=selectedLayer();
  const{x,y,w,h}=pendingImageImport.placement;
  try{
    const result=permanentEngine.generateImageLayout({imageBuffer:pendingImageImport.buffer,layerId:'preview',xMm:x,yMm:y,widthMm:w,heightMm:h,stoneSizeMm:base.stoneSize||2,gapMm:base.gap||.3,color:base.color||'gold',threshold,invert,blurRadiusPx,maxWidthPx,maxHeightPx});
    el('imageImportStoneCount').textContent=`${result.count} stones (approx.)`;
  }catch(error){console.error('Image preview trace failed',error);el('imageImportStoneCount').textContent='—'}
}
el('importImage').onclick=()=>el('importImageFile').click();
el('importImageFile').addEventListener('change',async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  if(!isSupportedImageFile(file)){el('status').textContent='Image import failed: unsupported file type. Supported formats: PNG, JPG/JPEG, WebP.';return}
  try{
    const buffer=await decodeImageFileToBuffer(file);
    const dataUrl=await readFileAsDataUrl(file);
    imageBufferCache.set(dataUrl,buffer);
    pendingImageImport={buffer,dataUrl,fileName:file.name,naturalWidthPx:buffer.widthPx,naturalHeightPx:buffer.heightPx,placement:computeDefaultImagePlacement(buffer.widthPx,buffer.heightPx)};
    el('imgPreviewThreshold').value=DEFAULT_IMAGE_THRESHOLD;el('imgPreviewInvert').value='off';el('imgPreviewBlur').value=0;el('imgPreviewMaxWidth').value=DEFAULT_IMAGE_MAX_DIMENSION_PX;el('imgPreviewMaxHeight').value=DEFAULT_IMAGE_MAX_DIMENSION_PX;
    updateImagePreview();
    el('imageImportPanel').style.display='block';
    el('status').textContent=`Previewing ${file.name} (${buffer.widthPx}×${buffer.heightPx}px)`;
  }catch(error){console.error('Image import failed',error);el('status').textContent=`Image import failed: ${error.message}`}
});
for(const id of['imgPreviewThreshold','imgPreviewInvert','imgPreviewBlur','imgPreviewMaxWidth','imgPreviewMaxHeight'])el(id).addEventListener('input',updateImagePreview);
el('imageImportCancel').onclick=()=>{pendingImageImport=null;el('imageImportPanel').style.display='none';el('status').textContent='Image import cancelled'};
el('imageImportCommit').onclick=async()=>{
  if(!pendingImageImport)return;
  const{threshold,invert,blurRadiusPx,maxWidthPx,maxHeightPx}=currentImagePreviewParams();
  const base=selectedLayer();
  const{x,y,w,h}=pendingImageImport.placement;
  const layer={id:'image'+Date.now(),type:'image',visible:true,imageSrc:pendingImageImport.dataUrl,imageName:pendingImageImport.fileName,naturalWidthPx:pendingImageImport.naturalWidthPx,naturalHeightPx:pendingImageImport.naturalHeightPx,x,y,w,h,threshold,invert,blurRadiusPx,maxWidthPx,maxHeightPx,stoneSize:base.stoneSize||2,gap:base.gap||.3,color:base.color||'gold',rotationDeg:0};
  const importedName=layer.imageName;
  commitHistory();
  project.layers.push(layer);
  selectedLayerId=layer.id;
  selectedLayerIds=selectOnly(layer.id);
  pendingImageImport=null;
  el('imageImportPanel').style.display='none';
  syncSelectedControlsFromLayer();
  await updateAll(true);
  el('status').textContent=`Imported ${importedName}`;
};
el('exportProject').onclick=()=>{try{download('rhinestone-project.json','application/json',JSON.stringify(project,null,2));cleanProjectJson=JSON.stringify(project);updateHistoryUI();
  // RC-005: a manual Save/Export is now the authoritative saved copy -- clear the autosave
  // recovery slot so a later refresh never reports "restored unsaved changes" for work that was
  // already safely exported. lastAutosavedProjectJson still tracks the live project (not stale)
  // so a further edit after this Save autosaves normally, same as always.
  try{autosave.clear()}catch{}
  lastAutosavedProjectJson=cleanProjectJson;
  if(autosaveTimer){clearTimeout(autosaveTimer);autosaveTimer=null}
  }catch(error){el('status').textContent=`Export failed: ${error.message}`}};
el('exportLayout').onclick=()=>{if(!layout){el('status').textContent='Export failed: layout is not ready yet.';return}try{download('rhinestone-generated-layout.json','application/json',JSON.stringify(layout,null,2))}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
el('exportSVG').onclick=()=>{if(!layout){el('status').textContent='Export failed: layout is not ready yet.';return}try{download('rhinestone-layout.svg','image/svg+xml',stoneLayoutToSvg(layout,{widthMm:project.canvas.width,heightMm:project.canvas.height}))}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
el('exportPNG').onclick=()=>{if(!layout){el('status').textContent='Export failed: layout is not ready yet.';return}try{exportCanvas('rhinestone-layout.png',layoutCanvas)}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
el('exportCup').onclick=()=>{if(!layout){el('status').textContent='Export failed: layout is not ready yet.';return}try{exportCanvas('rhinestone-cup-preview.png',cupCanvas)}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
el('exportCombined').onclick=()=>{if(!layout){el('status').textContent='Export failed: layout is not ready yet.';return}try{exportCanvas('rhinestone-combined-preview.png',composeCombinedPreviewCanvas())}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
// RS-1005: Production Sheet export. Page size/margin/mirror/registration-marks are view/export-
// only options (like rotation/zoom) -- read live from their controls at click time, not part of
// `project`, not undo/redo-tracked. gapMm is collected from every currently visible layer (the one
// piece of header metadata Stone itself never carries -- see
// docs/specifications/RS-1005-ProductionSheetGenerator.md, "Current Repository State").
// S-112: adds five plate-only header fields (undefined/absent for every other template, matching
// ProductionSheetExporter.js's existing "plain caller-supplied options, label + '—' fallback"
// pattern for Gap/Crystal color) -- see docs/specifications/RS-1005-ProductionSheetGenerator.md for
// this function's pre-existing fields and docs/specifications/S-112-RoundDinnerPlate.md for the
// plate-specific additions.
function currentProductionSheetOptions(){const t=currentObjectTemplate(),isPlate=t.preview.kind==='plate';const plateFields=isPlate?{plateDesignTarget:getPlateDesignTargetMeta(project.plate.designTarget).name,plateOuterDiameterMm:project.plate.outerDiameterMm,plateInnerWellDiameterMm:project.plate.innerWellDiameterMm,plateRimWidthMm:computeRimWidthMm(project.plate.outerDiameterMm,project.plate.innerWellDiameterMm),plateOverallHeightMm:project.plate.overallHeightMm,plateWeightGrams:PLATE_ROUND_DINNER_DEFINITION.weightGrams.average,plateColorName:getPlateColor(project.plate.colorId).name}:{};return{projectName:project.name,objectType:t.displayName,productionWidthMm:project.canvas.width,productionHeightMm:project.canvas.height,gapMm:[...new Set(project.layers.filter(l=>l.visible).map(l=>l.gap))],pageSize:el('prodSheetPageSize').value,marginMm:readLengthField('prodSheetMargin')||0,mirror:el('prodSheetMirror').value==='on',registrationMarks:el('prodSheetRegMarks').value==='on',units:project.units,...plateFields}}
el('exportProdSheetSVG').onclick=()=>{if(!layout){el('status').textContent='Export failed: layout is not ready yet.';return}try{download('rhinestone-production-sheet.svg','image/svg+xml',productionSheetToSvg(layout,currentProductionSheetOptions()))}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
el('exportProdSheetPDF').onclick=()=>{if(!layout){el('status').textContent='Export failed: layout is not ready yet.';return}try{download('rhinestone-production-sheet.pdf','application/pdf',productionSheetToPdf(layout,currentProductionSheetOptions()))}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
// PNG has no dedicated src/export/** module (matching #exportPNG/#exportCup's existing "capture,
// not a standalone exporter" precedent): it rasterizes the already-generated production-sheet SVG
// via an offscreen Image+canvas at a fixed PRODUCTION_SHEET_PNG_DPI, so the raster's pixel
// dimensions are always an undistorted multiple of the page's mm size -- never fit-to-viewport
// scaled the way the on-screen 2D canvas is.
el('exportProdSheetPNG').onclick=async()=>{if(!layout){el('status').textContent='Export failed: layout is not ready yet.';return}try{
  const options=currentProductionSheetOptions();
  const svgMarkup=productionSheetToSvg(layout,options);
  const{pageWidthMm,pageHeightMm}=computeProductionSheetLayout(layout,options);
  const pxPerMm=PRODUCTION_SHEET_PNG_DPI/25.4;
  const c=document.createElement('canvas');c.width=Math.round(pageWidthMm*pxPerMm);c.height=Math.round(pageHeightMm*pxPerMm);
  const svgUrl=URL.createObjectURL(new Blob([svgMarkup],{type:'image/svg+xml'}));
  const img=new Image();
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Failed to rasterize the production sheet SVG'));img.src=svgUrl});
  const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);
  URL.revokeObjectURL(svgUrl);
  exportCanvas('rhinestone-production-sheet.png',c)
}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
// RS-1006: the previous custom pointerdown/pointermove drag-to-rotate handler on cupCanvas is
// removed here -- OrbitControls (inside src/preview3d/Preview3DRenderer.js) now owns pointer
// interaction on that canvas natively, and does strictly more (rotate, zoom, and pan, with
// damping) without fighting over the same pointer events.
window.addEventListener('resize',()=>updateAll(true));

// ============================================================================
// UI-001 (Complete Application Redesign): top menu / Lightbox / workspace-tab /
// inspector orchestration. Pure UI wiring only -- no project/geometry/history/export logic is
// added or changed below; every function here only opens/closes dialogs, toggles a display:none,
// or calls an existing function (performUndo/performRedo/duplicateLayer/deleteLayer/click()).
// See docs/specifications/UI-001-CompleteRedesign.md.
// ============================================================================

// ---- Shared field-group relocation: one physical DOM node per field (sharedPositionFields =
// shapeX/Y/W/H, sharedStoneFields = stoneSize/gap/stoneColor+swatch), moved via appendChild
// (preserves bound listeners) between the right inspector's "home" slot and whichever Lightbox
// that needs the same field is currently open -- never a duplicate id, never a second live copy
// that could disagree with the first. ----
const FIELD_GROUPS={
  position:{field:'sharedPositionFields',home:'inspectorPositionSlot',lightboxSlots:{shapes:'shapesPositionSlot',import:'importPositionSlot',imagetrace:'imageTracePositionSlot'}},
  // RS-3011 Step 3a: designSlot is a second fallback destination, checked only for this group --
  // Position/Mixed Size stay Inspector/Lightbox-only, matching the milestone's stated scope
  // (stoneSize/gap/color only, "still whole-shape, not sub-region").
  stone:{field:'sharedStoneFields',home:'inspectorStoneSlot',lightboxSlots:{text:'textStoneSlot',shapes:'shapesStoneSlot',import:'importStoneSlot',imagetrace:'imageTraceStoneSlot'},designSlot:'designStoneSlot'},
  // S-200: Mixed Stone Size -- same relocation shape as `stone` above (applies to every layer type).
  mixedSize:{field:'sharedMixedSizeFields',home:'inspectorMixedSizeSlot',lightboxSlots:{text:'textMixedSizeSlot',shapes:'shapesMixedSizeSlot',import:'importMixedSizeSlot',imagetrace:'imageTraceMixedSizeSlot'}}
};
let activeFieldLightbox=null;
function relocateFieldGroups(){
  // RS-3011 Step 3a: while Design is active with exactly one 'path' (Design-drawn) layer selected,
  // the stone group's designSlot outranks its Inspector home -- but a Lightbox slot (if one happens
  // to be open) still outranks both, unchanged from the pre-existing precedence.
  const designStoneTarget=drawingTool.isActive&&selectedLayerIds.size===1&&selectedLayer().type==='path';
  for(const group of Object.values(FIELD_GROUPS)){
    const fieldEl=el(group.field);
    const destId=(activeFieldLightbox&&group.lightboxSlots[activeFieldLightbox])||(designStoneTarget&&group.designSlot)||group.home;
    const dest=el(destId);
    if(fieldEl&&dest&&fieldEl.parentElement!==dest)dest.appendChild(fieldEl);
  }
}
relocateFieldGroups();

// ---- Lightboxes ----
// S-105: the 11 named Lightboxes are `primary:true` (mutually exclusive -- opening one closes any
// other open primary Lightbox first, see src/ui/Lightbox.js and docs/specifications/
// S-105-PersistentMovableLightboxes.md). libraryConfirm/galleryPreview are transient sub-dialogs
// launched from within an already-open primary Lightbox and are deliberately left non-primary so
// they keep stacking on top of it exactly as before.
const lightboxes={
  text:new Lightbox('lightboxText',{primary:true,onOpen(){activeFieldLightbox='text';relocateFieldGroups()},onClose(){activeFieldLightbox=null;relocateFieldGroups();updateAll(true)}}),
  shapes:new Lightbox('lightboxShapes',{primary:true,onOpen(){activeFieldLightbox='shapes';relocateFieldGroups();updateObjectTemplateDetail()},onClose(){activeFieldLightbox=null;relocateFieldGroups();updateAll(true)}}),
  importBox:new Lightbox('lightboxImport',{primary:true,onOpen(){activeFieldLightbox='import';relocateFieldGroups()},onClose(){activeFieldLightbox=null;relocateFieldGroups();updateAll(true)}}),
  imagetrace:new Lightbox('lightboxImageTrace',{primary:true,onOpen(){activeFieldLightbox='imagetrace';relocateFieldGroups();updateImageTraceSections()},onClose(){activeFieldLightbox=null;relocateFieldGroups();updateAll(true)}}),
  exportBox:new Lightbox('lightboxExport',{primary:true}),
  prodSheet:new Lightbox('lightboxProdSheet',{primary:true}),
  shipping:new Lightbox('lightboxShipping',{primary:true,onOpen(){syncShippingFieldsFromState(project.units)}}),
  settings:new Lightbox('lightboxSettings',{primary:true,onOpen(){syncSettingsFieldsFromState()}}),
  help:new Lightbox('lightboxHelp',{primary:true}),
  gallery:new Lightbox('lightboxGallery',{primary:true,onOpen(){onGalleryOpen()}}),
  galleryPreview:new Lightbox('lightboxGalleryPreview'),
  // MONO-006: no shared field group participates in this Lightbox (Frame/Layout/Letters/Font/Stone
  // Size/Color/Frame Size all live in dedicated #monogram* controls, never the relocated
  // #stoneSize/#stoneColor/#font shared elements above), so it needs no relocateFieldGroups()
  // onOpen/onClose pair -- onOpen only needs to (re)populate its own option lists.
  monogram:new Lightbox('lightboxMonogram',{primary:true,onOpen(){onMonogramOpen()}})
};

// RS-topmenu-active-persist: highlighting the active top-menu section is a navigation-level
// concept owned by app.js, not a per-dialog open/close concern -- a Lightbox closing (X, Escape,
// backdrop, or a programmatic close after a successful action) does not mean the user has left
// that section, so Lightbox.js itself has no involvement in this at all (see src/ui/Lightbox.js).
const TOP_MENU_BUTTON_IDS=['menuText','menuShapes','menuMonogram','menuGallery','menuImport','menuImageTrace','menuExport','menuProdSheet','menuShipping','menuSettings','menuHelp'];
let activeTopMenuButtonId=null;
function setActiveTopMenuButton(id){
  if(activeTopMenuButtonId===id)return;
  if(activeTopMenuButtonId)el(activeTopMenuButtonId).setAttribute('aria-pressed','false');
  activeTopMenuButtonId=id;
  if(id)el(id).setAttribute('aria-pressed','true');
}

// RS-3011 nav-toggle fix: a Lightbox that opens over Design (or over a non-Dual workspace view)
// left the underlying view untouched -- Design has no Object Preview of its own, so a user
// opening Text/Shapes/Monogram/etc. from Design got no product preview behind the Lightbox at
// all. Reveal Dual Workspace first, through the exact same setWorkspaceMode('dual')+
// persistActiveView('dual') pair viewTabDual's own onclick below uses -- not a separate
// mechanism -- so a reload afterward lands back in Dual Workspace too. When Design is active,
// setDrawMode(false) (Design's own existing exit path, per DECISION 2 below -- opening one of
// these Lightboxes is now the only way to leave Design) must run first: setWorkspaceMode('dual')
// alone does not toggle drawingTool.isActive or hide Design's own rails, so skipping this would
// leave Design's rails and the Dual Workspace panels both visible at once. Design's own exit
// restores workspaceModeBeforeDrawing, not necessarily 'dual', so setWorkspaceMode('dual') still
// runs afterward if that restore landed anywhere else. Skipped entirely when Dual Workspace is
// already showing and Design isn't active (redundant no-op call).
function revealDualWorkspaceForLightbox(){
  const exitingDesign=drawingTool.isActive;
  if(exitingDesign)setDrawMode(false);
  if(exitingDesign||workspaceMode!=='dual'){
    if(workspaceMode!=='dual')setWorkspaceMode('dual');
    persistActiveView('dual');
  }
}
el('menuText').onclick=()=>{revealDualWorkspaceForLightbox();lightboxes.text.open();setActiveTopMenuButton('menuText')};
el('menuShapes').onclick=()=>{revealDualWorkspaceForLightbox();lightboxes.shapes.open();setActiveTopMenuButton('menuShapes')};
el('menuMonogram').onclick=()=>{revealDualWorkspaceForLightbox();lightboxes.monogram.open();setActiveTopMenuButton('menuMonogram')};
// S-103 (Product Scope Freeze): #menuGallery carries the native `disabled` attribute (see
// index.html), which makes the browser withhold click/Enter/Space activation and tab focus
// entirely -- this handler is wired the same as every other menu item and is deliberately left
// in place (Gallery code/tests/fixtures stay intact), it is just unreachable via the UI for now.
el('menuGallery').onclick=()=>{revealDualWorkspaceForLightbox();lightboxes.gallery.open();setActiveTopMenuButton('menuGallery')};
el('menuImport').onclick=()=>{revealDualWorkspaceForLightbox();lightboxes.importBox.open();setActiveTopMenuButton('menuImport')};
el('menuImageTrace').onclick=()=>{revealDualWorkspaceForLightbox();lightboxes.imagetrace.open();setActiveTopMenuButton('menuImageTrace')};
el('menuExport').onclick=()=>{revealDualWorkspaceForLightbox();lightboxes.exportBox.open();setActiveTopMenuButton('menuExport')};
el('exportShortcut').onclick=()=>{revealDualWorkspaceForLightbox();lightboxes.exportBox.open();setActiveTopMenuButton('menuExport')};
el('menuProdSheet').onclick=()=>{revealDualWorkspaceForLightbox();lightboxes.prodSheet.open();setActiveTopMenuButton('menuProdSheet')};
// Shipping/Settings/Help show no design/geometry content -- nothing behind them for Dual
// Workspace to usefully reveal, so these deliberately keep the old behavior.
el('menuShipping').onclick=()=>{lightboxes.shipping.open();setActiveTopMenuButton('menuShipping')};
el('menuSettings').onclick=()=>{lightboxes.settings.open();setActiveTopMenuButton('menuSettings')};
el('menuHelp').onclick=()=>{lightboxes.help.open();setActiveTopMenuButton('menuHelp')};

// S-105 follow-up: the layer-type -> Lightbox mapping used by both "More Options" (below) and
// syncSelectedControlsFromLayer()'s auto-switch (so a type-specific Lightbox left open across a
// different-type selection never goes empty, see docs/specifications/
// S-105-PersistentMovableLightboxes.md, "Follow-up: No Empty Lightbox on Selection Mismatch").
function lightboxForLayerType(t){
  if(t==='text')return lightboxes.text;
  if(t==='path'||SHAPE_LAYER_TYPES.has(t))return lightboxes.shapes;
  if(t==='svg')return lightboxes.importBox;
  if(t==='image')return lightboxes.imagetrace;
  return null;
}

// The right inspector's "More Options" opens the Lightbox that matches the selected layer's type.
el('moreOptionsBtn').onclick=()=>{
  const target=lightboxForLayerType(selectedLayer().type);
  if(target)target.open();
};

// ---- Monogram Lightbox (MONO-006) ----
// UI integration only: every control here is read at Generate-click time and handed to
// MonogramGenerator.generate() (constructed above as `monogramGenerator`). This section never
// computes geometry, layout, fitting, or collisions -- it only builds a request object, calls the
// generator, and (on success) inserts the returned ordinary layers through the exact same
// commitHistory()+project.layers.push() pattern insertLibraryItem() already uses, so undo/redo
// treats a generated monogram as a single step, same as inserting a Design Library item.
const MONOGRAM_LAYOUT_LABELS={
  [MONOGRAM_LAYOUTS.SINGLE]:'Single',
  [MONOGRAM_LAYOUTS.TWO_LETTER]:'Two Letter',
  [MONOGRAM_LAYOUTS.TRADITIONAL_THREE]:'Traditional Three',
  [MONOGRAM_LAYOUTS.EQUAL_THREE]:'Equal Three'
};
const MONOGRAM_FAILURE_MESSAGES={
  [MONOGRAM_GENERATOR_FAILURE_REASONS.INVALID_INPUT]:'Check the Monogram settings and try again.',
  [MONOGRAM_GENERATOR_FAILURE_REASONS.FRAME_NOT_FOUND]:'The selected frame is not available.',
  [MONOGRAM_GENERATOR_FAILURE_REASONS.LAYOUT_NOT_FOUND]:'The selected layout is not available.',
  [MONOGRAM_GENERATOR_FAILURE_REASONS.UNSUPPORTED_LETTER_COUNT]:'The number of letters does not match the selected layout.',
  [MONOGRAM_GENERATOR_FAILURE_REASONS.INVALID_FONT]:'The selected font cannot be used for Monogram generation. Choose a different production font.',
  [MONOGRAM_GENERATOR_FAILURE_REASONS.INTERNAL_CONTRACT_MISMATCH]:'Monogram generation failed unexpectedly. Please try again.'
};
// MONO-006C/MONO-006E: item 7 ("better fitting diagnostics") -- for the sizing/spacing failure
// reasons (the ones a user can actually correct by changing frame size or stone size), build a
// message naming the layout, frame size/shape, and stone size actually requested, plus a concrete
// corrective action, instead of the old generic "A letter overlaps the frame." `request` is the
// same object buildMonogramRequest() built for this generate() call (frameRect/stoneSizeMm/layoutId
// are exactly what was sent to the generator, so the message can never drift from what was actually
// tried). MONO-006E additionally reads `result.diagnostics` (MonogramGenerator's own per-letter
// fitting diagnostics) when present, to name the specific limiting letter and the exact room it
// needed versus what was available -- e.g. "the 'A' letter needs at least 31.1×44.5mm ... but only
// 27.8×39.6mm is available there" -- rather than only a generic corrective suggestion. Every other
// reason (bad selection, internal error) keeps its static MONOGRAM_FAILURE_MESSAGES copy -- there is
// no frame/stone context that would make those more actionable.
function monogramFailureMessage(result,request){
  const R=MONOGRAM_GENERATOR_FAILURE_REASONS,reason=result&&result.reason;
  const frame=request&&listFrames().find(f=>f.id===request.frameId);
  const frameLabel=frame?frame.label:'the';
  const layoutLabel=request&&MONOGRAM_LAYOUT_LABELS[request.layoutId];
  const designText=layoutLabel?`This ${layoutLabel} monogram`:'This design';
  const frameSizeText=request&&Number.isFinite(request.frameRect?.widthMm)&&Number.isFinite(request.frameRect?.heightMm)
    ?`${request.frameRect.widthMm}×${request.frameRect.heightMm}mm`:'the current';
  const stoneSizeMatch=request&&findStoneSizeByDiameterMm(request.stoneSizeMm);
  const stoneSizeText=stoneSizeMatch?stoneSizeMatch.name:(request?`${request.stoneSizeMm}mm`:'the current');
  const diag=result&&result.diagnostics;
  const minLegalScale=diag&&diag.scaleAuthoredTextLayoutResult&&diag.scaleAuthoredTextLayoutResult.minimumLegalScale;
  let limitingFactorText='';
  if(diag&&typeof diag.letter==='string'&&Number.isFinite(diag.naturalWidthMm)&&Number.isFinite(diag.naturalHeightMm)
    &&Number.isFinite(diag.slotWidthMm)&&Number.isFinite(diag.slotHeightMm)&&Number.isFinite(minLegalScale)){
    const neededWMm=(diag.naturalWidthMm*minLegalScale).toFixed(1);
    const neededHMm=(diag.naturalHeightMm*minLegalScale).toFixed(1);
    limitingFactorText=` -- the "${diag.letter}" letter needs at least ${neededWMm}×${neededHMm}mm of room at legal production spacing, but only ${diag.slotWidthMm.toFixed(1)}×${diag.slotHeightMm.toFixed(1)}mm is available there`;
  }
  if(reason===R.FITTING_FAILED)return `${designText} cannot fit using ${stoneSizeText} stones inside a ${frameSizeText} ${frameLabel} frame because the required production spacing exceeds the available interior${limitingFactorText}. Increase the frame size, or choose a smaller stone size.`;
  if(reason===R.BELOW_MINIMUM_SCALE)return `${designText} cannot fit using ${stoneSizeText} stones inside a ${frameSizeText} ${frameLabel} frame${limitingFactorText}. Increase the frame size, or choose a smaller stone size.`;
  if(reason===R.LETTER_COLLISION)return `Two or more letters in this${layoutLabel?` ${layoutLabel}`:''} monogram would touch at ${stoneSizeText} spacing in a ${frameSizeText} ${frameLabel} frame. Increase the frame size, choose a different layout, or choose a smaller stone size.`;
  if(reason===R.FRAME_COLLISION)return `A letter would touch the frame in this${layoutLabel?` ${layoutLabel}`:''} monogram at ${stoneSizeText} spacing in a ${frameSizeText} ${frameLabel} frame. Increase the frame size, or choose a smaller stone size.`;
  // MONO-008: the generator's own message already names the frame/stone-width context -- no
  // request-specific data to add here, unlike the reasons above.
  if(reason===R.STONE_WIDTH_UNAVAILABLE)return result.message;
  return MONOGRAM_FAILURE_MESSAGES[reason]||'Monogram generation failed. Please check your settings and try again.';
}
// Frame choices come straight from FrameLibrary.listFrames() -- adding a frame there needs no
// change here, mirroring populateStoneSizeOptions()/populateStoneColorOptions()'s existing
// "index.html hardcodes no <option>, the catalog is the only source" convention.
function populateMonogramFrameOptions(){el('monogramFrame').innerHTML=listFrames().map(f=>`<option value="${f.id}">${escapeHtml(f.label)}</option>`).join('')}
function populateMonogramLayoutOptions(){el('monogramLayout').innerHTML=Object.values(MONOGRAM_LAYOUTS).map(id=>`<option value="${id}">${escapeHtml(MONOGRAM_LAYOUT_LABELS[id]||id)}</option>`).join('')}
// Authored (stoneCenters-based) fonts only, never OpenType/sampled fonts, per this milestone's own
// requirement -- MonogramGenerator only supports authored fonts (see its own "invalid-font"
// rejection), so this deliberately filters providerId==='rhinestone' directly rather than reusing
// productionFonts() (FONT-DECISION-001, then FONT-LIB-002, widened that shared helper to offer every
// enabled OpenType font in the ordinary #font picker, none of which MonogramGenerator can use). A dedicated
// #monogramFont select (not the shared #font element) so this Lightbox never participates in
// relocateFieldGroups().
function authoredProductionFonts(){return fontManager?fontManager.listFonts().filter(f=>f.providerId==='rhinestone'):[]}
function populateMonogramFontOptions(){if(!fontManager)return;el('monogramFont').innerHTML=groupFontsByCategory(authoredProductionFonts()).map(([role,fonts])=>`<optgroup label="${escapeHtml(fontCategoryLabel(role))}">${fonts.map(f=>`<option value="${f.id}">${escapeHtml(f.family)}</option>`).join('')}</optgroup>`).join('')}
function populateMonogramStoneSizeOptions(){el('monogramStoneSize').innerHTML=listStoneSizes().map(s=>`<option value="${s.diameterMm}">${escapeHtml(s.name)} — ${s.diameterMm.toFixed(1)} mm</option>`).join('')}
function updateMonogramColorSwatch(){const c=STONE_COLORS[el('monogramColor').value];el('monogramColorSwatch').style.background=c?c.previewColor:'transparent'}
// MONO-010: mirrors populateMonogramStoneSizeOptions()/populateStoneColorOptions()/
// updateMonogramColorSwatch() above verbatim, retargeted at the frame-specific selects.
function populateMonogramFrameStoneSizeOptions(){el('monogramFrameStoneSize').innerHTML=listStoneSizes().map(s=>`<option value="${s.diameterMm}">${escapeHtml(s.name)} — ${s.diameterMm.toFixed(1)} mm</option>`).join('')}
function updateMonogramFrameColorSwatch(){const c=STONE_COLORS[el('monogramFrameColor').value];el('monogramFrameColorSwatch').style.background=c?c.previewColor:'transparent'}
function updateMonogramFrameStoneControlsVisibility(){el('monogramFrameStoneFields').style.display=el('monogramFrameStoneToggle').checked?'':'none'}
// MONO-009: the frame's own generic scalingLimitsMm midpoint is a size that only ever coincidentally
// fits the current product's real printable area. For every product except Plate, default instead to
// that product's safe area (getSafeAreaRectMm) shrunk by the operator-configurable #monogramSizeMarginMm,
// clamped into the frame's hard scalingLimitsMm range. Plate is excluded: its safeAreaInsetMm is all-zero
// (safe area === the full square canvas), while Plate's true printable region is circular, not the
// square/rect this function reasons about -- a rect-based auto-fit would overshoot the real usable area
// and place a frame that overlaps the plate's edge, so Plate deliberately keeps the old generic-midpoint
// default rather than being given a wrong one.
function computeMonogramDefaultSizeMm(frame){
  const template=currentObjectTemplate();
  const limits=frame.scalingLimitsMm;
  if(template.preview.kind==='plate'){
    return{
      widthMm:Math.round((limits.minWidthMm+limits.maxWidthMm)/2),
      heightMm:Math.round((limits.minHeightMm+limits.maxHeightMm)/2)
    };
  }
  const marginMm=readLengthField('monogramSizeMarginMm')||0;
  const safe=getSafeAreaRectMm(template,project.canvas.width,project.canvas.height);
  const widthMm=Math.max(limits.minWidthMm,Math.min(limits.maxWidthMm,safe.widthMm-2*marginMm));
  const heightMm=Math.max(limits.minHeightMm,Math.min(limits.maxHeightMm,safe.heightMm-2*marginMm));
  return{widthMm,heightMm};
}
// Frame Size Width/Height bounds come from FrameLibrary's own scalingLimitsMm for the selected
// frame -- the same field this app already uses to bound vessel/plate dimensions. Only resets the
// current value when it falls outside the new frame's range, so switching frames back and forth
// never fights a value the user just typed. MONO-009: this conservative reuse-if-valid behavior is
// deliberately different from applyMonogramSizeMargin() below, which always reapplies the computed
// default -- see that function's own comment for why.
function updateMonogramFrameSizeBounds(){
  const frame=listFrames().find(f=>f.id===el('monogramFrame').value);
  if(!frame)return;
  const limits=frame.scalingLimitsMm;
  const widthInput=el('monogramWidth'),heightInput=el('monogramHeight');
  widthInput.min=String(mmToDisplayValue(limits.minWidthMm,project.units));widthInput.max=String(mmToDisplayValue(limits.maxWidthMm,project.units));
  heightInput.min=String(mmToDisplayValue(limits.minHeightMm,project.units));heightInput.max=String(mmToDisplayValue(limits.maxHeightMm,project.units));
  const currentW=readLengthField('monogramWidth'),currentH=readLengthField('monogramHeight');
  const defaultSize=computeMonogramDefaultSizeMm(frame);
  if(!Number.isFinite(currentW)||currentW<limits.minWidthMm||currentW>limits.maxWidthMm)setLengthField('monogramWidth',defaultSize.widthMm);
  if(!Number.isFinite(currentH)||currentH<limits.minHeightMm||currentH>limits.maxHeightMm)setLengthField('monogramHeight',defaultSize.heightMm);
  const suffix=unitSuffix(project.units);
  let hint=`${frame.label}: width ${mmToDisplayValue(limits.minWidthMm,project.units)}-${mmToDisplayValue(limits.maxWidthMm,project.units)}${suffix}, height ${mmToDisplayValue(limits.minHeightMm,project.units)}-${mmToDisplayValue(limits.maxHeightMm,project.units)}${suffix}.`;
  // MONO-009: Plate has no auto-fit default (see computeMonogramDefaultSizeMm()'s own comment for
  // why) -- the margin field is disabled and a note is appended here rather than shown via a
  // separate hint element, since this is the one place both the range text and this note are
  // already refreshed together (frame change, units change, boot, monogram open).
  const isPlate=currentObjectTemplate().preview.kind==='plate';
  el('monogramSizeMarginMm').disabled=isPlate;
  if(isPlate)hint+=' Auto-fit isn\'t available for Plate yet -- frame size defaults to this frame\'s own generic range.';
  el('monogramFrameSizeHint').textContent=hint;
}
// MONO-009: unlike updateMonogramFrameSizeBounds()'s conservative reuse-if-valid behavior on frame
// switch, editing the margin field always reapplies the computed size -- the margin field's entire
// purpose is "resize the frame," so silently doing nothing because a width was already typed would
// make the field appear broken.
function applyMonogramSizeMargin(){
  const frame=listFrames().find(f=>f.id===el('monogramFrame').value);
  if(!frame)return;
  const{widthMm,heightMm}=computeMonogramDefaultSizeMm(frame);
  setLengthField('monogramWidth',widthMm);
  setLengthField('monogramHeight',heightMm);
  updateMonogramGenerateButtonState();
}
// MONOGRAM_LAYOUT_LETTER_COUNTS is authoritative (MonogramLayouts.js) -- this only mirrors it into
// a visible hint and the input's maxlength; the same count is re-checked in
// validateMonogramControls() below before Generate is ever allowed to call the generator.
function updateMonogramLetterCountHint(){
  const count=MONOGRAM_LAYOUT_LETTER_COUNTS[el('monogramLayout').value];
  el('monogramLetterCountHint').textContent=count?`This layout uses exactly ${count} letter${count===1?'':'s'}.`:'';
  if(count)el('monogramLetters').maxLength=count;
}
function showMonogramValidation(message){const v=el('monogramValidation');v.textContent=message;v.style.display='block'}
function clearMonogramValidation(){const v=el('monogramValidation');v.textContent='';v.style.display='none'}
// UI-side validation (empty letters, wrong letter count, zero/blank frame size, no font selected)
// -- prevents impossible requests from ever reaching the generator, per this milestone's own
// requirement. MonogramGenerator.generate()'s own validation remains authoritative for everything
// else (frame/letter fitting, collisions) -- this function deliberately does not duplicate that.
function validateMonogramControls(){
  const frameId=el('monogramFrame').value;
  const layoutId=el('monogramLayout').value;
  const fontId=el('monogramFont').value;
  const lettersRaw=el('monogramLetters').value.trim();
  const widthMm=readLengthField('monogramWidth');
  const heightMm=readLengthField('monogramHeight');
  if(!frameId)return{ok:false,message:'Choose a frame.'};
  if(!layoutId)return{ok:false,message:'Choose a layout.'};
  if(!fontId)return{ok:false,message:'Choose a font. Only production fonts are offered here.'};
  if(lettersRaw.length===0)return{ok:false,message:'Enter at least one letter.'};
  const letters=Array.from(lettersRaw);
  const requiredCount=MONOGRAM_LAYOUT_LETTER_COUNTS[layoutId];
  if(requiredCount&&letters.length!==requiredCount)return{ok:false,message:`This layout requires exactly ${requiredCount} letter${requiredCount===1?'':'s'} (got ${letters.length}).`};
  if(!Number.isFinite(widthMm)||widthMm<=0||!Number.isFinite(heightMm)||heightMm<=0)return{ok:false,message:'Frame width and height must be greater than zero.'};
  return{ok:true,frameId,layoutId,fontId,letters,widthMm,heightMm};
}
function updateMonogramGenerateButtonState(){el('monogramGenerate').disabled=!validateMonogramControls().ok}
// request.frameRect centers the frame on the project's own canvas (the same coordinate space
// every other placed layer type -- circle/rectangle/svg/path/image -- already places its x/y/w/h
// in); request.canvasMm is project.canvas.width/height verbatim, required so the generator can
// compute each letter's real text-layer x/y under the canvas-centered placement contract (see
// MonogramGenerator.generate()'s own doc comment).
function buildMonogramRequest(validated){
  const stoneSizeMm=parseFloat(el('monogramStoneSize').value);
  const color=el('monogramColor').value;
  const frameRect={
    xMm:(project.canvas.width-validated.widthMm)/2,
    yMm:(project.canvas.height-validated.heightMm)/2,
    widthMm:validated.widthMm,
    heightMm:validated.heightMm
  };
  const canvasMm={widthMm:project.canvas.width,heightMm:project.canvas.height};
  // resolveFontProviderId() -- same call generateTextStonesLive() already makes for every ordinary
  // text layer -- so an authored font resolves through the real Rhinestone font provider, not the
  // OpenType one; omitting this made the real GeometryEngine mis-resolve authored fonts entirely.
  // MONO-008: #monogramFrameStyle is a UI-level concept (static options, not FrameLibrary-catalog-
  // driven), mapped here to the frameOptions MonogramGenerator actually understands. 'fill' maps to
  // {} -- zero behavior change from before this field existed.
  const frameStyle=el('monogramFrameStyle').value;
  const frameOptions=frameStyle==='outline-1'?{mode:'outline',stoneWidth:1}
    :frameStyle==='outline-2'?{mode:'outline',stoneWidth:2}
    :{};
  // MONO-010: only set when the toggle is checked -- unchecked must leave frameOptions exactly as
  // it was before this milestone (no stoneSizeMm/color keys at all), so the generator's own
  // frameOptions.stoneSizeMm ?? stoneSizeMm / frameOptions.color ?? resolvedColor fallbacks still
  // apply unchanged. This is the one place that makes "toggle off" byte-identical to pre-milestone
  // behavior.
  if(el('monogramFrameStoneToggle').checked){
    frameOptions.stoneSizeMm=parseFloat(el('monogramFrameStoneSize').value);
    frameOptions.color=el('monogramFrameColor').value;
  }
  return{frameId:validated.frameId,layoutId:validated.layoutId,letters:validated.letters,fontId:validated.fontId,providerId:resolveFontProviderId(validated.fontId),stoneSizeMm,color,frameRect,canvasMm,frameOptions};
}
// MONO-009: also refreshes frame-size bounds/default on open (out-of-range-only, same as a frame
// switch) so a product switched while the lightbox was closed gets a chance to apply its own
// safe-area default on next open, rather than only on frame-change/units-change/boot.
function onMonogramOpen(){clearMonogramValidation();updateMonogramFrameSizeBounds();updateMonogramGenerateButtonState()}
// MONO-011: UI-layer-only auto-shrink retry loop. MonogramGenerator.generate() keeps its "never
// auto-corrects" doctrine (see its own doc comment) -- this wrapper is the thing that decides to
// retry, and it only ever adjusts frameOptions.stoneSizeMm (never the shared letters' stoneSizeMm,
// never gap, never the frame rect). Only FRAME_COLLISION and STONE_WIDTH_UNAVAILABLE are frame-
// stone-pitch problems this can plausibly fix; every other failure reason (letter fitting/collision,
// bad input) is returned unchanged, exactly like calling generate() directly.
async function generateMonogramWithFrameAutoShrink(request){
  const R=MONOGRAM_GENERATOR_FAILURE_REASONS;
  const firstResult=await monogramGenerator.generate(request);
  if(firstResult.ok||(firstResult.reason!==R.FRAME_COLLISION&&firstResult.reason!==R.STONE_WIDTH_UNAVAILABLE)){
    return{result:firstResult,appliedFrameStoneSizeMm:null};
  }
  const requestedFrameStoneSizeMm=request.frameOptions&&request.frameOptions.stoneSizeMm;
  if(!Number.isFinite(requestedFrameStoneSizeMm))return{result:firstResult,appliedFrameStoneSizeMm:null};
  const candidates=listStoneSizes().map(s=>s.diameterMm).filter(d=>d<requestedFrameStoneSizeMm).sort((a,b)=>b-a);
  for(const candidate of candidates){
    const retryResult=await monogramGenerator.generate({...request,frameOptions:{...request.frameOptions,stoneSizeMm:candidate}});
    if(retryResult.ok)return{result:retryResult,appliedFrameStoneSizeMm:candidate};
    if(retryResult.reason!==R.FRAME_COLLISION&&retryResult.reason!==R.STONE_WIDTH_UNAVAILABLE){
      // A smaller frame stone introduced a different failure -- stop immediately rather than keep
      // shrinking, and report the ORIGINAL failure (its message names the size the user actually
      // chose, not an intermediate candidate they never asked for).
      return{result:firstResult,appliedFrameStoneSizeMm:null};
    }
  }
  return{result:firstResult,appliedFrameStoneSizeMm:null};
}
async function generateMonogram(){
  const validation=validateMonogramControls();
  if(!validation.ok){showMonogramValidation(validation.message);return}
  clearMonogramValidation();
  const request=buildMonogramRequest(validation);
  el('monogramGenerate').disabled=true;
  let result,appliedFrameStoneSizeMm;
  try{
    ({result,appliedFrameStoneSizeMm}=await generateMonogramWithFrameAutoShrink(request));
  }catch(error){
    console.error('Monogram generation failed',error);
    showMonogramValidation('Monogram generation failed. Please check your settings and try again.');
    updateMonogramGenerateButtonState();
    return;
  }
  if(!result.ok){
    showMonogramValidation(monogramFailureMessage(result,request));
    updateMonogramGenerateButtonState();
    return;
  }
  // Single undo step: one commitHistory() before pushing every generated layer, exactly like
  // insertLibraryItem() -- HistoryManager snapshots the whole project, so undo removes (and redo
  // restores) all of this monogram's layers together, never one layer at a time.
  commitHistory();
  project.layers.push(...result.layers);
  selectedLayerIds=selectMany(result.layers.map(l=>l.id));
  selectedLayerId=result.layers[result.layers.length-1].id;
  syncSelectedControlsFromLayer();
  updateAll(true);
  lightboxes.monogram.close();
  if(appliedFrameStoneSizeMm!=null){
    // MONO-010's boot-sync block (`el('monogramFrameStoneSize').value=el('monogramStoneSize').value`)
    // establishes the convention that this control reflects the frame stone size actually in use --
    // keep that true after an auto-shrink too, and always surface the adjustment to the user rather
    // than letting it happen silently (per MONO-011's own scope: never silent).
    el('monogramFrameStoneSize').value=String(appliedFrameStoneSizeMm);
    el('status').textContent=`Generated monogram (${result.layers.length} layer${result.layers.length===1?'':'s'}). Frame stones reduced to ${formatStoneSizeLabel(appliedFrameStoneSizeMm)} to fit.`;
  }else{
    el('status').textContent=`Generated monogram (${result.layers.length} layer${result.layers.length===1?'':'s'}).`;
  }
}
populateMonogramFrameOptions();populateMonogramLayoutOptions();populateMonogramStoneSizeOptions();populateStoneColorOptions('monogramColor');
populateMonogramFrameStoneSizeOptions();populateStoneColorOptions('monogramFrameColor');
// MONO-010: one-time initial sync only, mirroring updateMonogramFrameSizeBounds()'s (MONO-009)
// "never fight a value already set" precedent -- set the frame-specific selects to match the
// shared ones once at boot so first-time toggle-on doesn't jump to an arbitrary first-in-list
// default, then never resync automatically again (toggling off/on preserves whatever was set).
el('monogramFrameStoneSize').value=el('monogramStoneSize').value;
el('monogramFrameColor').value=el('monogramColor').value;
updateMonogramColorSwatch();updateMonogramFrameColorSwatch();updateMonogramFrameSizeBounds();updateMonogramLetterCountHint();
updateMonogramFrameStoneControlsVisibility();
if(fontManager)populateMonogramFontOptions();
el('monogramFrame').addEventListener('change',()=>{updateMonogramFrameSizeBounds();updateMonogramGenerateButtonState()});
el('monogramLayout').addEventListener('change',()=>{updateMonogramLetterCountHint();updateMonogramGenerateButtonState()});
el('monogramLetters').addEventListener('input',()=>updateMonogramGenerateButtonState());
el('monogramFont').addEventListener('change',()=>updateMonogramGenerateButtonState());
el('monogramColor').addEventListener('change',()=>{updateMonogramColorSwatch();updateMonogramGenerateButtonState()});
el('monogramWidth').addEventListener('input',()=>{stashTypedLengthField('monogramWidth');updateMonogramGenerateButtonState()});
el('monogramHeight').addEventListener('input',()=>{stashTypedLengthField('monogramHeight');updateMonogramGenerateButtonState()});
el('monogramSizeMarginMm').addEventListener('input',()=>{stashTypedLengthField('monogramSizeMarginMm');applyMonogramSizeMargin()});
el('monogramFrameStoneToggle').addEventListener('change',()=>{updateMonogramFrameStoneControlsVisibility();updateMonogramGenerateButtonState()});
el('monogramFrameColor').addEventListener('change',()=>updateMonogramFrameColorSwatch());
el('monogramGenerate').onclick=()=>generateMonogram();

// ---- Shapes Lightbox: Design Shapes / Object Templates tabs ----
function setShapesTab(tab){
  const isDesign=tab==='design';
  el('shapesTabDesign').classList.toggle('active',isDesign);el('shapesTabDesign').setAttribute('aria-selected',String(isDesign));
  el('shapesTabTemplates').classList.toggle('active',!isDesign);el('shapesTabTemplates').setAttribute('aria-selected',String(!isDesign));
  el('shapesPanelDesign').hidden=!isDesign;el('shapesPanelTemplates').hidden=isDesign;
}
el('shapesTabDesign').onclick=()=>setShapesTab('design');
el('shapesTabTemplates').onclick=()=>setShapesTab('templates');
function updateObjectTemplateDetail(){
  const t=currentObjectTemplate(),s=t.safeAreaInsetMm;
  const isPlate=t.preview.kind==='plate';
  const isVessel=VESSEL_PRODUCT_IDS.includes(t.id);
  const detailEl=el('objectTemplateDetail');
  const u=unitSuffix(project.units);
  if(detailEl)detailEl.textContent=`Production ${formatLengthDisplay(t.productionWidthMm,project.units,1)}×${formatLengthDisplay(t.productionHeightMm,project.units,1)}${u} · Safe area inset ${formatLengthDisplay(s.top,project.units,1)}/${formatLengthDisplay(s.right,project.units,1)}/${formatLengthDisplay(s.bottom,project.units,1)}/${formatLengthDisplay(s.left,project.units,1)}${u} · Default wrap: ${t.wrap.default}`;
  const summaryEl=el('projectTemplateSummary');
  if(summaryEl)summaryEl.textContent=`${t.displayName} · ${formatLengthDisplay(project.canvas.width,project.units,1)}×${formatLengthDisplay(project.canvas.height,project.units,1)}${u}`;
  // S-112: the plate-only dimension/design-target field group and the plate-only color swatch
  // (in place of the generic #cupColor preview-background swatch) are shown only while the Round
  // Dinner Plate template is active -- every other template's fields are unaffected.
  el('plateFields').style.display=isPlate?'block':'none';
  el('plateColorField').style.display=isPlate?'flex':'none';
  el('cupColorField').style.display=isPlate?'none':'flex';
  // S-112A: Wrap mode is a cylindrical-only concept (it sizes the Front View Frame band, which the
  // plate never draws -- see drawLayout()) -- hidden whenever the Round Dinner Plate is the active
  // template, unchanged for every other template.
  el('wrapField').style.display=isPlate?'none':'flex';
  if(isPlate){
    const rimWidthMm=computeRimWidthMm(project.plate.outerDiameterMm,project.plate.innerWellDiameterMm);
    const targetName=getPlateDesignTargetMeta(project.plate.designTarget).name;
    const plateDetailEl=el('plateDetail');
    if(plateDetailEl)plateDetailEl.textContent=`Rim width ${rimWidthMm.toFixed(1)}mm (derived) · Design target: ${targetName} · Approx. weight ${PLATE_ROUND_DINNER_DEFINITION.weightGrams.average} g (product information, read-only)`;
  }
  // RS-2010: the vessel-only Body Diameter/Body Height/Top Diameter field group, shown only while
  // a Mug/Tumbler/Bottle template is active. Top Diameter is hidden for the straight-wall tumbler
  // (topDiameterMm is forced equal to bodyDiameterMm -- not an independently adjustable field, see
  // VesselProductDefinition.js's normalizeVesselParams()). min/max/step are re-applied on every
  // switch since the three vessel products share this one field group but have different
  // commercial ranges (unlike the plate's single fixed range).
  el('vesselFields').style.display=isVessel?'block':'none';
  if(isVessel){
    const straightWall=t.id==='tumbler';
    el('vesselTopDiameterField').style.display=straightWall?'none':'block';
    for(const[fieldId,field]of[['vesselBodyDiameter','bodyDiameterMm'],['vesselBodyHeight','bodyHeightMm'],['vesselTopDiameter','topDiameterMm']]){
      const range=getVesselDimensionRange(t.id,field),input=el(fieldId);
      input.min=range.min;input.max=range.max;
    }
    const vesselDetailEl=el('vesselDetail');
    if(vesselDetailEl)vesselDetailEl.textContent=`Printable height ${project.vessel.printableHeightMm.toFixed(1)}mm (derived) · Circumference ${project.canvas.width.toFixed(1)}mm (product information, read-only)`;
  }
}

// ---- Import Lightbox: SVG Import / Project Import tabs ----
function setImportTab(tab){
  const isSvg=tab==='svg';
  el('importTabSvg').classList.toggle('active',isSvg);el('importTabSvg').setAttribute('aria-selected',String(isSvg));
  el('importTabProject').classList.toggle('active',!isSvg);el('importTabProject').setAttribute('aria-selected',String(!isSvg));
  el('importPanelSvg').hidden=!isSvg;el('importPanelProject').hidden=isSvg;
}
el('importTabSvg').onclick=()=>setImportTab('svg');
el('importTabProject').onclick=()=>setImportTab('project');

// ---- Image Trace Lightbox: "new trace" vs "edit selected image layer" sections. Reuses the
// pre-existing pendingImageImport state and imageImportCommit/imageImportCancel handlers verbatim
// -- these two listeners only decide which section of the same dialog is visible. ----
function updateImageTraceSections(){
  const isImageLayer=selectedLayer().type==='image'&&!pendingImageImport;
  el('imageTraceEditSection').style.display=isImageLayer?'block':'none';
  el('imageTraceNewSection').style.display=pendingImageImport||!isImageLayer?'block':'none';
}
el('imageImportCommit').addEventListener('click',updateImageTraceSections);
el('imageImportCancel').addEventListener('click',updateImageTraceSections);

// ---- Workspace view mode (UI-001B: Dual Workspace). Three modes: 'dual' (2D Canvas and Object
// Preview shown together -- the default desktop layout), '2d' (2D Canvas only), 'preview' (Object
// Preview only). The single-view modes keep the pre-existing "only one canvas panel laid out at a
// time" behavior (more area than a fixed split); dual mode instead lays both canvas panels out
// side by side via the '.dual' CSS class. In every mode both canvases keep a real, non-zero pixel
// box (visibility, never display:none -- see the .tab-hidden rule), so the existing Export Cup PNG
// sizing fix keeps applying unchanged. updateAll(true) after a switch lets whichever canvas(es)
// just became visible/resized pick up their real box size via resizeCanvas()/ResizeObserver.
let workspaceMode='dual';
function setWorkspaceMode(mode,skipUpdate){
  workspaceMode=mode;
  const show2D=mode==='dual'||mode==='2d',show3D=mode==='dual'||mode==='preview';
  el('viewTabDual').classList.toggle('active',mode==='dual');el('viewTabDual').setAttribute('aria-selected',String(mode==='dual'));
  el('viewTab2D').classList.toggle('active',mode==='2d');el('viewTab2D').setAttribute('aria-selected',String(mode==='2d'));
  el('viewTab3D').classList.toggle('active',mode==='preview');el('viewTab3D').setAttribute('aria-selected',String(mode==='preview'));
  el('workspaceCanvasArea').classList.toggle('dual',mode==='dual');
  el('panel2D').classList.toggle('tab-hidden',!show2D);el('panel3D').classList.toggle('tab-hidden',!show3D);
  el('toolbar2D').style.display=show2D?'flex':'none';el('toolbar3D').style.display=show3D?'flex':'none';
  el('layoutStats').style.display=show2D?'flex':'none';el('cupStats').style.display=show3D?'flex':'none';
  if(!skipUpdate)updateAll(true);
}
// RS-3011 Step 4: which of Design/Dual Workspace/2D Canvas/Object Preview was last active, so a
// page reload lands back where the user left off -- a client-side UI preference, not project data,
// same storage-only convention as FONT_FAVORITES_STORAGE_KEY above (see its own comment): a
// dedicated localStorage key, read once at boot, degrading silently to a no-op on any storage
// error, never routed through AutosaveManager (that class only ever persists
// {project, selectedLayerId}).
const ACTIVE_VIEW_STORAGE_KEY='rhinestoneStudio.activeView';
const ACTIVE_VIEW_VALUES=new Set(['design','dual','2d','preview']);
function loadActiveView(){try{const raw=localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY);return ACTIVE_VIEW_VALUES.has(raw)?raw:null}catch{return null}}
function persistActiveView(value){try{localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY,value)}catch{}}
el('viewTabDual').onclick=()=>{setWorkspaceMode('dual');persistActiveView('dual')};
el('viewTab2D').onclick=()=>{setWorkspaceMode('2d');persistActiveView('2d')};
el('viewTab3D').onclick=()=>{setWorkspaceMode('preview');persistActiveView('preview')};
// RS-3011 Step 4: Design is the app's actual default view -- a browser with nothing yet in
// ACTIVE_VIEW_STORAGE_KEY (first-ever visit) resolves to 'design', not 'dual'. A narrower/smaller
// screen still always forces 2D-Canvas-only regardless of the resolved value (Sasha's explicit
// decision: the narrow-viewport override wins even over a saved 'design'/'dual' preference) --
// same narrow-viewport behavior this file has always had, just layered on top of the new
// persisted-preference read instead of a hardcoded 'dual' start. The override is never written
// back to storage: it's a viewport-driven display choice, not a new user preference, so the
// original saved value survives for the next reload on a wider window. skipUpdate=true on the
// non-Design branch below, same reasoning as before this change: this runs before the boot-time
// updateAll(true) at the bottom of this file, so there is no generated layout yet to redraw.
// bootActiveView is only *resolved* here -- the 'design' branch is *triggered* further down, right
// after #menuDesign's own handler (see "RS-3011 Step 4: boot-time Design entry" there), because
// setDrawMode()/workspaceModeBeforeDrawing aren't declared yet at this point in the file and this
// must reuse the exact same call the click path uses, not a hand-rolled boot-only duplicate of it.
let bootActiveView=loadActiveView();
if(bootActiveView===null)bootActiveView='design';
if(!window.matchMedia('(min-width: 900px)').matches)bootActiveView='2d';
if(bootActiveView!=='design')setWorkspaceMode(bootActiveView,true);

// ---- RS-3010 Step 1/2a: drawing mode toggle group. Entering hands layoutCanvas to drawingTool's
// own Paper.js scene (drawingTool.enter()) exactly like the pointerdown/keydown gates above
// assume; exiting hands it back to the normal renderer (drawLayout()). resizeCanvas() is called
// first so drawingTool's base fit scale is computed against the canvas's *current* pixel size,
// the same dpr-aware sizing drawLayout() itself always uses.
//
// Design Step A correction: the two design rails plus #menuDesign are now the only entry points
// (the old horizontal #drawToolGroup row is gone). Entering also forces the workspace into 2D-only
// view (drawing mode's own Paper.js scene only ever owns the 2D canvas) -- workspaceModeBeforeDrawing
// captures whatever mode was active so exiting can restore it, rather than always landing back on
// '2d'. ----
let workspaceModeBeforeDrawing=null;
function setDrawMode(active,mode){
  if(active){
    workspaceModeBeforeDrawing=workspaceMode;
    // Force 2D-only view before drawingTool.enter() measures layoutCanvas's box below -- same
    // "reflow before measuring" reasoning as the display toggles that follow: switching away from
    // Dual Workspace changes #panel2D's own CSS layout (position:relative/flex sizing vs. the
    // absolute/inset sizing single-view mode uses), so this must land before enter()'s
    // getBoundingClientRect() call, not after.
    setWorkspaceMode('2d');
    // Show the hint text -- letting the toolbar finish reflowing/wrapping around it -- BEFORE
    // calling drawingTool.enter(), which measures layoutCanvas's current box via
    // resyncViewSize(). Doing this in the other order sizes Paper's viewport against the
    // canvas's PRE-reflow box: if showing this UI causes the toolbar to wrap onto a second line
    // (more likely now that Step 2a added Rect/Ellipse buttons alongside Draw), the canvas's
    // available CSS height shrinks immediately afterward but its already-sized Paper.js backing
    // store does not, leaving drawn content misaligned/squished for the rest of the session.
    // Setting style.display here forces the browser to recompute layout by the time enter()'s
    // getBoundingClientRect() call runs, since both happen in the same synchronous task.
    el('drawModeHint').style.display='';
    el('designToolOptionsPanel').style.display='';
    el('designToolRailLeft').style.display='';
    el('designToolRailRight').style.display='';
    // RS-3010 Design Step C correction: reserve room for both rails so #layout's rendered box
    // stops extending underneath them (see the #panel2D.design-rails-inset CSS rule) -- added here,
    // alongside the style.display toggles above, for the exact same "same synchronous task forces
    // the reflow enter()'s getBoundingClientRect() below reads" reason this block's own comment
    // already documents for those.
    el('panel2D').classList.add('design-rails-inset');
    // RS-3010 Design Step A correction #2: setWorkspaceMode('2d') above already forces the
    // workspace to the 2D Canvas view -- the Dual Workspace/2D Canvas/Object Preview tab row is
    // dead UI while Design can't switch away from it, so hide the whole tab row too.
    el('workspaceViewTabs').style.display='none';
    // drawingTool.enter() resyncs layoutCanvas's size itself (see DrawingCanvasTool.js's
    // resyncViewSize()) -- app.js must not also call resizeCanvas() here, or the two would fight
    // over which one's dpr-scaled canvas.width/height sticks.
    drawingTool.enter({width:project.canvas.width,height:project.canvas.height},38*Math.max(1,devicePixelRatio||1),mode);
    el('status').textContent='Drawing mode: drag on the canvas to draw a shape. It becomes a Path layer immediately.';
  }else{
    drawingTool.exit();
    el('drawModeHint').style.display='none';
    el('designToolOptionsPanel').style.display='none';
    el('designToolRailLeft').style.display='none';
    el('designToolRailRight').style.display='none';
    el('workspaceViewTabs').style.display='';
    // RS-3010 Design Step C correction: drop the rail inset before setWorkspaceMode() below reads
    // #layout's box (via its own updateAll(true) -> resizeCanvas()) -- landing it here, alongside
    // the other hide-toggles and before that read, keeps #layout at its normal full width the
    // instant Design mode is no longer active, matching the isActive gate the rails themselves use.
    el('panel2D').classList.remove('design-rails-inset');
    // Restores whatever workspace mode was active before this session started (setWorkspaceMode()
    // already runs updateAll(true) internally, which covers the drawLayout()/drawCup()/stats
    // refresh this branch needed anyway -- no separate drawLayout() call required).
    setWorkspaceMode(workspaceModeBeforeDrawing);
    workspaceModeBeforeDrawing=null;
    // RS-3010 Design Step A correction #2: setDrawMode(true) above sets a "Drawing mode: ..."
    // status message that otherwise sticks around indefinitely after leaving Design -- reset to
    // the app's neutral status (see the two other 'Ready' resets in this file).
    el('status').textContent='Ready';
  }
  // RS-3011 Step 3a: covers entering/exiting Design when the selection itself doesn't change (a
  // shape already selected before this toggle) -- syncSelectedControlsFromLayer()'s own
  // relocateFieldGroups() call only fires on an actual selection change, not on this toggle alone.
  relocateFieldGroups();
  updateDrawToolButtons();
}
function updateDrawToolButtons(){
  const active=drawingTool.isActive,mode=drawingTool.mode;
  const showSlotWidth=active&&mode==='slot';
  el('drawSlotWidthField').style.display=showSlotWidth?'':'none';
  el('drawSlotWidthField').title=`Slot width (${unitSuffix(project.units)})`;
  el('drawSlotWidthMm').style.display=showSlotWidth?'':'none';
  // RS-topmenu-active-state: #menuDesign has no rail/mode of its own -- it reflects Design mode
  // as a whole (entering Design via any rail tool, or the Design menu button itself, all count).
  el('menuDesign').setAttribute('aria-pressed',String(active));
  // RS-topmenu-active-persist: entering Design mode is the moment the user has actually left
  // whichever Lightbox section was highlighted -- clear it here rather than on every rail-tool
  // switch within Design (setActiveTopMenuButton()'s no-op-if-same-id guard makes repeated calls
  // while active stays true harmless, so this needs no separate edge-transition tracking).
  if(active)setActiveTopMenuButton(null);
  // RS-3010 Design Step A correction: the old horizontal row's five preset buttons are gone --
  // these two rails (split left/right) are now the only aria-pressed sync targets.
  el('railSelectToggle').setAttribute('aria-pressed',String(active&&mode==='select'));
  el('railLassoToggle').setAttribute('aria-pressed',String(active&&mode==='lasso'));
  el('railDrawToggle').setAttribute('aria-pressed',String(active&&mode==='freehand'));
  el('railRectToggle').setAttribute('aria-pressed',String(active&&mode==='rect'));
  el('railEllipseToggle').setAttribute('aria-pressed',String(active&&mode==='ellipse'));
  el('railSlotToggle').setAttribute('aria-pressed',String(active&&mode==='slot'));
  el('railPolygonToggle').setAttribute('aria-pressed',String(active&&mode==='polygon'));
  el('railPenToggle').setAttribute('aria-pressed',String(active&&mode==='pen'));
  el('railPaintToggle').setAttribute('aria-pressed',String(active&&mode==='paint'));
  el('railStampToggle').setAttribute('aria-pressed',String(active&&mode==='stamp'));
  el('railTraceToggle').setAttribute('aria-pressed',String(active&&mode==='trace'));
  el('railEraserToggle').setAttribute('aria-pressed',String(active&&mode==='eraser'));
  // RS-3011 Step 13 decision 4a: eraserRadiusField/eraserRadiusMm's own visibility toggle, same
  // active-and-mode-matches idiom as drawSlotWidthField/drawSlotWidthMm above (two sibling
  // elements in #designToolOptionsPanel, toggled individually) -- kept in sync with
  // eraserSettings.radiusMm every time it's shown, so it always reflects the current brush size
  // regardless of which entry point (rail click, 'x' shortcut, '[' / ']' nudge) last changed it.
  const showEraserRadius=active&&mode==='eraser';
  el('eraserRadiusField').style.display=showEraserRadius?'':'none';
  el('eraserRadiusField').title=`Eraser brush radius (${unitSuffix(project.units)}) -- also adjustable with [ / ] while Eraser is active`;
  el('eraserRadiusMm').style.display=showEraserRadius?'':'none';
  if(showEraserRadius)setLengthField('eraserRadiusMm',eraserSettings.radiusMm);
  // RS-3014 Step 3: eraserModeField/eraserMode's own visibility toggle, same convention as
  // eraserRadiusField/eraserRadiusMm just above -- kept in sync with eraserSettings.mode every
  // time it's shown.
  el('eraserModeField').style.display=showEraserRadius?'':'none';
  el('eraserMode').style.display=showEraserRadius?'':'none';
  if(showEraserRadius)el('eraserMode').value=eraserSettings.mode;
  // RS-3014 Step 1: Stamp/Trace/Paint's own field-group visibility toggles, same
  // active-and-mode-matches idiom as showEraserRadius just above, kept in sync with each tool's own
  // settings object every time it's shown, so it always reflects the current style regardless of
  // which entry point (rail click, panel field) last changed it.
  const showStampStyle=active&&mode==='stamp';
  el('stampSizeField').style.display=showStampStyle?'':'none';
  el('stampSizeField').title=`Stamp stone size (${unitSuffix(project.units)})`;
  el('stampSizeMm').style.display=showStampStyle?'':'none';
  el('stampColorField').style.display=showStampStyle?'':'none';
  el('stampColor').style.display=showStampStyle?'':'none';
  if(showStampStyle){setLengthField('stampSizeMm',stampSettings.sizeMm);el('stampColor').value=stampSettings.color}
  const showTraceStyle=active&&mode==='trace';
  el('traceSizeField').style.display=showTraceStyle?'':'none';
  el('traceSizeField').title=`Trace stone size (${unitSuffix(project.units)})`;
  el('traceSizeMm').style.display=showTraceStyle?'':'none';
  el('traceGapField').style.display=showTraceStyle?'':'none';
  el('traceGapField').title=`Trace stone gap (${unitSuffix(project.units)})`;
  el('traceGapMm').style.display=showTraceStyle?'':'none';
  el('traceColorField').style.display=showTraceStyle?'':'none';
  el('traceColor').style.display=showTraceStyle?'':'none';
  if(showTraceStyle){setLengthField('traceSizeMm',traceSettings.sizeMm);setLengthField('traceGapMm',traceSettings.gapMm);el('traceColor').value=traceSettings.color}
  const showPaintStyle=active&&mode==='paint';
  el('paintSizeField').style.display=showPaintStyle?'':'none';
  el('paintSizeField').title=`Paint stone size (${unitSuffix(project.units)})`;
  el('paintSizeMm').style.display=showPaintStyle?'':'none';
  el('paintGapField').style.display=showPaintStyle?'':'none';
  el('paintGapField').title=`Paint stone gap (${unitSuffix(project.units)})`;
  el('paintGapMm').style.display=showPaintStyle?'':'none';
  el('paintColorField').style.display=showPaintStyle?'':'none';
  el('paintColor').style.display=showPaintStyle?'':'none';
  if(showPaintStyle){setLengthField('paintSizeMm',paintSettings.sizeMm);setLengthField('paintGapMm',paintSettings.gapMm);el('paintColor').value=paintSettings.color}
}
// RS-3011 Step 13 decision 4: seeds eraserSettings.radiusMm from the currently selected layer's own
// stoneSize (mirrors getStoneDefaults()'s own `base.stoneSize||2` convention above) the FIRST time
// Eraser mode is entered in this session -- eraserRadiusSeeded latches true right after, so every
// later entry leaves radiusMm exactly as the user last set it, regardless of which layer they next
// erase on. Called from setDrawTool() below, before either of its own dispatch branches.
function seedEraserRadiusIfNeeded(){
  if(eraserRadiusSeeded)return;
  eraserRadiusSeeded=true;
  const base=selectedLayer();
  eraserSettings.radiusMm=Math.max(0.5,base.stoneSize||2);
  drawingTool.setEraserRadiusMm(eraserSettings.radiusMm);
}
// RS-3014 Step 1: seeds stampSettings/traceSettings/paintSettings from the currently selected
// layer's own stoneSize/gap/color (mirrors seedEraserRadiusIfNeeded()'s own convention exactly) the
// FIRST time each tool is entered in this session -- each tool's own *StyleSeeded flag latches true
// right after, so every later entry leaves that tool's settings exactly as the user last set them,
// regardless of which layer they next act on. Called from setDrawTool() below, before either of its
// own dispatch branches.
function seedStampStyleIfNeeded(){
  if(stampStyleSeeded)return;
  stampStyleSeeded=true;
  const base=selectedLayer();
  stampSettings.sizeMm=base.stoneSize||2;
  stampSettings.color=base.color||'gold';
  drawingTool.setStampStyle(stampSettings);
}
function seedTraceStyleIfNeeded(){
  if(traceStyleSeeded)return;
  traceStyleSeeded=true;
  const base=selectedLayer();
  traceSettings.sizeMm=base.stoneSize||2;
  traceSettings.gapMm=base.gap||.3;
  traceSettings.color=base.color||'gold';
  drawingTool.setTraceStyle(traceSettings);
}
function seedPaintStyleIfNeeded(){
  if(paintStyleSeeded)return;
  paintStyleSeeded=true;
  const base=selectedLayer();
  paintSettings.sizeMm=base.stoneSize||2;
  paintSettings.gapMm=base.gap||.3;
  paintSettings.color=base.color||'gold';
}
function setDrawTool(mode){
  if(mode==='eraser')seedEraserRadiusIfNeeded();
  if(mode==='stamp')seedStampStyleIfNeeded();
  if(mode==='trace')seedTraceStyleIfNeeded();
  if(mode==='paint')seedPaintStyleIfNeeded();
  if(drawingTool.isActive){
    // RS-3011 issue #3 fix: re-clicking the already-active tool's own rail button is a no-op --
    // it must never exit Design. Select/Draw/Rect/Ellipse/Slot/Polygon are all persistent
    // tool-rail buttons now (not just a single Draw toggle), so "click active tool again" no
    // longer reads as "leave Design" the way it did when Draw was the only entry point. Design's
    // own enter/exit toggle now lives on #menuDesign instead (below), independent of tool state.
    if(drawingTool.mode===mode)return;
    drawingTool.setMode(mode);
    updateDrawToolButtons();
    return;
  }
  setDrawMode(true,mode);
}
el('drawSlotWidthMm').oninput=()=>{stashTypedLengthField('drawSlotWidthMm');drawingTool.setSlotWidthMm(readLengthField('drawSlotWidthMm'))};
el('railSelectToggle').onclick=()=>setDrawTool('select');
el('railLassoToggle').onclick=()=>setDrawTool('lasso');
el('railDrawToggle').onclick=()=>setDrawTool('freehand');
el('railRectToggle').onclick=()=>setDrawTool('rect');
el('railEllipseToggle').onclick=()=>setDrawTool('ellipse');
el('railSlotToggle').onclick=()=>setDrawTool('slot');
el('railPolygonToggle').onclick=()=>setDrawTool('polygon');
el('railPenToggle').onclick=()=>setDrawTool('pen');
el('railPaintToggle').onclick=()=>setDrawTool('paint');
el('railStampToggle').onclick=()=>setDrawTool('stamp');
el('railTraceToggle').onclick=()=>setDrawTool('trace');
el('railEraserToggle').onclick=()=>setDrawTool('eraser');
// RS-3015: visible shortcut-key badges on the rail buttons above -- reads DRAW_TOOL_SHORTCUT_KEYS
// (rather than hardcoding letters here) so the badge can never drift out of sync with the actual
// keybinding.
function initDrawToolShortcutBadges(){
  const modeToKey={};
  for(const key in DRAW_TOOL_SHORTCUT_KEYS)modeToKey[DRAW_TOOL_SHORTCUT_KEYS[key]]=key;
  const idsByMode={railSelectToggle:'select',railLassoToggle:'lasso',railDrawToggle:'freehand',
    railRectToggle:'rect',railEllipseToggle:'ellipse',railSlotToggle:'slot',railPolygonToggle:'polygon',
    railPenToggle:'pen',railPaintToggle:'paint',railStampToggle:'stamp',railTraceToggle:'trace',
    railEraserToggle:'eraser'};
  for(const id in idsByMode){
    const key=modeToKey[idsByMode[id]];
    if(key)el(id).setAttribute('data-shortcut',key.toUpperCase());
  }
}
initDrawToolShortcutBadges();
// RS-3011 Step 13 decision 4a: the second of the two required radius-adjustment paths (the first
// is the '[' / ']' keydown handling below) -- writes straight through to both eraserSettings (this
// module's own runtime state) and drawingTool.setEraserRadiusMm() (its live ghost/drag-preview
// radius), same "own state + tool's live value, both updated together" pattern the '[' / ']'
// handler below follows.
el('eraserRadiusMm').oninput=()=>{
  const parsed=readLengthField('eraserRadiusMm');
  if(!Number.isFinite(parsed))return;
  eraserSettings.radiusMm=Math.max(0.5,parsed);
  drawingTool.setEraserRadiusMm(eraserSettings.radiusMm);
};
// RS-3014 Step 3: Eraser's own mode toggle, same "own state + tool's live value, both updated
// together" pattern as #eraserRadiusMm's own handler just above.
el('eraserMode').onchange=()=>{
  eraserSettings.mode=el('eraserMode').value;
  drawingTool.setEraserMode(eraserSettings.mode);
};
// RS-3014 Step 1: Stamp/Trace/Paint's own panel field handlers, same "own state + tool's live
// value, both updated together" pattern as #eraserRadiusMm's own handler just above. Paint has no
// drawingTool-side setter to push into (its lasso preview doesn't render stone-colored geometry --
// see onPaintStroke's own doc comment above), so its handlers only update paintSettings.
el('stampSizeMm').oninput=()=>{
  const parsed=readLengthField('stampSizeMm');
  if(!Number.isFinite(parsed))return;
  stampSettings.sizeMm=parsed;
  drawingTool.setStampStyle(stampSettings);
};
el('stampColor').oninput=()=>{
  stampSettings.color=el('stampColor').value;
  drawingTool.setStampStyle(stampSettings);
};
el('traceSizeMm').oninput=()=>{
  const parsed=readLengthField('traceSizeMm');
  if(!Number.isFinite(parsed))return;
  traceSettings.sizeMm=parsed;
  drawingTool.setTraceStyle(traceSettings);
};
el('traceGapMm').oninput=()=>{
  const parsed=readLengthField('traceGapMm');
  if(!Number.isFinite(parsed))return;
  traceSettings.gapMm=parsed;
  drawingTool.setTraceStyle(traceSettings);
};
el('traceColor').oninput=()=>{
  traceSettings.color=el('traceColor').value;
  drawingTool.setTraceStyle(traceSettings);
};
el('paintSizeMm').oninput=()=>{
  const parsed=readLengthField('paintSizeMm');
  if(!Number.isFinite(parsed))return;
  paintSettings.sizeMm=parsed;
};
el('paintGapMm').oninput=()=>{
  const parsed=readLengthField('paintGapMm');
  if(!Number.isFinite(parsed))return;
  paintSettings.gapMm=parsed;
};
el('paintColor').oninput=()=>{
  paintSettings.color=el('paintColor').value;
};
// RS-3011 Step 8 Phase B: Import SVG is a one-shot action, not a draw-tool mode -- clicking it
// never calls setDrawTool()/setMode(), it just opens its own hidden file input, matching the
// existing top-nav Import Lightbox's own el('importSvg').onclick pattern below (a fully separate
// input/handler -- that one's pipeline stores svgSource verbatim for an 'svg'-type layer; this one
// runs the file through Phase A's Paper.js-native flatten pipeline into a real 'path' layer).
el('railImportSvgToggle').onclick=()=>el('designImportSvgFile').click();
el('designImportSvgFile').addEventListener('change',async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  try{
    const svgSource=await file.text();
    const item=importSvgIntoItem(svgSource,project.canvas.width,project.canvas.height);
    const flattened=flattenPathToContours(item,FLATTEN_TOLERANCE_MM);
    if(!flattened.contours.length){el('status').textContent=`Import failed: "${file.name}" has no usable shape geometry.`;return}
    const base=selectedLayer();
    const{layer,warning}=createPathLayerFromContours(flattened,{stoneSize:base.stoneSize||2,gap:base.gap||.3,color:base.color||'gold',pathName:file.name});
    // RS-3011 Step 7: same gate every other Design-created shape gets -- the outline appears
    // immediately, stones wait for the "Generate Stones" button.
    layer.stonesGenerated=false;
    commitHistory();
    project.layers.push(layer);
    selectedLayerId=layer.id;selectedLayerIds=selectOnly(layer.id);
    syncSelectedControlsFromLayer();
    await updateAll(true);
    // Design's own on-canvas selection (`drawingTool`'s internal selectedIds) only exists once
    // syncFromProjectLayers() (run synchronously inside updateAll() above, while Design is active)
    // has materialized this brand-new layer into a real board.shapes item -- see
    // selectShapeForLayer()'s own doc comment for why this call is needed at all.
    drawingTool.selectShapeForLayer(layer.id);
    const warningNote=warning?` — ${warning}`:'';
    el('status').textContent=`Imported ${file.name}: ${flattened.contours.length} shape(s)${warningNote}`;
  }catch(error){
    console.error('Design SVG import failed',error);
    el('status').textContent=`SVG import failed: ${error.message}`;
  }
});
// RS-3011 nav-toggle fix: #menuDesign no longer toggles. It always means "go to Design" --
// matching setDrawTool()'s own same-mode no-op convention above (fa80918): entering is
// idempotent, clicking it while Design is already active does nothing. There is no longer a
// direct "exit Design" button -- Dual Workspace is reached only by opening one of the Lightboxes
// above, a deliberate tradeoff.
el('menuDesign').onclick=()=>{
  if(drawingTool.isActive)return;
  setDrawTool('select');persistActiveView('design');
};
// RS-3011 Step 4: boot-time Design entry -- resolved above (bootActiveView==='design'), but
// deferred until here because setDrawMode()/workspaceModeBeforeDrawing aren't declared until this
// point in the file, and this reuses the exact same call the click-driven path above uses so the
// "RS-3010 Design Step A correction #2" DOM-timing ordering (style.display toggles land before
// drawingTool.enter()'s getBoundingClientRect() call, in the same synchronous task) applies
// identically at boot, not a hand-rolled boot-only duplicate of it. Always starts in Select mode,
// not the last-used tool -- simpler/safer to always start fresh here.
//
// A real boot-only race was found and fixed here during Playwright verification (comparing
// boot-time vs. click-triggered Design entry, scenario (g) below): #layoutStats' own text is only
// populated once updateAll()'s `await engine.generate(project)` resolves (see updateStats()), which
// on the click path has always already happened at least once by the time a user can click
// #menuDesign -- #layoutStats is already at its real, final height, so entering Design never
// observes it change. At boot, #layoutStats has never been populated yet, so if setDrawMode(true,
// ...) below ran immediately, drawingTool.enter()'s resyncViewSize() would measure the canvas
// against #layoutStats' short placeholder height, and the real stats text landing moments later
// (asynchronously, after generation resolves) would shrink #layoutStats -- and therefore #layout's
// own box -- out from under an already-fixed Paper.js backing store, with nothing to resync it
// afterward. Settling one real generation cycle first (in whatever mode the static HTML/`
// workspaceMode` default already shows -- explicit here rather than assumed) means #layoutStats is
// already at its final height before setDrawMode()'s own DOM-timing care runs.
// RS-3011 Step 4 flash fix: setWorkspaceMode('dual',true) below applies Dual Workspace's full
// visible DOM state (two-panel layout, workspace tabs, Align & Snap / Front-Left-Right-Back
// toolbars) before the settle-generation await yields control back to the browser -- confirmed via
// CDP screencast to produce a real, painted ~25-30ms flash of Dual Workspace before Design appears.
// visibility:hidden (not display:none) keeps every element inside .workspace participating in
// layout -- #layoutStats/#cupStats etc. still measure/settle against their real box, preserving the
// scenario (g) canvas-sizing fix documented above -- while producing no visible paint for the
// duration. Scoped to .workspace (the single ancestor of the two-panel canvas layout, the workspace
// tabs, and the toolbar controls the flash screenshot showed -- everything Dual Workspace's
// boot-time state paints, and also everything Design's own rails/panel end up in) rather than
// <body>, so the top menu and left panel (already correct, unaffected by this gap) keep rendering
// normally throughout.
if(bootActiveView==='design'){
  const workspaceEl=document.querySelector('.workspace');
  if(workspaceEl)workspaceEl.style.visibility='hidden';
  setWorkspaceMode('dual',true);
  await updateAll(true);
  setDrawMode(true,'select');
  if(workspaceEl)workspaceEl.style.visibility='';
}
// Figma-style trackpad/mouse mapping, kept out of the normal pointerdown/move/up flow entirely so
// a drag on the canvas always draws and never pans: plain scroll pans (deltaX/deltaY), Ctrl/Cmd+
// scroll (or a trackpad pinch, which the browser reports as wheel+ctrlKey) zooms.
layoutCanvas.addEventListener('wheel',e=>{if(!drawingTool.isActive)return;drawingTool.onWheel(e)},{passive:false});
// RS-3011 Step 9 follow-up: double-click finishes an in-progress Pen path as an open shape, an
// alternative to clicking back on the first anchor (which closes it). hasInProgressPen already
// folds in the interactionKind==='pen' check, so this doesn't duplicate it.
layoutCanvas.addEventListener('dblclick',e=>{
  if(!drawingTool.isActive||!drawingTool.hasInProgressPen)return;
  drawingTool.finishOpenPenPath();
});

// ---- Left panel Actions shortcuts: each calls the exact same function as its top-bar/per-row
// equivalent -- no new history, selection, or export logic. ----
el('actionUndo').onclick=()=>performUndo();
el('actionRedo').onclick=()=>performRedo();
// RS-3013 Step 3: a selected REGION (drawingTool.activeSelection.kind==='region') duplicates just
// that region via duplicateRegionInPathLayer() above, then hands the new copy's id/polygon to
// drawingTool.setActiveSelectionToRegion() so its outline renders as the current selection
// immediately, without a second hit-test round-trip. A null/undefined activeSelection or a 'draft'
// kind (an in-progress rect/lasso selection with no committed region behind it yet) falls through
// unchanged to today's whole-layer duplicateLayer(selectedLayerId) -- same "leave drafts alone
// entirely" rule Step 2's region-move already followed.
el('actionDuplicate').onclick=()=>{
  const selection=drawingTool.activeSelection;
  if(selection&&selection.kind==='region'){
    const result=duplicateRegionInPathLayer(selection.layerId,selection.regionId);
    if(result)drawingTool.setActiveSelectionToRegion(selection.layerId,result.newRegionId,result.polygon);
    return;
  }
  duplicateLayer(selectedLayerId);
};
// RS-3013 Step 4: shared by both Delete entry points -- this button's own onclick immediately below,
// and the global keydown handler's Delete/Backspace branch inside `if(drawingTool.isActive){...}` --
// same "factor the shared logic once" precedent Step 2's own tryStartRegionMove() fix already set,
// so neither entry point carries its own duplicated region-vs-fallthrough branch. A selected REGION
// (drawingTool.activeSelection.kind==='region') deletes just that region via
// deleteRegionFromPathLayer(), then clears the selection via drawingTool.clearActiveSelection() --
// unlike Step 3's duplicate, delete leaves NOTHING selected afterward; it does not fall back to
// selecting the parent shape, matching deleteSelected()'s own existing behavior for a whole shape. A
// null/undefined activeSelection falls through unchanged to the existing drawingTool.deleteSelected().
// Bulk-delete-by-area: a 'draft' kind (an in-progress rect/lasso area from Select/Lasso, not yet a
// committed region) USED to fall through to deleteSelected() too, but Step 4's own diagnosis already
// established that fallback is a no-op here -- the draft's own commit clears selectedIds before
// Delete can act, so nothing was ever actually working in this case. This branch replaces that dead
// fallback: it erases every stone (base-fill, region-patch, and stamped alike) whose position falls
// inside the draft's own area, via the shared eraseStonesWithinTest() (see its own doc comment near
// deleteRegionFromPathLayer above) -- passing isPointInActiveSelection (this file's own standalone
// function, the exact same test already wired into drawingTool's own hooks for Stamp/Trace, see its
// doc comment near resolvePaintTargetTwoPass) as the withinTest, rather than reimplementing a second
// rect-bounds/lasso-polygon test here. Region OBJECTS are never touched -- only their rendered stones
// within the area disappear, exactly like ordinary Eraser use already does; a region left fully
// hollowed out stays present in layer.regions as an empty-output object, no new behavior needed. Per
// Step 1's own resolveSelectionTarget() contract, a draft always resolves to exactly one layer, so
// this never needs to reason about multiple targets. Clears the selection afterward either way --
// nothing is left "selected" once its contents are gone, same as the region branch above.
async function deleteCurrentSelection(){
  const selection=drawingTool.activeSelection;
  if(selection&&selection.kind==='region'){
    deleteRegionFromPathLayer(selection.layerId,selection.regionId);
    drawingTool.clearActiveSelection();
    return;
  }
  if(selection&&selection.kind==='draft'){
    const targetLayer=project.layers.find(l=>l.id===selection.layerId&&l.type==='path');
    if(targetLayer){
      const withinTest=(xMm,yMm)=>isPointInActiveSelection({xMm,yMm},selection);
      const result=await eraseStonesWithinTest(targetLayer,withinTest);
      el('status').textContent=result
        ?`Erased ${result.removedCount} stone${result.removedCount===1?'':'s'} within the selected area.`
        :'Nothing to erase within the selected area.';
    }
    drawingTool.clearActiveSelection();
    return;
  }
  drawingTool.deleteSelected();
}
el('actionDelete').onclick=()=>deleteCurrentSelection();
function saveProjectDownload(){el('exportProject').click()}
el('actionSave').onclick=saveProjectDownload;
el('saveProject').onclick=saveProjectDownload;

// ---- Thumbnails (RS-2001): shared generate -> render -> capture sequence reused by the Gallery
// for its own cards/previews -- the existing `engine.generate()` bridge + the permanent
// `renderProductionLayout()` against an offscreen canvas, the same generate-then-render call
// sequence `drawLayout()` already performs against the live canvas, never a second rendering
// pipeline. ----
const LIBRARY_THUMB_WIDTH_PX=260,LIBRARY_THUMB_HEIGHT_PX=170;

async function generateProjectThumbnail(tempProject){
  try{
    const stoneLayout=await engine.generate(tempProject);
    const canvas=document.createElement('canvas');
    canvas.width=LIBRARY_THUMB_WIDTH_PX;canvas.height=LIBRARY_THUMB_HEIGHT_PX;
    renderProductionLayout(canvas.getContext('2d'),stoneLayout,{widthPx:canvas.width,heightPx:canvas.height,paddingPx:12,units:tempProject.units||'mm'});
    return canvas.toDataURL('image/png');
  }catch(error){
    console.error('Thumbnail generation failed',error);
    return null;
  }
}

// ---- Gallery (RS-2001): a built-in, permanent, READ-ONLY set of example projects sourced from
// examples/*.rhs + examples/manifest.json + examples/baselines.json + examples/gallery.json (the
// curatorial metadata this milestone adds). Items are never renamed/duplicated/deleted, and
// nothing here is ever written back to examples/**. "Open Copy" fetches a fixture, translates it
// through the existing toAppProjectShape()/validateProject() bridge (src/gallery/index.js), and
// replaces the live project exactly like #importProjectFile already does. Thumbnails reuse
// generateProjectThumbnail() above -- no second thumbnail renderer, no second render pipeline. ----
let galleryEntries=null,galleryFixtures=null,galleryLoadError=null;
let galleryQuery='',galleryCategory='All',galleryPreviewFile=null;
const galleryThumbnailCache=new Map();

async function loadGalleryCatalogIfNeeded(){
  if(galleryEntries||galleryLoadError)return;
  try{
    const [manifest,baselines,galleryMeta]=await Promise.all([
      fetch('./examples/manifest.json').then(r=>r.json()),
      fetch('./examples/baselines.json').then(r=>r.json()),
      fetch('./examples/gallery.json').then(r=>r.json())
    ]);
    const fixtures={};
    await Promise.all(galleryMeta.items.map(async item=>{fixtures[item.file]=await fetch(`./examples/${item.file}`).then(r=>r.json())}));
    galleryFixtures=fixtures;
    galleryEntries=parseCatalog({manifest,baselines,galleryMeta,fixtures});
  }catch(error){
    console.error('Gallery: failed to load catalog',error);
    galleryLoadError=error;
  }
}

function galleryFilteredEntries(){
  const searched=searchGalleryCatalog(galleryEntries,galleryQuery);
  if(galleryCategory==='Featured')return galleryFeaturedEntries(searched);
  return filterGalleryCategory(searched,galleryCategory);
}

// Translates a Gallery fixture to a fresh, editable app-shape project. Never mutates
// galleryFixtures[file] -- validateRhsProject()/toAppProjectShape() both return new objects.
function buildAppProjectFromGalleryFile(file,title){
  const fixture=galleryFixtures[file];
  const rhsProject=validateRhsProject(fixture,file);
  const appProjectShape=toAppProjectShape(rhsProject);
  return validateProject({...appProjectShape,name:title});
}

async function generateGalleryThumbnail(file,title){
  if(galleryThumbnailCache.has(file))return galleryThumbnailCache.get(file);
  const thumbnail=await generateProjectThumbnail(buildAppProjectFromGalleryFile(file,title));
  galleryThumbnailCache.set(file,thumbnail);
  return thumbnail;
}

function renderGalleryGrid(){
  if(galleryLoadError){
    el('galleryGrid').innerHTML='';
    el('galleryNoResults').style.display='none';
    el('galleryStatus').textContent=`Gallery failed to load: ${galleryLoadError.message}`;
    return;
  }
  const categoryOptions=['All','Featured',...galleryCategories(galleryEntries)];
  el('galleryCategoryFilter').innerHTML=categoryOptions.map(c=>`<option value="${escapeHtml(c)}" ${c===galleryCategory?'selected':''}>${c==='All'?'All categories':escapeHtml(c)}</option>`).join('');
  const items=galleryFilteredEntries();
  el('galleryNoResults').style.display=items.length===0?'block':'none';
  el('galleryGrid').innerHTML=items.map(entry=>`<div class="library-card gallery-card" data-file="${escapeHtml(entry.file)}">
      <span class="gallery-readonly-badge" title="Gallery designs are read-only">Read-only</span>
      <div class="library-card-thumb" data-role="thumb"><span class="library-card-thumb-empty">Loading…</span></div>
      <div class="library-card-body">
        <h4 title="${escapeHtml(entry.title)}">${escapeHtml(entry.title)}</h4>
        <div class="library-card-meta">
          <span class="library-badge gallery-category-pill">${escapeHtml(entry.category)}</span>
          <span class="library-badge">${escapeHtml(entry.difficulty)}</span>
          <span class="library-badge">${entry.stoneCount} stones</span>
        </div>
      </div>
      <div class="library-card-actions">
        <button class="btn" data-action="preview" title="Preview this design">Preview</button>
        <button class="btn primary" data-action="openCopy" title="Open an editable copy of this design">Open Copy</button>
      </div>
    </div>`).join('');
  for(const entry of items){
    generateGalleryThumbnail(entry.file,entry.title).then(thumbnail=>{
      const thumbEl=el('galleryGrid').querySelector(`[data-file="${CSS.escape(entry.file)}"] [data-role="thumb"]`);
      if(thumbEl&&thumbnail)thumbEl.innerHTML=`<img src="${thumbnail}" alt="Preview of ${escapeHtml(entry.title)}">`;
    });
  }
}

async function onGalleryOpen(){
  galleryQuery='';galleryCategory='All';
  el('gallerySearch').value='';
  el('galleryStatus').textContent='';
  el('galleryGrid').innerHTML='<p class="hint">Loading Gallery…</p>';
  await loadGalleryCatalogIfNeeded();
  renderGalleryGrid();
}

function openGalleryPreview(file){
  const entry=getGalleryEntry(galleryEntries,file);if(!entry)return;
  galleryPreviewFile=file;
  el('galleryPreviewTitle').textContent=entry.title;
  el('galleryPreviewMeta').innerHTML=`<span class="library-badge gallery-category-pill">${escapeHtml(entry.category)}</span><span class="library-badge">${escapeHtml(entry.difficulty)}</span><span class="library-badge">${escapeHtml(entry.objectType)}</span><span class="library-badge">${entry.stoneCount} stones</span>`;
  el('galleryPreviewDescription').textContent=entry.description;
  el('galleryPreviewTags').textContent=entry.tags.join(', ');
  el('galleryPreviewThumb').innerHTML='<span class="library-card-thumb-empty">Loading…</span>';
  el('galleryPreviewStatus').textContent='';
  lightboxes.galleryPreview.open();
  generateGalleryThumbnail(file,entry.title).then(thumbnail=>{
    if(galleryPreviewFile===file&&thumbnail)el('galleryPreviewThumb').innerHTML=`<img src="${thumbnail}" alt="Preview of ${escapeHtml(entry.title)}">`;
  });
}

async function openGalleryItemAsCopy(file){
  const entry=getGalleryEntry(galleryEntries,file);if(!entry)return;
  try{
    project=buildAppProjectFromGalleryFile(file,entry.title);
    selectedLayerId=project.layers[0].id;selectedLayerIds=selectOnly(selectedLayerId);
    // Mirrors #importProjectFile's/createProjectFromLibraryItem's exact "loading a project is a
    // fresh start, not an undoable edit" history-clear + dirty-baseline-reset pattern.
    history.clear();cleanProjectJson=JSON.stringify(project);
    // RC-005: loading a project (Import/Open, Design Library "New Project", Gallery "Open as copy")
    // is a fresh start -- immediately re-baseline the autosave slot to this project so a crash
    // right after loading still recovers *this* project, not stale content from before it loaded.
    // Also guards "never overwrite a manually saved/opened project": invalidating
    // lastAutosavedProjectJson first forces flushAutosaveNow() to actually write (it no-ops when
    // the live project already matches what's stored), so the old record is always replaced here,
    // never left to linger and get offered as a stale "recovery" on some later boot.
    lastAutosavedProjectJson=null;flushAutosaveNow();
    refreshUnitLabels();refreshAllFieldSteps();syncSelectedControlsFromLayer();await updateAll(true);
    lightboxes.galleryPreview.close();lightboxes.gallery.close();
    el('status').textContent=`Opened an editable copy of "${entry.title}" from the Gallery.`;
  }catch(error){
    console.error('Gallery: failed to open item as a copy',error);
    el('galleryPreviewStatus').textContent=`Failed to open: ${error.message}`;
  }
}

el('gallerySearch').addEventListener('input',()=>{galleryQuery=el('gallerySearch').value;renderGalleryGrid()});
el('galleryCategoryFilter').addEventListener('change',()=>{galleryCategory=el('galleryCategoryFilter').value;renderGalleryGrid()});
el('galleryGrid').addEventListener('click',e=>{
  const card=e.target.closest('.gallery-card');if(!card)return;
  const file=card.dataset.file,action=e.target.dataset.action;
  if(action==='preview')openGalleryPreview(file);
  else if(action==='openCopy')openGalleryItemAsCopy(file);
});
el('galleryPreviewOpenCopy').onclick=()=>{if(galleryPreviewFile)openGalleryItemAsCopy(galleryPreviewFile)};

// ---- Shipping & Handling: local, session-scoped metadata only. Deliberately not part of
// `project` / Project JSON / undo-redo this milestone -- see
// docs/specifications/UI-001-CompleteRedesign.md, "Shipping & Handling". ----
// ARC-001: shippingInfo state, syncShippingFieldsFromState(), and the #shipApply wiring moved to
// src/ui/ShippingPanel.js (imported above); wireShippingApply() is called once at startup, below.
// RS-3018: units passed as a live getter (not a snapshot) so Apply always reads the operator's
// current Units setting, not whatever it was when the app booted.
wireShippingApply(()=>project.units);

// ---- Settings: mirrors the live grid/safe-area/snap toggle state (one boolean each, never a
// second independent copy). Default stone size/gap are session-local preference fields not yet
// wired into new-layer creation (createShapeLayer()/addText() already default sensibly from the
// currently selected layer) -- documented, not faked; see the specification. ----
function syncSettingsFieldsFromState(){
  el('settingsGridDefault').checked=true;el('settingsGridDefault').disabled=true;
  el('settingsSafeAreaDefault').checked=showSafeArea;el('settingsSnapDefault').checked=snapEnabled;
  setLengthField('settingsSnapDistance',snapToleranceMm);el('settingsShowGuides').checked=showSnapGuides;
  el('settingsUnits').value=project.units;
}
// RS-3020 Part D: #settingsSnapDistance's HTML min/max are static mm literals (index.html), same
// situation RS-3019 solved for #height with refreshHeightFieldBounds() -- its display value is
// now unit-converted, so its bounds must be too.
function refreshSnapDistanceFieldBounds(){
  el('settingsSnapDistance').min=mmToDisplayValue(0.5,project.units);
  el('settingsSnapDistance').max=mmToDisplayValue(5,project.units);
}
el('settingsApply').onclick=()=>{
  showSafeArea=el('settingsSafeAreaDefault').checked;
  snapEnabled=el('settingsSnapDefault').checked;el('snapEnabled').value=snapEnabled?'on':'off';
  snapToleranceMm=Math.min(5,Math.max(0.5,readLengthField('settingsSnapDistance')||SNAP_TOLERANCE_MM));
  showSnapGuides=el('settingsShowGuides').checked;
  drawLayout();
};

// RS-3018: project.units is a display preference (which unit a freely-typed length field shows/
// accepts), never a project-content edit -- deliberately not run through commitHistory()/undo-redo
// and deliberately not in HISTORY_TRACKED_CONTROL_IDS, same category as settingsSnapDefault/
// settingsShowGuides above. Storage stays mm everywhere, forever; only display/input formatting
// changes. #stoneSize (fixed named sizes, not a free-typed length) is permanently excluded.
function setLengthField(id,mm){el(id).value=formatLengthDisplay(mm,project.units);el(id).dataset.mmValue=String(mm)}
function readLengthField(id){return displayValueToMm(el(id).value,project.units)}
// RS-3025: called from each of the eight length fields' own 'input' listeners so a value the
// operator just typed also gets an exact-mm stash, computed from the raw typed value in the
// current display unit -- before any display-side rounding -- so it survives later Units round
// trips losslessly, same as a programmatic setLengthField() write. Without this, hand-typed values
// in prodSheetMargin/shipLengthMm/shipWidthMm/shipHeightMm/drawSlotWidthMm (which have no other
// writer besides direct typing) would never get a usable stash at all, leaving the original drift
// bug unfixed for exactly the fields an operator is most likely to type into.
function stashTypedLengthField(id){
  const mm=displayValueToMm(el(id).value,project.units);
  if(Number.isFinite(mm))el(id).dataset.mmValue=String(mm);else delete el(id).dataset.mmValue;
}
function refreshUnitLabels(){
  document.querySelectorAll('[data-unit-label]').forEach(labelEl=>{
    labelEl.textContent=`${labelEl.dataset.unitLabel} (${unitSuffix(project.units)})`;
  });
  const quickEl=el('projectUnitsQuick');if(quickEl)quickEl.value=project.units;
}
// Plate/Vessel fields mirror canonical project.plate/vessel mm state, so they can always be
// re-derived from `project` regardless of what units were previously displayed. prodSheetMargin
// and the Shipping length fields have no such canonical store on `project` (prodSheetMargin is a
// bare DOM field; Shipping's shippingInfo is session-only and only written on #shipApply) -- for
// those, convert the field's own current display value from `previousUnits` in place.
// RS-3025: that display-value-conversion path re-derives mm from an already-2-decimal-rounded
// display string, which drifts a few hundredths of a mm on every unit round trip. setLengthField()
// now stashes the exact mm it was last given in dataset.mmValue, and each field's own 'input'
// listener (via stashTypedLengthField()) re-stashes the exact mm computed from what was just typed
// -- so here, a stash is present and used directly whether the value came from a programmatic write
// or a hand-typed one; only a field with genuinely no parseable value (dataset.mmValue never set,
// or explicitly deleted for an unparseable typed value) falls back to the old convert-from-display
// path.
function refreshAllLengthFieldDisplays(previousUnits=project.units){
  setLengthField('plateOuterDiameter',project.plate.outerDiameterMm);
  setLengthField('plateInnerWellDiameter',project.plate.innerWellDiameterMm);
  setLengthField('plateOverallHeight',project.plate.overallHeightMm);
  setLengthField('plateCenterDepth',project.plate.centerDepthMm);
  setLengthField('vesselBodyDiameter',project.vessel.bodyDiameterMm);
  setLengthField('vesselBodyHeight',project.vessel.bodyHeightMm);
  setLengthField('vesselTopDiameter',project.vessel.topDiameterMm);
  for(const id of['prodSheetMargin','shipLengthMm','shipWidthMm','shipHeightMm','monogramWidth','monogramHeight','monogramSizeMarginMm','drawSlotWidthMm']){
    const stashedMm=parseFloat(el(id).dataset.mmValue);
    if(Number.isFinite(stashedMm)){
      el(id).value=formatLengthDisplay(stashedMm,project.units);
      el(id).dataset.mmValue=String(stashedMm);
      continue;
    }
    const raw=el(id).value;
    if(raw==='')continue;
    const mm=displayValueToMm(raw,previousUnits);
    if(!Number.isFinite(mm))continue;
    el(id).value=formatLengthDisplay(mm,project.units);
  }
}
// RS-3025: prodSheetMargin and the three Shipping fields never go through setLengthField() today
// (prodSheetMargin has no writer at all besides the operator; Shipping's own
// syncShippingFieldsFromState() in ShippingPanel.js formats directly) -- typing is their ONLY
// source of a value, so stashTypedLengthField() here is what actually fixes the drift for these
// four fields, not just parity with the setLengthField()-backed ones above.
for(const id of['prodSheetMargin','shipLengthMm','shipWidthMm','shipHeightMm']){
  el(id).addEventListener('input',()=>stashTypedLengthField(id));
}
// RS-3024: every convertible numeric field's HTML `step` attribute is mm-tuned and, unlike its
// `value`, was never made unit-aware -- in inches mode the spinner-arrow/Up-Down-key increment
// still applied the raw mm step unconverted. Proposed inch steps are clean round decimals (not a
// literal mm->in conversion of the step, which would produce ugly non-round increments).
const MM_STEP_TO_IN_STEP={0.1:0.01,0.5:0.02,1:0.05};
function refreshAllFieldSteps(){
  document.querySelectorAll('[data-mm-step]').forEach(inputEl=>{
    const mmStep=parseFloat(inputEl.dataset.mmStep);
    inputEl.step=project.units==='in'?(MM_STEP_TO_IN_STEP[mmStep]??mmStep):mmStep;
  });
}
async function applyUnitsChange(newUnits){
  const previousUnits=project.units;
  project.units=newUnits;
  refreshUnitLabels();
  refreshAllLengthFieldDisplays(previousUnits);
  // RS-3019: monogramWidth/Height's min/max bounds and #monogramFrameSizeHint (unlike their own
  // .value, just refreshed above) are otherwise only ever refreshed by #monogramFrame's own
  // 'change' listener or the one-time boot call -- both blind to a later Units switch.
  updateMonogramFrameSizeBounds();
  // RS-3020 Part E: updateDrawToolButtons() (Eraser/Stamp/Trace/Paint tool-session-state fields)
  // and syncSettingsFieldsFromState()/refreshSnapDistanceFieldBounds() (Snap Distance) are, like
  // updateMonogramFrameSizeBounds() above, outside updateAll()'s own refresh chain -- a Units
  // switch would otherwise leave their displayed values in the old unit until next touched.
  updateDrawToolButtons();
  syncSettingsFieldsFromState();
  refreshSnapDistanceFieldBounds();
  refreshAllFieldSteps();
  syncSelectedControlsFromLayer();
  await updateAll(true);
}
el('settingsUnits').addEventListener('change',()=>applyUnitsChange(el('settingsUnits').value));
el('projectUnitsQuick').addEventListener('change',()=>applyUnitsChange(el('projectUnitsQuick').value));

populateStoneColorOptions();populateStoneColorOptions('stampColor');populateStoneColorOptions('traceColor');populateStoneColorOptions('paintColor');populateStoneSizeOptions();populateMixedSizeSelectOptions();
// RS-2002: only populated when fontManager actually loaded -- if the manifest fetch failed,
// index.html's static two-option #font markup (Courier Prime/Great Vibes) is left as the fallback,
// and permanentEngineError's #status message (set inside updateAll(), see generate() above)
// already tells the user text layers are empty.
if(fontManager){populateFontOptions();injectFontFaceRules(fontManager.listFonts());populateFontCategoryFilterOptions()}
syncSelectedControlsFromLayer();updateAll(true);
// RC-005: reports the boot-time crash/refresh recovery decision (see the AutosaveManager setup
// above) last, once startup has otherwise finished -- but never over permanentEngineError's own
// #status message (set inside updateAll(), just above): a broken font manifest is the more urgent
// thing for the operator to see, and recovery already succeeded silently either way.
//
// RC-005 follow-up: a plain, never-dismissing #status line was reported as too easy to miss right
// after a recovery (the exact moment it matters most). #status is this app's one existing
// notification channel -- every other action already reports success/failure through it (Import,
// Export failures, runAlign/runDistribute, etc.) -- so this reuses it rather than adding a new
// toast/dialog/workflow. RECOVERY_NOTIFICATION_DISMISS_MS auto-clears it back to the exact "Ready"
// text index.html ships by default, but only if nothing else has changed #status in the meantime --
// a real subsequent action's own message must never be clobbered by this timer. bootStatusMessage
// is set in exactly one place (the boot-time recovery block above, only when autosave.load()
// actually returned a usable record), so this notification is never shown after a normal startup
// with nothing to recover, a manual Save, Import/Open, New Project, Gallery, or Design Library
// action -- none of those ever touch bootStatusMessage.
const RECOVERY_NOTIFICATION_DISMISS_MS=5000;
if(bootStatusMessage&&!permanentEngineError){
  el('status').textContent=bootStatusMessage;
  setTimeout(()=>{if(el('status').textContent===bootStatusMessage)el('status').textContent='Ready'},RECOVERY_NOTIFICATION_DISMISS_MS);
}
