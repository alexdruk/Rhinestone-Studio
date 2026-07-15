import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// UI-001 (Complete Application Redesign) — verifies every Lightbox exposes the parameters the
// milestone brief requires for its domain (the "feature-to-UI inventory" proof for the parts that
// are checkable statically), the reusable Lightbox shell contract (title/close/Cancel/Apply where
// applicable), and that Shapes distinguishes design shapes from object templates. Structural checks
// against the live index.html/app.js source, matching this repository's established convention.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

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

function extractElementHtml(html, id) {
  const openTagMatch = html.match(new RegExp(`<([a-zA-Z]+)[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(openTagMatch, `expected to find an element with id="${id}"`);
  const tag = openTagMatch[1];
  const start = openTagMatch.index + openTagMatch[0].length;
  const openRe = new RegExp(`<${tag}\\b`, 'g');
  const closeRe = new RegExp(`</${tag}>`, 'g');
  let depth = 1;
  let cursor = start;
  while (depth > 0) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    assert.ok(nextClose, `unbalanced <${tag}> for id="${id}"`);
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      cursor = nextClose.index + nextClose[0].length;
      if (depth === 0) return html.slice(start, nextClose.index);
    }
  }
  throw new Error(`unreachable: failed to extract #${id}`);
}

const ALL_LIGHTBOXES = ['lightboxText', 'lightboxShapes', 'lightboxImport', 'lightboxImageTrace', 'lightboxExport', 'lightboxProdSheet', 'lightboxShipping', 'lightboxSettings', 'lightboxHelp'];

await test('1. every Lightbox has a title, a close button, Escape-closeable dialog role, and (except Help/Export/ProdSheet/Shipping/Settings-only-Close cases) a documented footer', () => {
  for (const id of ALL_LIGHTBOXES) {
    const body = extractElementHtml(indexHtml, id);
    assert.match(body, /<header class="lightbox-header">/, `expected ${id} to have a header`);
    // S-105: all 11 named Lightboxes are non-modal (aria-modal="false") so canvas/Layers-list/
    // Inspector interaction keeps working while any of them stays open -- generalizing the S-101
    // Shapes-only precedent. See tools/test-s101-ux-workflow-polish.mjs and
    // tools/test-ui001-dialog-behavior.mjs test 13 for the dedicated non-modal assertions.
    assert.match(body, /role="dialog" aria-modal="false"/, `expected ${id}'s dialog to declare aria-modal="false"`);
    assert.match(body, /<button class="lightbox-close" data-lightbox-close aria-label="Close">/, `expected ${id} to have a close button`);
    assert.match(body, /<footer class="lightbox-footer">/, `expected ${id} to have a footer`);
  }
});

await test('2. every Lightbox overlay is controlled by a real src/ui Lightbox instance', () => {
  for (const id of ALL_LIGHTBOXES) {
    assert.match(appJs, new RegExp(`new Lightbox\\('${id}'`), `expected app.js to construct a Lightbox for #${id}`);
  }
});

await test('3. Text Lightbox exposes every documented text/curve parameter', () => {
  const body = extractElementHtml(indexHtml, 'lightboxText');
  for (const id of ['text', 'font', 'textMode', 'height', 'autoFit', 'textX', 'textY', 'curveEnabled', 'curveRadiusMm', 'curveDirection', 'curveStartAngleDeg', 'curveSweepAngleDeg', 'curveAlignment']) {
    assert.ok(body.includes(`id="${id}"`), `expected the Text Lightbox to contain #${id}`);
  }
  assert.ok(body.includes('id="textStoneSlot"'), 'expected a stone-fields slot inside the Text Lightbox');
});

await test('4. Shapes Lightbox has two clearly separated sections: Design Shapes (circle, rectangle) and Object Templates (mug, tumbler, bottle)', () => {
  const body = extractElementHtml(indexHtml, 'lightboxShapes');
  assert.match(body, /<button class="active" id="shapesTabDesign"/, 'expected a Design Shapes tab');
  assert.match(body, /<button id="shapesTabTemplates"/, 'expected an Object Templates tab');
  const designBody = extractElementHtml(indexHtml, 'shapesPanelDesign');
  // S-110: #addCircleLightbox/#addRectLightbox (dead proxy buttons that only forwarded clicks to
  // the left panel's now-removed #addCircle/#addRect) were replaced by #shapeGrid, the one real
  // creation control for all 11 Design Shapes, including Circle/Rectangle.
  assert.ok(designBody.includes('id="shapeGrid"'), 'expected the unified Design Shapes creation grid');
  assert.ok(designBody.includes('data-shape-kind="circle"'), 'expected a circle add control in Design Shapes');
  assert.ok(designBody.includes('data-shape-kind="rectangle"'), 'expected a rectangle add control in Design Shapes');
  assert.ok(designBody.includes('id="shapesPositionSlot"'), 'expected a position-fields slot in Design Shapes');
  assert.ok(designBody.includes('id="shapesStoneSlot"'), 'expected a stone-fields slot in Design Shapes');
  const templatesBody = extractElementHtml(indexHtml, 'shapesPanelTemplates');
  assert.ok(templatesBody.includes('id="objectType"'), 'expected #objectType in Object Templates');
  for (const value of ['mug', 'tumbler', 'bottle']) {
    assert.ok(templatesBody.includes(`value="${value}"`), `expected Object Templates to offer ${value}`);
  }
  // S-107 follow-up: wrap mode moved out of this tab into the Object Preview toolbar (#toolbar3D)
  // for discoverability -- it only affects the Object Preview/Front View Frame, not a design shape
  // or object template choice, and a user reported being unable to find it here. See check in
  // tools/test-s107-long-text-readability.mjs for its new location.
  assert.ok(!templatesBody.includes('id="wrap"'), 'expected wrap mode to no longer live in Object Templates (moved to the Object Preview toolbar)');
});

await test('5. Import Lightbox has two clearly separated tabs: SVG Import and Project Import, and Project Import explains it is not SVG import', () => {
  const body = extractElementHtml(indexHtml, 'lightboxImport');
  assert.match(body, /<button class="active" id="importTabSvg"/, 'expected an SVG Import tab');
  assert.match(body, /<button id="importTabProject"/, 'expected a Project Import tab');
  const svgBody = extractElementHtml(indexHtml, 'importPanelSvg');
  for (const id of ['importSvg', 'importSvgFile', 'svgMode']) {
    assert.ok(svgBody.includes(`id="${id}"`), `expected SVG Import to contain #${id}`);
  }
  assert.ok(svgBody.includes('id="importPositionSlot"') && svgBody.includes('id="importStoneSlot"'), 'expected position/stone slots in SVG Import');
  const projectBody = extractElementHtml(indexHtml, 'importPanelProject');
  for (const id of ['importProject', 'importProjectFile', 'importProjectValidation']) {
    assert.ok(projectBody.includes(`id="${id}"`), `expected Project Import to contain #${id}`);
  }
  assert.ok(/not the same as SVG Import/.test(projectBody), 'expected Project Import to explicitly distinguish itself from SVG Import');
});

await test('6. Image Trace Lightbox exposes every documented trace parameter plus Cancel/Commit', () => {
  const body = extractElementHtml(indexHtml, 'lightboxImageTrace');
  for (const id of ['importImage', 'importImageFile', 'imgPreviewThreshold', 'imgPreviewInvert', 'imgPreviewBlur', 'imgPreviewMaxWidth', 'imgPreviewMaxHeight', 'imageImportPreviewCanvas', 'imageImportStoneCount', 'imageImportCancel', 'imageImportCommit']) {
    assert.ok(body.includes(`id="${id}"`), `expected the Image Trace Lightbox to contain #${id}`);
  }
  for (const id of ['imgThreshold', 'imgInvert', 'imgBlurRadius', 'imgMaxWidth', 'imgMaxHeight']) {
    assert.ok(body.includes(`id="${id}"`), `expected post-commit editing field #${id} inside the Image Trace Lightbox`);
  }
  assert.ok(body.includes('id="imageTracePositionSlot"') && body.includes('id="imageTraceStoneSlot"'), 'expected position/stone slots for post-commit editing');
});

await test('7. Export Lightbox exposes all five current export types, grouped and distinguished by data kind', () => {
  const body = extractElementHtml(indexHtml, 'lightboxExport');
  for (const id of ['exportProject', 'exportLayout', 'exportSVG', 'exportPNG', 'exportCup']) {
    assert.ok(body.includes(`id="${id}"`), `expected the Export Lightbox to contain #${id}`);
  }
  assert.ok(/Project data/.test(body) && /Production geometry/.test(body) && /Visual previews/.test(body), 'expected Export to distinguish project data / production geometry / visual previews');
});

await test('8. Production Sheet Lightbox exposes all current options and SVG/PNG/PDF export', () => {
  const body = extractElementHtml(indexHtml, 'lightboxProdSheet');
  for (const id of ['prodSheetPageSize', 'prodSheetMargin', 'prodSheetMirror', 'prodSheetRegMarks', 'exportProdSheetSVG', 'exportProdSheetPNG', 'exportProdSheetPDF']) {
    assert.ok(body.includes(`id="${id}"`), `expected the Production Sheet Lightbox to contain #${id}`);
  }
  for (const value of ['A4', 'Letter']) assert.ok(body.includes(`value="${value}"`));
});

await test('9. Shipping & Handling Lightbox exposes local-only metadata fields and states its session-only scope', () => {
  const body = extractElementHtml(indexHtml, 'lightboxShipping');
  for (const id of ['shipPackageType', 'shipLengthMm', 'shipWidthMm', 'shipHeightMm', 'shipWeightG', 'shipNotes', 'shipFragile']) {
    assert.ok(body.includes(`id="${id}"`), `expected the Shipping Lightbox to contain #${id}`);
  }
  assert.ok(/session/i.test(body), 'expected the Shipping Lightbox to disclose its session-only scope');
  assert.ok(/no carrier, rate, label, or tracking integration/i.test(body), 'expected an explicit disclaimer that no carrier/rate/label/tracking integration exists (not a silent omission)');
  assert.ok(!/\bbuy\b|\bpurchase\b|calculate.*(rate|cost)/i.test(body), 'must not offer any working purchase/calculation action');
});

await test('10. Settings Lightbox exposes existing safe UI preferences only', () => {
  const body = extractElementHtml(indexHtml, 'lightboxSettings');
  for (const id of ['settingsSafeAreaDefault', 'settingsSnapDefault', 'settingsDefaultStoneSize', 'settingsDefaultGap']) {
    assert.ok(body.includes(`id="${id}"`), `expected the Settings Lightbox to contain #${id}`);
  }
  assert.ok(/mm \(fixed\)/.test(body), 'expected units to be shown as fixed, not an invented preference');
  assert.ok(/Light \(fixed\)/.test(body), 'expected theme to be fixed to the approved light theme this milestone');
});

await test('11. Help Lightbox covers getting started, shortcuts, import, export, production sheet, and about', () => {
  const body = extractElementHtml(indexHtml, 'lightboxHelp');
  for (const needle of ['Getting started', 'Keyboard shortcuts', 'Import', 'Export', 'Production Sheet', 'About Rhinestone Studio']) {
    assert.ok(body.includes(needle), `expected the Help Lightbox to cover "${needle}"`);
  }
});

await test('12. Cancel never applies edits: every Lightbox\'s Cancel/Close button only closes the dialog (data-lightbox-close), never an id with its own commit side effect', () => {
  for (const id of ALL_LIGHTBOXES) {
    const body = extractElementHtml(indexHtml, id);
    const cancelButtons = [...body.matchAll(/<button class="btn"[^>]*data-lightbox-close[^>]*>(Cancel|Close)<\/button>/g)];
    assert.ok(cancelButtons.length >= 1, `expected ${id} to have a Cancel/Close button that only closes`);
    for (const btn of cancelButtons) {
      assert.ok(!/id="/.test(btn[0]), `expected ${id}'s Cancel/Close button to have no id (so it cannot be an export/apply action)`);
    }
  }
});

console.log('UI-001 Lightbox content tests passed.');
