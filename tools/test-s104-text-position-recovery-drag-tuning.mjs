import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// S-104 (Text Position Recovery & Drag Tuning): (1) move-drag sensitivity is reduced via a named
// constant applied to the pointer delta before it becomes a position change, so dragging is smoother
// and more precise; (2) a "Center on Object" action resets only a selected text layer's x/y to the
// center of the printable (safe) area, recovering text dragged fully outside the visible canvas,
// without touching font/size/rotation/spacing/fill/stone size.
// Structural checks against the live app.js/index.html source, matching the established convention
// in tools/test-alignment-snapping-integration.mjs / tools/test-ui001b-fixes.mjs (app.js is a
// browser entry point, not import()-able directly under plain Node).

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

await test('1. a named LAYER_MOVE_DRAG_SENSITIVITY constant exists and is strictly between 0 and 1 (reduced, not removed or left at 1:1)', () => {
  const match = appJs.match(/const LAYER_MOVE_DRAG_SENSITIVITY=([0-9.]+);/);
  assert.ok(match, 'expected a named LAYER_MOVE_DRAG_SENSITIVITY constant in app.js');
  const value = Number(match[1]);
  assert.ok(value > 0 && value < 1, `expected LAYER_MOVE_DRAG_SENSITIVITY to be in (0,1), got ${value}`);
});

await test('2. the move-drag pointermove handler scales the pointer delta by LAYER_MOVE_DRAG_SENSITIVITY before snapping/shift-lock/position-apply, not after', () => {
  const handler = appJs.match(/layoutCanvas\.addEventListener\('pointermove',e=>\{[\s\S]*?\n\}\);/);
  assert.ok(handler, 'expected to find the layoutCanvas pointermove handler');
  const body = handler[0];
  assert.match(body, /let dx=rawDx\*LAYER_MOVE_DRAG_SENSITIVITY,dy=rawDy\*LAYER_MOVE_DRAG_SENSITIVITY;/, 'expected dx/dy to be derived from rawDx/rawDy scaled by the sensitivity constant');
  const scaleIndex = body.indexOf('LAYER_MOVE_DRAG_SENSITIVITY');
  const snapIndex = body.indexOf('if(snapEnabled)');
  const applyIndex = body.indexOf('setLayerPosition(l,p0.xMm+dx,p0.yMm+dy)');
  assert.ok(scaleIndex >= 0 && snapIndex > scaleIndex, 'expected the sensitivity scale to happen before snapping');
  assert.ok(applyIndex > snapIndex, 'expected the position to still be applied after snapping/shift-lock, unchanged in structure');
});

await test('3. resize-drag (mm-under-cursor, not a pointer delta) is untouched by the sensitivity constant', () => {
  const resizeBranch = appJs.match(/\}else if\(drag\.kind==='resize'\)\{[\s\S]*?\n  \}/);
  assert.ok(resizeBranch, 'expected to find the resize-drag branch');
  assert.doesNotMatch(resizeBranch[0], /LAYER_MOVE_DRAG_SENSITIVITY/, 'resize-drag must not be scaled — it maps directly to the pointer mm position, not a delta');
});

await test('4. the Text lightbox\'s Position section has a "Center on Object" button, placed after the X/Y fields', () => {
  const positionSection = indexHtml.match(/<h3>Position<\/h3>[\s\S]*?<\/div>\s*<p class="hint">/);
  assert.ok(positionSection, 'expected to find the Text lightbox Position field-section');
  const body = positionSection[0];
  assert.match(body, /id="textY"/);
  assert.match(body, /id="centerTextOnObject"/);
  assert.ok(body.indexOf('id="textY"') < body.indexOf('id="centerTextOnObject"'), 'expected the button after the X/Y fields');
  assert.match(body, /Center on Object</);
});

await test('4b. the button is styled as a primary (visually prominent) action, not a plain/easily-overlooked secondary control -- a real discoverability audit found the control, while present and functional, was easy to miss since it looked identical to neighboring neutral fields', () => {
  const button = indexHtml.match(/<button[^>]*id="centerTextOnObject"[^>]*>/);
  assert.ok(button, 'expected to find the #centerTextOnObject button tag');
  assert.match(button[0], /class="[^"]*\bprimary\b[^"]*"/, 'expected the button to carry the .primary style so it reads as an action, not a plain field');
});

await test('5. app.js defines centerSelectedTextOnObject() and wires it to #centerTextOnObject', () => {
  assert.match(appJs, /function centerSelectedTextOnObject\(\)\{/);
  assert.match(appJs, /el\('centerTextOnObject'\)\.onclick=\(\)=>centerSelectedTextOnObject\(\);/);
});

await test('6. centerSelectedTextOnObject() only ever writes l.x/l.y — no font/size/rotation/curve/spacing/fill/stone-size property is assigned', () => {
  const fn = appJs.match(/function centerSelectedTextOnObject\(\)\{([\s\S]*?)\n\}/)[1];
  assert.match(fn, /l\.x=targetX;l\.y=targetY;/, 'expected the only layer mutation to be x/y');
  const forbiddenAssignments = [
    'l.font=', 'l.text=', 'l.height=', 'l.stoneSize=', 'l.gap=', 'l.color=', 'l.textMode=',
    'l.autoFit=', 'l.curveEnabled=', 'l.curveRadiusMm=', 'l.curveDirection=', 'l.curveStartAngleDeg=',
    'l.curveSweepAngleDeg=', 'l.curveAlignment=', 'l.rotation=', 'l.fillMode='
  ];
  for (const assignment of forbiddenAssignments) {
    assert.doesNotMatch(fn, new RegExp(assignment.replace('.', '\\.')), `centerSelectedTextOnObject() must not touch ${assignment}`);
  }
});

await test('7. centerSelectedTextOnObject() guards non-text layers, opens one undo step, and re-syncs the UI/history exactly like the existing runAlign/runDistribute/nudgeSelection actions', () => {
  const fn = appJs.match(/function centerSelectedTextOnObject\(\)\{([\s\S]*?)\n\}/)[1];
  assert.match(fn, /if\(!l\|\|l\.type!=='text'\)return;/, 'expected an early return for a non-text or missing selection');
  assert.match(fn, /commitHistory\(\);/);
  assert.ok(fn.indexOf("if(!l||l.type!=='text')return;") < fn.indexOf('commitHistory();'), 'the guard must precede the mutation');
  assert.match(fn, /syncSelectedControlsFromLayer\(\);updateAll\(true\);/, 'expected the same UI-resync pattern runAlign/runDistribute use');
  assert.match(fn, /el\('status'\)\.textContent=/, 'expected a status confirmation, matching every other mutating action');
});

await test('8. centering targets the printable (safe) area\'s center, not just the raw canvas center — computed via the existing getSafeAreaRectMm(), no new geometry/area logic', () => {
  const fn = appJs.match(/function centerSelectedTextOnObject\(\)\{([\s\S]*?)\n\}/)[1];
  assert.match(fn, /getSafeAreaRectMm\(currentObjectTemplate\(\),project\.canvas\.width,project\.canvas\.height\)/);
  assert.match(fn, /safe\.xMm\+safe\.widthMm\/2-project\.canvas\.width\/2/);
  assert.match(fn, /safe\.yMm\+safe\.heightMm\/2-project\.canvas\.height\/2/);
});

await test('10. the Text lightbox\'s Position section has an "outside the printable area" warning with the exact required wording, sitting between the X/Y fields and the Center on Object button', () => {
  const positionSection = indexHtml.match(/<h3>Position<\/h3>[\s\S]*?<\/div>\s*<p class="hint">/)[0];
  assert.match(positionSection, /id="textOutsidePrintableWarning"/);
  assert.match(positionSection, /This text is outside the printable area\./, 'expected the exact required warning text');
  assert.ok(
    positionSection.indexOf('id="textY"') < positionSection.indexOf('id="textOutsidePrintableWarning"') &&
    positionSection.indexOf('id="textOutsidePrintableWarning"') < positionSection.indexOf('id="centerTextOnObject"'),
    'expected the warning between the X/Y fields and the Center on Object button'
  );
});

await test('11. the warning reuses the existing .validation-message alert styling (hidden by default, shown via .visible) already used elsewhere in this same lightbox — no new CSS', () => {
  const warningTag = indexHtml.match(/<p[^>]*id="textOutsidePrintableWarning"[^>]*>/)[0];
  assert.match(warningTag, /class="validation-message"/);
  assert.match(indexHtml, /\.validation-message\{[^}]*display:none/, 'expected the shared hidden-by-default rule to still exist');
  assert.match(indexHtml, /\.validation-message\.visible\{display:block\}/, 'expected the shared reveal rule to still exist');
});

await test('12. isTextOutsidePrintableArea()/updateTextOutsidePrintableWarning() are pure read+DOM-toggle (no layer/property mutation) and reuse existing geometry (getLayerBBox/getSafeAreaRectMm) — no new geometry, and moving text outside the area is never prevented', () => {
  const fn = appJs.match(/function isTextOutsidePrintableArea\(l\)\{([\s\S]*?)\n\}/)[1];
  assert.match(fn, /getLayerBBox\(l\)/);
  assert.match(fn, /getSafeAreaRectMm\(currentObjectTemplate\(\),project\.canvas\.width,project\.canvas\.height\)/);
  assert.doesNotMatch(fn, /[a-zA-Z0-9_.]+\.[a-zA-Z]+\s*=[^=]/, 'expected a pure read-only computation, no assignment of any kind');
  const updateFn = appJs.match(/function updateTextOutsidePrintableWarning\(\)\{([\s\S]*?)\n\}/)[1];
  // S-107 follow-up: the positional warning is still driven by this exact isTextOutsidePrintableArea()
  // result (one shared computation, reused by both warning surfaces) -- now additionally gated by
  // `!tooLong` so the structural "too long to fit no matter where it sits" warning (S-107) always
  // takes priority instead of the two ever showing (or disagreeing) at once.
  assert.match(updateFn, /const outside=!tooLong&&isTextOutsidePrintableArea\(l\);/, 'expected one shared computation reused by both warning surfaces');
  assert.match(updateFn, /el\('textOutsidePrintableWarning'\)\.classList\.toggle\('visible',outside\);/);
  assert.match(updateFn, /el\('workspaceTextOutsideWarning'\)\.classList\.toggle\('visible',outside\);/);
});

await test('12b. the warning uses a partial-overlap-area ratio against the printable safe area (not a full-disjoint/boundary-touch test) — a real mouse-drag audit found a full-disjoint test never fires for text wider than the safe area (the default project\'s own auto-fit text is 199.4mm vs. a 182mm-wide safe area) until literally 100% of it has left, well after a real user can no longer read it', () => {
  const match = appJs.match(/const TEXT_PRINTABLE_VISIBILITY_RATIO=([0-9.]+);/);
  assert.ok(match, 'expected a named TEXT_PRINTABLE_VISIBILITY_RATIO constant');
  const ratio = Number(match[1]);
  assert.ok(ratio > 0 && ratio < 1, `expected the visibility ratio to be a real fraction, got ${ratio}`);
  const fn = appJs.match(/function isTextOutsidePrintableArea\(l\)\{([\s\S]*?)\n\}/)[1];
  assert.match(fn, /overlapWidth\s*\*\s*overlapHeight\s*\)\s*\/\s*bboxArea/, 'expected an overlap-area / bbox-area ratio, not a boundary-only test');
  assert.match(fn, /visibleRatio\s*<\s*TEXT_PRINTABLE_VISIBILITY_RATIO/);
});

await test('13. the warning is recomputed on every updateAll() call — live during drag (pointermove already calls updateAll() every move), after Undo/Redo, and on every keystroke in #textX/#textY, exactly like every other post-mutation UI refresh (renderLayerUI/drawLayout/updateStats)', () => {
  const updateAllFn = appJs.match(/async function updateAll\([\s\S]*?\n\}/)[0];
  assert.match(updateAllFn, /layout=generated;renderLayerUI\(\);drawLayout\(\);drawCup\(\);updateStats\(\);updateHistoryUI\(\);updateEditingUI\(\);updateViewButtons\(\);updateTextOutsidePrintableWarning\(\);/);
});

await test('15. the persistent right Inspector panel (never covered by a modal, always visible while dragging on the canvas) has its own "outside the printable area" warning with a "Center Text" action — not inside the Text Lightbox', () => {
  const inspector = indexHtml.match(/<aside class="right-inspector" id="rightInspector"[\s\S]*?<\/aside>/)[0];
  assert.match(inspector, /id="workspaceTextOutsideWarning"/);
  assert.match(inspector, /This text is outside the printable area\./);
  assert.match(inspector, /id="workspaceCenterTextBtn"/);
  assert.match(inspector, /Center Text</);
  assert.ok(
    inspector.indexOf('id="workspaceTextOutsideWarning"') < inspector.indexOf('id="workspaceCenterTextBtn"') &&
    inspector.indexOf('id="workspaceCenterTextBtn"') < inspector.indexOf('id="inspectorPositionSlot"'),
    'expected the warning+button ahead of the rest of the inspector, immediately under the layer name'
  );
});

await test('16. the workspace "Center Text" button reuses the exact same centerSelectedTextOnObject() the Text Lightbox\'s Center on Object uses — no duplicated recovery logic, so it is guaranteed to only ever touch x/y', () => {
  assert.match(appJs, /el\('workspaceCenterTextBtn'\)\.onclick=\(\)=>centerSelectedTextOnObject\(\);/);
});

await test('17. the workspace warning reuses the existing .validation-message alert styling and is toggled from the exact same isTextOutsidePrintableArea() result as the Text Lightbox\'s copy (see check 12) — both surfaces can never disagree', () => {
  const warningTag = indexHtml.match(/<div class="validation-message" id="workspaceTextOutsideWarning"[^>]*>/);
  assert.ok(warningTag, 'expected #workspaceTextOutsideWarning to carry class="validation-message"');
});

await test('18. no forbidden file changed (GeometryEngine, StoneLayout, exporters, every renderer, Design Library, Gallery, and every other prior milestone\'s forbidden list) — S-104 is app.js/index.html/tools/docs only', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  const forbiddenPrefixes = [
    'src/geometry/', 'src/renderer/', 'src/export/', 'src/text/', 'src/fonts/', 'src/browser/',
    'src/svg/', 'src/image/', 'src/history/', 'src/products/', 'src/preview3d/', 'src/library/',
    'src/gallery/', 'examples/', 'assets/'
  ];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('S-104 Text Position Recovery & Drag Tuning tests passed.');
