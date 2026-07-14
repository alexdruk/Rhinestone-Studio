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
import { GeometryEngine as PermanentGeometryEngine, Stone, StoneLayout, combineManyShapeSources } from './src/geometry/index.js';
import { FontManager } from './src/fonts/index.js';
import { createDefaultFontProviderRegistry } from './src/text/index.js';
import { renderProductionLayout } from './src/renderer/CanvasRenderer2D.js';
import { createPreview3D } from './src/preview3d/index.js';
import { STONE_COLORS } from './src/renderer/StoneColors.js';
import { listStoneSizes, findStoneSizeByDiameterMm } from './src/renderer/StoneSizes.js';
import { stoneLayoutToSvg } from './src/export/SvgExporter.js';
import { computeProductionSheetLayout, productionSheetToSvg, productionSheetToPdf } from './src/export/ProductionSheetExporter.js';
import { parseSvgDocument } from './src/svg/index.js';
import { HistoryManager } from './src/history/index.js';
import { getObjectTemplate, getSafeAreaRectMm } from './src/products/index.js';
import { prepareImageField, maskFieldToRgba, decodeImageFileToBuffer, decodeDataUrlToBuffer, readFileAsDataUrl, isSupportedImageFile } from './src/image/index.js';
// RS-1009 (Alignment & Snapping): src/editing/** is a new, pure, DOM-free module -- multi-select,
// align/distribute, and drag/keyboard snapping math over layer bounding boxes in mm. It has no
// dependency on src/geometry/**/StoneLayout/Stone and never generates stone positions itself;
// app.js is the only caller, and is the only place that knows a given layer's position field
// names (cx/cy vs x/y) via the new getLayerPosition()/setLayerPosition() helpers below. See
// docs/specifications/RS-1009-AlignmentSnapping.md.
import { SNAP_TOLERANCE_MM, NUDGE_STEP_MM, NUDGE_STEP_LARGE_MM, alignLayers, distributeLayers, buildSnapTargets, computeSnapOffset, selectOnly, toggleSelection, clearSelection, selectMany } from './src/editing/index.js';
// UI-001 (Complete Application Redesign): src/ui/** is a new, pure, DOM-only module -- a generic
// Lightbox/dialog controller (open/close, focus trap, Escape, backdrop click). It has no knowledge
// of Project/Layer/StoneLayout/layer type; app.js is the only caller, and is the only place that
// wires a Lightbox to a top-menu button or a layer-aware "which fields to show" decision. See
// docs/specifications/UI-001-CompleteRedesign.md.
import { Lightbox } from './src/ui/index.js';
// RS-1015 (Design Library): src/library/** is a new, pure, DOM-free module -- library item
// creation/validation, category derivation, storage-adapter-injected CRUD/search/filter/sort, and
// the pure clone/insert/new-project transforms over the existing ad hoc project/layer JSON. It has
// no dependency on src/geometry/**/StoneLayout/Stone/Project/Layer and never generates stone
// positions; app.js is the only caller, and is the only place that touches a browser-global
// (localStorage, via createLocalStorageAdapter) or the existing engine.generate()/
// renderProductionLayout() pipeline (reused, unmodified, for thumbnail generation). See
// docs/specifications/RS-1015-DesignLibrary.md.
import { DesignLibrary, createLocalStorageAdapter, createMemoryStorageAdapter, buildSelectionItemData, buildProjectItemData, buildProjectFromItem, prepareLayersForInsert, getInsertableLayers } from './src/library/index.js';
import { validateRhsProject, toAppProjectShape, parseCatalog, search as searchGalleryCatalog, filterByCategory as filterGalleryCategory, categories as galleryCategories, featuredEntries as galleryFeaturedEntries, getEntry as getGalleryEntry } from './src/gallery/index.js';
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
const DEFAULT_TEXT_FONT_ID='courier-prime-regular';
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
// RS-1008: `parseFloat(...)||fallback` (the pattern the rest of this file already uses for numeric
// field reads) silently discards an explicit, meaningful 0 -- harmless for fields whose fallback is
// also a sensible default at 0 (e.g. curveStartAngleDeg), but wrong for imgThreshold, whose valid
// range starts at 0. parseIntOr() only falls back on genuinely invalid (NaN) input.
function parseIntOr(value,fallback){const n=Math.round(parseFloat(value));return Number.isFinite(n)?n:fallback}
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
const FONT_CATEGORY_LABELS={script:'Script','sans-serif':'Sans Serif',serif:'Serif',display:'Display',monogram:'Monogram',decorative:'Decorative',block:'Block',handwritten:'Handwritten',monospace:'Monospace'};
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
function injectFontFaceRules(fonts){const style=document.createElement('style');style.textContent=fonts.map(f=>`@font-face{font-family:"${cssFontFamily(f.family)}";src:url("${f.path}") format("truetype");font-display:swap;}`).join('\n');document.head.appendChild(style)}
// Builds the #font <select>'s <optgroup>s from the live manifest, grouped by category and sorted
// alphabetically within each group -- mirrors populateStoneColorOptions()'s existing pattern.
// Disabled fonts (just the RobotoMono placeholder today) are never listed, matching
// TEXT_ENGINE_FONT_IDS above.
function populateFontOptions(){if(!fontManager)return;el('font').innerHTML=groupFontsByCategory(fontManager.listFonts()).map(([role,fonts])=>`<optgroup label="${escapeHtml(fontCategoryLabel(role))}">${fonts.map(f=>`<option value="${f.id}" style="font-family:'${cssFontFamily(f.family)}'">${escapeHtml(f.family)}</option>`).join('')}</optgroup>`).join('')}
// Favorites are a client-side browsing preference, not project data -- stored in localStorage,
// never read/written by save/load/export/Design Library/Gallery, so they carry no compatibility
// risk and don't need to round-trip through a project file.
const FONT_FAVORITES_STORAGE_KEY='rhinestoneStudio.favoriteFontIds';
function loadFavoriteFontIds(){try{const raw=localStorage.getItem(FONT_FAVORITES_STORAGE_KEY);const arr=raw?JSON.parse(raw):[];return new Set(Array.isArray(arr)?arr.filter(id=>typeof id==='string'):[])}catch{return new Set()}}
function saveFavoriteFontIds(ids){try{localStorage.setItem(FONT_FAVORITES_STORAGE_KEY,JSON.stringify([...ids]))}catch{}}
let favoriteFontIds=loadFavoriteFontIds();
let fontSearchQuery='';
function fontLibraryRowHtml(f,currentFontId){const isFav=favoriteFontIds.has(f.id);return`<div class="font-library-row"><button type="button" class="font-fav${isFav?' active':''}" data-fav-font="${f.id}" title="${isFav?'Remove from favorites':'Add to favorites'}" aria-pressed="${isFav}">${isFav?'★':'☆'}</button><button type="button" class="font-library-item" data-pick-font="${f.id}" role="option" aria-selected="${f.id===currentFontId}" style="font-family:'${cssFontFamily(f.family)}'"><span class="font-preview">${escapeHtml(f.family)}</span></button></div>`}
// Renders the Browse Fonts panel's list: an optional pinned "Favorites" group (only among fonts
// matching the current search), then every category group in alphabetical order. Re-run on every
// search keystroke and every favorite toggle; cheap at this catalog size (9 fonts today).
function renderFontLibraryList(){if(!fontManager)return;const list=el('fontLibraryList');const query=fontSearchQuery.trim().toLowerCase();const fonts=fontManager.listFonts().filter(f=>!query||f.family.toLowerCase().includes(query)||fontCategoryLabel(f.role).toLowerCase().includes(query));if(fonts.length===0){list.innerHTML='<div class="font-library-empty">No fonts match your search.</div>';return}const currentFontId=el('font').value;const favorites=fonts.filter(f=>favoriteFontIds.has(f.id)).sort((a,b)=>a.family.localeCompare(b.family));let html='';if(favorites.length)html+=`<div class="font-library-group">Favorites</div>${favorites.map(f=>fontLibraryRowHtml(f,currentFontId)).join('')}`;for(const[role,group]of groupFontsByCategory(fonts))html+=`<div class="font-library-group">${escapeHtml(fontCategoryLabel(role))}</div>${group.map(f=>fontLibraryRowHtml(f,currentFontId)).join('')}`;list.innerHTML=html}
function openFontLibraryPanel(){el('fontLibraryPanel').hidden=false;el('fontLibraryBtn').setAttribute('aria-expanded','true');fontSearchQuery='';el('fontSearch').value='';renderFontLibraryList();el('fontSearch').focus()}
function closeFontLibraryPanel(){el('fontLibraryPanel').hidden=true;el('fontLibraryBtn').setAttribute('aria-expanded','false')}
// Writes the picked font into the one real #font control and replays the exact 'input'+'change'
// sequence a user picking from the native <select> would fire, so HISTORY_TRACKED_CONTROL_IDS'
// existing listener (openHistorySession/updateAll on input, closeHistorySession on change) runs
// unchanged -- this panel is a second way to set #font's value, never a second place that value
// is read from.
function pickFont(fontId){el('font').value=fontId;el('font').dispatchEvent(new Event('input'));el('font').dispatchEvent(new Event('change'));closeFontLibraryPanel()}
function toggleFavoriteFont(fontId){if(favoriteFontIds.has(fontId))favoriteFontIds.delete(fontId);else favoriteFontIds.add(fontId);saveFavoriteFontIds(favoriteFontIds);renderFontLibraryList()}
// RS-1009 originally, RS-1012 extracted to a standalone function: a text layer has no stored
// absolute position of its own (unlike every other layer type) -- it is always auto-centered on the
// production canvas first, then offset by layer.x/layer.y on top of that. generateTextStonesLive()
// below applies this to already-generated stones; resolveLayerShapeSource()'s text branch applies
// the exact same formula to already-generated *polygons* (RS-1012 boolean input), so both stay in
// sync by construction instead of by duplicated arithmetic.
function computeTextPlacementOffset(boundingBox,layer,project){
  const offsetX=(boundingBox?(project.canvas.width-boundingBox.widthMm)/2-boundingBox.minXmm:0)+(layer.x||0);
  const offsetY=(boundingBox?(project.canvas.height-boundingBox.heightMm)/2-boundingBox.minYmm:0)+(layer.y||0);
  return{offsetX,offsetY};
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
function resolveTextFillMode(textMode){return TEXT_MODE_TO_ENGINE_MODE[textMode]||'outline'}
function resolveVectorFillMode(value){return VECTOR_FILL_MODES.has(value)?value:'outline'}
function resolveImageFillMode(value){return IMAGE_FILL_MODES.has(value)?value:'fill'}
class GeometryEngine{constructor(permanentEngine=null){this.permanentEngine=permanentEngine}
 // Geometry generation happens exactly once here, per docs/ARCHITECTURE.md: every layer's stones
 // come straight from the permanent engine's per-layer StoneLayout; dedupe() below only filters
 // already-generated stones by proximity across layers, it invents no new positions. The survivors
 // are wrapped into one real StoneLayout ('project' is a sentinel layerId — StoneLayout requires
 // one non-empty layerId per instance; each Stone still carries its own real layer id) so every
 // renderer/exporter downstream consumes the same canonical product.
 async generate(project){let raw=[];for(const l of project.layers){if(!l.visible)continue;if(l.type==='text')raw.push(...await this.generateTextStonesLive(l,project));if(l.type==='circle'||l.type==='rectangle')raw.push(...await this.generateShapeStonesLive(l));if(l.type==='svg')raw.push(...await this.generateSvgStonesLive(l));if(l.type==='image')raw.push(...await this.generateImageStonesLive(l));if(l.type==='path')raw.push(...await this.generatePathStonesLive(l));}const stones=this.dedupe(raw,Math.min(...raw.map(s=>s.d||2),2)*0.58).map(s=>new Stone({xMm:s.x,yMm:s.y,sizeMm:s.d,color:s.color,layerId:s.layerId}));return new StoneLayout({layerId:'project',stones})}
 async generateTextStonesLive(layer,project){if(!this.permanentEngine||!this.permanentEngine.canGenerateText||!layer.text)return[];const fontId=TEXT_ENGINE_FONT_IDS.has(layer.font)?layer.font:DEFAULT_TEXT_FONT_ID;const mode=resolveTextFillMode(layer.textMode);const base={text:layer.text,fontId,layerId:layer.id,heightMm:layer.height,stoneSizeMm:layer.stoneSize,gapMm:layer.gap,mode,color:layer.color,curveEnabled:Boolean(layer.curveEnabled),curveRadiusMm:layer.curveRadiusMm,curveDirection:layer.curveDirection,curveStartAngleDeg:layer.curveStartAngleDeg,curveSweepAngleDeg:layer.curveSweepAngleDeg,curveAlignment:layer.curveAlignment};let result=await this.permanentEngine.generateTextLayout(base);if(layer.autoFit){const maxWidth=project.canvas.width-10;if(result.widthMm>maxWidth&&result.widthMm>0){const scale=maxWidth/result.widthMm;const scaledHeight=Math.max(1,layer.height*scale);result=await this.permanentEngine.generateTextLayout({...base,heightMm:scaledHeight})}}const bb=result.getBoundingBox();
  // RS-1009: text layers previously had no position field -- stones were always centered on the
  // canvas. layer.x/layer.y (mm, default 0) are a further offset applied on top of that same
  // auto-centered base position, so pre-RS-1009 Project JSON (no x/y on its text layers) renders
  // byte-identical to before, and dragging/nudging/aligning a text layer just moves this offset.
  const{offsetX,offsetY}=computeTextPlacementOffset(bb,layer,project);return result.stones.map(s=>({x:s.xMm+offsetX,y:s.yMm+offsetY,d:s.sizeMm,color:s.color,layerId:s.layerId}))}
 // RS-0003.5C1: circle/rectangle layers are generated by the same permanent engine's
 // generateShapeLayout(), mirroring generateTextStonesLive() above.
 async generateShapeStonesLive(layer){if(!this.permanentEngine)return[];const isCircle=layer.type==='circle';const params={shape:layer.type,layerId:layer.id,stoneSizeMm:layer.stoneSize,gapMm:layer.gap,mode:resolveVectorFillMode(layer.fillMode),color:layer.color,...(isCircle?{cxMm:layer.cx,cyMm:layer.cy,radiusMm:layer.r}:{xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h})};const result=this.permanentEngine.generateShapeLayout(params);return result.stones.map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:s.color,layerId:s.layerId}))}
 // RS-1001: svg layers reuse the same x/y/w/h placement box rectangle layers use; src/svg/**
 // (not app.js) does the actual SVG parsing, inside generateSvgLayout().
 async generateSvgStonesLive(layer){if(!this.permanentEngine)return[];const params={svgSource:layer.svgSource,layerId:layer.id,xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h,stoneSizeMm:layer.stoneSize,gapMm:layer.gap,mode:resolveVectorFillMode(layer.mode),color:layer.color};const result=this.permanentEngine.generateSvgLayout(params);return result.stones.map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:s.color,layerId:s.layerId}))}
 // RS-1008A: image layers go through the permanent engine's generateImageLayout(), mirroring
 // generateSvgStonesLive()/generateShapeStonesLive() above -- src/image/** only prepares the
 // decoded pixel buffer (decode/cache happens here since that's the one async, DOM-only step;
 // generateImageLayout() itself is synchronous, like generateShapeLayout()). imageBufferCache means
 // the (comparatively expensive) browser image decode only re-runs the first time a given imageSrc
 // is seen; every subsequent call here only re-runs the permanent engine's pure/fast pipeline.
 async generateImageStonesLive(layer){if(!this.permanentEngine||!layer.imageSrc)return[];let buffer=imageBufferCache.get(layer.imageSrc);if(!buffer){buffer=await decodeDataUrlToBuffer(layer.imageSrc);imageBufferCache.set(layer.imageSrc,buffer)}const params={imageBuffer:buffer,layerId:layer.id,xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h,stoneSizeMm:layer.stoneSize,gapMm:layer.gap,mode:resolveImageFillMode(layer.fillMode),color:layer.color,threshold:layer.threshold,invert:layer.invert,blurRadiusPx:layer.blurRadiusPx,maxWidthPx:layer.maxWidthPx,maxHeightPx:layer.maxHeightPx};const result=this.permanentEngine.generateImageLayout(params);return result.stones.map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:s.color,layerId:s.layerId}))}
 // RS-1012: 'path' layers (Boolean Operation results) go through the permanent engine's
 // generatePathLayout(), mirroring generateSvgStonesLive()/generateShapeStonesLive() above --
 // layer.contours is already plain (0,0)-rooted polygon data (no parsing step, unlike SVG).
 async generatePathStonesLive(layer){if(!this.permanentEngine)return[];const params={contours:layer.contours.map(c=>c.map(p=>({xMm:p.x,yMm:p.y}))),layerId:layer.id,xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h,stoneSizeMm:layer.stoneSize,gapMm:layer.gap,mode:resolveVectorFillMode(layer.fillMode),color:layer.color};const result=this.permanentEngine.generatePathLayout(params);return result.stones.map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:s.color,layerId:s.layerId}))}
 // RS-2000: the legacy bitmap text engine (FONT5 + generateText/sampleGlyphFill/
 // sampleGlyphStroke/line) and the legacy generateCircle/generateRect/bbox/layerBBox shape path
 // were deleted here -- unreachable since generateTextStonesLive/generateShapeStonesLive took over
 // (RS-0003.5B3/5C1/5C2), and confirmed production-acceptable by this milestone's end-to-end +
 // browser validation (see docs/specifications/RS-2000-MVPStabilizationValidation.md). dedupe()
 // below is the one survivor: it is also the live cross-layer proximity merge generate() still uses.
 dedupe(stones,minDist){const cell=Math.max(minDist,0.5),grid=new Map(),out=[],m2=minDist*minDist;for(const s of stones){const gx=Math.floor(s.x/cell),gy=Math.floor(s.y/cell);let ok=true;for(let yy=gy-1;yy<=gy+1;yy++)for(let xx=gx-1;xx<=gx+1;xx++){const arr=grid.get(xx+','+yy)||[];for(const o of arr){const dx=s.x-o.x,dy=s.y-o.y;if(dx*dx+dy*dy<m2){ok=false;break}}if(!ok)break}if(ok){out.push(s);const k=gx+','+gy;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(s)}}return out} }
const DEFAULT_PROJECT_NAME='Untitled Project';
function defaultProject(){return{version:2,units:'mm',name:DEFAULT_PROJECT_NAME,product:'mug',canvas:{width:210,height:90},cupColor:'#1f3556',wrap:'front',layers:[{id:'text',type:'text',visible:true,text:'Vitalina Serbin',font:DEFAULT_TEXT_FONT_ID,height:25,textMode:'stroke',stoneSize:2,gap:.3,color:'gold',autoFit:true,curveEnabled:false,curveRadiusMm:40,curveDirection:'outside',curveStartAngleDeg:0,curveSweepAngleDeg:180,curveAlignment:'center',x:0,y:0}]}}
// RS-0003.5D1: validates an imported Project JSON file against the exact ad hoc project/layer
// shape #exportProject already produces (JSON.stringify(project)). Throws a specific Error
// describing the first problem found instead of silently accepting a malformed project; the
// caller (the #importProjectFile change handler) surfaces that message via #status and leaves
// the current `project` untouched on failure. Returns a normalized copy on success — it never
// mutates its input.
const SUPPORTED_LAYER_TYPES=new Set(['text','circle','rectangle','svg','image','path']);
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
    if(ids.has(l.id))throw new Error(`Duplicate layer id: ${l.id}`);
    ids.add(l.id);
    if(!SUPPORTED_LAYER_TYPES.has(l.type))throw new Error(`Layer "${l.id}" has unsupported type: ${l.type}`);
    if(l.type==='text'&&typeof l.text!=='string')throw new Error(`Text layer "${l.id}" is missing a string 'text' field.`);
    if(l.type==='circle'&&![l.cx,l.cy,l.r].every(n=>typeof n==='number'&&Number.isFinite(n)))throw new Error(`Circle layer "${l.id}" is missing numeric cx/cy/r fields.`);
    if(l.type==='rectangle'&&![l.x,l.y,l.w,l.h].every(n=>typeof n==='number'&&Number.isFinite(n)))throw new Error(`Rectangle layer "${l.id}" is missing numeric x/y/w/h fields.`);
    if(l.type==='svg'&&(typeof l.svgSource!=='string'||l.svgSource.length===0))throw new Error(`SVG layer "${l.id}" is missing a non-empty 'svgSource' string.`);
    if(l.type==='svg'&&![l.x,l.y,l.w,l.h].every(n=>typeof n==='number'&&Number.isFinite(n)))throw new Error(`SVG layer "${l.id}" is missing numeric x/y/w/h fields.`);
    // RS-1008: image layers mirror the svg case above (a non-empty self-contained source string
    // plus a numeric x/y/w/h placement box), plus their own threshold/blurRadiusPx/maxWidthPx/
    // maxHeightPx pipeline fields. 'invert' is a plain boolean UI toggle, not strictly validated
    // here, matching this function's existing permissive style for other boolean-ish fields
    // (e.g. layer.visible/autoFit).
    if(l.type==='image'&&(typeof l.imageSrc!=='string'||l.imageSrc.length===0))throw new Error(`Image layer "${l.id}" is missing a non-empty 'imageSrc' string.`);
    if(l.type==='image'&&![l.x,l.y,l.w,l.h].every(n=>typeof n==='number'&&Number.isFinite(n)))throw new Error(`Image layer "${l.id}" is missing numeric x/y/w/h fields.`);
    if(l.type==='image'&&(typeof l.threshold!=='number'||!Number.isFinite(l.threshold)||l.threshold<0||l.threshold>255))throw new Error(`Image layer "${l.id}" is missing a valid 'threshold' (0-255).`);
    if(l.type==='image'&&(typeof l.blurRadiusPx!=='number'||!Number.isFinite(l.blurRadiusPx)||l.blurRadiusPx<0))throw new Error(`Image layer "${l.id}" is missing a valid non-negative 'blurRadiusPx'.`);
    if(l.type==='image'&&![l.maxWidthPx,l.maxHeightPx].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0))throw new Error(`Image layer "${l.id}" is missing valid positive 'maxWidthPx'/'maxHeightPx'.`);
    // RS-1012: a 'path' layer (a Boolean Operation result) stores its shape directly as contours --
    // an array of (0,0)-rooted polygons, each a numeric {x,y}[] with 3+ points -- plus the same
    // x/y/w/h placement box svg/image layers already use.
    if(l.type==='path'&&!(Array.isArray(l.contours)&&l.contours.length>0&&l.contours.every(c=>Array.isArray(c)&&c.length>=3&&c.every(p=>p&&typeof p.x==='number'&&Number.isFinite(p.x)&&typeof p.y==='number'&&Number.isFinite(p.y)))))throw new Error(`Path layer "${l.id}" is missing a valid non-empty 'contours' array.`);
    if(l.type==='path'&&![l.x,l.y,l.w,l.h].every(n=>typeof n==='number'&&Number.isFinite(n)))throw new Error(`Path layer "${l.id}" is missing numeric x/y/w/h fields.`);
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
  return{version:Number(obj.version)||2,units:'mm',name:typeof obj.name==='string'&&obj.name.length>0?obj.name:DEFAULT_PROJECT_NAME,product:getObjectTemplate(obj.product).id,canvas:{width:canvas.width,height:canvas.height},cupColor:typeof obj.cupColor==='string'?obj.cupColor:'#1f3556',wrap:typeof obj.wrap==='string'?obj.wrap:'front',layers:obj.layers.map(l=>({...l,visible:l.visible!==false}))}
}
let fontProviderRegistry=null,permanentEngineError=null,fontManager=null;
try{fontManager=await FontManager.fromUrl('./assets/fonts/manifest.json');fontProviderRegistry=createDefaultFontProviderRegistry(fontManager);TEXT_ENGINE_FONT_IDS=new Set(fontManager.listFonts().map(f=>f.id))}catch(error){permanentEngineError=error;console.error('Font manifest failed to load; text layers will render empty until this is resolved. Shape layers are unaffected.',error)}
const permanentEngine=new PermanentGeometryEngine({fontProviderRegistry});
const engine=new GeometryEngine(permanentEngine);let project=defaultProject(),selectedLayerId='text',layout=null,rotation=0,zoom=1,layoutTransform=null,drag=null,generationToken=0;const el=id=>document.getElementById(id);const layoutCanvas=el('layout'),cupCanvas=el('cup');
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
let cleanProjectJson=JSON.stringify(project);
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
  const isShapeFillType=l.type==='circle'||l.type==='rectangle'||l.type==='path';
  el('shapeFillModeField').style.display=isShapeFillType?'block':'none';
  if(isShapeFillType)el('shapeFillMode').value=resolveVectorFillMode(l.fillMode);
  if(l.type==='image')el('imageFillMode').value=resolveImageFillMode(l.fillMode);
  if(isText){el('text').value=l.text;el('font').value=l.font;el('height').value=l.height;el('autoFit').value=l.autoFit?'on':'off';el('textMode').value=l.textMode||'stroke';el('curveEnabled').value=l.curveEnabled?'on':'off';el('curveRadiusMm').value=l.curveRadiusMm??40;el('curveDirection').value=l.curveDirection||'outside';el('curveStartAngleDeg').value=l.curveStartAngleDeg??0;el('curveSweepAngleDeg').value=l.curveSweepAngleDeg??180;el('curveAlignment').value=l.curveAlignment||'center';el('curveControls').style.display=l.curveEnabled?'block':'none';el('textX').value=l.x||0;el('textY').value=l.y||0}else{el('shapeX').value=l.type==='circle'?l.cx:l.x;el('shapeY').value=l.type==='circle'?l.cy:l.y;el('shapeW').value=l.type==='circle'?l.r:l.w;el('shapeH').value=l.type==='circle'?'':l.h;el('shapeWLabel').textContent=l.type==='circle'?'Radius (mm)':'Width (mm)';el('shapeHField').style.display=l.type==='circle'?'none':'';if(l.type==='svg')el('svgMode').value=resolveVectorFillMode(l.mode);if(l.type==='image'){el('imgThreshold').value=l.threshold??DEFAULT_IMAGE_THRESHOLD;el('imgInvert').value=l.invert?'on':'off';el('imgBlurRadius').value=l.blurRadiusPx??0;el('imgMaxWidth').value=l.maxWidthPx??DEFAULT_IMAGE_MAX_DIMENSION_PX;el('imgMaxHeight').value=l.maxHeightPx??DEFAULT_IMAGE_MAX_DIMENSION_PX}}ensureStoneSizeOption(el('stoneSize'),l.stoneSize);setNumericSelectValue(el('stoneSize'),l.stoneSize);el('gap').value=l.gap;el('stoneColor').value=l.color;
  // RS-1002: project.cupColor/project.wrap are project-level (not per-layer) fields, so they must
  // be resynced here too -- otherwise an undo/redo restore (or a Project JSON import) leaves these
  // two dropdowns stale, and the *next* edit's writeSelectedControlsToLayer() would silently write
  // the stale displayed value back into `project`, undoing the very restore that just happened.
  el('cupColor').value=project.cupColor;el('wrap').value=project.wrap;
  // RS-1004: project.product is likewise project-level, not per-layer -- resync on every selection
  // change/undo/redo/import for the same reason cupColor/wrap are resynced above.
  el('objectType').value=project.product;
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
}
function writeSelectedControlsToLayer(){const l=selectedLayer();if(l.type==='text'){l.text=el('text').value;l.font=el('font').value;l.height=parseFloat(el('height').value)||25;l.autoFit=el('autoFit').value==='on';l.textMode=el('textMode').value;l.curveEnabled=el('curveEnabled').value==='on';l.curveRadiusMm=Math.max(0.1,parseFloat(el('curveRadiusMm').value)||40);l.curveDirection=el('curveDirection').value==='inside'?'inside':'outside';l.curveStartAngleDeg=parseFloat(el('curveStartAngleDeg').value)||0;l.curveSweepAngleDeg=parseFloat(el('curveSweepAngleDeg').value)||180;l.curveAlignment=el('curveAlignment').value;el('curveControls').style.display=l.curveEnabled?'block':'none';
  // UI-001: manual X/Y mm fields for the Text Lightbox, writing to the same layer.x/layer.y fields
  // RS-1009 already added (previously settable only by drag/nudge/align/distribute).
  l.x=parseFloat(el('textX').value)||0;l.y=parseFloat(el('textY').value)||0}else if(l.type==='circle'){l.cx=parseFloat(el('shapeX').value)||105;l.cy=parseFloat(el('shapeY').value)||45;l.r=Math.max(1,parseFloat(el('shapeW').value)||18);l.fillMode=resolveVectorFillMode(el('shapeFillMode').value)}else if(l.type==='rectangle'){l.x=parseFloat(el('shapeX').value)||65;l.y=parseFloat(el('shapeY').value)||30;l.w=Math.max(1,parseFloat(el('shapeW').value)||80);l.h=Math.max(1,parseFloat(el('shapeH').value)||30);l.fillMode=resolveVectorFillMode(el('shapeFillMode').value)}else if(l.type==='svg'){l.x=parseFloat(el('shapeX').value)||0;l.y=parseFloat(el('shapeY').value)||0;l.w=Math.max(1,parseFloat(el('shapeW').value)||10);l.h=Math.max(1,parseFloat(el('shapeH').value)||10);l.mode=resolveVectorFillMode(el('svgMode').value)}else if(l.type==='image'){l.x=parseFloat(el('shapeX').value)||0;l.y=parseFloat(el('shapeY').value)||0;l.w=Math.max(1,parseFloat(el('shapeW').value)||10);l.h=Math.max(1,parseFloat(el('shapeH').value)||10);l.threshold=Math.max(0,Math.min(255,parseIntOr(el('imgThreshold').value,DEFAULT_IMAGE_THRESHOLD)));l.invert=el('imgInvert').value==='on';l.blurRadiusPx=Math.max(0,parseIntOr(el('imgBlurRadius').value,0));l.maxWidthPx=Math.max(8,parseIntOr(el('imgMaxWidth').value,DEFAULT_IMAGE_MAX_DIMENSION_PX));l.maxHeightPx=Math.max(8,parseIntOr(el('imgMaxHeight').value,DEFAULT_IMAGE_MAX_DIMENSION_PX));l.fillMode=resolveImageFillMode(el('imageFillMode').value)}else if(l.type==='path'){l.x=parseFloat(el('shapeX').value)||0;l.y=parseFloat(el('shapeY').value)||0;l.w=Math.max(2,parseFloat(el('shapeW').value)||10);l.h=Math.max(2,parseFloat(el('shapeH').value)||10);l.fillMode=resolveVectorFillMode(el('shapeFillMode').value)}l.stoneSize=parseFloat(el('stoneSize').value)||2;l.gap=parseFloat(el('gap').value)||.3;l.color=el('stoneColor').value;project.cupColor=el('cupColor').value;project.wrap=el('wrap').value;project.name=el('projectName').value||DEFAULT_PROJECT_NAME;rotation=parseFloat(el('rotation').value)||0;zoom=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,(parseFloat(el('zoom').value)||100)/100))}
async function updateAll(skipWrite=false){if(!skipWrite)writeSelectedControlsToLayer();const token=++generationToken;let generated;try{generated=await engine.generate(project)}catch(error){if(token!==generationToken)return;console.error('Layout generation failed',error);el('status').textContent=`Text generation failed: ${error.message}`;return}if(token!==generationToken)return;layout=generated;renderLayerUI();drawLayout();drawCup();updateStats();updateHistoryUI();updateEditingUI();updateViewButtons();updateTextOutsidePrintableWarning();if(permanentEngineError)el('status').textContent=`Font manifest failed to load (${permanentEngineError.message}); text layers are empty. Shape layers are unaffected.`}// S-003: a project must always keep at least one layer (deleteLayer()'s guard below), so once
// only one layer remains, every delete affordance -- the per-row trash icon and the sidebar
// "Delete selected layer" button -- is disabled here (not just left clickable-but-a-no-op) and
// #layerRuleHint (sitting directly under the button, always in view) explains why. This runs on
// every renderLayerUI() call (i.e. after every add/delete/duplicate/undo/redo/import), so the
// disabled state and hint never go stale relative to the current layer count.
function renderLayerUI(){const onlyOneLayer=project.layers.length<=1;el('selectedLayer').innerHTML=project.layers.map(l=>`<option value="${l.id}">${escapeHtml(layerLabel(l))}</option>`).join('');el('selectedLayer').value=selectedLayerId;el('layersList').innerHTML=project.layers.map(l=>`<div class="layer ${selectedLayerIds.has(l.id)?'selected':''}" data-layer="${l.id}"><input type="checkbox" ${l.visible?'checked':''} data-action="visible"><div class="name" data-action="select" title="${escapeHtml(layerLabel(l))}">${escapeHtml(layerLabel(l))}</div><div class="type">${l.type.toUpperCase()}</div><button data-action="select">✎</button><button data-action="duplicate">⧉</button><button data-action="delete" ${onlyOneLayer?'disabled title="At least one layer is required"':''}>🗑</button></div>`).join('');el('deleteSelected').disabled=onlyOneLayer;el('deleteSelected').title=onlyOneLayer?'At least one layer is required':'';el('layerRuleHint').style.display=onlyOneLayer?'block':'none';
  // UI-001: keep the right inspector's layer name and the left panel's project/template summary
  // in sync on every render (add/delete/duplicate/undo/redo/import/selection change).
  el('inspectorLayerName').textContent=layerLabel(selectedLayer());updateObjectTemplateDetail();
}function layerLabel(l){return l.type==='text'?(l.text||'Text'):l.type==='circle'?'Circle':l.type==='svg'?(l.svgName||'SVG'):l.type==='image'?(l.imageName||'Image'):l.type==='path'?(l.pathName||'Path'):'Rectangle'}function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function resizeCanvas(c){const r=c.getBoundingClientRect(),dpr=Math.max(1,devicePixelRatio||1),w=Math.floor(r.width*dpr),h=Math.floor(r.height*dpr);if(c.width!==w||c.height!==h){c.width=w;c.height=h}return{w,h,dpr}}
function layoutMmToPx(p){return{x:layoutTransform.ox+p.x*layoutTransform.s,y:layoutTransform.oy+p.y*layoutTransform.s}}function layoutPxToMm(x,y){return{x:(x-layoutTransform.ox)/layoutTransform.s,y:(y-layoutTransform.oy)/layoutTransform.s}}
function drawLayout(){const{w,h,dpr}=resizeCanvas(layoutCanvas),ctx=layoutCanvas.getContext('2d');const{s,ox,oy}=renderProductionLayout(ctx,layout,{widthPx:w,heightPx:h,paddingPx:38*dpr});layoutTransform={s,ox,oy,dpr};if(showSafeArea)drawSafeAreaGuide(ctx,s,ox,oy,dpr,getSafeAreaRectMm(currentObjectTemplate(),project.canvas.width,project.canvas.height));drawSelection(ctx,s,ox,oy,dpr);drawGuides(ctx,s,ox,oy,dpr);ctx.fillStyle='#516071';ctx.font=`${12*dpr}px Arial`;ctx.fillText(`${layout.count} stones · ${layout.widthMm.toFixed(1)}×${layout.heightMm.toFixed(1)} mm · ${selectedLayer().textMode||''}`,20*dpr,h-18*dpr);el('fitNotice').textContent='Drag to move (Shift = constrain, Alt = duplicate) · Shift-click to multi-select · click empty canvas to clear · Arrow keys nudge (Shift = larger step).'}
// RS-1004: a dashed guide rectangle for the active object template's safe design area, derived from
// the current project.canvas size. This is a layer-agnostic editor overlay (like drawSelection()
// below), not a CanvasRenderer2D.js change -- it reuses the exact mm->px transform
// renderProductionLayout() already returned, drawn before the selection outline so selection always
// reads on top.
function drawSafeAreaGuide(ctx,s,ox,oy,dpr,rectMm){const rx=ox+rectMm.xMm*s,ry=oy+rectMm.yMm*s,rw=rectMm.widthMm*s,rh=rectMm.heightMm*s;ctx.save();ctx.strokeStyle='rgba(20,120,255,.45)';ctx.lineWidth=1.25*dpr;ctx.setLineDash([5*dpr,4*dpr]);ctx.strokeRect(rx,ry,rw,rh);ctx.setLineDash([]);ctx.restore()}
// Text layers have no plain layer fields to compute a bbox from directly (unlike circle/
// rectangle), so their selection bbox is derived from the already-generated StoneLayout, filtered
// to this layer's stones and wrapped in a fresh StoneLayout to reuse its getBoundingBox() math.
function getLayerBBox(l){if(l.type==='circle')return{x:l.cx-l.r,y:l.cy-l.r,width:l.r*2,height:l.r*2,x2:l.cx+l.r,y2:l.cy+l.r};if(l.type==='rectangle'||l.type==='svg'||l.type==='image'||l.type==='path')return{x:l.x,y:l.y,width:l.w,height:l.h,x2:l.x+l.w,y2:l.y+l.h};const stones=layout.stones.filter(s=>s.layerId===l.id);if(!stones.length)return{x:0,y:0,x2:0,y2:0,width:0,height:0};const b=new StoneLayout({layerId:l.id,stones}).getBoundingBox();return{x:b.minXmm,y:b.minYmm,x2:b.maxXmm,y2:b.maxYmm,width:b.widthMm,height:b.heightMm}}
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
function applyPositionDeltas(deltas){for(const[id,{dxMm,dyMm}]of deltas){const l=project.layers.find(x=>x.id===id);if(!l)continue;const p=getLayerPosition(l);setLayerPosition(l,p.xMm+dxMm,p.yMm+dyMm)}}
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
// is that same frame's inset rectangle. The 3D preview (src/preview3d/StoneLayoutTexture.js's
// drawStoneLayoutTexture(), fed canvasWidthMm/canvasHeightMm from this exact project.canvas by
// Preview3DRenderer.js's update()) rasterizes the *entire* flat canvas into one texture and
// ObjectGeometryBuilder.js's applyWrapUv()/applyAzimuthUv() map that whole texture (U 0..1 = canvas
// x 0..canvasWidthMm) across the wrap angle centered on the front -- so anything within the flat
// canvas's mm bounds is always on the front-facing, always-visible part of the object regardless of
// wrap mode or camera rotation, and anything outside those mm bounds is clipped out of the texture
// before it ever reaches the mesh. The flat canvas-mm safe-area comparison is therefore already the
// correct coordinate space for "visible on the object" -- no 3D projection math is needed or was
// touched. What was wrong was the *threshold*: the first version only warned once the bbox had zero
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
function updateTextOutsidePrintableWarning(){
  const outside=isTextOutsidePrintableArea(selectedLayer());
  el('textOutsidePrintableWarning').classList.toggle('visible',outside);
  el('workspaceTextOutsideWarning').classList.toggle('visible',outside);
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
  if(layer.type==='circle'||layer.type==='rectangle'){
    const isCircle=layer.type==='circle';
    const{polygons,boundingBox}=permanentEngine.resolveShapePolygons({
      shape:layer.type,layerId:layer.id,
      ...(isCircle?{cxMm:layer.cx,cyMm:layer.cy,radiusMm:layer.r}:{xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h})
    });
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
    if(!permanentEngine.canGenerateText||!layer.text)return null;
    const fontId=TEXT_ENGINE_FONT_IDS.has(layer.font)?layer.font:DEFAULT_TEXT_FONT_ID;
    const base={text:layer.text,fontId,layerId:layer.id,heightMm:layer.height,curveEnabled:Boolean(layer.curveEnabled),curveRadiusMm:layer.curveRadiusMm,curveDirection:layer.curveDirection,curveStartAngleDeg:layer.curveStartAngleDeg,curveSweepAngleDeg:layer.curveSweepAngleDeg,curveAlignment:layer.curveAlignment};
    let resolved=await permanentEngine.resolveTextPolygons(base);
    if(layer.autoFit&&resolved.boundingBox){
      const maxWidth=project.canvas.width-10;
      if(resolved.boundingBox.widthMm>maxWidth&&resolved.boundingBox.widthMm>0){
        const scale=maxWidth/resolved.boundingBox.widthMm;
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
    showBooleanOpsError(`"${layerLabel(layers[missingIndex])}" has no closed shape to combine — Boolean Operations need a solid outline (not an empty text layer, an SVG made only of open lines, or an unplaced Image Trace).`);
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
}
// RS-0003.5D2: SELECTION_HANDLE_SIZE_PX enlarges the resize handles slightly (was a bare 10px
// square) and a white halo is stroked behind the dashed outline so the selection reads clearly
// against any background (light grid, light/dark stones), not just against the plain canvas.
const SELECTION_HANDLE_SIZE_PX=11;
// RS-1009: draws one selection box (+ optional resize handles); drawSelection() below calls this
// once per multi-selected layer. Handles only ever draw when exactly one layer is selected
// (multi-layer resize is out of scope for this milestone) -- unchanged single-selection visuals.
function drawSelectionBox(ctx,s,ox,oy,dpr,b,showHandles){const rx=ox+b.x*s,ry=oy+b.y*s,rw=b.width*s,rh=b.height*s;ctx.save();ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=4*dpr;ctx.setLineDash([]);ctx.strokeRect(rx,ry,rw,rh);ctx.strokeStyle='#1478ff';ctx.lineWidth=1.75*dpr;ctx.setLineDash([6*dpr,3*dpr]);ctx.strokeRect(rx,ry,rw,rh);ctx.setLineDash([]);if(showHandles){for(const h of handlesFor(b)){const hs=SELECTION_HANDLE_SIZE_PX*dpr;ctx.shadowColor='rgba(20,30,50,.35)';ctx.shadowBlur=3*dpr;ctx.fillStyle='white';ctx.strokeStyle='#1478ff';ctx.lineWidth=1.75*dpr;ctx.beginPath();ctx.rect(ox+h.x*s-hs/2,oy+h.y*s-hs/2,hs,hs);ctx.fill();ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.stroke()}}ctx.restore()}
function drawSelection(ctx,s,ox,oy,dpr){const selected=project.layers.filter(l=>selectedLayerIds.has(l.id));const single=selected.length===1;for(const l of selected)drawSelectionBox(ctx,s,ox,oy,dpr,getLayerBBox(l),single&&l.type!=='text')}
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
function drawCup(){preview3D.update(layout,{cupColor:project.cupColor,wrap:project.wrap,objectTemplate:currentObjectTemplate(),canvasWidthMm:project.canvas.width,canvasHeightMm:project.canvas.height});preview3D.syncView(rotation,zoom)}
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
function updateStats(){const safe=getSafeAreaRectMm(currentObjectTemplate(),project.canvas.width,project.canvas.height);el('layoutStats').innerHTML=`<b>${layout.count}</b> stones <span>${layout.widthMm.toFixed(1)}×${layout.heightMm.toFixed(1)} mm</span><span>canvas: ${project.canvas.width}×${project.canvas.height} mm</span><span>safe area: ${safe.widthMm.toFixed(1)}×${safe.heightMm.toFixed(1)} mm</span><span>units: mm</span>${selectionBoundsText()}<span>selected: ${escapeHtml(layerLabel(selectedLayer()))}</span>`;el('cupStats').innerHTML=`<span>${escapeHtml(currentObjectTemplate().displayName)}</span><span>same generated layout</span><span>${STONE_COLORS[selectedLayer().color]?.name||''}</span>`;updateStoneColorSwatch()}
function download(name,mime,data){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:mime}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),800);el('status').textContent=`Downloaded ${name}`}function exportCanvas(name,canvas){canvas.toBlob(b=>{const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),800)},'image/png')}
function duplicateLayer(id){const l=project.layers.find(x=>x.id===id);if(!l)return;commitHistory();const copy=JSON.parse(JSON.stringify(l));copy.id=l.type+Date.now();if(copy.type==='circle'){copy.cx+=8;copy.cy+=8}if(copy.type==='rectangle'){copy.x+=8;copy.y+=8}if(copy.type==='svg'){copy.x+=8;copy.y+=8}if(copy.type==='image'){copy.x+=8;copy.y+=8}if(copy.type==='path'){copy.x+=8;copy.y+=8}if(copy.type==='text'){copy.text+=' copy';copy.x=(copy.x||0)+8;copy.y=(copy.y||0)+8}project.layers.push(copy);selectedLayerId=copy.id;selectedLayerIds=selectOnly(copy.id);syncSelectedControlsFromLayer();updateAll()}function deleteLayer(id){if(project.layers.length<=1){el('status').textContent='Cannot delete the last layer';const hint=el('layerRuleHint');hint.style.display='block';hint.scrollIntoView({block:'nearest'});return}commitHistory();project.layers=project.layers.filter(l=>l.id!==id);selectedLayerId=project.layers[0].id;selectedLayerIds=selectOnly(selectedLayerId);syncSelectedControlsFromLayer();updateAll(true)}
function pointerToLayout(e){const r=layoutCanvas.getBoundingClientRect(),dpr=layoutTransform.dpr;return layoutPxToMm((e.clientX-r.left)*dpr,(e.clientY-r.top)*dpr)}function hitTest(mm){const layers=[...project.layers].reverse();for(const l of layers){const b=getLayerBBox(l);for(const h of handlesFor(b)){if(Math.abs(mm.x-h.x)<3&&Math.abs(mm.y-h.y)<3&&l.type!=='text')return{layer:l,kind:'resize',handle:h.name,b0:b}}if(mm.x>=b.x&&mm.x<=b.x2&&mm.y>=b.y&&mm.y<=b.y2)return{layer:l,kind:'move',b0:b}}return null}
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
  const mm=pointerToLayout(e);const hit=hitTest(mm);
  if(!hit){if(selectedLayerIds.size){selectedLayerIds=clearSelection();renderLayerUI();updateEditingUI();drawLayout()}return}
  if(hit.kind==='resize'){
    selectedLayerIds=selectOnly(hit.layer.id);selectedLayerId=hit.layer.id;
    syncSelectedControlsFromLayer();renderLayerUI();updateEditingUI();
    commitHistory();
    drag={kind:'resize',handle:hit.handle,layerId:hit.layer.id,start:mm,b0:hit.b0,l0:JSON.parse(JSON.stringify(hit.layer))};
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
    else if(l.type==='rectangle'||l.type==='svg'||l.type==='image'||l.type==='path'){let x0=drag.b0.x,y0=drag.b0.y,x1=drag.b0.x2,y1=drag.b0.y2;if(drag.handle.includes('w'))x0=mm.x;if(drag.handle.includes('e'))x1=mm.x;if(drag.handle.includes('n'))y0=mm.y;if(drag.handle.includes('s'))y1=mm.y;l.x=Math.min(x0,x1);l.y=Math.min(y0,y1);l.w=Math.max(2,Math.abs(x1-x0));l.h=Math.max(2,Math.abs(y1-y0))}
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
  if(e.key==='Delete'||e.key==='Backspace'){const t=document.activeElement?.tagName;if(t==='INPUT'||t==='SELECT')return;deleteLayer(selectedLayerId)}
  // RS-1009: arrow keys nudge the current multi-selection by a named mm step (NUDGE_STEP_MM,
  // src/editing/EditingConstants.js); Shift+Arrow uses the larger step. Guarded exactly like
  // Delete/Backspace above so typing in a text/number field or using a <select> is never hijacked.
  if(ARROW_KEY_DELTAS[e.key]){const t=document.activeElement?.tagName;if(t==='INPUT'||t==='SELECT')return;e.preventDefault();const step=e.shiftKey?NUDGE_STEP_LARGE_MM:NUDGE_STEP_MM;const[ux,uy]=ARROW_KEY_DELTAS[e.key];nudgeSelection(ux*step,uy*step)}
});
// RS-1002: these controls edit `project` fields, so one undo step is committed per edit session
// (opened on the first 'input' event, closed on 'change'). `rotation`/`zoom` are view-only (not
// part of `project`) and keep their original plain 'input' listener, untouched.
// UI-001: 'textX'/'textY' are the new manual Text Lightbox position fields (see writeSelectedControlsToLayer()).
const HISTORY_TRACKED_CONTROL_IDS=['projectName','text','font','height','stoneSize','gap','stoneColor','cupColor','autoFit','wrap','textMode','shapeX','shapeY','shapeW','shapeH','svgMode','shapeFillMode','imageFillMode','curveEnabled','curveRadiusMm','curveDirection','curveStartAngleDeg','curveSweepAngleDeg','curveAlignment','imgThreshold','imgInvert','imgBlurRadius','imgMaxWidth','imgMaxHeight','textX','textY'];
for(const id of HISTORY_TRACKED_CONTROL_IDS){el(id).addEventListener('input',()=>{openHistorySession();updateAll()});el(id).addEventListener('change',()=>closeHistorySession())}
for(const id of ['rotation','zoom'])el(id).addEventListener('input',()=>updateAll());
// RS-2002: Browse Fonts panel wiring. Toggling/closing never touches history (it only decides
// which fontId #font's native 'input'/'change' events -- wired above via HISTORY_TRACKED_CONTROL_IDS
// -- will fire for); only pickFont()'s dispatched events do.
el('fontLibraryBtn').addEventListener('click',()=>{if(el('fontLibraryPanel').hidden)openFontLibraryPanel();else closeFontLibraryPanel()});
el('fontSearch').addEventListener('input',()=>{fontSearchQuery=el('fontSearch').value;renderFontLibraryList()});
el('fontLibraryList').addEventListener('click',e=>{const favBtn=e.target.closest('[data-fav-font]');if(favBtn){toggleFavoriteFont(favBtn.dataset.favFont);return}const pickBtn=e.target.closest('[data-pick-font]');if(pickBtn)pickFont(pickBtn.dataset.pickFont)});
el('selectedLayer').addEventListener('change',()=>{selectedLayerId=el('selectedLayer').value;selectedLayerIds=selectOnly(selectedLayerId);syncSelectedControlsFromLayer();updateAll(true)});
// RS-1004: switching the object template is one discrete, undoable action (matching addCircle/
// addRect/deleteLayer's commitHistory()-then-mutate pattern below), not a continuous-session field
// -- it also resets project.canvas/project.wrap to the new template's own defaults, so those two
// resets are always committed together with the switch, never independently.
el('objectType').addEventListener('change',()=>{commitHistory();const template=getObjectTemplate(el('objectType').value);project.product=template.id;project.canvas={width:template.productionWidthMm,height:template.productionHeightMm};project.wrap=template.wrap.default;syncSelectedControlsFromLayer();updateAll(true)});el('layersList').addEventListener('click',e=>{const row=e.target.closest('.layer');if(!row)return;const id=row.dataset.layer,action=e.target.dataset.action;if(action==='visible'){const l=project.layers.find(x=>x.id===id);commitHistory();l.visible=e.target.checked;updateAll(true);return}if(action==='duplicate'){duplicateLayer(id);return}if(action==='delete'){deleteLayer(id);return}
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
el('alignLeft').onclick=()=>runAlign('left');el('alignCenterH').onclick=()=>runAlign('centerH');el('alignRight').onclick=()=>runAlign('right');el('alignTop').onclick=()=>runAlign('top');el('alignCenterV').onclick=()=>runAlign('centerV');el('alignBottom').onclick=()=>runAlign('bottom');el('distributeH').onclick=()=>runDistribute('horizontal');el('distributeV').onclick=()=>runDistribute('vertical');el('snapEnabled').addEventListener('change',()=>{snapEnabled=el('snapEnabled').value==='on'});
// RS-1012: Boolean Operations, in the Shapes Lightbox (see index.html's #booleanOpsSection).
el('boolUnion').onclick=()=>runBooleanOp('union');el('boolSubtract').onclick=()=>runBooleanOp('subtract');el('boolIntersect').onclick=()=>runBooleanOp('intersect');el('boolExclude').onclick=()=>runBooleanOp('xor');el('addCircle').onclick=()=>{const l=selectedLayer();commitHistory();const layer={id:'circle'+Date.now(),type:'circle',visible:true,cx:105,cy:45,r:18,stoneSize:l.stoneSize||2,gap:l.gap||.3,color:l.color||'gold'};project.layers.push(layer);selectedLayerId=layer.id;selectedLayerIds=selectOnly(layer.id);syncSelectedControlsFromLayer();updateAll(true)};el('addRect').onclick=()=>{const l=selectedLayer();commitHistory();const layer={id:'rect'+Date.now(),type:'rectangle',visible:true,x:65,y:30,w:80,h:30,stoneSize:l.stoneSize||2,gap:l.gap||.3,color:l.color||'gold'};project.layers.push(layer);selectedLayerId=layer.id;selectedLayerIds=selectOnly(layer.id);syncSelectedControlsFromLayer();updateAll(true)};el('importProject').onclick=()=>el('importProjectFile').click();
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
  syncSelectedControlsFromLayer();await updateAll(true);el('status').textContent=`Imported ${file.name}: ${project.layers.length} layer(s)`;lightboxes.importBox.close()}catch(error){console.error('Project import failed',error);el('status').textContent=`Import failed: ${error.message}`;validationEl.textContent=`Import failed: ${error.message} The current project was left untouched.`;validationEl.style.display='block'}});
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
el('exportProject').onclick=()=>{try{download('rhinestone-project.json','application/json',JSON.stringify(project,null,2));cleanProjectJson=JSON.stringify(project);updateHistoryUI()}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
el('exportLayout').onclick=()=>{if(!layout){el('status').textContent='Export failed: layout is not ready yet.';return}try{download('rhinestone-generated-layout.json','application/json',JSON.stringify(layout,null,2))}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
el('exportSVG').onclick=()=>{if(!layout){el('status').textContent='Export failed: layout is not ready yet.';return}try{download('rhinestone-layout.svg','image/svg+xml',stoneLayoutToSvg(layout,{widthMm:project.canvas.width,heightMm:project.canvas.height}))}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
el('exportPNG').onclick=()=>{if(!layout){el('status').textContent='Export failed: layout is not ready yet.';return}try{exportCanvas('rhinestone-layout.png',layoutCanvas)}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
el('exportCup').onclick=()=>{if(!layout){el('status').textContent='Export failed: layout is not ready yet.';return}try{exportCanvas('rhinestone-cup-preview.png',cupCanvas)}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
// RS-1005: Production Sheet export. Page size/margin/mirror/registration-marks are view/export-
// only options (like rotation/zoom) -- read live from their controls at click time, not part of
// `project`, not undo/redo-tracked. gapMm is collected from every currently visible layer (the one
// piece of header metadata Stone itself never carries -- see
// docs/specifications/RS-1005-ProductionSheetGenerator.md, "Current Repository State").
function currentProductionSheetOptions(){return{projectName:project.name,objectType:currentObjectTemplate().displayName,productionWidthMm:project.canvas.width,productionHeightMm:project.canvas.height,gapMm:[...new Set(project.layers.filter(l=>l.visible).map(l=>l.gap))],pageSize:el('prodSheetPageSize').value,marginMm:parseFloat(el('prodSheetMargin').value)||0,mirror:el('prodSheetMirror').value==='on',registrationMarks:el('prodSheetRegMarks').value==='on'}}
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
  stone:{field:'sharedStoneFields',home:'inspectorStoneSlot',lightboxSlots:{text:'textStoneSlot',shapes:'shapesStoneSlot',import:'importStoneSlot',imagetrace:'imageTraceStoneSlot'}}
};
let activeFieldLightbox=null;
function relocateFieldGroups(){
  for(const group of Object.values(FIELD_GROUPS)){
    const fieldEl=el(group.field);
    const destId=(activeFieldLightbox&&group.lightboxSlots[activeFieldLightbox])||group.home;
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
  library:new Lightbox('lightboxLibrary',{primary:true,onOpen(){onLibraryOpen()}}),
  libraryConfirm:new Lightbox('lightboxLibraryConfirm'),
  gallery:new Lightbox('lightboxGallery',{primary:true,onOpen(){onGalleryOpen()}}),
  galleryPreview:new Lightbox('lightboxGalleryPreview')
};

el('menuText').onclick=()=>lightboxes.text.open();
el('menuShapes').onclick=()=>lightboxes.shapes.open();
el('menuLibrary').onclick=()=>lightboxes.library.open();
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
  if(t==='circle'||t==='rectangle'||t==='path')return lightboxes.shapes;
  if(t==='svg')return lightboxes.importBox;
  if(t==='image')return lightboxes.imagetrace;
  return null;
}

// The right inspector's "More Options" opens the Lightbox that matches the selected layer's type.
el('moreOptionsBtn').onclick=()=>{
  const target=lightboxForLayerType(selectedLayer().type);
  if(target)target.open();
};

// ---- Shapes Lightbox: Design Shapes / Object Templates tabs ----
function setShapesTab(tab){
  const isDesign=tab==='design';
  el('shapesTabDesign').classList.toggle('active',isDesign);el('shapesTabDesign').setAttribute('aria-selected',String(isDesign));
  el('shapesTabTemplates').classList.toggle('active',!isDesign);el('shapesTabTemplates').setAttribute('aria-selected',String(!isDesign));
  el('shapesPanelDesign').hidden=!isDesign;el('shapesPanelTemplates').hidden=isDesign;
}
el('shapesTabDesign').onclick=()=>setShapesTab('design');
el('shapesTabTemplates').onclick=()=>setShapesTab('templates');
el('addCircleLightbox').onclick=()=>el('addCircle').click();
el('addRectLightbox').onclick=()=>el('addRect').click();
function updateObjectTemplateDetail(){
  const t=currentObjectTemplate(),s=t.safeAreaInsetMm;
  const detailEl=el('objectTemplateDetail');
  if(detailEl)detailEl.textContent=`Production ${t.productionWidthMm}×${t.productionHeightMm}mm · Safe area inset ${s.top}/${s.right}/${s.bottom}/${s.left}mm · Default wrap: ${t.wrap.default}`;
  const summaryEl=el('projectTemplateSummary');
  if(summaryEl)summaryEl.textContent=`${t.displayName} · ${project.canvas.width}×${project.canvas.height}mm`;
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

// ---- Safe-area toggle (view-only editor state; see the showSafeArea declaration above and
// drawLayout()). No grid toggle exists here -- see the showSafeArea declaration's comment above. ----
el('safeAreaToggle').onclick=()=>{showSafeArea=!showSafeArea;el('safeAreaToggle').setAttribute('aria-pressed',String(showSafeArea));el('settingsSafeAreaDefault').checked=showSafeArea;drawLayout()};

// ---- Left panel Actions shortcuts: each calls the exact same function as its top-bar/per-row
// equivalent -- no new history, selection, or export logic. ----
el('actionUndo').onclick=()=>performUndo();
el('actionRedo').onclick=()=>performRedo();
el('actionDuplicate').onclick=()=>duplicateLayer(selectedLayerId);
el('actionDelete').onclick=()=>deleteLayer(selectedLayerId);
function saveProjectDownload(){el('exportProject').click()}
el('actionSave').onclick=saveProjectDownload;
el('saveProject').onclick=saveProjectDownload;

// ---- Design Library (RS-1015): save/browse/reuse rhinestone designs. See
// docs/specifications/RS-1015-DesignLibrary.md. A library item's `data` is never a new schema --
// it is a verbatim, deep-cloned copy of the exact ad hoc project/layer JSON `#exportProject`/
// `duplicateLayer()` already read and write (see `src/library/LibraryTransform.js`). Thumbnails
// reuse the existing `engine.generate()` bridge + the permanent `renderProductionLayout()` against
// an offscreen canvas -- the same generate-then-render call sequence `drawLayout()` already
// performs against the live canvas, never a second rendering pipeline. Insertion/new-project reuse
// the existing commitHistory()/updateAll()/history.clear() patterns every other layer-adding or
// project-replacing action already uses, so undo/redo, Production Sheet, and every exporter work
// against library-sourced layers with zero further changes. ----
const LIBRARY_STORAGE_KEY='rhinestone-studio:design-library';
const LIBRARY_THUMB_WIDTH_PX=260,LIBRARY_THUMB_HEIGHT_PX=170;
const LIBRARY_NEW_PROJECT_DEFAULTS={defaultProduct:'mug',defaultCupColor:'#1f3556',defaultWrap:'front',projectVersion:2};
let designLibrary;
try{
  designLibrary=new DesignLibrary({storageAdapter:createLocalStorageAdapter(LIBRARY_STORAGE_KEY)});
}catch(error){
  console.warn('Design Library: localStorage is unavailable in this environment; using in-memory storage for this session only.',error);
  designLibrary=new DesignLibrary({storageAdapter:createMemoryStorageAdapter()});
}
let libraryQuery='',libraryCategory='All',librarySortDir='asc',pendingLibraryDeleteId=null;

function currentSelectedLayers(){return project.layers.filter(l=>selectedLayerIds.has(l.id))}

// RS-2001: generalized from the Design-Library-only generateLibraryThumbnail() so the Gallery
// reuses the exact same generate -> render -> capture sequence for its own cards/previews, rather
// than a second thumbnail renderer.
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

function updateLibrarySaveButtons(){
  const hasSelection=selectedLayerIds.size>0;
  el('librarySaveSelection').disabled=!hasSelection;
  el('libraryDisabledHint').style.display=hasSelection?'none':'block';
}

function libraryFilteredSortedItems(){
  const searched=designLibrary.search(libraryQuery);
  const filtered=designLibrary.filterByCategory(searched,libraryCategory);
  return designLibrary.sortByName(filtered,librarySortDir);
}

function renderLibraryGrid(){
  const all=designLibrary.list();
  const items=libraryFilteredSortedItems();
  const categories=['All',...designLibrary.categories()];
  el('libraryCategoryFilter').innerHTML=categories.map(c=>`<option value="${escapeHtml(c)}" ${c===libraryCategory?'selected':''}>${c==='All'?'All categories':escapeHtml(c)}</option>`).join('');
  el('libraryEmptyState').style.display=all.length===0?'block':'none';
  el('libraryNoResults').style.display=(all.length>0&&items.length===0)?'block':'none';
  el('libraryGrid').innerHTML=items.map(item=>`<div class="library-card" data-item="${item.id}">
      <div class="library-card-thumb">${item.thumbnail?`<img src="${item.thumbnail}" alt="Preview of ${escapeHtml(item.name)}">`:'<span class="library-card-thumb-empty">No preview</span>'}</div>
      <div class="library-card-body">
        <h4 data-role="name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</h4>
        <div class="library-card-meta"><span class="library-badge">${item.kind==='project'?'Project':'Selection'}</span><span class="library-badge">${escapeHtml(item.category)}</span></div>
      </div>
      <div class="library-card-actions">
        <button class="btn" data-action="insert" title="Insert into the current project">Insert</button>
        <button class="btn" data-action="newProject" title="Start a new project from this design">New Project</button>
        <button class="btn" data-action="rename" title="Rename this design">Rename</button>
        <button class="btn" data-action="duplicate" title="Duplicate this design">Duplicate</button>
        <button class="btn danger" data-action="delete" title="Delete this design">Delete</button>
      </div>
    </div>`).join('');
}

function onLibraryOpen(){
  libraryQuery='';libraryCategory='All';librarySortDir='asc';
  el('librarySearch').value='';el('librarySort').value='asc';el('libraryStatus').textContent='';
  updateLibrarySaveButtons();
  renderLibraryGrid();
}

async function saveProjectToLibrary(){
  const name=el('librarySaveName').value.trim()||project.name||DEFAULT_PROJECT_NAME;
  const data=buildProjectItemData(project);
  const thumbnail=await generateProjectThumbnail(project);
  designLibrary.add({kind:'project',name,data,thumbnail});
  el('librarySaveName').value='';
  renderLibraryGrid();
  el('libraryStatus').textContent=`Saved "${name}" to the Design Library.`;
}

async function saveSelectionToLibrary(){
  const layers=currentSelectedLayers();
  if(layers.length===0)return;
  const name=el('librarySaveName').value.trim()||'Untitled Selection';
  const data=buildSelectionItemData(layers,project.canvas);
  const thumbnail=await generateProjectThumbnail({...project,layers});
  designLibrary.add({kind:'selection',name,data,thumbnail});
  el('librarySaveName').value='';
  renderLibraryGrid();
  el('libraryStatus').textContent=`Saved "${name}" to the Design Library.`;
}

function insertLibraryItem(id){
  const item=designLibrary.get(id);if(!item)return;
  const newLayers=prepareLayersForInsert(getInsertableLayers(item));
  commitHistory();
  project.layers.push(...newLayers);
  selectedLayerIds=selectMany(newLayers.map(l=>l.id));
  selectedLayerId=newLayers[newLayers.length-1].id;
  syncSelectedControlsFromLayer();
  updateAll(true);
  updateLibrarySaveButtons();
  el('libraryStatus').textContent=`Inserted "${item.name}" (${newLayers.length} layer${newLayers.length===1?'':'s'}).`;
}

function createProjectFromLibraryItem(id){
  const item=designLibrary.get(id);if(!item)return;
  const built=buildProjectFromItem(item,LIBRARY_NEW_PROJECT_DEFAULTS);
  project=validateProject(built);
  selectedLayerId=project.layers[0].id;selectedLayerIds=selectOnly(selectedLayerId);
  // Mirrors #importProjectFile's exact "loading/replacing a project is a fresh start, not an
  // undoable edit" history-clear + dirty-baseline-reset pattern.
  history.clear();cleanProjectJson=JSON.stringify(project);
  syncSelectedControlsFromLayer();updateAll(true);
  lightboxes.library.close();
  el('status').textContent=`Started a new project from "${item.name}".`;
}

function beginRenameLibraryItem(card,id){
  const item=designLibrary.get(id);if(!item)return;
  const nameEl=card.querySelector('[data-role="name"]');
  const input=document.createElement('input');
  input.type='text';input.maxLength=80;input.value=item.name;input.className='library-rename-input';
  nameEl.replaceWith(input);input.focus();input.select();
  let settled=false;
  const commit=()=>{
    if(settled)return;settled=true;
    const value=input.value.trim();
    if(value&&value!==item.name){designLibrary.rename(id,value);el('libraryStatus').textContent='Renamed.'}
    renderLibraryGrid();
  };
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();commit()}
    else if(e.key==='Escape'){e.preventDefault();settled=true;renderLibraryGrid()}
  });
  input.addEventListener('blur',commit);
}

function requestDeleteLibraryItem(id){
  const item=designLibrary.get(id);if(!item)return;
  pendingLibraryDeleteId=id;
  el('libraryConfirmMessage').textContent=`Delete "${item.name}" from the Design Library? This cannot be undone.`;
  lightboxes.libraryConfirm.open();
}

el('librarySaveProject').onclick=()=>{saveProjectToLibrary()};
el('librarySaveSelection').onclick=()=>{saveSelectionToLibrary()};
el('librarySearch').addEventListener('input',()=>{libraryQuery=el('librarySearch').value;renderLibraryGrid()});
el('libraryCategoryFilter').addEventListener('change',()=>{libraryCategory=el('libraryCategoryFilter').value;renderLibraryGrid()});
el('librarySort').addEventListener('change',()=>{librarySortDir=el('librarySort').value;renderLibraryGrid()});
el('libraryGrid').addEventListener('click',e=>{
  const card=e.target.closest('.library-card');if(!card)return;
  const id=card.dataset.item,action=e.target.dataset.action;
  if(action==='insert')insertLibraryItem(id);
  else if(action==='newProject')createProjectFromLibraryItem(id);
  else if(action==='duplicate'){designLibrary.duplicate(id);renderLibraryGrid();el('libraryStatus').textContent='Duplicated.'}
  else if(action==='delete')requestDeleteLibraryItem(id);
  else if(action==='rename')beginRenameLibraryItem(card,id);
});
el('libraryConfirmDelete').onclick=()=>{
  if(pendingLibraryDeleteId){designLibrary.remove(pendingLibraryDeleteId);pendingLibraryDeleteId=null;renderLibraryGrid();el('libraryStatus').textContent='Deleted.'}
  lightboxes.libraryConfirm.close();
};

// ---- Gallery (RS-2001): a built-in, permanent, READ-ONLY set of example projects sourced from
// examples/*.rhs + examples/manifest.json + examples/baselines.json + examples/gallery.json (the
// curatorial metadata this milestone adds). Gallery is not the Design Library: items are never
// renamed/duplicated/deleted, and nothing here is ever written back to examples/**. "Open Copy"
// fetches a fixture, translates it through the existing toAppProjectShape()/validateProject()
// bridge (src/gallery/index.js), and replaces the live project exactly like #importProjectFile
// already does; "Save to Library" reuses buildProjectItemData()/designLibrary.add() without
// touching the live project at all. Thumbnails reuse generateProjectThumbnail() above -- no second
// thumbnail renderer, no second render pipeline. ----
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
    syncSelectedControlsFromLayer();await updateAll(true);
    lightboxes.galleryPreview.close();lightboxes.gallery.close();
    el('status').textContent=`Opened an editable copy of "${entry.title}" from the Gallery.`;
  }catch(error){
    console.error('Gallery: failed to open item as a copy',error);
    el('galleryPreviewStatus').textContent=`Failed to open: ${error.message}`;
  }
}

async function saveGalleryItemToLibrary(file){
  const entry=getGalleryEntry(galleryEntries,file);if(!entry)return;
  try{
    const appProject=buildAppProjectFromGalleryFile(file,entry.title);
    const data=buildProjectItemData(appProject);
    const thumbnail=await generateGalleryThumbnail(file,entry.title);
    designLibrary.add({kind:'project',name:entry.title,data,thumbnail});
    el('galleryPreviewStatus').textContent=`Saved "${entry.title}" to the Design Library.`;
  }catch(error){
    console.error('Gallery: failed to save item to the Design Library',error);
    el('galleryPreviewStatus').textContent=`Save failed: ${error.message}`;
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
el('galleryPreviewSaveToLibrary').onclick=()=>{if(galleryPreviewFile)saveGalleryItemToLibrary(galleryPreviewFile)};

// ---- Shipping & Handling: local, session-scoped metadata only. Deliberately not part of
// `project` / Project JSON / undo-redo this milestone -- see
// docs/specifications/UI-001-CompleteRedesign.md, "Shipping & Handling". ----
const shippingInfo={packageType:'box',lengthMm:'',widthMm:'',heightMm:'',weightG:'',notes:'',fragile:false};
function syncShippingFieldsFromState(){
  el('shipPackageType').value=shippingInfo.packageType;el('shipLengthMm').value=shippingInfo.lengthMm;
  el('shipWidthMm').value=shippingInfo.widthMm;el('shipHeightMm').value=shippingInfo.heightMm;
  el('shipWeightG').value=shippingInfo.weightG;el('shipNotes').value=shippingInfo.notes;el('shipFragile').checked=shippingInfo.fragile;
}
el('shipApply').onclick=()=>{
  shippingInfo.packageType=el('shipPackageType').value;shippingInfo.lengthMm=el('shipLengthMm').value;
  shippingInfo.widthMm=el('shipWidthMm').value;shippingInfo.heightMm=el('shipHeightMm').value;
  shippingInfo.weightG=el('shipWeightG').value;shippingInfo.notes=el('shipNotes').value;shippingInfo.fragile=el('shipFragile').checked;
  el('status').textContent='Shipping & Handling notes updated (this session only).';
};

// ---- Settings: mirrors the live grid/safe-area/snap toggle state (one boolean each, never a
// second independent copy). Default stone size/gap are session-local preference fields not yet
// wired into new-layer creation (addCircle/addRect already default sensibly from the currently
// selected layer) -- documented, not faked; see the specification. ----
function syncSettingsFieldsFromState(){
  el('settingsGridDefault').checked=true;el('settingsGridDefault').disabled=true;
  el('settingsSafeAreaDefault').checked=showSafeArea;el('settingsSnapDefault').checked=snapEnabled;
  el('settingsSnapDistance').value=snapToleranceMm;el('settingsShowGuides').checked=showSnapGuides;
}
el('settingsApply').onclick=()=>{
  showSafeArea=el('settingsSafeAreaDefault').checked;el('safeAreaToggle').setAttribute('aria-pressed',String(showSafeArea));
  snapEnabled=el('settingsSnapDefault').checked;el('snapEnabled').value=snapEnabled?'on':'off';
  snapToleranceMm=Math.min(5,Math.max(0.5,parseFloat(el('settingsSnapDistance').value)||SNAP_TOLERANCE_MM));
  showSnapGuides=el('settingsShowGuides').checked;
  drawLayout();
};

populateStoneColorOptions();populateStoneSizeOptions();
// RS-2002: only populated when fontManager actually loaded -- if the manifest fetch failed,
// index.html's static two-option #font markup (Courier Prime/Great Vibes) is left as the fallback,
// and permanentEngineError's #status message (set inside updateAll(), see generate() above)
// already tells the user text layers are empty.
if(fontManager){populateFontOptions();injectFontFaceRules(fontManager.listFonts())}
syncSelectedControlsFromLayer();updateAll(true);
