#!/usr/bin/env node
/**
 * READ-004 — recognition harness CLI.
 *
 *   node tools/font-certification/readability-probe.mjs --cases ground-truth --oracle stub
 *
 * Runs a list of (font, mode, height, stone size) probes through the deterministic half of the
 * harness (readabilityProbe → recognitionSheets → screenshotPages → recognitionScoring →
 * probeRecordStore) and writes one auditable JSON record per probe.
 *
 * `--oracle stub` is the only mode exercised in READ-004. `--oracle pinned` is wired and reachable
 * but deliberately not run here — see recognitionOracle.mjs: the pinned model's first real call
 * happens under review, not in this milestone.
 *
 * Options:
 *   --cases <name>      case list to run (only `ground-truth` is implemented)
 *   --oracle <mode>     `stub` (default) or `pinned`
 *   --corpus <tier>     `words` (default), `search`, or `full`
 *   --only <id[,id]>    restrict to these font ids
 *   --force             ignore an existing cached record and re-run
 *   --channel <name>    Playwright browser channel passed through screenshotPages() (e.g. `chrome`
 *                       when the bundled Chromium build is unavailable, as on macOS 13)
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { FontManager } from '../../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../../src/text/index.js';
import { GeometryEngine } from '../../src/geometry/index.js';
import { repoPath } from './lib/repoPaths.mjs';
import { runProbe } from './lib/readabilityProbe.mjs';
import { buildRecognitionSheetHtml } from './lib/recognitionSheets.mjs';
import { createStubOracle, createPinnedOracle, PINNED_MODEL_ID } from './lib/recognitionOracle.mjs';
import { scoreProbe } from './lib/recognitionScoring.mjs';
import { assembleRecord, computeCacheKey, readRecord, writeRecord, combineSheetPngHashes } from './lib/probeRecordStore.mjs';
import { screenshotPages } from './lib/screenshotPages.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const OUTPUT_DIR = repoPath('tools/font-certification/output/read-004');
const SHEETS_DIR = path.join(OUTPUT_DIR, 'sheets');
const PW_PROFILE_DIR = path.join(OUTPUT_DIR, 'pw-profile');

// --- ground-truth case list (real manifest ids, verified) ------------------------------------
//
// The curved row is anton-regular / contour / 60mm / ss10 with a 120mm-radius upward arc. The
// arc-projection engine (src/geometry/ArcProjection.js) takes curveDirection ∈ {outside, inside}
// and requires a non-zero curveSweepAngleDeg, so the prompt's `curveDirection: 'up'` is recorded
// on the case as-authored and mapped to the engine's upward-bulging direction ('outside') with a
// 180° sweep; both the authored value and the engine value are kept in the probe record's `curve`.
export const GROUND_TRUTH_CASES = [
  { fontId: 'anton-regular',          mode: 'outline', heightMm: 36.52, stoneSizeId: 'ss6' },
  { fontId: 'poppins-regular',        mode: 'outline', heightMm: 42.5,  stoneSizeId: 'ss6' },
  { fontId: 'great-vibes-regular',    mode: 'outline', heightMm: 42.5,  stoneSizeId: 'ss6' },
  { fontId: 'dancing-script-regular', mode: 'outline', heightMm: 34.3,  stoneSizeId: 'ss6' },
  { fontId: 'courier-prime-regular',  mode: 'outline', heightMm: 77.5,  stoneSizeId: 'ss16' },
  { fontId: 'cinzel-regular',         mode: 'radial',  heightMm: 56,    stoneSizeId: 'ss16' },
  { fontId: 'caveat-regular',         mode: 'fill',    heightMm: 55,    stoneSizeId: 'ss16' },
  { fontId: 'lobster-regular',        mode: 'contour', heightMm: 42,    stoneSizeId: 'ss10' },
  { fontId: 'lilita-one-regular',     mode: 'contour', heightMm: 40,    stoneSizeId: 'ss10' },
  { fontId: 'lilita-one-regular',     mode: 'radial',  heightMm: 58,    stoneSizeId: 'ss16' },
  {
    fontId: 'anton-regular', mode: 'contour', heightMm: 60, stoneSizeId: 'ss10',
    curve: {
      authored: { curveEnabled: true, curveRadiusMm: 120, curveDirection: 'up', curveAlignment: 'center' },
      curveEnabled: true, curveRadiusMm: 120, curveDirection: 'outside',
      curveStartAngleDeg: 0, curveSweepAngleDeg: 180, curveAlignment: 'center'
    }
  }
];

function parseArgs(argv) {
  const args = { cases: 'ground-truth', oracle: 'stub', corpus: 'words', only: null, force: false, channel: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cases') args.cases = argv[++i];
    else if (a === '--oracle') args.oracle = argv[++i];
    else if (a === '--corpus') args.corpus = argv[++i];
    else if (a === '--only') args.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--channel') args.channel = argv[++i];
    else if (a === '--force') args.force = true;
    else if (a.startsWith('--cases=')) args.cases = a.slice(8);
    else if (a.startsWith('--oracle=')) args.oracle = a.slice(9);
    else if (a.startsWith('--corpus=')) args.corpus = a.slice(9);
    else if (a.startsWith('--only=')) args.only = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--channel=')) args.channel = a.slice(10);
    else throw new Error(`readability-probe: unknown argument ${JSON.stringify(a)}`);
  }
  if (!['stub', 'pinned'].includes(args.oracle)) throw new Error(`--oracle must be stub|pinned, got ${args.oracle}`);
  if (args.cases !== 'ground-truth') throw new Error(`--cases: only "ground-truth" is implemented, got ${args.cases}`);
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

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const { engine, fontsById } = await buildEngine();
  await mkdir(SHEETS_DIR, { recursive: true });

  const oracle = args.oracle === 'pinned'
    ? createPinnedOracle() // reachable; not invoked by --cases ground-truth in READ-004
    : null;
  const modelIdForStub = 'stub-oracle';

  let cases = GROUND_TRUTH_CASES;
  if (args.only) cases = cases.filter((c) => args.only.includes(c.fontId));

  const summary = [];

  for (const testCase of cases) {
    const font = fontsById.get(testCase.fontId);
    if (!font) throw new Error(`manifest has no font "${testCase.fontId}"`);
    const stemWidthRatio = font.stemWidthRatio;
    const curveForEngine = testCase.curve
      ? { ...testCase.curve, authored: undefined }
      : null;

    const probeRecord = await runProbe({
      engine,
      fontId: testCase.fontId,
      stemWidthRatio,
      mode: testCase.mode,
      heightMm: testCase.heightMm,
      stoneSizeId: testCase.stoneSizeId,
      corpus: args.corpus,
      curve: curveForEngine
    });
    // Preserve the as-authored curve params (incl. the prompt's `curveDirection: 'up'`) in the record.
    if (testCase.curve) probeRecord.curve = testCase.curve;

    const label = `${testCase.fontId} / ${testCase.mode}${testCase.curve ? ' (curved)' : ''} / ${testCase.heightMm}mm / ${testCase.stoneSizeId}`;

    if (!probeRecord.signalA.passed) {
      summary.push({ label, signalA: false, reasons: probeRecord.signalA.reasons, oracleRequired: probeRecord.oracleRequired });
      console.log(`SKIP  ${label}\n      signalA FAIL: ${probeRecord.signalA.reasons.join('; ')}`);
      continue;
    }

    // --- build sheets, screenshot, read, score ---
    const { sheets } = buildRecognitionSheetHtml({ probeRecord });
    const slug = `${testCase.fontId}__${testCase.mode}${testCase.curve ? '_curved' : ''}__${testCase.heightMm}__${testCase.stoneSizeId}`.replace(/[^\w.-]/g, '-');

    const scoredSheets = [];
    for (const sheet of sheets) {
      const htmlFile = `${slug}__sheet${sheet.index}.html`;
      const pngFile = path.join(SHEETS_DIR, `${slug}__sheet${sheet.index}.png`);
      await writeFile(path.join(SHEETS_DIR, htmlFile), sheet.html, 'utf8');
      await screenshotPages({
        dir: SHEETS_DIR,
        pages: [{ htmlFile, pngFile }],
        profileDir: path.join(PW_PROFILE_DIR, `${slug}-${sheet.index}`),
        channel: args.channel
      });
      const png = await readFile(pngFile);
      const sha = pngSha256(png);

      let modelId;
      let rawReadings;
      if (args.oracle === 'pinned') {
        ({ modelId, rawReadings } = await oracle({ pngPath: pngFile, tileCount: sheet.tileInventory.length }));
      } else {
        const stub = createStubOracle(Object.fromEntries(
          sheet.tileInventory.map((t) => [t.index, simulateReading(t.expectedText)])
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
      sheetPngSha256, modelId
    });

    const existing = args.force ? null : await readRecord(cacheKey);
    if (existing) {
      console.log(`HIT   ${label}  (cache ${cacheKey.slice(0, 12)})  aggregateCER=${existing.aggregateCer?.toFixed(4)}`);
      summary.push({ label, signalA: true, cacheKey, aggregateCer: existing.aggregateCer, pngs: scoredSheets.map((s) => s.pngFile) });
      continue;
    }

    const record = assembleRecord({ probeRecord, modelId, sheets: scoredSheets });
    const written = await writeRecord(record);
    console.log(`OK    ${label}  aggregateCER=${record.aggregateCer.toFixed(4)}  -> ${path.relative(repoRoot, written)}`);
    summary.push({ label, signalA: true, cacheKey: record.cacheKey, aggregateCer: record.aggregateCer, pngs: scoredSheets.map((s) => s.pngFile) });
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

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
