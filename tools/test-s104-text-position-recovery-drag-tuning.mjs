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
  assert.match(body, />Center on Object</);
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

await test('9. no forbidden file changed (GeometryEngine, StoneLayout, exporters, every renderer, Design Library, Gallery, and every other prior milestone\'s forbidden list) — S-104 is app.js/index.html/tools/docs only', () => {
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
