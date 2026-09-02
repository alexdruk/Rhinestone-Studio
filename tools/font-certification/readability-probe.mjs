#!/usr/bin/env node
/**
 * READ-004 — recognition harness CLI.
 *
 *   node tools/font-certification/readability-probe.mjs --cases ground-truth --oracle stub
 *   node tools/font-certification/readability-probe.mjs --render plain --channel chrome
 *
 * Runs a list of (font, mode, height, stone size) probes through the deterministic half of the
 * harness (readabilityProbe → recognitionSheets → screenshotPages → recognitionScoring →
 * probeRecordStore) and writes one auditable JSON record per probe.
 *
 * `--oracle stub` is the only mode exercised in READ-004. `--oracle pinned` is wired and reachable
 * but deliberately not run here — see recognitionOracle.mjs: the pinned model's first real call
 * happens under review, not in this milestone.
 *
 * `--render plain` is a ground-truth mode: one PNG per case showing the text "Vitalina" as a person
 * would see the design — no tiles, no labels, no grid. It bypasses signal A entirely (it calls
 * analyzeOne() directly, never runProbe(), and never touches buildRecognitionSheetHtml), so the two
 * cases that fail signal A (cinzel radial, caveat fill) — exactly the images that need looking at —
 * still render.
 *
 * Options:
 *   --cases <name>      case list to run (only `ground-truth` is implemented)
 *   --oracle <mode>     `stub` (default) or `pinned`
 *   --corpus <tier>     `words` (default), `search`, or `full`
 *   --render <mode>     `plain` — ground-truth PNGs instead of recognition sheets
 *   --only <id[,id]>    restrict to these font ids
 *   --force             ignore an existing cached record and re-run
 *   --channel <name>    Playwright browser channel passed through screenshotPages() (e.g. `chrome`
 *                       when the bundled Chromium build is unavailable, as on macOS 13)
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { FontManager } from '../../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../../src/text/index.js';
import { GeometryEngine } from '../../src/geometry/index.js';
import { getPlateDefaults, getPlateDesignTargetGuide } from '../../src/products/index.js';
import { repoPath } from './lib/repoPaths.mjs';
import { runProbe } from './lib/readabilityProbe.mjs';
import { analyzeOne } from './lib/productionAnalysis.mjs';
import { buildRecognitionSheetHtml } from './lib/recognitionSheets.mjs';
import { renderLayoutSvg, RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE } from './lib/specimenPages.mjs';
import { createStubOracle, createPinnedOracle, PINNED_MODEL_ID } from './lib/recognitionOracle.mjs';
import { scoreProbe } from './lib/recognitionScoring.mjs';
import { assembleRecord, computeCacheKey, readRecord, writeRecord, combineSheetPngHashes } from './lib/probeRecordStore.mjs';
import { screenshotPages } from './lib/screenshotPages.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const OUTPUT_DIR = repoPath('tools/font-certification/output/read-004');
const SHEETS_DIR = path.join(OUTPUT_DIR, 'sheets');
const PLAIN_DIR = path.join(OUTPUT_DIR, 'plain');
const PW_PROFILE_DIR = path.join(OUTPUT_DIR, 'pw-profile');

// The text every ground-truth render shows — a personal name with no language prior (READ-000 §3).
export const PLAIN_RENDER_TEXT = 'Vitalina';

// --- ground-truth case list (real manifest ids, verified) ------------------------------------

const STRAIGHT_GROUND_TRUTH_CASES = [
  { fontId: 'anton-regular',          mode: 'fill',    heightMm: 36.52, stoneSizeId: 'ss6' },
  { fontId: 'poppins-regular',        mode: 'outline', heightMm: 42.5,  stoneSizeId: 'ss6' },
  { fontId: 'great-vibes-regular',    mode: 'outline', heightMm: 42.5,  stoneSizeId: 'ss6' },
  { fontId: 'dancing-script-regular', mode: 'outline', heightMm: 34.3,  stoneSizeId: 'ss6' },
  { fontId: 'courier-prime-regular',  mode: 'outline', heightMm: 77.5,  stoneSizeId: 'ss16' },
  { fontId: 'cinzel-regular',         mode: 'radial',  heightMm: 56,    stoneSizeId: 'ss16' },
  { fontId: 'caveat-regular',         mode: 'fill',    heightMm: 55,    stoneSizeId: 'ss16' },
  { fontId: 'lobster-regular',        mode: 'contour', heightMm: 42,    stoneSizeId: 'ss10' },
  { fontId: 'lilita-one-regular',     mode: 'contour', heightMm: 40,    stoneSizeId: 'ss10' },
  { fontId: 'lilita-one-regular',     mode: 'radial',  heightMm: 58,    stoneSizeId: 'ss16' },
  // Not part of the original ground truth. The first row was recorded as anton-regular Grid fill
  // (rated "good") but the harness had it as `mode: 'outline'` through five passes; row 1 is now
  // 'fill' to match the rating. This anton-regular *outline* render was also produced and rated
  // during READ-004 and the rating is worth keeping, so it stays as an extra case.
  { fontId: 'anton-regular',          mode: 'outline', heightMm: 36.52, stoneSizeId: 'ss6' }
];

// Part 7 (revised in the third pass): the single curved row uses a real DESIGN-PLANE product
// geometry — the round dinner plate's rim band. A mug's body radius describes the cylinder a flat
// decal wraps *around*; it is not a radius in the design plane where ArcProjection operates, and
// using it gave a 249° sweep (end letters rotated ±125°). The plate rim band is a flat annulus in
// the design plane, and app.js's own `rimBandCurveRadiusMm()` (app.js:2316) is the only place the
// codebase derives a curve radius from product geometry: the mid-radius of the rim annulus
// (`(outerRadiusMm + innerRadiusMm) / 2`) from `getPlateDesignTargetGuide('rimBand', ...)`.
//
// curveSweepAngleDeg is still derived so "Vitalina" subtends its natural (undistorted) arc:
// ArcProjection stretches the text uniformly onto the sweep with `t = xMm / totalAdvanceWidthMm`,
// so `sweep = width / radius` is exactly the sweep at which arc length equals text width and the
// stretch factor is 1. The measurement and everything derived are recorded in `curve.derivation`.
export const CURVED_CASE_PRODUCT = Object.freeze({
  productId: 'plate-round-dinner',
  productName: 'Round Dinner Plate',
  designTarget: 'rimBand',
  measureText: 'Vitalina',
  measureFontId: 'anton-regular',
  measureHeightMm: 60,
  measureStoneSizeId: 'ss10',
  measureMode: 'contour'
});

export async function deriveCurvedCase(engine) {
  const p = CURVED_CASE_PRODUCT;
  const plate = getPlateDefaults();
  // Same derivation as app.js's rimBandCurveRadiusMm(): mid-radius of the rim annulus.
  const guide = getPlateDesignTargetGuide('rimBand', plate, plate.outerDiameterMm, plate.outerDiameterMm);
  const outerRimRadiusMm = guide.outerRadiusMm;
  const innerRimRadiusMm = guide.innerRadiusMm;
  const curveRadiusMm = (outerRimRadiusMm + innerRimRadiusMm) / 2;

  const m = await analyzeOne(engine, p.measureFontId, p.measureText, p.measureStoneSizeId, p.measureHeightMm, { mode: p.measureMode });
  if (m.error || !m.boundingBoxMm) throw new Error(`deriveCurvedCase: could not measure "${p.measureText}" (${m.error ?? 'no bbox'})`);
  const measuredTextWidthMm = m.boundingBoxMm.widthMm;
  const curveSweepAngleDeg = (measuredTextWidthMm / curveRadiusMm) * (180 / Math.PI);
  const derivation = {
    productId: p.productId,
    productName: p.productName,
    designTarget: p.designTarget,
    outerDiameterMm: plate.outerDiameterMm,
    innerWellDiameterMm: plate.innerWellDiameterMm,
    outerRimRadiusMm,
    innerRimRadiusMm,
    curveRadiusMm,
    measureText: p.measureText,
    measureFontId: p.measureFontId,
    measureHeightMm: p.measureHeightMm,
    measuredTextWidthMm,
    curveSweepAngleDeg
  };
  return {
    fontId: 'anton-regular', mode: 'contour', heightMm: 60, stoneSizeId: 'ss10',
    curve: {
      authored: { curveEnabled: true, curveRadiusMm, curveDirection: 'up', curveAlignment: 'center' },
      curveEnabled: true, curveRadiusMm, curveDirection: 'outside',
      curveStartAngleDeg: 0, curveSweepAngleDeg, curveAlignment: 'center',
      derivation
    }
  };
}

export async function resolveGroundTruthCases(engine) {
  return [...STRAIGHT_GROUND_TRUTH_CASES, await deriveCurvedCase(engine)];
}

function parseArgs(argv) {
  const args = { cases: 'ground-truth', oracle: 'stub', corpus: 'words', render: null, only: null, force: false, channel: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cases') args.cases = argv[++i];
    else if (a === '--oracle') args.oracle = argv[++i];
    else if (a === '--corpus') args.corpus = argv[++i];
    else if (a === '--render') args.render = argv[++i];
    else if (a === '--only') args.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--channel') args.channel = argv[++i];
    else if (a === '--force') args.force = true;
    else if (a.startsWith('--cases=')) args.cases = a.slice(8);
    else if (a.startsWith('--oracle=')) args.oracle = a.slice(9);
    else if (a.startsWith('--corpus=')) args.corpus = a.slice(9);
    else if (a.startsWith('--render=')) args.render = a.slice(9);
    else if (a.startsWith('--only=')) args.only = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--channel=')) args.channel = a.slice(10);
    else throw new Error(`readability-probe: unknown argument ${JSON.stringify(a)}`);
  }
  if (!['stub', 'pinned'].includes(args.oracle)) throw new Error(`--oracle must be stub|pinned, got ${args.oracle}`);
  if (args.cases !== 'ground-truth') throw new Error(`--cases: only "ground-truth" is implemented, got ${args.cases}`);
  if (args.render !== null && args.render !== 'plain') throw new Error(`--render: only "plain" is implemented, got ${args.render}`);
  return args;
}

async function buildEngine() {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
  const fontManager = new FontManager(manifest);
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, {
    loadFontBuffer: async (rel) => {
      const b = await readFile(path.join(repoRoot, rel));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    }
  });
  const engine = new GeometryEngine({ fontProviderRegistry });
  const fontsById = new Map(fontManager.manifest.fonts.map((f) => [f.id, f]));
  return { engine, fontsById };
}

// A deterministic stand-in for real oracle noise, so the stub path still produces a non-trivial
// per-tile record. READ-005 replaces this entirely with the pinned model's actual readings.
function simulateReading(expectedText) {
  let s = expectedText
    .replace(/O/g, '0').replace(/l/g, '1').replace(/S/g, '5');
  if (/y$/.test(expectedText)) s = s.slice(0, -1); // a "lost final stone" omission
  return s;
}

function pngSha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function caseSlug(testCase) {
  return `${testCase.fontId}__${testCase.mode}${testCase.curve ? '_curved' : ''}__${testCase.heightMm}__${testCase.stoneSizeId}`.replace(/[^\w.-]/g, '-');
}

function caseLabel(testCase) {
  return `${testCase.fontId} / ${testCase.mode}${testCase.curve ? ' (curved)' : ''} / ${testCase.heightMm}mm / ${testCase.stoneSizeId}`;
}

function curveForEngineOf(testCase) {
  return testCase.curve ? { ...testCase.curve, authored: undefined, derivation: undefined } : null;
}

/**
 * The CLI's per-case recognition path, one exported function so it can be driven directly (test 8).
 * Returns a plain summary object; writes the sheet HTML/PNG and the probe record as side effects.
 * `buildSheets` and `screenshot` are injectable so a test can assert that an A-fail probe never
 * reaches the sheet builder.
 */
export async function runRecognitionCase(testCase, opts = {}) {
  const {
    engine, fontsById, oracleMode = 'stub', corpus = 'words', force = false, channel,
    buildSheets = buildRecognitionSheetHtml, screenshot = screenshotPages,
    sheetsDir = SHEETS_DIR, profileBaseDir = PW_PROFILE_DIR
  } = opts;

  const font = fontsById.get(testCase.fontId);
  if (!font) throw new Error(`manifest has no font "${testCase.fontId}"`);

  const probeRecord = await runProbe({
    engine,
    fontId: testCase.fontId,
    stemWidthRatio: font.stemWidthRatio,
    mode: testCase.mode,
    heightMm: testCase.heightMm,
    stoneSizeId: testCase.stoneSizeId,
    corpus,
    curve: curveForEngineOf(testCase)
  });
  if (testCase.curve) probeRecord.curve = testCase.curve;

  const label = caseLabel(testCase);

  if (!probeRecord.signalA.passed) {
    return { label, signalA: false, reasons: probeRecord.signalA.reasons, oracleRequired: probeRecord.oracleRequired, pngs: [] };
  }

  await mkdir(sheetsDir, { recursive: true });
  const { sheets } = buildSheets({ probeRecord });
  const slug = caseSlug(testCase);
  const oracle = oracleMode === 'pinned' ? createPinnedOracle() : null;
  const modelIdForStub = 'stub-oracle';

  const scoredSheets = [];
  for (const sheet of sheets) {
    const htmlFile = `${slug}__sheet${sheet.index}.html`;
    const pngFile = path.join(sheetsDir, `${slug}__sheet${sheet.index}.png`);
    await writeFile(path.join(sheetsDir, htmlFile), sheet.html, 'utf8');
    await screenshot({
      dir: sheetsDir,
      pages: [{ htmlFile, pngFile }],
      profileDir: path.join(profileBaseDir, `${slug}-${sheet.index}`),
      channel
    });
    const png = await readFile(pngFile);
    const sha = pngSha256(png);

    let modelId;
    let rawReadings;
    if (oracleMode === 'pinned') {
      ({ modelId, rawReadings } = await oracle({ pngPath: pngFile, tileCount: sheet.tileInventory.length }));
    } else {
      // key by 1-based tile position: the stub is positional (it only sees tileCount), and the
      // tile labels are now circled numerals, not stringified positions.
      const stub = createStubOracle(Object.fromEntries(
        sheet.tileInventory.map((t, i) => [i + 1, simulateReading(t.expectedText)])
      ));
      ({ modelId, rawReadings } = await stub({ tileCount: sheet.tileInventory.length }));
      modelId = modelIdForStub;
    }

    const scoring = scoreProbe({ tileInventory: sheet.tileInventory, rawReadings });
    scoredSheets.push({ ...sheet, pngSha256: sha, pngFile, rawReadings, scoring, modelId });
  }

  const modelId = scoredSheets[0]?.modelId ?? modelIdForStub;
  const perSheetSha = scoredSheets.map((s) => s.pngSha256);
  const sheetPngSha256 = perSheetSha.length === 1 ? perSheetSha[0] : combineSheetPngHashes(perSheetSha);
  const cacheKey = computeCacheKey({
    fontId: probeRecord.fontId, mode: probeRecord.mode, heightMm: probeRecord.heightMm,
    stoneSizeId: probeRecord.stoneSizeId, gapMm: probeRecord.gapMm,
    corpusName: probeRecord.corpusName, corpusHash: probeRecord.corpusHash,
    sheetPngSha256, modelId, harnessVersion: probeRecord.harnessVersion
  });

  const existing = force ? null : await readRecord(cacheKey);
  if (existing) {
    return { label, signalA: true, cacheKey, aggregateCer: existing.aggregateCer, cached: true, pngs: scoredSheets.map((s) => s.pngFile) };
  }

  const record = assembleRecord({ probeRecord, modelId, sheets: scoredSheets });
  const written = await writeRecord(record);
  return { label, signalA: true, cacheKey: record.cacheKey, aggregateCer: record.aggregateCer, recordPath: written, pngs: scoredSheets.map((s) => s.pngFile) };
}

// --- ground-truth ("plain") render mode ------------------------------------------------------

function plainPageShell(svgMarkup) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ground-truth render</title>
<style>
  html { color-scheme: dark; }
  html, body { margin: 0; padding: 0; background: #0f1720; }
  main { padding: 40px; display: flex; justify-content: center; }
  svg { display: block; max-width: 100%; height: auto; }
  .row-note { color: #9fb0c3; font: 600 13px ui-monospace, Menlo, monospace; margin-top: 12px; }
  .stone-error { color: #ff8f8f; font: 600 14px ui-monospace, Menlo, monospace; }
</style>
</head>
<body><main><div>${svgMarkup}</div></main></body>
</html>`;
}

/**
 * Part 6: one PNG per ground-truth case, `PLAIN_RENDER_TEXT` at that case's font / mode / height /
 * stone size. Bypasses signal A entirely — analyzeOne() directly, no runProbe(), no
 * buildRecognitionSheetHtml() — so the A-fail cases render too.
 */
export async function renderPlainCase(testCase, opts = {}) {
  const { engine, outDir = PLAIN_DIR, channel, screenshot = screenshotPages } = opts;
  const measurement = await analyzeOne(
    engine, testCase.fontId, PLAIN_RENDER_TEXT, testCase.stoneSizeId, testCase.heightMm,
    { mode: testCase.mode, curve: curveForEngineOf(testCase) }
  );
  const pxPerMm = RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE[testCase.stoneSizeId];
  if (!pxPerMm) throw new Error(`renderPlainCase: no px/mm scale for "${testCase.stoneSizeId}"`);
  const svg = renderLayoutSvg(measurement, pxPerMm);
  const slug = caseSlug(testCase);
  const htmlFile = `${slug}.html`;
  const pngFile = path.join(outDir, `${slug}.png`);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, htmlFile), plainPageShell(svg), 'utf8');
  await screenshot({
    dir: outDir,
    pages: [{ htmlFile, pngFile }],
    profileDir: path.join(PW_PROFILE_DIR, `plain-${slug}`),
    channel
  });
  return { label: caseLabel(testCase), pngFile, htmlFile, stoneCount: measurement.stoneCount, error: measurement.error ?? null };
}

export async function runPlainRenders(cases, opts = {}) {
  const results = [];
  for (const testCase of cases) {
    const r = await renderPlainCase(testCase, opts);
    results.push(r);
    console.log(`${r.error ? 'ERR ' : 'OK  '}${r.label}  stones=${r.stoneCount}${r.error ? `  (${r.error})` : ''}\n      -> ${r.pngFile}`);
  }
  console.log('\n--- plain render PNGs ---');
  for (const r of results) console.log(r.pngFile);
  return results;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const { engine, fontsById } = await buildEngine();

  let cases = await resolveGroundTruthCases(engine);
  if (args.only) cases = cases.filter((c) => args.only.includes(c.fontId));

  if (args.render === 'plain') {
    await runPlainRenders(cases, { engine, fontsById, channel: args.channel });
    return;
  }

  const summary = [];
  for (const testCase of cases) {
    const res = await runRecognitionCase(testCase, {
      engine, fontsById, oracleMode: args.oracle, corpus: args.corpus, force: args.force, channel: args.channel
    });
    summary.push(res);
    if (!res.signalA) {
      console.log(`SKIP  ${res.label}\n      signalA FAIL: ${res.reasons.join('; ')}`);
    } else if (res.cached) {
      console.log(`HIT   ${res.label}  (cache ${res.cacheKey.slice(0, 12)})  aggregateCER=${res.aggregateCer?.toFixed(4)}`);
    } else {
      console.log(`OK    ${res.label}  aggregateCER=${res.aggregateCer.toFixed(4)}  -> ${path.relative(repoRoot, res.recordPath)}`);
    }
  }

  console.log('\n--- signal A verdicts ---');
  for (const s of summary) {
    console.log(`${s.signalA ? 'PASS' : 'FAIL'}  ${s.label}` + (s.signalA ? '' : `\n      ${s.reasons.join('; ')}`));
  }
  const pngs = summary.flatMap((s) => s.pngs ?? []);
  if (pngs.length) {
    console.log('\n--- generated PNGs ---');
    for (const p of pngs) console.log(p);
  }
  console.log(`\noracle mode: ${args.oracle}${args.oracle === 'pinned' ? ` (${PINNED_MODEL_ID})` : ''}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
