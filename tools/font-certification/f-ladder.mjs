#!/usr/bin/env node
/**
 * READ-005a Part D — the free F + A ladder (docs/specifications/READ-005-SweepAndFloors.md §4.2, §6
 * Step 1). Deterministic, no oracle, no network.
 *
 *   node tools/font-certification/f-ladder.mjs
 *
 * Cells: every enabled manifest font carrying a `stemWidthRatio` EXCEPT `montserrat-regular`
 * (spec §4.1 — the bundled file is Montserrat Thin under a Regular id), crossed with the 5 sample
 * modes. 28 × 5 = 140 cells. Texts: "Vitalina" and "Emmanuel".
 *
 * Two ladders per cell:
 *   - Dense  — ss10 only, ratio from the cell's start to 32.0 in 0.5 steps.
 *   - Coarse — all five stone sizes, ratios [10, 12.5, 15, 18, 21, 24, 28, 32].
 *
 * Ladder start (spec §4.2): interior-filling modes -> max(6, ceil(1 / stemWidthRatio));
 * outline -> 6. Height for a rung = ratio * stoneSizeMm.
 *
 * At each rung, per text: clusterCount, expectedComponents, separationRatio, the signal-A verdict,
 * stoneCount. Then per cell: `monotone`, `lowestPassingRatio`, `floorRatio` (spec §4.2's number:
 * the highest rung below which any failure occurs).
 *
 * Output: tools/font-certification/output/read-005/f-ladder.json — checkpointed after every
 * completed (font, mode) cell, and resumable: a re-run skips cells already in the file.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FontManager } from '../../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../../src/text/index.js';
import { GeometryEngine } from '../../src/geometry/index.js';
import { STONE_SIZE_BY_ID } from '../../src/renderer/StoneSizes.js';
import { runProbe, HARNESS_VERSION, F_SEPARATION_THRESHOLD } from './lib/readabilityProbe.mjs';
import { expectedComponentCount, separationBand } from '../../src/geometry/index.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const OUT_DIR = path.join(repoRoot, 'tools/font-certification/output/read-005');
const OUT_FILE = path.join(OUT_DIR, 'f-ladder.json');

const TEXTS = ['Vitalina', 'Emmanuel'];
const MODES = ['outline', 'fill', 'staggered', 'radial', 'contour'];
const INTERIOR_MODES = new Set(['fill', 'staggered', 'radial', 'contour']);
const DENSE_STONE_SIZE_ID = 'ss10';
const DENSE_TOP_RATIO = 32.0;
const DENSE_STEP = 0.5;
const COARSE_RATIOS = [10, 12.5, 15, 18, 21, 24, 28, 32];
const COARSE_STONE_SIZE_IDS = ['ss6', 'ss10', 'ss16', 'ss20', 'ss30'];
const EXCLUDED_FONT = 'montserrat-regular';

// READ-005a-2 Fix 2 — bumped when a change to deriveCell()/separationBand()/plateauRatio would make
// a stored cell's derived fields wrong. A cell whose `derivedSchema` differs is re-derived from its
// stored rungs (no re-evaluation), so adding a derived field never forces a full re-sweep.
const DERIVED_SCHEMA = 'read-005a-2';

function ladderStart(mode, stemWidthRatio) {
  if (INTERIOR_MODES.has(mode)) return Math.max(6, Math.ceil(1 / stemWidthRatio));
  return 6; // outline — no signal-A protection at all
}

function denseRatios(start) {
  const out = [];
  for (let r = start; r <= DENSE_TOP_RATIO + 1e-9; r += DENSE_STEP) {
    out.push(Number(r.toFixed(3)));
  }
  return out;
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
  return { engine, fonts: fontManager.manifest.fonts };
}

// One rung, one stone size: run both texts through runProbe with a single-entry ad-hoc corpus so
// signal A and stoneCount are per text, and read clusterCount / separationRatio straight off the
// record. expectedComponents is computed unconditionally (memoized, ~free) so it is present even on
// a rung whose pure stroke check fails and produces no measurements.
async function evalRung({ engine, font, mode, ratio, stoneSizeId }) {
  const stoneSizeMm = STONE_SIZE_BY_ID[stoneSizeId].diameterMm;
  const heightMm = Number((ratio * stoneSizeMm).toFixed(4));
  const byText = {};
  for (const text of TEXTS) {
    const expectedComponents = await expectedComponentCount(engine, font.id, text, font.providerId);
    const probe = await runProbe({
      engine,
      fontId: font.id,
      providerId: font.providerId,
      stemWidthRatio: font.stemWidthRatio,
      mode,
      heightMm,
      stoneSizeId,
      corpus: { name: 'f-ladder', entries: [text], glyphIdentificationTask: true }
    });
    const m = probe.measurements ? probe.measurements[0] : null;
    const clusterCount = m && !m.error && Number.isFinite(m.clusterCount) ? m.clusterCount : null;
    const stoneCount = m && !m.error ? m.stoneCount : null;
    const separationRatio = clusterCount !== null && expectedComponents > 0
      ? clusterCount / expectedComponents
      : null;
    byText[text] = {
      clusterCount,
      expectedComponents,
      separationRatio,
      separationBand: separationBand(separationRatio),
      signalA: probe.signalA.passed,
      stoneCount,
      error: m && m.error ? m.error : null
    };
  }
  return { ratio, stoneSizeId, heightMm, byText };
}

// A rung F-passes iff every text has a finite separationRatio and their minimum clears the
// threshold (min governs — one merged pair spoils the design, spec §3.1).
function rungFPasses(rung) {
  const ratios = TEXTS.map((t) => rung.byText[t].separationRatio);
  if (ratios.some((r) => !Number.isFinite(r))) return false;
  return Math.min(...ratios) >= F_SEPARATION_THRESHOLD;
}

function isNonDecreasing(seq) {
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] < seq[i - 1] - 1e-9) return false;
  }
  return true;
}

function deriveCell(cell) {
  const dense = cell.dense;

  // Monotonicity — per text, over the finite separationRatio values in rung order.
  const monotoneByText = {};
  let worstDrop = 0;
  for (const text of TEXTS) {
    const seq = dense.map((r) => r.byText[text].separationRatio).filter((v) => Number.isFinite(v));
    monotoneByText[text] = isNonDecreasing(seq);
    for (let i = 1; i < seq.length; i++) {
      const drop = seq[i - 1] - seq[i];
      if (drop > worstDrop) worstDrop = drop;
    }
  }
  const monotone = TEXTS.every((t) => monotoneByText[t]);

  // Pass/fail per dense rung, in ascending ratio order.
  const passFlags = dense.map(rungFPasses);
  const anyPass = passFlags.some(Boolean);

  let lowestPassingRatio = null;
  let floorRatio = null;
  let floorNote = null;

  if (!anyPass) {
    // Never clears anywhere on the ladder — honest output is `unsupported`, not a floor (spec §4.2).
    floorNote = 'never-passes';
  } else {
    lowestPassingRatio = dense[passFlags.indexOf(true)].ratio;
    let lastFail = -1;
    for (let i = 0; i < passFlags.length; i++) if (!passFlags[i]) lastFail = i;
    if (lastFail === -1) {
      // Passes every rung: the floor is the bottom of the ladder.
      floorRatio = dense[0].ratio;
    } else if (lastFail === passFlags.length - 1) {
      // The top rung itself fails while a lower rung passes — no all-passing suffix exists.
      floorNote = 'top-rung-fails';
    } else {
      // The highest rung below which a failure occurs = the rung immediately above the last failure.
      floorRatio = dense[lastFail + 1].ratio;
    }
  }

  // plateauRatio — the lowest dense rung at or above which every rung's minimum separationRatio
  // (over both texts) stays within [0.85, 1.15]: a stable, one-blob-per-letter region, distinct
  // from `floorRatio` (which a shattered layout also clears, since `passed` has no upper bound).
  let plateauRatio = null;
  let suffixInPlateau = true;
  for (let i = dense.length - 1; i >= 0; i--) {
    const mins = TEXTS.map((t) => dense[i].byText[t].separationRatio);
    const rungInPlateau = mins.every((v) => Number.isFinite(v)) &&
      Math.min(...mins) >= 0.85 && Math.min(...mins) <= 1.15;
    if (rungInPlateau && suffixInPlateau) {
      plateauRatio = dense[i].ratio;
    } else {
      suffixInPlateau = false;
    }
  }

  cell.monotone = monotone;
  cell.monotoneByText = monotoneByText;
  cell.worstSeparationDrop = Number(worstDrop.toFixed(4));
  cell.lowestPassingRatio = lowestPassingRatio;
  cell.floorRatio = floorRatio;
  cell.floorNote = floorNote;
  cell.neverPasses = !anyPass;
  cell.floorDisagreesWithLowestPassing = floorRatio !== lowestPassingRatio;
  cell.plateauRatio = plateauRatio;
  cell.derivedSchema = DERIVED_SCHEMA;
}

// Backfill `separationBand` onto every stored rung (dense + coarse) of a cell loaded from an
// earlier schema — a pure function of the already-stored `separationRatio`, no re-evaluation.
function backfillBands(cell) {
  for (const rung of [...cell.dense, ...cell.coarse]) {
    for (const text of TEXTS) {
      rung.byText[text].separationBand = separationBand(rung.byText[text].separationRatio);
    }
  }
}

async function atomicWrite(file, data) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, file);
}

async function run() {
  await mkdir(OUT_DIR, { recursive: true });
  const { engine, fonts } = await buildEngine();

  const cellFonts = fonts.filter((f) => f.enabled !== false && typeof f.stemWidthRatio === 'number' && f.id !== EXCLUDED_FONT);
  const cellList = [];
  for (const font of cellFonts) {
    for (const mode of MODES) cellList.push({ font, mode });
  }

  let out;
  try {
    out = JSON.parse(await readFile(OUT_FILE, 'utf8'));
  } catch {
    out = null;
  }
  if (!out || out.meta?.harnessVersion !== HARNESS_VERSION) {
    if (out) console.log(`existing f-ladder.json is harnessVersion ${out.meta?.harnessVersion} != ${HARNESS_VERSION} — starting fresh`);
    out = {
      meta: {
        harnessVersion: HARNESS_VERSION,
        fSeparationThreshold: F_SEPARATION_THRESHOLD,
        texts: TEXTS,
        modes: MODES,
        denseStoneSizeId: DENSE_STONE_SIZE_ID,
        denseTopRatio: DENSE_TOP_RATIO,
        denseStep: DENSE_STEP,
        coarseRatios: COARSE_RATIOS,
        coarseStoneSizeIds: COARSE_STONE_SIZE_IDS,
        excludedFont: EXCLUDED_FONT,
        derivedSchema: DERIVED_SCHEMA,
        startedAt: new Date().toISOString()
      },
      cells: {}
    };
  }

  // READ-005a-2 Fix 2 — re-derive any complete cell stored under an older derived schema. The new
  // fields (`separationBand` per rung, `plateauRatio` per cell) are pure functions of the rungs
  // already measured, so this is a cheap in-place migration, never a re-sweep.
  let migrated = 0;
  for (const cell of Object.values(out.cells)) {
    if (cell.complete && cell.derivedSchema !== DERIVED_SCHEMA) {
      backfillBands(cell);
      deriveCell(cell);
      migrated++;
    }
  }
  if (migrated > 0) {
    out.meta.derivedSchema = DERIVED_SCHEMA;
    out.meta.updatedAt = new Date().toISOString();
    await atomicWrite(OUT_FILE, out);
    console.log(`re-derived ${migrated} cell(s) to derived schema ${DERIVED_SCHEMA}`);
  }

  let done = 0;
  for (const { font, mode } of cellList) {
    done++;
    const key = `${font.id}::${mode}`;
    if (out.cells[key] && out.cells[key].complete) {
      console.log(`[${done}/${cellList.length}] ${key}  — cached`);
      continue;
    }

    const start = ladderStart(mode, font.stemWidthRatio);
    const t0 = Date.now();
    const cell = {
      fontId: font.id,
      mode,
      providerId: font.providerId ?? null,
      stemWidthRatio: font.stemWidthRatio,
      ladderStart: start,
      dense: [],
      coarse: [],
      complete: false
    };

    for (const ratio of denseRatios(start)) {
      cell.dense.push(await evalRung({ engine, font, mode, ratio, stoneSizeId: DENSE_STONE_SIZE_ID }));
    }
    for (const stoneSizeId of COARSE_STONE_SIZE_IDS) {
      for (const ratio of COARSE_RATIOS) {
        cell.coarse.push(await evalRung({ engine, font, mode, ratio, stoneSizeId }));
      }
    }

    deriveCell(cell);
    cell.complete = true;
    cell.elapsedSec = Number(((Date.now() - t0) / 1000).toFixed(1));
    out.cells[key] = cell;
    out.meta.updatedAt = new Date().toISOString();
    await atomicWrite(OUT_FILE, out);

    console.log(
      `[${done}/${cellList.length}] ${key}  start=${start}  dense=${cell.dense.length} coarse=${cell.coarse.length}  ` +
      `monotone=${cell.monotone}  lowestPassing=${cell.lowestPassingRatio}  floor=${cell.floorRatio}` +
      `${cell.floorNote ? ` (${cell.floorNote})` : ''}  ${cell.elapsedSec}s`
    );
  }

  out.meta.finishedAt = new Date().toISOString();
  await atomicWrite(OUT_FILE, out);
  console.log(`\ndone — ${OUT_FILE}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
