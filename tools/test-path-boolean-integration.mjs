import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeometryEngine, combineShapeSources, combineManyShapeSources } from '../src/geometry/index.js';
import { stoneLayoutToSvg } from '../src/export/SvgExporter.js';
import { productionSheetToSvg } from '../src/export/ProductionSheetExporter.js';

// RS-1012 (Vector Boolean Operations) integration tests. Structural checks against the live
// app.js/index.html source (app.js is a browser entry point and is not import()-able directly
// under plain Node, matching the established convention in
// tools/test-svg-integration.mjs/tools/test-image-integration.mjs); behavioral checks run the real,
// imported GeometryEngine.resolve*/generatePathLayout() methods and src/geometry/PathBoolean.js
// (also independently unit-tested in tools/test-path-boolean.mjs), plus the real exporters, to
// prove a boolean result's StoneLayout flows unchanged through export/Production Sheet — per
// docs/ARCHITECTURE.md, no exporter file needed to change for this milestone.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------------------------
// GeometryEngine: resolve*Polygons() / generatePathLayout() — real, imported module behavior
// ---------------------------------------------------------------------------------------------

await test('1. resolveShapePolygons() returns the same polygons generateShapeLayout() flattens internally', () => {
  const engine = new GeometryEngine();
  const { polygons, boundingBox } = engine.resolveShapePolygons({ shape: 'rectangle', layerId: 'r1', xMm: 10, yMm: 20, widthMm: 30, heightMm: 15 });
  assert.equal(polygons.length, 1);
  assert.equal(polygons[0].length, 4);
  assert.equal(boundingBox.widthMm, 30);
  assert.equal(boundingBox.heightMm, 15);

  const circle = engine.resolveShapePolygons({ shape: 'circle', layerId: 'c1', cxMm: 0, cyMm: 0, radiusMm: 10 });
  assert.equal(circle.polygons.length, 1);
  assert.ok(circle.polygons[0].length > 8);
});

await test('2. resolveSvgPolygons() only returns closed contours (open paths have no interior to combine)', () => {
  const engine = new GeometryEngine();
  const svgSource = '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm"><rect x="0" y="0" width="10" height="10"/><line x1="0" y1="0" x2="10" y2="10"/></svg>';
  const { polygons, boundingBox } = engine.resolveSvgPolygons({ svgSource, layerId: 's1', xMm: 0, yMm: 0, widthMm: 20, heightMm: 20 });
  assert.equal(polygons.length, 1, 'expected only the closed <rect>, not the open <line>');
  assert.ok(boundingBox);
});

await test('3. resolvePathPolygons() places (0,0)-rooted contours into an x/y/w/h box, matching generatePathLayout()\'s own placement', () => {
  const engine = new GeometryEngine();
  const contours = [[{ xMm: 0, yMm: 0 }, { xMm: 10, yMm: 0 }, { xMm: 10, yMm: 10 }, { xMm: 0, yMm: 10 }]];
  const { polygons, boundingBox } = engine.resolvePathPolygons({ contours, layerId: 'p1', xMm: 5, yMm: 5, widthMm: 20, heightMm: 20 });
  assert.equal(boundingBox.minXmm, 5);
  assert.equal(boundingBox.widthMm, 20);
  assert.equal(polygons[0].length, 4);
});

await test('4. generatePathLayout() outline/fill-samples a boolean result exactly like generateSvgLayout() samples an SVG shape', () => {
  const engine = new GeometryEngine();
  // A union of two overlapping squares, normalized to (0,0), matching the shape app.js's
  // runBooleanOp() constructs before calling generatePathStonesLive().
  const a = [{ xMm: 0, yMm: 0 }, { xMm: 10, yMm: 0 }, { xMm: 10, yMm: 10 }, { xMm: 0, yMm: 10 }];
  const b = [{ xMm: 5, yMm: 5 }, { xMm: 15, yMm: 5 }, { xMm: 15, yMm: 15 }, { xMm: 5, yMm: 15 }];
  const combined = combineShapeSources({ kind: 'polygons', polygons: [a] }, { kind: 'polygons', polygons: [b] }, 'union');
  const box = combined.boundingBox;
  const localContours = combined.contours.map((poly) => poly.map((p) => ({ xMm: p.xMm - box.minXmm, yMm: p.yMm - box.minYmm })));

  const outline = engine.generatePathLayout({ contours: localContours, layerId: 'union-1', xMm: box.minXmm, yMm: box.minYmm, stoneSizeMm: 1, gapMm: 0.2, mode: 'outline', color: 'gold' });
  assert.ok(outline.count > 0);
  assert.equal(outline.sourceMode, 'outline');
  for (const stone of outline.stones) {
    assert.equal(stone.color, 'gold');
    assert.equal(stone.layerId, 'union-1');
    assert.ok(Number.isFinite(stone.xMm) && Number.isFinite(stone.yMm));
  }

  const fill = engine.generatePathLayout({ contours: localContours, layerId: 'union-1', xMm: box.minXmm, yMm: box.minYmm, stoneSizeMm: 1, gapMm: 0.2, mode: 'fill', color: 'gold' });
  assert.ok(fill.count > outline.count, 'expected fill mode to place more stones than outline mode for a 15x15mm-ish shape');
});

await test('5. generatePathLayout() scales a natural-size shape into an explicit widthMm/heightMm box, like generateSvgLayout()', () => {
  const engine = new GeometryEngine();
  const contours = [[{ xMm: 0, yMm: 0 }, { xMm: 10, yMm: 0 }, { xMm: 10, yMm: 10 }, { xMm: 0, yMm: 10 }]];
  const natural = engine.generatePathLayout({ contours, layerId: 'p1', stoneSizeMm: 1, gapMm: 0, mode: 'outline' });
  const scaled = engine.generatePathLayout({ contours, layerId: 'p1', widthMm: 20, heightMm: 20, stoneSizeMm: 1, gapMm: 0, mode: 'outline' });
  assert.ok(scaled.widthMm > natural.widthMm);
});

await test('6. generatePathLayout() rejects malformed contours with clear errors', () => {
  const engine = new GeometryEngine();
  assert.throws(() => engine.generatePathLayout({ contours: [], layerId: 'p1', stoneSizeMm: 1 }), /non-empty contours/);
  assert.throws(() => engine.generatePathLayout({ contours: [[{ xMm: 0, yMm: 0 }]], layerId: 'p1', stoneSizeMm: 1 }), /at least 3 points/);
  assert.throws(() => engine.generatePathLayout({ contours: [[{ xMm: 0, yMm: 0 }, { xMm: 1, yMm: 0 }, { xMm: 1, yMm: 1 }]], stoneSizeMm: 1 }), /non-empty layerId/);
});

// ---------------------------------------------------------------------------------------------
// Export / Production Sheet compatibility — proves no exporter changed, per docs/ARCHITECTURE.md
// ---------------------------------------------------------------------------------------------

await test('7. a boolean result\'s StoneLayout exports through the unmodified SVG exporter', () => {
  const engine = new GeometryEngine();
  const contours = [[{ xMm: 0, yMm: 0 }, { xMm: 10, yMm: 0 }, { xMm: 10, yMm: 10 }, { xMm: 0, yMm: 10 }]];
  const layout = engine.generatePathLayout({ contours, layerId: 'p1', xMm: 5, yMm: 5, stoneSizeMm: 2, gapMm: 0.3, mode: 'outline', color: 'gold' });
  const svg = stoneLayoutToSvg(layout, { widthMm: 50, heightMm: 50 });
  assert.match(svg, /<svg/);
  assert.match(svg, /<circle/, 'expected the exporter to render stones as circles, unaware this layer came from a Boolean Operation');
});

await test('8. a boolean result\'s StoneLayout exports through the unmodified Production Sheet exporter', () => {
  const engine = new GeometryEngine();
  const contours = [[{ xMm: 0, yMm: 0 }, { xMm: 10, yMm: 0 }, { xMm: 10, yMm: 10 }, { xMm: 0, yMm: 10 }]];
  const layout = engine.generatePathLayout({ contours, layerId: 'p1', xMm: 5, yMm: 5, stoneSizeMm: 2, gapMm: 0.3, mode: 'outline', color: 'gold' });
  const svg = productionSheetToSvg(layout, { projectName: 'Test', objectType: 'Mug', productionWidthMm: 210, productionHeightMm: 90, gapMm: [0.3], pageSize: 'A4', marginMm: 10, mirror: false, registrationMarks: true });
  assert.match(svg, /<svg/);
  assert.match(svg, /Test/);
});

// ---------------------------------------------------------------------------------------------
// app.js structural wiring
// ---------------------------------------------------------------------------------------------

await test('9. app.js imports combineManyShapeSources from the geometry barrel', () => {
  // S-110 legitimately adds more named imports (SHAPE_LIBRARY_KINDS, FITTABLE_SHAPE_TYPES,
  // computeInscribedRect, computeShapeFitScale) to this same import line -- matched loosely (any
  // named-import list containing these four, in their original relative order) rather than
  // requiring it to be the complete list.
  assert.match(appJs, /import\s*\{\s*GeometryEngine as PermanentGeometryEngine,\s*Stone,\s*StoneLayout,\s*combineManyShapeSources[^}]*\}\s*from\s*['"]\.\/src\/geometry\/index\.js['"]/);
});

await test('10. SUPPORTED_LAYER_TYPES includes \'path\', and validateProject() has path-specific field checks', () => {
  assert.match(appJs, /SUPPORTED_LAYER_TYPES\s*=\s*new Set\(\[[^\]]*'path'[^\]]*\]\)/);
  assert.match(appJs, /l\.type==='path'&&!\(Array\.isArray\(l\.contours\)/);
  assert.match(appJs, /Path layer "\$\{l\.id\}" is missing a valid non-empty 'contours' array/);
});

await test('11. GeometryEngine.generate() routes \'path\' layers through generatePathStonesLive() -> permanentEngine.generatePathLayout()', () => {
  assert.match(appJs, /if\(l\.type==='path'\)raw\.push\(\.\.\.await this\.generatePathStonesLive\(l\)\)/);
  assert.match(appJs, /async generatePathStonesLive\(layer,\{includeStats=false\}=\{\}\)\{[\s\S]*?this\.permanentEngine\.generatePathLayout\(params\)/);
});

await test('12. getLayerBBox()/drag-resize/duplicateLayer()/layerLabel()/moreOptionsBtn each have a \'path\' case (shared with rectangle/svg/image)', () => {
  // S-110 generalized every one of these per-type unions (plus nine new shape kinds) into shared
  // XYWH_SHAPE_TYPES/SHAPE_LAYER_TYPES sets -- 'path' still behaves exactly like rectangle/svg/image.
  assert.match(appJs, /if\(l\.type==='circle'\)return\{[^}]*\};if\(XYWH_SHAPE_TYPES\.has\(l\.type\)\)return\{x:l\.x,y:l\.y,width:l\.w,height:l\.h,x2:l\.x\+l\.w,y2:l\.y\+l\.h\}/);
  // RS-3030: the unrotated fast path picked up an `&&!drag.rotationDeg` guard (the rotated case
  // now branches to its own local-axis resize algorithm, see the milestone doc) -- 'path' still
  // isn't special-cased, it's still gated purely by XYWH_SHAPE_TYPES membership like rectangle/svg/image.
  assert.match(appJs, /XYWH_SHAPE_TYPES\.has\(l\.type\)(?:&&[^)]*)?\)\{let x0=drag\.b0\.x/);
  // RS-3011 Step 2 added a drawingTool.duplicateShapeForLayer() call inside this same branch (so a
  // Design-drawn 'path' shape's Paper.js item gets cloned alongside the layer) -- this checks the
  // enduring invariant (XYWH_SHAPE_TYPES.has(copy.type) still gates an x/y offset assignment for
  // copy) rather than the exact old one-liner, so it doesn't re-break on the next legitimate edit
  // inside this block.
  assert.match(appJs, /if\(XYWH_SHAPE_TYPES\.has\(copy\.type\)\)\{[^}]*copy\.x\s*\+=[^;]+;[^}]*copy\.y\s*\+=[^;]+;[^}]*\}/);
  assert.match(appJs, /if\(l\.type==='path'\)return l\.pathName\|\|'Path'/);
  // S-105 follow-up moved the type->Lightbox mapping (moreOptionsBtn's former inline branch) into
  // the shared lightboxForLayerType() helper -- see tools/test-lightbox-movable-persistent.mjs.
  const fnMatch = appJs.match(/function lightboxForLayerType\(t\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected a lightboxForLayerType(t) function in app.js');
  assert.match(fnMatch[0], /if\(t==='path'\|\|SHAPE_LAYER_TYPES\.has\(t\)\)return lightboxes\.shapes/);
});

await test('13. writeSelectedControlsToLayer() has a \'path\' branch writing the shared x/y/w/h fields back', () => {
  // RS-1011: the path branch also writes l.fillMode now (the Shapes Lightbox's new #shapeFillMode
  // control, shared with circle/rectangle -- see docs/specifications/RS-1011-FillAlgorithms.md).
  assert.match(appJs, /else if\(l\.type==='path'\)\{l\.x=readLengthField\('shapeX'\)\|\|0;l\.y=readLengthField\('shapeY'\)\|\|0;l\.w=Math\.max\(2,readLengthField\('shapeW'\)\|\|10\);l\.h=Math\.max\(2,readLengthField\('shapeH'\)\|\|10\);l\.fillMode=resolveVectorFillMode\(el\('shapeFillMode'\)\.value\)\}/);
});

await test('14. resolveLayerShapeSource() resolves every layer type into a boolean-input source, or null when a shape has no closed outline', () => {
  assert.match(appJs, /async function resolveLayerShapeSource\(layer\)\{/);
  for (const branch of [
    // S-110 generalized this branch's condition into a shared SHAPE_LAYER_TYPES set (also covering
    // nine new shape kinds) -- circle/rectangle still resolve through the same
    // permanentEngine.resolveShapePolygons() call just below, unchanged.
    /SHAPE_LAYER_TYPES\.has\(layer\.type\)/,
    /layer\.type==='svg'/,
    /layer\.type==='path'/,
    /layer\.type==='text'/,
    /layer\.type==='image'/
  ]) {
    assert.match(appJs, branch, `expected resolveLayerShapeSource to branch on ${branch}`);
  }
  assert.match(appJs, /permanentEngine\.resolveShapePolygons\(/);
  assert.match(appJs, /permanentEngine\.resolveSvgPolygons\(/);
  assert.match(appJs, /permanentEngine\.resolvePathPolygons\(/);
  assert.match(appJs, /permanentEngine\.resolveTextPolygons\(/);
  assert.match(appJs, /kind:'field',field,xMm:layer\.x,yMm:layer\.y,widthMm:layer\.w,heightMm:layer\.h/);
  // Regression: resolveTextPolygons()'s params must carry layerId (normalizeTextParams() throws
  // "requires a non-empty layerId" without it) -- caught by browser verification when a text layer
  // was included in a multi-selection alongside a shape.
  // TXT-101A also threads providerId (resolveFontProviderId(fontId)) into this same params object.
  assert.match(appJs, /const base=\{text:layer\.text,fontId,providerId:resolveFontProviderId\(fontId\),layerId:layer\.id,heightMm:layer\.height,curveEnabled:/);
});

await test('15. runBooleanOp() requires 2+ layers, commits history before mutating, removes the source layers, and reports a specific status message', () => {
  assert.match(appJs, /async function runBooleanOp\(operation\)\{/);
  assert.match(appJs, /if\(layers\.length<2\)\{[\s\S]{0,200}?showBooleanOpsError\(/);
  assert.match(appJs, /const missingIndex=sources\.findIndex\(s=>!s\);/, 'expected a graceful-failure check for layers with no closed outline');
  assert.match(appJs, /if\(!combined\.contours\.length\)\{/, 'expected a graceful-failure check for an empty operation result');
  // commitHistory() must run before project.layers is mutated (source-layer removal), so a failed
  // resolve/combine step above never touches project or history.
  const fnBody = appJs.slice(appJs.indexOf('async function runBooleanOp'), appJs.indexOf('function nudgeSelection'));
  const commitIndex = fnBody.indexOf('commitHistory();');
  const filterIndex = fnBody.indexOf('project.layers=project.layers.filter(l=>!ids.includes(l.id));');
  assert.ok(commitIndex > -1 && filterIndex > -1 && commitIndex < filterIndex, 'expected commitHistory() to run before source layers are removed');
  // RS-1012A: the resolution options object now threads the destination layer's own stone pitch
  // through as a resolution hint (see src/geometry/PathBoolean.js's computeAdaptiveCellSizeMm()).
  assert.match(fnBody, /combineManyShapeSources\(sources,operation,\{targetSpacingMm\}\)/);
  assert.match(fnBody, /const targetSpacingMm=\(layers\[0\]\.stoneSize\|\|2\)\+\(layers\[0\]\.gap\?\?0\.3\);/);
  assert.match(fnBody, /type:'path'/);
});

await test('16. Boolean Operations use the required Union/Subtract/Intersect/Exclude terminology, not raw operation ids like "xor"', () => {
  assert.match(appJs, /const BOOLEAN_OPERATION_LABELS=\{union:'Union',subtract:'Subtract',intersect:'Intersect',xor:'Exclude'\}/);
});

// ---------------------------------------------------------------------------------------------
// UI wiring (index.html) — placed in the Shapes Lightbox, per the milestone brief
// ---------------------------------------------------------------------------------------------

await test('17. the Shapes Lightbox has a Boolean Operations section with Union/Subtract/Intersect/Exclude buttons, each with an explanatory tooltip', () => {
  const shapesLightboxStart = indexHtml.indexOf('id="lightboxShapes"');
  const shapesLightboxEnd = indexHtml.indexOf('<!-- ---------- IMPORT ---------- -->');
  const section = indexHtml.slice(shapesLightboxStart, shapesLightboxEnd);
  assert.match(section, /<h3>Boolean Operations<\/h3>/);
  for (const id of ['boolUnion', 'boolSubtract', 'boolIntersect', 'boolExclude']) {
    const re = new RegExp(`<button class="btn" id="${id}" disabled title="[^"]+">`);
    assert.match(section, re, `expected #${id} to exist, start disabled, and have a tooltip`);
  }
  assert.match(section, /id="booleanOpsValidation"/);
  assert.match(section, /id="booleanOpsHint"/);
});

await test('18. Boolean Operation buttons are wired to runBooleanOp() with the correct operation id', () => {
  assert.match(appJs, /el\('boolUnion'\)\.onclick=\(\)=>runBooleanOp\('union'\)/);
  assert.match(appJs, /el\('boolSubtract'\)\.onclick=\(\)=>runBooleanOp\('subtract'\)/);
  assert.match(appJs, /el\('boolIntersect'\)\.onclick=\(\)=>runBooleanOp\('intersect'\)/);
  assert.match(appJs, /el\('boolExclude'\)\.onclick=\(\)=>runBooleanOp\('xor'\)/);
});

await test('19. updateEditingUI() disables the four Boolean Operation buttons whenever fewer than 2 layers are selected, exactly like Align', () => {
  assert.match(appJs, /const boolDisabled=n<2;for\(const id of\['boolUnion','boolSubtract','boolIntersect','boolExclude'\]\)el\(id\)\.disabled=boolDisabled;/);
});

// ---------------------------------------------------------------------------------------------
// Undo/redo and save/load are automatic consequences of routing through the existing
// project/commitHistory/validateProject machinery — these assertions pin that down explicitly.
// ---------------------------------------------------------------------------------------------

await test('20. undo/redo: runBooleanOp() uses the same commitHistory()/currentSnapshot() machinery every other editing action uses (no parallel history)', () => {
  assert.ok(!/history\.commit\(/.test(appJs.slice(appJs.indexOf('async function runBooleanOp'), appJs.indexOf('function nudgeSelection'))), 'runBooleanOp must go through commitHistory(), not call history.commit() directly');
});

await test('21. save/load: a project containing a path layer round-trips through validateProject()', async () => {
  const validateMatch = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  assert.ok(validateMatch, 'expected to find validateProject()');
  const constantsSlice = appJs.slice(appJs.indexOf('const SUPPORTED_LAYER_TYPES=new Set'), appJs.indexOf(validateMatch[0]) + validateMatch[0].length);
  const getObjectTemplateModule = await import('../src/products/index.js');
  // S-110: validateProject()'s own extracted slice includes SUPPORTED_LAYER_TYPES's declaration,
  // which now spreads SHAPE_LIBRARY_KINDS, and validateProject() itself references
  // XYWH_SHAPE_TYPES -- both declared well before this slice begins, injected as function
  // parameters for the same reason getObjectTemplate is.
  const { SHAPE_LIBRARY_KINDS } = await import('../src/geometry/index.js');
  const XYWH_SHAPE_TYPES = new Set(['rectangle', 'svg', 'image', 'path', ...SHAPE_LIBRARY_KINDS]);
  // S-112: validateProject() also calls normalizePlateParams() -- injected as a function parameter
  // for the same reason getObjectTemplate is.
  const fn = new Function(
    'getObjectTemplate', 'normalizePlateParams', 'XYWH_SHAPE_TYPES', 'SHAPE_LIBRARY_KINDS',
    'VESSEL_PRODUCT_IDS', 'getVesselDefaults', 'normalizeVesselParams', 'deriveLegacyVesselParams', 'computeCanvasFromVessel',
    `${constantsSlice}\nreturn validateProject;`
  )(getObjectTemplateModule.getObjectTemplate, getObjectTemplateModule.normalizePlateParams, XYWH_SHAPE_TYPES, SHAPE_LIBRARY_KINDS, getObjectTemplateModule.VESSEL_PRODUCT_IDS, getObjectTemplateModule.getVesselDefaults, getObjectTemplateModule.normalizeVesselParams, getObjectTemplateModule.deriveLegacyVesselParams, getObjectTemplateModule.computeCanvasFromVessel);

  const validProject = {
    version: 2, name: 'Test', product: 'mug', canvas: { width: 210, height: 90 },
    layers: [{
      id: 'path1', type: 'path', visible: true, pathName: 'Union Result',
      contours: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]],
      x: 5, y: 5, w: 10, h: 10, stoneSize: 2, gap: 0.3, color: 'gold'
    }]
  };
  const normalized = fn(validProject);
  assert.equal(normalized.layers[0].type, 'path');

  const missingContours = JSON.parse(JSON.stringify(validProject));
  delete missingContours.layers[0].contours;
  assert.throws(() => fn(missingContours), /contours/);

  const badPlacement = JSON.parse(JSON.stringify(validProject));
  delete badPlacement.layers[0].w;
  assert.throws(() => fn(badPlacement), /x\/y\/w\/h/);
});

// ---------------------------------------------------------------------------------------------
// UX terminology: error/tooltip strings must be plain-language, per the milestone brief
// ---------------------------------------------------------------------------------------------

await test('22. graceful-failure messages name the specific problem in plain language (no raw operation ids or stack traces)', () => {
  assert.match(appJs, /Select two or more layers \(Shift-click on the canvas or in the Layers list\) to use Boolean Operations\./);
  assert.match(appJs, /has no closed shape to combine/);
  assert.match(appJs, /produced an empty shape/);
});

console.log('Path Boolean integration tests passed.');
