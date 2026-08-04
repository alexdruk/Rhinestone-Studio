// MONO-006A: Authored Scale Text Regression Fix.
//
// A visual QA pass on feature/mono-006-ui found that editing an ordinary text layer (e.g. one born
// from Monogram generation, then edited like any other text layer through the standard Text
// controls) could permanently blank the whole canvas: GeometryEngine.generateTextLayout() throws
// when a persisted authoredScale (MONO-005A) is no longer legal for the layer's current
// text/font/stoneSize/gap, and app.js's own inline GeometryEngine.generate() (this file, not the
// permanent one) has no per-layer try/catch -- one bad text layer aborts stone generation for the
// entire project.
//
// Root cause traced empirically (not guessed): writeSelectedControlsToLayer() never invalidated a
// layer's stored authoredScale when text/font/stoneSize/gap were edited, so a monogram-generated
// letter's fitted scale (computed for its original stoneSizeMm) silently kept being reapplied after
// e.g. the stone size was changed to a larger production size -- becoming illegal under
// scaleAuthoredTextLayout()'s minimum-legal-scale check and throwing. Reproduced with the real
// engine: generate a monogram letter (authoredScale ~2.09 fitted for 2.8mm stones), bump stoneSize
// to 6.4mm without clearing authoredScale -> "authoredScale 2.08778876899254 is invalid ... below
// the minimum legal scale 2.161290322580649 ... 6.7mm of center-to-center clearance" -- the exact
// shape of error reported against production data (there: authoredScale 1.451041666666667 / minimum
// 2.161290322580649 / 6.7mm, a different frame/letter fit hitting the identical mechanism).
//
// The fix is `invalidateAuthoredScaleForGeometryChange(layer, changedField)` (app.js, next to
// resolveAuthoredScale()), called from writeSelectedControlsToLayer() at each of the four fields
// that can make a persisted fit stale (text/font/stoneSize/gap) -- never for color/position, which
// don't change what was fitted. Ordinary Add Text layers and defaultProject()'s own seed layer
// already never wrote authoredScale (confirmed by audit, not changed here); only MonogramGenerator
// (MONO-005A) does.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine, listFrames } from '../src/geometry/index.js';
import { MonogramGenerator } from '../src/monogram/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
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

// ---------- Part A: pure-logic tests for invalidateAuthoredScaleForGeometryChange() ----------
// Extracted verbatim from app.js and executed (not just pattern-matched), matching the repo's own
// TXT-103 precedent (tools/test-txt-103-text-sizing-consistency.mjs) for testing app.js internals
// without a full DOM harness.

function extractLine(startMarker, label) {
  const start = appJs.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const end = appJs.indexOf('\n', start);
  assert.ok(end !== -1, `expected a line ending after "${startMarker}" (${label})`);
  return appJs.slice(start, end);
}

const invalidatingFieldsSrc = extractLine(
  "const AUTHORED_SCALE_INVALIDATING_FIELDS=",
  'AUTHORED_SCALE_INVALIDATING_FIELDS'
);
const invalidateFnSrc = (() => {
  const start = appJs.indexOf('function invalidateAuthoredScaleForGeometryChange(layer,changedField){');
  assert.ok(start !== -1, 'expected to find invalidateAuthoredScaleForGeometryChange()');
  const end = appJs.indexOf('\n}', start);
  assert.ok(end !== -1, 'expected a closing brace for invalidateAuthoredScaleForGeometryChange()');
  return appJs.slice(start, end + 2);
})();

const makeInvalidate = new Function(`
  ${invalidatingFieldsSrc}
  ${invalidateFnSrc}
  return invalidateAuthoredScaleForGeometryChange;
`)();

await test('1. invalidateAuthoredScaleForGeometryChange() deletes authoredScale for text/font/stoneSize/gap', () => {
  for (const field of ['text', 'font', 'stoneSize', 'gap']) {
    const layer = { authoredScale: 1.451041666666667 };
    makeInvalidate(layer, field);
    assert.equal(layer.authoredScale, undefined, `expected authoredScale removed for field "${field}"`);
    assert.equal('authoredScale' in layer, false, `expected the key itself gone for field "${field}", not just undefined`);
  }
});

await test('2. invalidateAuthoredScaleForGeometryChange() preserves authoredScale for color/position/any other field', () => {
  for (const field of ['color', 'x', 'y', 'align', 'lineSpacing', 'rotationDeg', 'height', 'autoFit']) {
    const layer = { authoredScale: 2.5 };
    makeInvalidate(layer, field);
    assert.equal(layer.authoredScale, 2.5, `expected authoredScale preserved for field "${field}"`);
  }
});

await test('3. invalidateAuthoredScaleForGeometryChange() is a safe no-op when authoredScale is already absent', () => {
  const layer = { text: 'hi' };
  makeInvalidate(layer, 'text');
  assert.equal('authoredScale' in layer, false, 'must not introduce authoredScale:1 or any value on an ordinary layer');
});

// ---------- Part B: writeSelectedControlsToLayer() wiring -- each write site executed in isolation ----------
// The full function has many unrelated dependencies (plate/vessel fields, mixed-size checkboxes,
// etc.) -- rather than build a heavyweight fake-DOM harness for the whole function (the file's own
// MONO-006 Part A precedent does this only where the interactions under test truly need it), each
// relevant write-back line is extracted verbatim and executed against a minimal fake `el()`/layer,
// proving the actual shipped wiring (not a re-description of it) triggers correctly.

function extractStatement(containing, label) {
  const idx = appJs.indexOf(containing);
  assert.ok(idx !== -1, `expected to find "${containing}" (${label}) in app.js`);
  return containing;
}

const textLineSrc = extractStatement(
  "const nextText=el('text').value;if(nextText!==l.text)invalidateAuthoredScaleForGeometryChange(l,'text');l.text=nextText;",
  'text write-back'
);
const fontLineSrc = extractStatement(
  "const nextFont=el('font').value||l.font;if(nextFont!==l.font)invalidateAuthoredScaleForGeometryChange(l,'font');l.font=nextFont;",
  'font write-back'
);
const stoneSizeLineSrc = extractStatement(
  "const nextStoneSize=parseFloat(el('stoneSize').value)||2;if(nextStoneSize!==l.stoneSize)invalidateAuthoredScaleForGeometryChange(l,'stoneSize');l.stoneSize=nextStoneSize;",
  'stoneSize write-back'
);
const gapLineSrc = extractStatement(
  "const nextGap=parseFloat(el('gap').value)||.3;if(nextGap!==l.gap)invalidateAuthoredScaleForGeometryChange(l,'gap');l.gap=nextGap;",
  'gap write-back'
);

function runWriteBackLine(lineSrc, el, l) {
  const run = new Function('el', 'l', 'invalidateAuthoredScaleForGeometryChange', `${lineSrc}\n return l;`);
  return run(el, l, makeInvalidate);
}

await test('4. writeSelectedControlsToLayer() invalidates authoredScale when #text differs from the stored text', () => {
  const l = { text: 'Old', authoredScale: 1.451041666666667 };
  runWriteBackLine(textLineSrc, () => ({ value: 'New' }), l);
  assert.equal(l.text, 'New');
  assert.equal('authoredScale' in l, false);
});

await test('5. writeSelectedControlsToLayer() preserves authoredScale when #text is re-written unchanged', () => {
  const l = { text: 'Same', authoredScale: 1.451041666666667 };
  runWriteBackLine(textLineSrc, () => ({ value: 'Same' }), l);
  assert.equal(l.authoredScale, 1.451041666666667);
});

await test('6. writeSelectedControlsToLayer() invalidates authoredScale when #font differs from the stored font', () => {
  const l = { font: 'rs-block', authoredScale: 1.451041666666667 };
  runWriteBackLine(fontLineSrc, () => ({ value: 'rs-modern' }), l);
  assert.equal(l.font, 'rs-modern');
  assert.equal('authoredScale' in l, false);
});

await test('7. writeSelectedControlsToLayer() preserves authoredScale when #font is re-written unchanged', () => {
  const l = { font: 'rs-block', authoredScale: 1.451041666666667 };
  runWriteBackLine(fontLineSrc, () => ({ value: 'rs-block' }), l);
  assert.equal(l.authoredScale, 1.451041666666667);
});

await test('8. writeSelectedControlsToLayer() invalidates authoredScale when #stoneSize differs (the exact production regression)', () => {
  const l = { stoneSize: 2.8, authoredScale: 2.08778876899254 };
  runWriteBackLine(stoneSizeLineSrc, () => ({ value: '6.4' }), l);
  assert.equal(l.stoneSize, 6.4);
  assert.equal('authoredScale' in l, false);
});

await test('9. writeSelectedControlsToLayer() preserves authoredScale when #stoneSize is re-written unchanged', () => {
  const l = { stoneSize: 2.8, authoredScale: 2.08778876899254 };
  runWriteBackLine(stoneSizeLineSrc, () => ({ value: '2.8' }), l);
  assert.equal(l.authoredScale, 2.08778876899254);
});

await test('10. writeSelectedControlsToLayer() invalidates authoredScale when #gap differs from the stored gap', () => {
  const l = { gap: 0.3, authoredScale: 2.08778876899254 };
  runWriteBackLine(gapLineSrc, () => ({ value: '0.5' }), l);
  assert.equal(l.gap, 0.5);
  assert.equal('authoredScale' in l, false);
});

await test('11. writeSelectedControlsToLayer() preserves authoredScale when #gap is re-written unchanged', () => {
  const l = { gap: 0.3, authoredScale: 2.08778876899254 };
  runWriteBackLine(gapLineSrc, () => ({ value: '0.3' }), l);
  assert.equal(l.authoredScale, 2.08778876899254);
});

await test('12. writeSelectedControlsToLayer() never calls invalidateAuthoredScaleForGeometryChange for color, or text x/y position', () => {
  assert.match(appJs, /l\.color=el\('stoneColor'\)\.value;/, 'expected the plain, unconditional color write-back to remain unconditional');
  assert.match(
    appJs,
    /l\.x=parseFloat\(el\('textX'\)\.value\)\|\|0;l\.y=parseFloat\(el\('textY'\)\.value\)\|\|0;/,
    'expected the plain, unconditional text x/y write-back to remain unconditional'
  );
});

// ---------- Part C: new ordinary text layers never carry authoredScale ----------

await test('13. defaultProject()\'s seed text layer has no authoredScale field', () => {
  const match = appJs.match(/function defaultProject\(\)\{[\s\S]*?layers:\[\{[^}]*\}\]\}\}/);
  assert.ok(match, 'expected to find defaultProject()\'s single-layer literal');
  assert.doesNotMatch(match[0], /authoredScale/);
});

await test('14. Add Text\'s new-layer literal has no authoredScale field', () => {
  const match = appJs.match(/const layer=\{id:'text'\+Date\.now\(\),type:'text',[^}]*\};/);
  assert.ok(match, 'expected to find the Add Text new-layer literal');
  assert.doesNotMatch(match[0], /authoredScale/);
});

// ---------- Part D: updateAll() clears a stale "Text generation failed" status on success ----------

await test('15. updateAll() resets the status line back to Ready once generation succeeds after a prior failure', () => {
  assert.match(
    appJs,
    /if\(el\('status'\)\.textContent\.startsWith\('Text generation failed'\)\)el\('status'\)\.textContent='Ready';/,
    'expected updateAll()\'s success path to clear a stale generation-failure status message'
  );
});

// ---------- Part E: real-engine end-to-end proof (no DOM, the exact GeometryEngine call app.js makes) ----------

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);
async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
function createEngine() {
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
  return new GeometryEngine({ fontProviderRegistry });
}

// The large production stone size from the reported failure's own clearance math (6.7mm required =
// 6.4mm stone + the repo's 0.3mm authored-font fitting gap).
const LARGE_PRODUCTION_STONE_MM = 6.4;

for (const fontId of ['rs-modern', 'rs-block']) {
  await test(`16. ordinary ${fontId} text renders at ${LARGE_PRODUCTION_STONE_MM}mm stones with authoredScale absent (resolveAuthoredScale()'s own default of 1, never validated)`, async () => {
    const engine = createEngine();
    const result = await engine.generateTextLayout({
      text: 'HELLO',
      fontId,
      providerId: 'rhinestone',
      layerId: 'layer-ordinary',
      heightMm: 25,
      stoneSizeMm: LARGE_PRODUCTION_STONE_MM,
      gapMm: 0.3,
      mode: 'outline',
      color: 'crystal',
      authoredScale: 1 // exactly what app.js's resolveAuthoredScale(layer) returns for an absent field
    });
    assert.ok(result.stones.length > 0, 'expected stones to render, not a blank layout');
  });
}

await test('17. the same large stone size correctly still rejects a genuinely illegal EXPLICIT authoredScale (this fix does not weaken real validation)', async () => {
  const engine = createEngine();
  await assert.rejects(
    () => engine.generateTextLayout({
      text: 'HELLO',
      fontId: 'rs-modern',
      providerId: 'rhinestone',
      layerId: 'layer-illegal',
      heightMm: 25,
      stoneSizeMm: LARGE_PRODUCTION_STONE_MM,
      gapMm: 0.3,
      mode: 'outline',
      color: 'crystal',
      authoredScale: 0.5 // explicitly requested, not absent -- must still be validated
    }),
    /below-minimum-scale/
  );
});

await test('18. the full production regression: a monogram letter\'s fitted authoredScale becomes illegal after a stoneSize edit, and throws until invalidated -- then regenerates normally', async () => {
  const engine = createEngine();
  const generator = new MonogramGenerator({ geometryEngine: engine });
  const frame = listFrames().find((f) => f.id === 'square');
  assert.ok(frame, 'expected the square frame to exist');
  const genResult = await generator.generate({
    frameId: 'square',
    layoutId: 'single',
    letters: ['W'],
    fontId: 'rs-modern',
    providerId: 'rhinestone',
    // MONO-006C: the original stone size here is deliberately SS6 (2.0mm), not the previous 2.8mm --
    // at 2.8mm rs-modern's own minimum legal scale happens to land at exactly 1.0 (2.8mm + the
    // 0.3mm authored-font gap == this font's own natural pitch, by construction), and authoredScale
    // === 1 is GeometryEngine's documented "no explicit fit requested" default (test 16 above),
    // therefore never validated at all regardless of stoneSize -- reapplying it here would not
    // reproduce the regression this test exists to cover.
    //
    // MONO-006E: MonogramGenerator now fits every letter to *fill* its own slot (see that module's
    // own doc comment), not to its minimum legal scale -- so the fitted authoredScale below depends
    // on frameRect too, not only on font/stoneSize. A modest 45x45mm frame (rather than the previous
    // 60x60mm) keeps the fitted scale comfortably between 1.0 (the unvalidated default, must not
    // land here) and ~2.16 (rs-modern's own minimum legal scale once stoneSize is later bumped to
    // LARGE_PRODUCTION_STONE_MM below) -- large enough to still be a genuine, validated explicit
    // value, small enough that the later stoneSize edit still makes it illegal, reproducing the
    // real regression end to end.
    stoneSizeMm: 2.0,
    gapMm: 0.3,
    color: 'crystal',
    frameRect: { xMm: 0, yMm: 0, widthMm: 45, heightMm: 45 },
    canvasMm: { widthMm: 200, heightMm: 200 }
  });
  assert.ok(genResult.ok, `expected the monogram to generate: ${genResult.reason} ${genResult.message}`);
  const letterLayer = genResult.layers.find((l) => l.type === 'text');
  assert.equal(typeof letterLayer.authoredScale, 'number', 'expected MonogramGenerator to persist an explicit authoredScale');
  assert.notEqual(letterLayer.authoredScale, 1, 'fixture must not land on the unvalidated authoredScale===1 default (see comment above)');

  // Before the fix: editing stoneSize without invalidating authoredScale reproduces the reported
  // regression exactly (below-minimum-scale, same mechanism as the real bug).
  const staleEditedLayer = { ...letterLayer, stoneSize: LARGE_PRODUCTION_STONE_MM };
  await assert.rejects(
    () => engine.generateTextLayout({
      text: staleEditedLayer.text,
      fontId: staleEditedLayer.font,
      providerId: 'rhinestone',
      layerId: staleEditedLayer.id,
      heightMm: staleEditedLayer.height,
      stoneSizeMm: staleEditedLayer.stoneSize,
      gapMm: staleEditedLayer.gap,
      mode: 'outline',
      color: staleEditedLayer.color,
      authoredScale: staleEditedLayer.authoredScale
    }),
    /below-minimum-scale/,
    'expected the stale, now-illegal authoredScale to reproduce the reported regression'
  );

  // After the fix: writeSelectedControlsToLayer()'s stoneSize write-back calls
  // invalidateAuthoredScaleForGeometryChange(), so this same edit removes authoredScale first.
  // Starts from the layer's original (pre-edit) stoneSize so the write-back line itself detects the
  // change -- unlike staleEditedLayer above, which pre-applies the new value to simulate the bug.
  const fixedEditedLayer = { ...letterLayer };
  runWriteBackLine(stoneSizeLineSrc, () => ({ value: String(LARGE_PRODUCTION_STONE_MM) }), fixedEditedLayer);
  assert.equal('authoredScale' in fixedEditedLayer, false);
  const result = await engine.generateTextLayout({
    text: fixedEditedLayer.text,
    fontId: fixedEditedLayer.font,
    providerId: 'rhinestone',
    layerId: fixedEditedLayer.id,
    heightMm: fixedEditedLayer.height,
    stoneSizeMm: fixedEditedLayer.stoneSize,
    gapMm: fixedEditedLayer.gap,
    mode: 'outline',
    color: fixedEditedLayer.color,
    authoredScale: fixedEditedLayer.authoredScale ?? 1 // resolveAuthoredScale()'s own fallback
  });
  assert.ok(result.stones.length > 0, 'expected the edited letter to regenerate normally, not blank the canvas');
});

await test('19. explicit valid authoredScale still reproduces the fitted monogram layout unchanged (no regression to MONO-005A)', async () => {
  const engine = createEngine();
  const generator = new MonogramGenerator({ geometryEngine: engine });
  const genResult = await generator.generate({
    frameId: 'square',
    layoutId: 'single',
    letters: ['W'],
    fontId: 'rs-modern',
    providerId: 'rhinestone',
    stoneSizeMm: 2.8,
    gapMm: 0.3,
    color: 'crystal',
    frameRect: { xMm: 0, yMm: 0, widthMm: 60, heightMm: 60 },
    canvasMm: { widthMm: 200, heightMm: 200 }
  });
  assert.ok(genResult.ok);
  const letterLayer = genResult.layers.find((l) => l.type === 'text');
  const result = await engine.generateTextLayout({
    text: letterLayer.text,
    fontId: letterLayer.font,
    providerId: 'rhinestone',
    layerId: letterLayer.id,
    heightMm: letterLayer.height,
    stoneSizeMm: letterLayer.stoneSize,
    gapMm: letterLayer.gap,
    mode: 'outline',
    color: letterLayer.color,
    authoredScale: letterLayer.authoredScale
  });
  assert.ok(result.stones.length > 0);
});

console.log('MONO-006A Authored Scale Text Regression tests complete.');
