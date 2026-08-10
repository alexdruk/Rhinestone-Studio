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
import { GeometryEngine as PermanentGeometryEngine, Stone, StoneLayout, combineManyShapeSources, SHAPE_LIBRARY_KINDS, FITTABLE_SHAPE_TYPES, computeInscribedRect, computeShapeFitScale, computeContainingShapeScale, dedupeStonesByRadius, listFrames } from './src/geometry/index.js';
import { FontManager } from './src/fonts/index.js';
import { createDefaultFontProviderRegistry, createDefaultRhinestoneFontRegistry, BoundingBox } from './src/text/index.js';
import { renderProductionLayout, renderStoneLayout, fitTransform } from './src/renderer/CanvasRenderer2D.js';
import { createPreview3D } from './src/preview3d/index.js';
import { circumferenceMm, frontViewFrameWidthMm, canvasXMmForRotationDeg, rotationDegForCanvasXMm, azimuthRadForCanvasXMm, wrapAngleRad } from './src/preview3d/ObjectDimensions.js';
import { STONE_COLORS } from './src/renderer/StoneColors.js';
import { listStoneSizes, findStoneSizeByDiameterMm, stoneSizeHeightMidpointMm, isHeightWithinStoneSizeRange, stoneSizeEntirelyExceedsPrintableHeight } from './src/renderer/StoneSizes.js';
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
import { createDrawingTool } from './src/drawing/index.js';
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
// Photoshop's Brush convention (more recognizable than an arbitrary "D"); G=Polygon deliberately
// reserves P for a future Bezier Pen tool (Illustrator/Figma's near-universal "Pen" binding), per
// Sasha's own roadmap for this rail.
const DRAW_TOOL_SHORTCUT_KEYS={v:'select',b:'freehand',r:'rect',e:'ellipse',s:'slot',g:'polygon'};
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
// string keys STONE_COLORS is built from). Called once at startup -- index.html no longer
// hardcodes any <option> for this select.
function populateStoneColorOptions(){const groups=new Map();for(const c of Object.values(STONE_COLORS)){if(!groups.has(c.group))groups.set(c.group,[]);groups.get(c.group).push(c)}el('stoneColor').innerHTML=[...groups.entries()].map(([group,colors])=>`<optgroup label="${escapeHtml(group)}">${colors.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</optgroup>`).join('')}
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
function groupFontsByCategory(fonts){const groups=new Map();for(const f of fonts){const key=f.role||'display';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f)}for(const list of groups.values())list.sort((a,b)=>a.family.localeCompare(b.family));return[...groups.entries()].sort((a,b)=>fontCategoryLabel(a[0]).localeCompare(fontCategoryLabel(b[0])))}
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
// FONT-002: only Production Fonts (providerId 'rhinestone') are offered here -- OpenType fonts stay
// fully registered/enabled (existing projects keep loading/rendering/exporting unchanged, see
// resolveFontProviderId() below) but are no longer offered as a *pick* for new/other text layers.
// FONT-DECISION-001: an OpenType font can also earn a place here by clearing this project's
// human-and-metric rhinestone legibility bar (manifest `rhinestoneValidated:true`) -- unvalidated
// legacy OpenType fonts remain hidden exactly as FONT-002 decided.
// A layer that already uses one is handled by ensureFontOptionForLayer(), not by listing it here.
function productionFonts(){return fontManager?fontManager.listFonts().filter(f=>f.providerId==='rhinestone'||f.rhinestoneValidated===true):[]}
function populateFontOptions(){if(!fontManager)return;el('font').innerHTML=groupFontsByCategory(productionFonts()).map(([role,fonts])=>`<optgroup label="${escapeHtml(fontCategoryLabel(role))}">${fonts.map(f=>`<option value="${f.id}" style="font-family:'${cssFontFamily(f.family)}'">${escapeHtml(f.family)}</option>`).join('')}</optgroup>`).join('')}
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
function fontLibraryRowHtml(f,currentFontId){const isFav=favoriteFontIds.has(f.id);return`<div class="font-library-row"><button type="button" class="font-fav${isFav?' active':''}" data-fav-font="${f.id}" title="${isFav?'Remove from favorites':'Add to favorites'}" aria-pressed="${isFav}">${isFav?'★':'☆'}</button><button type="button" class="font-library-item" data-pick-font="${f.id}" role="option" aria-selected="${f.id===currentFontId}"><canvas class="font-preview-canvas" data-preview-font="${f.id}" width="160" height="36" aria-hidden="true"></canvas><span class="font-library-item-meta"><span class="font-library-item-name">${escapeHtml(f.family)}</span><span class="font-library-item-category">${escapeHtml(fontCategoryLabel(f.role))}</span></span></button></div>`}
// Renders the Browse Fonts panel's list: pinned "Recently Used" then "Favorites" groups (each only
// among fonts matching the current search/category filter), then every category group in
// alphabetical order, then kicks off (without awaiting) filling in every row's live rhinestone
// preview. Re-run on every search keystroke, category change, and favorite toggle; cheap at this
// catalog size (12 fonts today) since preview generation itself is cached.
function renderFontLibraryList(){if(!fontManager)return;const list=el('fontLibraryList');const query=fontSearchQuery.trim().toLowerCase();const fonts=productionFonts().filter(f=>(!fontCategoryFilterValue||f.role===fontCategoryFilterValue)&&(!query||f.family.toLowerCase().includes(query)||fontCategoryLabel(f.role).toLowerCase().includes(query)));if(fonts.length===0){list.innerHTML='<div class="font-library-empty">No fonts match your search.</div>';return}const currentFontId=el('font').value;const recents=recentFontIds.map(id=>fonts.find(f=>f.id===id)).filter(Boolean);const favorites=fonts.filter(f=>favoriteFontIds.has(f.id)).sort((a,b)=>a.family.localeCompare(b.family));let html='';if(recents.length)html+=`<div class="font-library-group">Recently Used</div>${recents.map(f=>fontLibraryRowHtml(f,currentFontId)).join('')}`;if(favorites.length)html+=`<div class="font-library-group">Favorites</div>${favorites.map(f=>fontLibraryRowHtml(f,currentFontId)).join('')}`;for(const[role,group]of groupFontsByCategory(fonts))html+=`<div class="font-library-group">${escapeHtml(fontCategoryLabel(role))}</div>${group.map(f=>fontLibraryRowHtml(f,currentFontId)).join('')}`;list.innerHTML=html;populateFontPreviewCanvases(list).catch(error=>console.error('Font preview rendering failed',error))}
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
// S-107: the minimum heightMm/spacingMm ratio auto-fit will shrink text to. spacingMm (stoneSize+gap)
// is the fixed physical stone pitch -- unlike heightMm, it never scales down here, because a stone's
// size is a real catalog rhinestone (see src/renderer/StoneSizes.js), not a continuously-adjustable
// display value; shrinking it during auto-fit would silently produce a non-orderable size. Below
// this ratio there are too few stones across a glyph's shrunk stroke width for the letterform to
// read as anything but a blurred row of dots (confirmed empirically -- see
// docs/specifications/S-107-LongTextReadability.md's audit). Auto-fit still shrinks heightMm as much
// as it can within this floor; only text so long it would need to shrink past the floor now overflows
// maxWidth instead of collapsing into illegible stone soup.
const MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO=6;
// Computes the heightMm scale factor generateTextStonesLive()/resolveLayerShapeSource() apply for
// auto-fit text, given that text's straight (unscaled) measured widthMm. Shared by both call sites
// so their auto-fit decisions can never drift apart (mirrors computeTextPlacementOffset() above).
// `scale` is 1 (no change) whenever auto-fit is off, the text already fits, or heightMm/spacingMm is
// degenerate -- this arithmetic is byte-identical to before this milestone's follow-up.
function computeAutoFitScale(layer,project,measuredWidthMm){
  if(!layer.autoFit||!(measuredWidthMm>0))return{scale:1};
  const maxWidth=project.canvas.width-10;
  if(measuredWidthMm<=maxWidth)return{scale:1};
  const fitScale=maxWidth/measuredWidthMm;
  const spacingMm=(layer.stoneSize||0)+(layer.gap||0);
  const minScale=spacingMm>0&&layer.height>0?(spacingMm*MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO)/layer.height:fitScale;
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
// TXT-104 step 4b: the read/display half of #letterHeight's bidirectional sync with #height -- called
// from updateTextFontCapabilityUI() (the one place guaranteed to run after every source of a #height
// value change: a direct edit, the stone-size auto-set snap, or a fresh layer selection) whenever
// #letterHeightField is shown. Pure DOM read -> solveDesiredCapHeightMm() -> DOM write; never itself
// dispatches an event, so it can never trigger #letterHeight's own write-direction listener below.
function syncLetterHeightFromHeight(fontId){
  const engineHeightMm=parseFloat(el('height').value);
  if(!Number.isFinite(engineHeightMm))return;
  el('letterHeight').value=solveDesiredCapHeightMm({fontId,engineHeightMm}).toFixed(2);
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
  star:'Star',heart:'Heart',arrow:'Arrow',cross:'Cross',crescent:'Crescent',ring:'Ring'
};
// Default creation size (mm) for each non-circle shape kind, centered on the same (105,45) point
// the original circle/rectangle defaults already used (a 210x90mm default canvas's own center).
// Rectangle's own w/h here (80x30) is unchanged from its pre-S-110 default. Most kinds default to a
// square box so a Regular Polygon/Star/Ring/Cross reads as its canonical, undistorted shape at
// creation (distortion via resize is opt-in, not the default look) -- Capsule and Arrow are
// deliberately non-square since a stretched-to-square pill/arrow would no longer read as one.
const SHAPE_DEFAULT_SIZES_MM={
  rectangle:{w:80,h:30},ellipse:{w:70,h:45},capsule:{w:80,h:40},polygon:{w:60,h:60},star:{w:60,h:60},
  heart:{w:55,h:50},arrow:{w:70,h:42},cross:{w:55,h:55},crescent:{w:50,h:62},ring:{w:60,h:60}
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
 // FONT-002: an unknown font id (not just one hidden from the picker -- see isFontKnown()) is never
 // silently substituted for DEFAULT_TEXT_FONT_ID; that layer's stones are skipped (same shape as an
 // empty-text layer already returning []), and updateTextFontCapabilityUI() surfaces why while it's
 // selected. layer.font itself is left untouched in `project`.
 async generateTextStonesLive(layer,project){if(!this.permanentEngine||!this.permanentEngine.canGenerateText||!layer.text||!isFontKnown(layer.font))return[];const base={...buildTextLayoutBaseParams(layer),
  // MONO-005A: see resolveAuthoredScale()'s own doc comment. No effect on sampled/OpenType text --
  // GeometryEngine only ever reads authoredScale inside its authored-stone-center branch.
  authoredScale:resolveAuthoredScale(layer)};let result=await this.permanentEngine.generateTextLayout(base);if(layer.autoFit){const{scale}=computeAutoFitScale(layer,project,result.widthMm);if(scale<1){const scaledHeight=Math.max(1,layer.height*scale);result=await this.permanentEngine.generateTextLayout({...base,heightMm:scaledHeight})}}const bb=result.getBoundingBox();
  // RS-1009: text layers previously had no position field -- stones were always centered on the
  // canvas. layer.x/layer.y (mm, default 0) are a further offset applied on top of that same
  // auto-centered base position, so pre-RS-1009 Project JSON (no x/y on its text layers) renders
  // byte-identical to before, and dragging/nudging/aligning a text layer just moves this offset.
  const{offsetX,offsetY}=computeTextPlacementOffset(bb,layer,project);return result.stones.map(s=>({x:s.xMm+offsetX,y:s.yMm+offsetY,d:s.sizeMm,color:s.color,layerId:s.layerId}))}
 // RS-0003.5C1: circle/rectangle layers are generated by the same permanent engine's
 // generateShapeLayout(), mirroring generateTextStonesLive() above. S-110: every new shape kind
 // (Ellipse/Capsule/Regular Polygon/Star/Heart/Arrow/Cross/Crescent/Ring) goes through this exact
 // same call, via shapeLayerResolveParams()'s shared layer->params mapping (module scope, above).
 async generateShapeStonesLive(layer){if(!this.permanentEngine)return[];const params={...shapeLayerResolveParams(layer),stoneSizeMm:layer.stoneSize,gapMm:layer.gap,mode:resolveVectorFillMode(layer.fillMode),color:layer.color,...mixedSizeParamsFor(layer)};const result=this.permanentEngine.generateShapeLayout(params);return result.stones.map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:s.color,layerId:s.layerId}))}
 // RS-1001: svg layers reuse the same x/y/w/h placement box rectangle layers use; src/svg/**
 // (not app.js) does the actual SVG parsing, inside generateSvgLayout().
 async generateSvgStonesLive(layer){if(!this.permanentEngine)return[];const params={svgSource:layer.svgSource,layerId:layer.id,xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h,stoneSizeMm:layer.stoneSize,gapMm:layer.gap,mode:resolveVectorFillMode(layer.mode),color:layer.color,...mixedSizeParamsFor(layer)};const result=this.permanentEngine.generateSvgLayout(params);return result.stones.map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:s.color,layerId:s.layerId}))}
 // RS-1008A: image layers go through the permanent engine's generateImageLayout(), mirroring
 // generateSvgStonesLive()/generateShapeStonesLive() above -- src/image/** only prepares the
 // decoded pixel buffer (decode/cache happens here since that's the one async, DOM-only step;
 // generateImageLayout() itself is synchronous, like generateShapeLayout()). imageBufferCache means
 // the (comparatively expensive) browser image decode only re-runs the first time a given imageSrc
 // is seen; every subsequent call here only re-runs the permanent engine's pure/fast pipeline.
 async generateImageStonesLive(layer){if(!this.permanentEngine||!layer.imageSrc)return[];let buffer=imageBufferCache.get(layer.imageSrc);if(!buffer){buffer=await decodeDataUrlToBuffer(layer.imageSrc);imageBufferCache.set(layer.imageSrc,buffer)}const params={imageBuffer:buffer,layerId:layer.id,xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h,stoneSizeMm:layer.stoneSize,gapMm:layer.gap,mode:resolveImageFillMode(layer.fillMode),color:layer.color,threshold:layer.threshold,invert:layer.invert,blurRadiusPx:layer.blurRadiusPx,maxWidthPx:layer.maxWidthPx,maxHeightPx:layer.maxHeightPx,...mixedSizeParamsFor(layer)};const result=this.permanentEngine.generateImageLayout(params);return result.stones.map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:s.color,layerId:s.layerId}))}
 // RS-1012: 'path' layers (Boolean Operation results) go through the permanent engine's
 // generatePathLayout(), mirroring generateSvgStonesLive()/generateShapeStonesLive() above --
 // layer.contours is already plain (0,0)-rooted polygon data (no parsing step, unlike SVG).
 async generatePathStonesLive(layer){if(!this.permanentEngine)return[];const params={contours:layer.contours.map(c=>c.map(p=>({xMm:p.x,yMm:p.y}))),layerId:layer.id,xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h,stoneSizeMm:layer.stoneSize,gapMm:layer.gap,mode:resolveVectorFillMode(layer.fillMode),color:layer.color,...mixedSizeParamsFor(layer)};const result=this.permanentEngine.generatePathLayout(params);return result.stones.map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:s.color,layerId:s.layerId}))}
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
function defaultProject(){const vessel=getVesselDefaults('mug');return{version:2,units:'mm',name:DEFAULT_PROJECT_NAME,product:'mug',canvas:computeCanvasFromVessel(vessel),cupColor:'#1f3556',wrap:'front',plate:getPlateDefaults(),vessel,layers:[{id:'text',type:'text',visible:true,text:'Vitalina Serbin',font:DEFAULT_TEXT_FONT_ID,height:25,heightMode:'capHeight',textMode:'stroke',stoneSize:2.8,gap:.3,color:'gold',autoFit:false,curveEnabled:false,curveRadiusMm:40,curveDirection:'outside',curveStartAngleDeg:0,curveSweepAngleDeg:180,curveAlignment:'center',align:'left',lineSpacing:1,rotationDeg:0,x:0,y:0}]}}
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
  return{version:Number(obj.version)||2,units:'mm',name:typeof obj.name==='string'&&obj.name.length>0?obj.name:DEFAULT_PROJECT_NAME,product:productId,canvas:{width:canvas.width,height:canvas.height},cupColor:typeof obj.cupColor==='string'?obj.cupColor:'#1f3556',wrap:typeof obj.wrap==='string'?obj.wrap:'front',plate:normalizePlateParams(obj.plate),vessel,layers:obj.layers.map(l=>({...l,visible:l.visible!==false}))}
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
    l.x=boundsMm.left;l.y=boundsMm.top;l.w=boundsMm.width;l.h=boundsMm.height;
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
    return{stoneSizeMm:l.stoneSize,gapMm:l.gap,mode:resolveVectorFillMode(l.fillMode),color:l.color,...mixedSizeParamsFor(l)};
  },
  // Mirrors generatePathStonesLive()'s own result mapping, plus resolving the stored color id
  // (STONE_COLORS key, e.g. 'gold') to its previewColor -- the same flat swatch color
  // updateStoneColorSwatch()/populateStoneColorOptions() already use, since the live Design dots are
  // plain paper.Path.Circle fills, not CanvasRenderer2D.js's faceted drawCrystalStone() look.
  generatePathLayout:(params)=>{
    if(!permanentEngine)return[];
    const result=permanentEngine.generatePathLayout(params);
    return result.stones.map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:(STONE_COLORS[s.color]&&STONE_COLORS[s.color].previewColor)||s.color}));
  }
});
// RS-3010 Step 2d: exposes drawingTool's own debugGrid/debugHitTestShapeId QA-only surface for
// automated verification of the Design canvas's background grid layering -- same "read-only,
// never used to drive any application logic" precedent as window.__preview3D above.
window.__drawingTool=drawingTool;
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
function applyHistorySnapshot(snap){project=snap.project;selectedLayerId=snap.selectedLayerId;syncSelectedControlsFromLayer();updateAll(true)}
function performUndo(){closeHistorySession();const snap=history.undo(currentSnapshot());if(!snap){el('status').textContent='Nothing to undo';updateHistoryUI();return}applyHistorySnapshot(snap);el('status').textContent='Undo'}
function performRedo(){closeHistorySession();const snap=history.redo(currentSnapshot());if(!snap){el('status').textContent='Nothing to redo';updateHistoryUI();return}applyHistorySnapshot(snap);el('status').textContent='Redo'}
function updateHistoryUI(){const undoBtn=el('undoBtn'),redoBtn=el('redoBtn'),dirtyEl=el('dirtyIndicator');if(undoBtn)undoBtn.disabled=!history.canUndo;if(redoBtn)redoBtn.disabled=!history.canRedo;if(dirtyEl)dirtyEl.textContent=JSON.stringify(project)!==cleanProjectJson?'Unsaved changes':'Saved';
  // UI-001: the left panel's Actions-section Undo/Redo buttons mirror the top bar's undoBtn/redoBtn
  // disabled state exactly -- both call the same performUndo()/performRedo(), never a second history.
  const actionUndoBtn=el('actionUndo'),actionRedoBtn=el('actionRedo');if(actionUndoBtn)actionUndoBtn.disabled=!history.canUndo;if(actionRedoBtn)actionRedoBtn.disabled=!history.canRedo;
}function syncSelectedControlsFromLayer(){const l=selectedLayer();el('selectedLayer').value=l.id;const isText=l.type==='text';el('textControls').style.display=isText?'block':'none';el('shapeControls').style.display=isText?'none':'block';
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
  if(isText){el('text').value=l.text;ensureFontOptionForLayer(l.font);el('font').value=l.font;el('height').value=l.height;el('heightAutoAdjustedHint').style.display='none';el('autoFit').value=l.autoFit?'on':'off';el('autoFitOnHint').style.display='none';el('textMode').value=l.textMode||'stroke';el('curveEnabled').value=l.curveEnabled?'on':'off';el('curveRadiusMm').value=l.curveRadiusMm??40;el('curveDirection').value=l.curveDirection||'outside';el('curveStartAngleDeg').value=l.curveStartAngleDeg??0;el('curveSweepAngleDeg').value=l.curveSweepAngleDeg??180;el('curveAlignment').value=l.curveAlignment||'center';el('curveControls').style.display=l.curveEnabled?'block':'none';el('textX').value=l.x||0;el('textY').value=l.y||0;
  // TXT-102: '??'/'||' fallbacks so a pre-TXT-102 project (no align/lineSpacing/rotationDeg stored)
  // displays GeometryEngine's own defaults, matching this line's existing curve-field convention.
  el('textAlign').value=l.align||'left';el('lineSpacing').value=l.lineSpacing??1;el('rotationDeg').value=l.rotationDeg??0}else{el('shapeX').value=l.type==='circle'?l.cx:l.x;el('shapeY').value=l.type==='circle'?l.cy:l.y;el('shapeW').value=l.type==='circle'?l.r:l.w;el('shapeH').value=l.type==='circle'?'':l.h;el('shapeWLabel').textContent=l.type==='circle'?'Radius (mm)':'Width (mm)';el('shapeHField').style.display=l.type==='circle'?'none':'';if(l.type==='svg')el('svgMode').value=resolveVectorFillMode(l.mode);if(l.type==='image'){el('imgThreshold').value=l.threshold??DEFAULT_IMAGE_THRESHOLD;el('imgInvert').value=l.invert?'on':'off';el('imgBlurRadius').value=l.blurRadiusPx??0;el('imgMaxWidth').value=l.maxWidthPx??DEFAULT_IMAGE_MAX_DIMENSION_PX;el('imgMaxHeight').value=l.maxHeightPx??DEFAULT_IMAGE_MAX_DIMENSION_PX}}ensureStoneSizeOption(el('stoneSize'),l.stoneSize);setNumericSelectValue(el('stoneSize'),l.stoneSize);el('gap').value=l.gap;el('stoneColor').value=l.color;
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
  el('plateOuterDiameter').value=project.plate.outerDiameterMm;el('plateInnerWellDiameter').value=project.plate.innerWellDiameterMm;el('plateOverallHeight').value=project.plate.overallHeightMm;el('plateCenterDepth').value=project.plate.centerDepthMm;el('plateColor').value=project.plate.colorId;el('plateDesignTarget').value=project.plate.designTarget;
  // RS-2010: project.vessel is likewise project-level -- resync for the same reason as project.plate
  // just above.
  el('vesselBodyDiameter').value=project.vessel.bodyDiameterMm;el('vesselBodyHeight').value=project.vessel.bodyHeightMm;el('vesselTopDiameter').value=project.vessel.topDiameterMm;
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
function writeSelectedControlsToLayer(){const l=selectedLayer();
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
    if(enteringRimBand){el('curveEnabled').value='on';el('curveRadiusMm').value=rimBandCurveRadiusMm().toFixed(2);el('curveDirection').value='outside';el('curveControls').style.display='block'}
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
    l.height=Math.max(RAW_ENGINE_HEIGHT_MM_MIN,Math.min(RAW_ENGINE_HEIGHT_MM_MAX,parseFloat(el('height').value)||25));l.autoFit=el('autoFit').value==='on';l.textMode=el('textMode').value;
    // FONT-002: a Production Font has no curve support (GeometryEngine.generateTextLayout() throws
    // for authored-stone-center fonts with curveEnabled) -- force it off in the stored layer data too
    // (not just the disabled control) so switching *to* an authored font from a curved legacy layer
    // can never leave curveEnabled:true sitting in the data.
    l.curveEnabled=isAuthoredStoneFontId(l.font)?false:el('curveEnabled').value==='on';l.curveRadiusMm=Math.max(0.1,parseFloat(el('curveRadiusMm').value)||40);l.curveDirection=el('curveDirection').value==='inside'?'inside':'outside';l.curveStartAngleDeg=parseFloat(el('curveStartAngleDeg').value)||0;l.curveSweepAngleDeg=parseFloat(el('curveSweepAngleDeg').value)||180;l.curveAlignment=el('curveAlignment').value;el('curveControls').style.display=l.curveEnabled?'block':'none';
  // UI-001: manual X/Y mm fields for the Text Lightbox, writing to the same layer.x/layer.y fields
  // RS-1009 already added (previously settable only by drag/nudge/align/distribute).
  l.x=parseFloat(el('textX').value)||0;l.y=parseFloat(el('textY').value)||0;
  // TXT-102: align/lineSpacing mirror curveAlignment/curveRadiusMm's own clamp-on-write convention
  // just above -- lineSpacing clamped to the same [0.5,3] range the #lineSpacing input itself allows,
  // rotationDeg normalized into [0,360) exactly like GeometryEngine's own normalizeRotationDeg().
  l.align=el('textAlign').value;l.lineSpacing=Math.max(0.5,Math.min(3,parseFloat(el('lineSpacing').value)||1));l.rotationDeg=(((parseFloat(el('rotationDeg').value)||0)%360)+360)%360}else if(l.type==='circle'){l.cx=parseFloat(el('shapeX').value)||105;l.cy=parseFloat(el('shapeY').value)||45;l.r=Math.max(1,parseFloat(el('shapeW').value)||18);l.fillMode=resolveVectorFillMode(el('shapeFillMode').value)}else if(l.type==='rectangle'){l.x=parseFloat(el('shapeX').value)||65;l.y=parseFloat(el('shapeY').value)||30;l.w=Math.max(1,parseFloat(el('shapeW').value)||80);l.h=Math.max(1,parseFloat(el('shapeH').value)||30);l.fillMode=resolveVectorFillMode(el('shapeFillMode').value)}else if(SHAPE_LIBRARY_KINDS.has(l.type)){
  // S-110: every new shape kind shares Rectangle's x/y/w/h + Fill Style write-back, plus its own
  // configurable extra fields (Regular Polygon/Star/Ring only).
  l.x=parseFloat(el('shapeX').value)||0;l.y=parseFloat(el('shapeY').value)||0;l.w=Math.max(1,parseFloat(el('shapeW').value)||60);l.h=Math.max(1,parseFloat(el('shapeH').value)||60);l.fillMode=resolveVectorFillMode(el('shapeFillMode').value);
  if(l.type==='polygon')l.sides=Math.max(3,Math.min(12,parseIntOr(el('shapeSides').value,6)));
  if(l.type==='star'){l.points=Math.max(3,Math.min(12,parseIntOr(el('shapePoints').value,5)));l.innerRadiusRatio=Math.max(0.1,Math.min(0.9,parseFloat(el('shapeInnerRadius').value)||0.5))}
  if(l.type==='ring')l.innerRatio=Math.max(0.1,Math.min(0.9,parseFloat(el('shapeRingInner').value)||0.5));
}else if(l.type==='svg'){l.x=parseFloat(el('shapeX').value)||0;l.y=parseFloat(el('shapeY').value)||0;l.w=Math.max(1,parseFloat(el('shapeW').value)||10);l.h=Math.max(1,parseFloat(el('shapeH').value)||10);l.mode=resolveVectorFillMode(el('svgMode').value)}else if(l.type==='image'){l.x=parseFloat(el('shapeX').value)||0;l.y=parseFloat(el('shapeY').value)||0;l.w=Math.max(1,parseFloat(el('shapeW').value)||10);l.h=Math.max(1,parseFloat(el('shapeH').value)||10);l.threshold=Math.max(0,Math.min(255,parseIntOr(el('imgThreshold').value,DEFAULT_IMAGE_THRESHOLD)));l.invert=el('imgInvert').value==='on';l.blurRadiusPx=Math.max(0,parseIntOr(el('imgBlurRadius').value,0));l.maxWidthPx=Math.max(8,parseIntOr(el('imgMaxWidth').value,DEFAULT_IMAGE_MAX_DIMENSION_PX));l.maxHeightPx=Math.max(8,parseIntOr(el('imgMaxHeight').value,DEFAULT_IMAGE_MAX_DIMENSION_PX));l.fillMode=resolveImageFillMode(el('imageFillMode').value)}else if(l.type==='path'){l.x=parseFloat(el('shapeX').value)||0;l.y=parseFloat(el('shapeY').value)||0;l.w=Math.max(2,parseFloat(el('shapeW').value)||10);l.h=Math.max(2,parseFloat(el('shapeH').value)||10);l.fillMode=resolveVectorFillMode(el('shapeFillMode').value)}
  const nextStoneSize=parseFloat(el('stoneSize').value)||2;if(nextStoneSize!==l.stoneSize)invalidateAuthoredScaleForGeometryChange(l,'stoneSize');l.stoneSize=nextStoneSize;
  const nextGap=parseFloat(el('gap').value)||.3;if(nextGap!==l.gap)invalidateAuthoredScaleForGeometryChange(l,'gap');l.gap=nextGap;
  l.color=el('stoneColor').value;
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
    project.plate=normalizePlateParams({outerDiameterMm:parseFloat(el('plateOuterDiameter').value),innerWellDiameterMm:parseFloat(el('plateInnerWellDiameter').value),overallHeightMm:parseFloat(el('plateOverallHeight').value),centerDepthMm:parseFloat(el('plateCenterDepth').value),footRingOuterDiameterMm:project.plate.footRingOuterDiameterMm,footRingHeightMm:project.plate.footRingHeightMm,colorId:el('plateColor').value,designTarget:el('plateDesignTarget').value});
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
    project.vessel=normalizeVesselParams(vesselProductId,{bodyDiameterMm:parseFloat(el('vesselBodyDiameter').value),topDiameterMm:parseFloat(el('vesselTopDiameter').value),bodyHeightMm:parseFloat(el('vesselBodyHeight').value)});
    project.canvas=computeCanvasFromVessel(project.vessel);
  }
  project.name=el('projectName').value||DEFAULT_PROJECT_NAME;rotation=parseFloat(el('rotation').value)||0;zoom=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,(parseFloat(el('zoom').value)||100)/100))}
async function updateAll(skipWrite=false){if(!skipWrite)writeSelectedControlsToLayer();const token=++generationToken;let generated;try{generated=await engine.generate(project)}catch(error){if(token!==generationToken)return;console.error('Layout generation failed',error);el('status').textContent=`Text generation failed: ${error.message}`;return}if(token!==generationToken)return;layout=generated;
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
  // comment for why this is a no-op after an ordinary Design-originated commit/move/resize/delete.
  drawingTool.syncFromProjectLayers(project.layers.filter(l=>l.type==='path'))}else{drawLayout()}drawCup();updateStats();updateHistoryUI();updateEditingUI();updateViewButtons();updateTextOutsidePrintableWarning();scheduleAutosave();if(permanentEngineError)el('status').textContent=`Font manifest failed to load (${permanentEngineError.message}); text layers are empty. Shape layers are unaffected.`}// S-003: a project must always keep at least one layer (deleteLayer()'s guard below), so once
// only one layer remains, every delete affordance -- the per-row trash icon and the sidebar
// "Delete selected layer" button -- is disabled here (not just left clickable-but-a-no-op) and
// #layerRuleHint (sitting directly under the button, always in view) explains why. This runs on
// every renderLayerUI() call (i.e. after every add/delete/duplicate/undo/redo/import), so the
// disabled state and hint never go stale relative to the current layer count.
function renderLayerUI(){const onlyOneLayer=project.layers.length<=1;el('selectedLayer').innerHTML=project.layers.map(l=>`<option value="${escapeHtml(l.id)}">${escapeHtml(layerLabel(l))}</option>`).join('');el('selectedLayer').value=selectedLayerId;el('layersList').innerHTML=project.layers.map(l=>`<div class="layer ${selectedLayerIds.has(l.id)?'selected':''}" data-layer="${escapeHtml(l.id)}"><input type="checkbox" ${l.visible?'checked':''} data-action="visible"><div class="name" data-action="select" title="${escapeHtml(layerLabel(l))}">${escapeHtml(layerLabel(l))}</div><div class="type">${l.type.toUpperCase()}</div><button data-action="select">✎</button><button data-action="duplicate">⧉</button><button data-action="delete" ${onlyOneLayer?'disabled title="At least one layer is required"':''}>🗑</button></div>`).join('');el('deleteSelected').disabled=onlyOneLayer;el('deleteSelected').title=onlyOneLayer?'At least one layer is required':'';el('layerRuleHint').style.display=onlyOneLayer?'block':'none';
  // UI-001: keep the right inspector's layer name and the left panel's project/template summary
  // in sync on every render (add/delete/duplicate/undo/redo/import/selection change).
  el('inspectorLayerName').textContent=layerLabel(selectedLayer());updateObjectTemplateDetail();
}function layerLabel(l){if(l.type==='text')return l.text||'Text';if(l.type==='svg')return l.svgName||'SVG';if(l.type==='image')return l.imageName||'Image';if(l.type==='path')return l.pathName||'Path';return SHAPE_DISPLAY_LABELS[l.type]||'Shape'}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function resizeCanvas(c){const r=c.getBoundingClientRect(),dpr=Math.max(1,devicePixelRatio||1),w=Math.floor(r.width*dpr),h=Math.floor(r.height*dpr);if(c.width!==w||c.height!==h){c.width=w;c.height=h}return{w,h,dpr}}
function layoutMmToPx(p){return{x:layoutTransform.ox+p.x*layoutTransform.s,y:layoutTransform.oy+p.y*layoutTransform.s}}function layoutPxToMm(x,y){return{x:(x-layoutTransform.ox)/layoutTransform.s,y:(y-layoutTransform.oy)/layoutTransform.s}}
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
  const{w,h,dpr}=resizeCanvas(layoutCanvas),ctx=layoutCanvas.getContext('2d');const{s,ox,oy}=renderProductionLayout(ctx,layout,{widthPx:w,heightPx:h,paddingPx:38*dpr});layoutTransform={s,ox,oy,dpr};
  // S-112: the plate template draws its own circular/annular design-target guide instead of the
  // cylindrical Front View Frame + rectangular safe-area guide -- neither applies to a flat
  // top-down disc (see drawPlateDesignTargetGuide()'s own header comment).
  const isPlate=currentObjectTemplate().preview.kind==='plate';
  if(isPlate){drawPlateDesignTargetGuide(ctx,s,ox,oy,dpr)}else{drawFrontViewFrame(ctx,s,ox,oy,dpr);if(showSafeArea)drawSafeAreaGuide(ctx,s,ox,oy,dpr,getSafeAreaRectMm(currentObjectTemplate(),project.canvas.width,project.canvas.height))}
  drawSelection(ctx,s,ox,oy,dpr);drawGuides(ctx,s,ox,oy,dpr);ctx.fillStyle='#516071';ctx.font=`${12*dpr}px Arial`;ctx.fillText(`${layout.count} stones · ${layout.widthMm.toFixed(1)}×${layout.heightMm.toFixed(1)} mm · ${selectedLayer().textMode||''}`,20*dpr,h-18*dpr);el('fitNotice').textContent=isPlate?'Drag to move (Shift = constrain, Alt = duplicate) · Shift-click to multi-select · click empty canvas to clear · Arrow keys nudge (Shift = larger step) · Blue guide shows the selected Design Target’s printable boundary.':'Drag to move (Shift = constrain, Alt = duplicate) · Shift-click to multi-select · click empty canvas to clear · Arrow keys nudge (Shift = larger step) · Drag the amber Front View Frame to rotate the Object Preview.'}
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
  const label=`Front View · ${frameWidthMm.toFixed(1)} mm`;
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
// Text layers have no plain layer fields to compute a bbox from directly (unlike circle/
// rectangle), so their selection bbox is derived from the already-generated StoneLayout, filtered
// to this layer's stones and wrapped in a fresh StoneLayout to reuse its getBoundingBox() math.
function getLayerBBox(l){if(l.type==='circle')return{x:l.cx-l.r,y:l.cy-l.r,width:l.r*2,height:l.r*2,x2:l.cx+l.r,y2:l.cy+l.r};if(XYWH_SHAPE_TYPES.has(l.type))return{x:l.x,y:l.y,width:l.w,height:l.h,x2:l.x+l.w,y2:l.y+l.h};const stones=layout.stones.filter(s=>s.layerId===l.id);if(!stones.length)return{x:0,y:0,x2:0,y2:0,width:0,height:0};const b=new StoneLayout({layerId:l.id,stones}).getBoundingBox();return{x:b.minXmm,y:b.minYmm,x2:b.maxXmm,y2:b.maxYmm,width:b.widthMm,height:b.heightMm}}
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
    const{polygons,boundingBox}=permanentEngine.resolvePathPolygons({contours:layer.contours.map(c=>c.map(p=>({xMm:p.x,yMm:p.y}))),layerId:layer.id,xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h});
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
    const base={text:layer.text,fontId,providerId:resolveFontProviderId(fontId),layerId:layer.id,heightMm:layer.height,curveEnabled:Boolean(layer.curveEnabled),curveRadiusMm:layer.curveRadiusMm,curveDirection:layer.curveDirection,curveStartAngleDeg:layer.curveStartAngleDeg,curveSweepAngleDeg:layer.curveSweepAngleDeg,curveAlignment:layer.curveAlignment};
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
  // FONT-DECISION-001: a known, non-authored font can still be one of productionFonts()'s offered
  // picks (rhinestoneValidated:true) -- only a font that's neither authored nor offered is "legacy".
  const validated=known&&!authored&&fontManager.getFont(fontId).rhinestoneValidated===true;
  const legacy=known&&!authored&&!validated;
  const unknown=isText&&!known;
  el('textModeField').style.display=authored?'none':'block';
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
  if(showLetterHeight){
    const bounds=computeLetterHeightBoundsMm(fontId);
    el('letterHeight').min=bounds.minMm;el('letterHeight').max=bounds.maxMm;
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
// RS-0003.5D2: SELECTION_HANDLE_SIZE_PX enlarges the resize handles slightly (was a bare 10px
// square) and a white halo is stroked behind the dashed outline so the selection reads clearly
// against any background (light grid, light/dark stones), not just against the plain canvas.
const SELECTION_HANDLE_SIZE_PX=11;
// RS-1009: draws one selection box (+ optional resize handles); drawSelection() below calls this
// once per multi-selected layer. Handles only ever draw when exactly one layer is selected
// (multi-layer resize is out of scope for this milestone) -- unchanged single-selection visuals.
function drawSelectionBox(ctx,s,ox,oy,dpr,b,showHandles){const rx=ox+b.x*s,ry=oy+b.y*s,rw=b.width*s,rh=b.height*s;ctx.save();ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=4*dpr;ctx.setLineDash([]);ctx.strokeRect(rx,ry,rw,rh);ctx.strokeStyle='#1478ff';ctx.lineWidth=1.75*dpr;ctx.setLineDash([6*dpr,3*dpr]);ctx.strokeRect(rx,ry,rw,rh);ctx.setLineDash([]);if(showHandles){for(const h of handlesFor(b)){const hs=SELECTION_HANDLE_SIZE_PX*dpr;ctx.shadowColor='rgba(20,30,50,.35)';ctx.shadowBlur=3*dpr;ctx.fillStyle='white';ctx.strokeStyle='#1478ff';ctx.lineWidth=1.75*dpr;ctx.beginPath();ctx.rect(ox+h.x*s-hs/2,oy+h.y*s-hs/2,hs,hs);ctx.fill();ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.stroke()}}ctx.restore()}
function drawSelection(ctx,s,ox,oy,dpr){const selected=project.layers.filter(l=>selectedLayerIds.has(l.id));const single=selected.length===1;for(const l of selected){const b=getLayerBBox(l);drawSelectionBox(ctx,s,ox,oy,dpr,b,single&&l.type!=='text');
  // TXT-102: text has no resize handles (see drawSelectionBox's showHandles above), but gets its own
  // single rotate handle instead, only while it is the sole selection -- matching the existing
  // single-selection-only precedent resize handles already set.
  if(single&&l.type==='text')drawRotateHandle(ctx,s,ox,oy,dpr,b)}}
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
function selectionBoundsText(){if(!selectedLayerIds.size)return'';const sel=[...selectedLayerIds].map(id=>project.layers.find(x=>x.id===id)).filter(Boolean);if(!sel.length)return'';const b=unionBBoxOfLayers(sel);return`<span>selection: ${b.width.toFixed(1)}×${b.height.toFixed(1)} mm</span>`}
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
function plateCupStatsHtml(t){const rimWidthMm=computeRimWidthMm(project.plate.outerDiameterMm,project.plate.innerWellDiameterMm);return`<span>${escapeHtml(t.displayName)}</span><span>same generated layout</span><span>${STONE_COLORS[selectedLayer().color]?.name||''}</span><span>design target: ${escapeHtml(getPlateDesignTargetMeta(project.plate.designTarget).name)}</span><span>outer diameter: ${project.plate.outerDiameterMm.toFixed(1)} mm</span><span>inner well diameter: ${project.plate.innerWellDiameterMm.toFixed(1)} mm</span><span>rim width: ${rimWidthMm.toFixed(1)} mm</span><span>approx. weight: ${PLATE_ROUND_DINNER_DEFINITION.weightGrams.average} g</span>`}
function cylindricalCupStatsHtml(t){const{frameWidthMm}=frontViewFrameGeometry();return`<span>${escapeHtml(t.displayName)}</span><span>same generated layout</span><span>${STONE_COLORS[selectedLayer().color]?.name||''}</span><span>Front View width: ${frameWidthMm.toFixed(1)} mm</span><span>printable circumference: ${printableCircumferenceMm().toFixed(1)} mm</span><span>viewing position: ${Math.round(rotation)}°</span>`}
function updateStats(){const t=currentObjectTemplate(),isPlate=t.preview.kind==='plate';const safe=getSafeAreaRectMm(t,project.canvas.width,project.canvas.height);el('layoutStats').innerHTML=`<b>${layout.count}</b> stones <span>${layout.widthMm.toFixed(1)}×${layout.heightMm.toFixed(1)} mm</span><span>canvas: ${project.canvas.width}×${project.canvas.height} mm</span><span>safe area: ${safe.widthMm.toFixed(1)}×${safe.heightMm.toFixed(1)} mm</span><span>units: mm</span>${selectionBoundsText()}<span>selected: ${escapeHtml(layerLabel(selectedLayer()))}</span>`;el('cupStats').innerHTML=isPlate?plateCupStatsHtml(t):cylindricalCupStatsHtml(t);updateStoneColorSwatch()}
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
// the guard blocked the delete, without duplicating the project.layers.length<=1 check itself --
// every pre-existing caller already discards the return value, so this stays backward-compatible.
function deleteLayer(id){if(project.layers.length<=1){el('status').textContent='Cannot delete the last layer';const hint=el('layerRuleHint');hint.style.display='block';hint.scrollIntoView({block:'nearest'});return false}commitHistory();project.layers=project.layers.filter(l=>l.id!==id);selectedLayerId=project.layers[0].id;selectedLayerIds=selectOnly(selectedLayerId);syncSelectedControlsFromLayer();updateAll(true);return true}
function pointerToLayout(e){const r=layoutCanvas.getBoundingClientRect(),dpr=layoutTransform.dpr;return layoutPxToMm((e.clientX-r.left)*dpr,(e.clientY-r.top)*dpr)}
// TXT-102: checked before the generic per-layer loop below -- the rotate handle only ever exists
// for the single currently-selected text layer (matching drawRotateHandle()'s own single&&
// l.type==='text' gate), and it is drawn outside the layer's own bbox, so it would never be reached
// by the bbox-contains 'move' check below anyway.
function rotateHandleHitTest(mm){
  if(selectedLayerIds.size!==1)return null;
  const l=project.layers.find(x=>x.type==='text'&&selectedLayerIds.has(x.id));
  if(!l)return null;
  const b=getLayerBBox(l);
  const h=rotateHandlePositionMm(b);
  if(!h)return null;
  if(Math.abs(mm.x-h.x)<ROTATE_HANDLE_HIT_TOLERANCE_MM&&Math.abs(mm.y-h.y)<ROTATE_HANDLE_HIT_TOLERANCE_MM){
    return{layer:l,kind:'rotate',b0:b,center:{x:h.cx,y:h.cy}};
  }
  return null;
}
function hitTest(mm){const rotateHit=rotateHandleHitTest(mm);if(rotateHit)return rotateHit;const layers=[...project.layers].reverse();for(const l of layers){const b=getLayerBBox(l);for(const h of handlesFor(b)){if(Math.abs(mm.x-h.x)<3&&Math.abs(mm.y-h.y)<3&&l.type!=='text')return{layer:l,kind:'resize',handle:h.name,b0:b}}if(mm.x>=b.x&&mm.x<=b.x2&&mm.y>=b.y&&mm.y<=b.y2)return{layer:l,kind:'move',b0:b}}return null}
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
    drag={kind:'resize',handle:hit.handle,layerId:hit.layer.id,start:mm,b0:hit.b0,l0:JSON.parse(JSON.stringify(hit.layer))};
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
  drag={kind:'move',layerIds:dragIds,start:mm,l0Map,groupBBox0};
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
    else if(XYWH_SHAPE_TYPES.has(l.type)){let x0=drag.b0.x,y0=drag.b0.y,x1=drag.b0.x2,y1=drag.b0.y2;if(drag.handle.includes('w'))x0=mm.x;if(drag.handle.includes('e'))x1=mm.x;if(drag.handle.includes('n'))y0=mm.y;if(drag.handle.includes('s'))y1=mm.y;l.x=Math.min(x0,x1);l.y=Math.min(y0,y1);l.w=Math.max(2,Math.abs(x1-x0));l.h=Math.max(2,Math.abs(y1-y0))}
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
  syncSelectedControlsFromLayer();updateAll(true);
});
window.addEventListener('pointerup',()=>{drag=null;if(activeGuides.length){activeGuides=[];drawLayout()}});
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
      drawingTool.deleteSelected();
    }
    // RS-3010 Step 2c: Escape cancels whatever drag or in-progress polygon drawingTool.cancelPath()
    // now covers (see DrawingCanvasTool.js's resetInProgressDrawing()) -- this block's own `return`
    // below already keeps drawing mode from falling through to any other Escape handler while it
    // owns the canvas.
    if(e.key==='Escape'){
      e.preventDefault();
      drawingTool.cancelPath();
    }
    // RS-3010 Design Step B: plain-keypress tool shortcuts (no Cmd/Ctrl/Alt/Shift) -- calls the
    // exact same setDrawTool() the rail buttons use, no new dispatch path. Guarded like
    // Delete/Backspace above so typing in the Slot width field never gets hijacked.
    if(!mod&&!e.altKey&&!e.shiftKey&&DRAW_TOOL_SHORTCUT_KEYS[key]){
      const t=document.activeElement?.tagName;if(t==='INPUT'||t==='SELECT')return;
      e.preventDefault();
      setDrawTool(DRAW_TOOL_SHORTCUT_KEYS[key]);
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
  const currentHeight=parseFloat(el('height').value);
  const staysValid=l.heightManuallyEdited&&Number.isFinite(currentHeight)&&isHeightWithinStoneSizeRange(size,currentHeight);
  el('heightAutoAdjustedHint').style.display='none';
  if(staysValid)return;
  el('height').value=stoneSizeHeightMidpointMm(size);
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
  const desiredCapHeightMm=parseFloat(el('letterHeight').value);
  if(!Number.isFinite(desiredCapHeightMm))return;
  const engineHeightMm=solveEngineHeightMm({fontId:l.font,desiredCapHeightMm});
  el('height').value=Math.max(RAW_ENGINE_HEIGHT_MM_MIN,Math.min(RAW_ENGINE_HEIGHT_MM_MAX,engineHeightMm));
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
const HISTORY_TRACKED_CONTROL_IDS=['projectName','text','font','height','stoneSize','gap','stoneColor','cupColor','autoFit','wrap','textMode','shapeX','shapeY','shapeW','shapeH','svgMode','shapeFillMode','imageFillMode','curveEnabled','curveRadiusMm','curveDirection','curveStartAngleDeg','curveSweepAngleDeg','curveAlignment','imgThreshold','imgInvert','imgBlurRadius','imgMaxWidth','imgMaxHeight','textX','textY','textAlign','lineSpacing','rotationDeg','shapeSides','shapePoints','shapeInnerRadius','shapeRingInner','plateOuterDiameter','plateInnerWellDiameter','plateOverallHeight','plateCenterDepth','plateColor','plateDesignTarget','vesselBodyDiameter','vesselBodyHeight','vesselTopDiameter','sizeMode','mixedAllowedSs6','mixedAllowedSs10','mixedAllowedSs16','mixedAllowedSs20','mixedAllowedSs30','mixedMinSize','mixedMaxSize','conservativeDetail'];
for(const id of HISTORY_TRACKED_CONTROL_IDS){el(id).addEventListener('input',()=>{openHistorySession();updateAll()});el(id).addEventListener('change',()=>closeHistorySession())}
for(const id of ['rotation','zoom'])el(id).addEventListener('input',()=>updateAll());
// RS-2002: Browse Fonts panel wiring. Toggling/closing never touches history (it only decides
// which fontId #font's native 'input'/'change' events -- wired above via HISTORY_TRACKED_CONTROL_IDS
// -- will fire for); only pickFont()'s dispatched events do.
el('fontLibraryBtn').addEventListener('click',()=>{if(el('fontLibraryPanel').hidden)openFontLibraryPanel();else closeFontLibraryPanel()});
el('fontSearch').addEventListener('input',()=>{fontSearchQuery=el('fontSearch').value;renderFontLibraryList()});
el('fontCategoryFilter').addEventListener('change',()=>{fontCategoryFilterValue=el('fontCategoryFilter').value;renderFontLibraryList()});
el('fontLibraryList').addEventListener('click',e=>{const favBtn=e.target.closest('[data-fav-font]');if(favBtn){toggleFavoriteFont(favBtn.dataset.favFont);return}const pickBtn=e.target.closest('[data-pick-font]');if(pickBtn)pickFont(pickBtn.dataset.pickFont)});
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
  syncSelectedControlsFromLayer();updateAll(true)});el('layersList').addEventListener('click',e=>{const row=e.target.closest('.layer');if(!row)return;const id=row.dataset.layer,action=e.target.dataset.action;if(action==='visible'){const l=project.layers.find(x=>x.id===id);commitHistory();l.visible=e.target.checked;updateAll(true);return}if(action==='duplicate'){duplicateLayer(id);return}if(action==='delete'){deleteLayer(id);return}
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
async function createShapeLayer(kind){
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
      ?{id:'circle'+Date.now(),type:'circle',visible:true,cx:shapeAroundText.cxMm,cy:shapeAroundText.cyMm,r:shapeAroundText.radiusMm,stoneSize:l.stoneSize||2,gap:l.gap||.3,color:l.color||'gold'}
      :{id:'circle'+Date.now(),type:'circle',visible:true,cx:105,cy:45,r:DEFAULT_CIRCLE_RADIUS_MM,stoneSize:l.stoneSize||2,gap:l.gap||.3,color:l.color||'gold'};
  }else{
    const{w,h}=shapeAroundText?{w:shapeAroundText.widthMm,h:shapeAroundText.heightMm}:(SHAPE_DEFAULT_SIZES_MM[kind]||{w:60,h:60});
    const x=shapeAroundText?shapeAroundText.xMm:105-w/2,y=shapeAroundText?shapeAroundText.yMm:45-h/2;
    layer={id:kind+Date.now(),type:kind,visible:true,x,y,w,h,stoneSize:l.stoneSize||2,gap:l.gap||.3,color:l.color||'gold',...defaultShapeExtraFields(kind)};
  }
  project.layers.push(layer);
  selectedLayerId=layer.id;selectedLayerIds=selectOnly(layer.id);
  let statusText=`Added ${SHAPE_DISPLAY_LABELS[kind]||kind}`;
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
  const layer={id:'text'+Date.now(),type:'text',visible:true,text:'New Text',font:TEXT_ENGINE_FONT_IDS.has(l.font)?l.font:DEFAULT_TEXT_FONT_ID,height:25,heightMode:'capHeight',textMode:'stroke',stoneSize:l.stoneSize||2.8,gap:l.gap||.3,color:l.color||'gold',autoFit:false,curveEnabled:false,curveRadiusMm:40,curveDirection:'outside',curveStartAngleDeg:0,curveSweepAngleDeg:180,curveAlignment:'center',align:'left',lineSpacing:1,rotationDeg:0,x:0,y:0};
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
// ShapeFit.computeShapeFitScale() -- reusing S-107's own MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO
// legibility floor so the two features can never disagree on "how small is too small". Never
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
  const spacingMm=(textLayer.stoneSize||0)+(textLayer.gap||0);
  const scaleResult=computeShapeFitScale({
    currentHeightMm:textLayer.height,measuredWidthMm:measured.boundingBox.widthMm,measuredHeightMm:measured.boundingBox.heightMm,
    spacingMm,targetWidthMm:inscribed.widthMm,targetHeightMm:inscribed.heightMm,minHeightToSpacingRatio:MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO
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
  syncSelectedControlsFromLayer();await updateAll(true);el('status').textContent=`Imported ${file.name}: ${project.layers.length} layer(s)`}catch(error){console.error('Project import failed',error);el('status').textContent=`Import failed: ${error.message}`;validationEl.textContent=`Import failed: ${error.message} The current project was left untouched.`;validationEl.style.display='block'}});
el('importSvg').onclick=()=>el('importSvgFile').click();
// RS-1001: parseSvgDocument() here only validates/measures the file (naturalWidthMm/heightMm,
// shape count, warnings) — it invents no stone positions, so this direct src/svg call does not
// violate "only the Geometry Engine generates stone positions". Actual stone generation for the
// new layer still runs through generate() -> generateSvgStonesLive() -> permanentEngine.generateSvgLayout().
el('importSvgFile').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{const svgSource=await file.text();const parsed=parseSvgDocument(svgSource);const maxW=project.canvas.width-20,maxH=project.canvas.height-20;let w=parsed.naturalWidthMm,h=parsed.naturalHeightMm;if(w>maxW||h>maxH){const s=Math.min(maxW/w,maxH/h);w*=s;h*=s}const x=(project.canvas.width-w)/2,y=(project.canvas.height-h)/2;const base=selectedLayer();const layer={id:'svg'+Date.now(),type:'svg',visible:true,svgSource,svgName:file.name,x,y,w,h,mode:'outline',stoneSize:base.stoneSize||2,gap:base.gap||.3,color:base.color||'gold'};commitHistory();project.layers.push(layer);selectedLayerId=layer.id;selectedLayerIds=selectOnly(layer.id);syncSelectedControlsFromLayer();await updateAll(true);const warningNote=parsed.warnings.length?` (${parsed.warnings.length} element(s) skipped, see console)`:'';if(parsed.warnings.length)console.warn('SVG import warnings for',file.name,parsed.warnings);el('status').textContent=`Imported ${file.name}: ${parsed.shapes.length} shape(s)${warningNote}`}catch(error){console.error('SVG import failed',error);el('status').textContent=`SVG import failed: ${error.message}`}});
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
  const layer={id:'image'+Date.now(),type:'image',visible:true,imageSrc:pendingImageImport.dataUrl,imageName:pendingImageImport.fileName,naturalWidthPx:pendingImageImport.naturalWidthPx,naturalHeightPx:pendingImageImport.naturalHeightPx,x,y,w,h,threshold,invert,blurRadiusPx,maxWidthPx,maxHeightPx,stoneSize:base.stoneSize||2,gap:base.gap||.3,color:base.color||'gold'};
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
function currentProductionSheetOptions(){const t=currentObjectTemplate(),isPlate=t.preview.kind==='plate';const plateFields=isPlate?{plateDesignTarget:getPlateDesignTargetMeta(project.plate.designTarget).name,plateOuterDiameterMm:project.plate.outerDiameterMm,plateInnerWellDiameterMm:project.plate.innerWellDiameterMm,plateRimWidthMm:computeRimWidthMm(project.plate.outerDiameterMm,project.plate.innerWellDiameterMm),plateOverallHeightMm:project.plate.overallHeightMm,plateWeightGrams:PLATE_ROUND_DINNER_DEFINITION.weightGrams.average,plateColorName:getPlateColor(project.plate.colorId).name}:{};return{projectName:project.name,objectType:t.displayName,productionWidthMm:project.canvas.width,productionHeightMm:project.canvas.height,gapMm:[...new Set(project.layers.filter(l=>l.visible).map(l=>l.gap))],pageSize:el('prodSheetPageSize').value,marginMm:parseFloat(el('prodSheetMargin').value)||0,mirror:el('prodSheetMirror').value==='on',registrationMarks:el('prodSheetRegMarks').value==='on',...plateFields}}
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
  shipping:new Lightbox('lightboxShipping',{primary:true,onOpen(){syncShippingFieldsFromState()}}),
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

el('menuText').onclick=()=>lightboxes.text.open();
el('menuShapes').onclick=()=>lightboxes.shapes.open();
el('menuMonogram').onclick=()=>lightboxes.monogram.open();
// S-103 (Product Scope Freeze): #menuGallery carries the native `disabled` attribute (see
// index.html), which makes the browser withhold click/Enter/Space activation and tab focus
// entirely -- this handler is wired the same as every other menu item and is deliberately left
// in place (Gallery code/tests/fixtures stay intact), it is just unreachable via the UI for now.
el('menuGallery').onclick=()=>lightboxes.gallery.open();
el('menuImport').onclick=()=>lightboxes.importBox.open();
el('menuImageTrace').onclick=()=>lightboxes.imagetrace.open();
el('menuExport').onclick=()=>lightboxes.exportBox.open();
el('exportShortcut').onclick=()=>lightboxes.exportBox.open();
el('menuProdSheet').onclick=()=>lightboxes.prodSheet.open();
el('menuShipping').onclick=()=>lightboxes.shipping.open();
el('menuSettings').onclick=()=>lightboxes.settings.open();
el('menuHelp').onclick=()=>lightboxes.help.open();

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
// productionFonts() (FONT-DECISION-001 widened that shared helper to also include validated
// OpenType fonts for the ordinary #font picker, which MonogramGenerator cannot use). A dedicated
// #monogramFont select (not the shared #font element) so this Lightbox never participates in
// relocateFieldGroups().
function authoredProductionFonts(){return fontManager?fontManager.listFonts().filter(f=>f.providerId==='rhinestone'):[]}
function populateMonogramFontOptions(){if(!fontManager)return;el('monogramFont').innerHTML=groupFontsByCategory(authoredProductionFonts()).map(([role,fonts])=>`<optgroup label="${escapeHtml(fontCategoryLabel(role))}">${fonts.map(f=>`<option value="${f.id}">${escapeHtml(f.family)}</option>`).join('')}</optgroup>`).join('')}
function populateMonogramStoneSizeOptions(){el('monogramStoneSize').innerHTML=listStoneSizes().map(s=>`<option value="${s.diameterMm}">${escapeHtml(s.name)} — ${s.diameterMm.toFixed(1)} mm</option>`).join('')}
function populateMonogramColorOptions(){const groups=new Map();for(const c of Object.values(STONE_COLORS)){if(!groups.has(c.group))groups.set(c.group,[]);groups.get(c.group).push(c)}el('monogramColor').innerHTML=[...groups.entries()].map(([group,colors])=>`<optgroup label="${escapeHtml(group)}">${colors.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</optgroup>`).join('')}
function updateMonogramColorSwatch(){const c=STONE_COLORS[el('monogramColor').value];el('monogramColorSwatch').style.background=c?c.previewColor:'transparent'}
// Frame Size Width/Height bounds come from FrameLibrary's own scalingLimitsMm for the selected
// frame -- the same field this app already uses to bound vessel/plate dimensions. Only resets the
// current value when it falls outside the new frame's range, so switching frames back and forth
// never fights a value the user just typed.
function updateMonogramFrameSizeBounds(){
  const frame=listFrames().find(f=>f.id===el('monogramFrame').value);
  if(!frame)return;
  const limits=frame.scalingLimitsMm;
  const widthInput=el('monogramWidth'),heightInput=el('monogramHeight');
  widthInput.min=String(limits.minWidthMm);widthInput.max=String(limits.maxWidthMm);
  heightInput.min=String(limits.minHeightMm);heightInput.max=String(limits.maxHeightMm);
  const currentW=parseFloat(widthInput.value),currentH=parseFloat(heightInput.value);
  if(!Number.isFinite(currentW)||currentW<limits.minWidthMm||currentW>limits.maxWidthMm)widthInput.value=String(Math.round((limits.minWidthMm+limits.maxWidthMm)/2));
  if(!Number.isFinite(currentH)||currentH<limits.minHeightMm||currentH>limits.maxHeightMm)heightInput.value=String(Math.round((limits.minHeightMm+limits.maxHeightMm)/2));
  el('monogramFrameSizeHint').textContent=`${frame.label}: width ${limits.minWidthMm}-${limits.maxWidthMm}mm, height ${limits.minHeightMm}-${limits.maxHeightMm}mm.`;
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
  const widthMm=parseFloat(el('monogramWidth').value);
  const heightMm=parseFloat(el('monogramHeight').value);
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
  return{frameId:validated.frameId,layoutId:validated.layoutId,letters:validated.letters,fontId:validated.fontId,providerId:resolveFontProviderId(validated.fontId),stoneSizeMm,color,frameRect,canvasMm};
}
function onMonogramOpen(){clearMonogramValidation();updateMonogramGenerateButtonState()}
async function generateMonogram(){
  const validation=validateMonogramControls();
  if(!validation.ok){showMonogramValidation(validation.message);return}
  clearMonogramValidation();
  const request=buildMonogramRequest(validation);
  el('monogramGenerate').disabled=true;
  let result;
  try{
    result=await monogramGenerator.generate(request);
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
  el('status').textContent=`Generated monogram (${result.layers.length} layer${result.layers.length===1?'':'s'}).`;
}
populateMonogramFrameOptions();populateMonogramLayoutOptions();populateMonogramStoneSizeOptions();populateMonogramColorOptions();
updateMonogramColorSwatch();updateMonogramFrameSizeBounds();updateMonogramLetterCountHint();
if(fontManager)populateMonogramFontOptions();
el('monogramFrame').addEventListener('change',()=>{updateMonogramFrameSizeBounds();updateMonogramGenerateButtonState()});
el('monogramLayout').addEventListener('change',()=>{updateMonogramLetterCountHint();updateMonogramGenerateButtonState()});
el('monogramLetters').addEventListener('input',()=>updateMonogramGenerateButtonState());
el('monogramFont').addEventListener('change',()=>updateMonogramGenerateButtonState());
el('monogramColor').addEventListener('change',()=>{updateMonogramColorSwatch();updateMonogramGenerateButtonState()});
el('monogramWidth').addEventListener('input',()=>updateMonogramGenerateButtonState());
el('monogramHeight').addEventListener('input',()=>updateMonogramGenerateButtonState());
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
  if(detailEl)detailEl.textContent=`Production ${t.productionWidthMm}×${t.productionHeightMm}mm · Safe area inset ${s.top}/${s.right}/${s.bottom}/${s.left}mm · Default wrap: ${t.wrap.default}`;
  const summaryEl=el('projectTemplateSummary');
  if(summaryEl)summaryEl.textContent=`${t.displayName} · ${project.canvas.width}×${project.canvas.height}mm`;
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
el('viewTabDual').onclick=()=>setWorkspaceMode('dual');
el('viewTab2D').onclick=()=>setWorkspaceMode('2d');
el('viewTab3D').onclick=()=>setWorkspaceMode('preview');
// Desktop always starts in Dual Workspace (matching the static HTML default); narrower/smaller
// screens start collapsed to the 2D Canvas alone so neither panel is squeezed unusably thin. This
// is only the *starting* mode -- the three tab buttons above let the user switch freely afterward
// at any screen size. skipUpdate=true here: this runs before the boot-time updateAll(true) at the
// bottom of this file, so there is no generated layout yet to redraw.
if(!window.matchMedia('(min-width: 900px)').matches)setWorkspaceMode('2d',true);

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
  el('drawSlotWidthMm').style.display=showSlotWidth?'':'none';
  // RS-3010 Design Step A correction: the old horizontal row's five preset buttons are gone --
  // these two rails (split left/right) are now the only aria-pressed sync targets.
  el('railSelectToggle').setAttribute('aria-pressed',String(active&&mode==='select'));
  el('railDrawToggle').setAttribute('aria-pressed',String(active&&mode==='freehand'));
  el('railRectToggle').setAttribute('aria-pressed',String(active&&mode==='rect'));
  el('railEllipseToggle').setAttribute('aria-pressed',String(active&&mode==='ellipse'));
  el('railSlotToggle').setAttribute('aria-pressed',String(active&&mode==='slot'));
  el('railPolygonToggle').setAttribute('aria-pressed',String(active&&mode==='polygon'));
}
function setDrawTool(mode){
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
el('drawSlotWidthMm').oninput=()=>drawingTool.setSlotWidthMm(el('drawSlotWidthMm').value);
el('railSelectToggle').onclick=()=>setDrawTool('select');
el('railDrawToggle').onclick=()=>setDrawTool('freehand');
el('railRectToggle').onclick=()=>setDrawTool('rect');
el('railEllipseToggle').onclick=()=>setDrawTool('ellipse');
el('railSlotToggle').onclick=()=>setDrawTool('slot');
el('railPolygonToggle').onclick=()=>setDrawTool('polygon');
// RS-3011 issue #3 fix: #menuDesign is Design's own dedicated enter/exit toggle, independent of
// which rail tool is active -- the same click that enters also exits, regardless of
// drawingTool.mode. This is now the only way to leave Design (the rail buttons above never exit,
// per setDrawTool()'s own comment), so it must not route through setDrawTool()'s same-mode check.
el('menuDesign').onclick=()=>{
  if(drawingTool.isActive){setDrawMode(false)}else{setDrawTool('select')}
};
// Figma-style trackpad/mouse mapping, kept out of the normal pointerdown/move/up flow entirely so
// a drag on the canvas always draws and never pans: plain scroll pans (deltaX/deltaY), Ctrl/Cmd+
// scroll (or a trackpad pinch, which the browser reports as wheel+ctrlKey) zooms.
layoutCanvas.addEventListener('wheel',e=>{if(!drawingTool.isActive)return;drawingTool.onWheel(e)},{passive:false});

// ---- Left panel Actions shortcuts: each calls the exact same function as its top-bar/per-row
// equivalent -- no new history, selection, or export logic. ----
el('actionUndo').onclick=()=>performUndo();
el('actionRedo').onclick=()=>performRedo();
el('actionDuplicate').onclick=()=>duplicateLayer(selectedLayerId);
el('actionDelete').onclick=()=>deleteLayer(selectedLayerId);
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
    renderProductionLayout(canvas.getContext('2d'),stoneLayout,{widthPx:canvas.width,heightPx:canvas.height,paddingPx:12});
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
    syncSelectedControlsFromLayer();await updateAll(true);
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
wireShippingApply();

// ---- Settings: mirrors the live grid/safe-area/snap toggle state (one boolean each, never a
// second independent copy). Default stone size/gap are session-local preference fields not yet
// wired into new-layer creation (createShapeLayer()/addText() already default sensibly from the
// currently selected layer) -- documented, not faked; see the specification. ----
function syncSettingsFieldsFromState(){
  el('settingsGridDefault').checked=true;el('settingsGridDefault').disabled=true;
  el('settingsSafeAreaDefault').checked=showSafeArea;el('settingsSnapDefault').checked=snapEnabled;
  el('settingsSnapDistance').value=snapToleranceMm;el('settingsShowGuides').checked=showSnapGuides;
}
el('settingsApply').onclick=()=>{
  showSafeArea=el('settingsSafeAreaDefault').checked;
  snapEnabled=el('settingsSnapDefault').checked;el('snapEnabled').value=snapEnabled?'on':'off';
  snapToleranceMm=Math.min(5,Math.max(0.5,parseFloat(el('settingsSnapDistance').value)||SNAP_TOLERANCE_MM));
  showSnapGuides=el('settingsShowGuides').checked;
  drawLayout();
};

populateStoneColorOptions();populateStoneSizeOptions();populateMixedSizeSelectOptions();
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
