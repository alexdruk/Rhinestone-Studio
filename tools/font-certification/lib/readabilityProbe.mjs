/**
 * READ-004 — the deterministic half of the recognition harness (Layer 2,
 * docs/specifications/READ-000-readability-architecture.md §3).
 *
 * `runProbe()` takes one (font, mode, height, stone size, gap, corpus) point and returns a plain
 * record. It does NO rendering and calls NO recognition oracle. Everything it produces is
 * re-derivable from the inputs by re-running this function — that is the whole point: the only
 * non-deterministic stage in the pipeline is PNG→reading, and it lives in recognitionOracle.mjs,
 * not here.
 *
 * ## Signal ordering (load-bearing)
 *
 * Signal A — physical impossibility — is evaluated FIRST, and its cheapest part (the pure
 * stroke-width arithmetic, src/text/StrokeWidthGate.js) runs before any geometry at all. If that
 * part fails, the probe returns immediately: no layouts are generated, `signalA.passed` is false,
 * `oracleRequired` is false, and the caller must not build a sheet or attempt a reading. This
 * ordering is what keeps the expensive recognition calls off physically-unbuildable combinations
 * (READ-000 §3, combination rule step 1).
 *
 * If the stroke check passes, layouts are measured for every corpus entry (via the real
 * GeometryEngine pipeline, through productionAnalysis.analyzeOne()), and the rest of signal A —
 * the collectProductionIssues()-equivalent checks (layout error, stone collision, zero-stone
 * non-blank text) — is evaluated over those measurements. Signal D (geometric corroboration) is
 * then recorded as raw numbers. Signal D is never a verdict (READ-000 §1.4, §3 row D).
 */
import { createHash } from 'node:crypto';
import { STONE_SIZE_BY_ID } from '../../../src/renderer/StoneSizes.js';
import { strokeNarrowerThanOneStone } from '../../../src/text/index.js';
import { analyzeOne, normalizedStonePoints, PRODUCTION_GAP_MM } from './productionAnalysis.mjs';
import { expectedComponentCount } from './glyphSeparation.mjs';
import { chamferDistance } from './shapeSimilarity.mjs';
import {
  CONFUSABLE_PAIRS,
  PRODUCTION_REVIEW_GLYPHS,
  PRODUCTION_REVIEW_WORDS,
  STRESS_STRINGS
} from './requiredCharacters.mjs';
import {
  COUNTER_BEARING_CHARACTERS,
  MIN_MEANINGFUL_STONE_COUNT,
  MIN_STONE_COUNT_FOR_COUNTER_BEARING,
  NEAR_IDENTICAL_CHAMFER_THRESHOLD
} from './readabilityMetrics.mjs';

// Bumped whenever a change to this module, the sheet builder, the scorer, or the geometry they
// depend on would make a stored probe record no longer reproducible from its inputs. Part of every
// cache key (probeRecordStore.mjs) so a stale record is a cache miss, not a silent wrong answer.
export const HARNESS_VERSION = 'read-005.1';

// READ-005 §3 — signal F's pass threshold on min(separationRatio) over a probe's multi-character
// corpus entries. Provisional: spec §3.1 fixes the committed value in Step 4 from the held-out
// validation block, not from the twelve cases that suggested it. Recorded on every probe record;
// gates nothing in this milestone (§3.4).
export const F_SEPARATION_THRESHOLD = 0.65;

// --- corpus tiers, as data --------------------------------------------------------------------

function dedupePreservingOrder(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

// `search` — the 12 CONFUSABLE_PAIRS members plus the readabilityMetrics counter-bearing set,
// deduplicated. Single characters only. This is the tier READ-005's binary-search probes walk.
const SEARCH_CORPUS = dedupePreservingOrder([
  ...CONFUSABLE_PAIRS.flat(),
  ...COUNTER_BEARING_CHARACTERS
]);

// `full` — all 62 PRODUCTION_REVIEW_GLYPHS plus all 15 STRESS_STRINGS (signal B at the floor).
const FULL_CORPUS = [...PRODUCTION_REVIEW_GLYPHS, ...STRESS_STRINGS];

// `words` — the 9 PRODUCTION_REVIEW_WORDS (signal C, context-realistic).
const WORDS_CORPUS = [...PRODUCTION_REVIEW_WORDS];

// Each tier declares whether its unit of recognition is the glyph. When it is, the sheet builder
// applies the cross-entry no-repeat rule (recognitionSheets §4 rule 2): a degraded glyph must not
// be resolvable by finding a legible copy of that same glyph elsewhere on the page. `search` and
// `full` are glyph-identification tasks — isolated characters, and `rn`-vs-`m` stress strings. The
// `words` tier is not: the unit is the whole word, two names sharing an `a` is incidental (every
// English word shares letters with every other), and a lone word on a distractor-free page is an
// *easier* read, so partitioning it would weaken signal C rather than protect it. Carried as tier
// data, not inferred from entry content, so a future corpus edit cannot silently flip it.
export const CORPORA = Object.freeze({
  search: Object.freeze({ entries: SEARCH_CORPUS, glyphIdentificationTask: true }),
  full: Object.freeze({ entries: FULL_CORPUS, glyphIdentificationTask: true }),
  words: Object.freeze({ entries: WORDS_CORPUS, glyphIdentificationTask: false })
});

function corpusHash(entries) {
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

/**
 * @param {string | { name: string, entries: string[], glyphIdentificationTask?: boolean }} nameOrObject
 * @returns {{ name: string, entries: string[], hash: string, glyphIdentificationTask: boolean }}
 */
export function resolveCorpus(nameOrObject) {
  if (nameOrObject && typeof nameOrObject === 'object' && Array.isArray(nameOrObject.entries)) {
    return {
      name: nameOrObject.name,
      entries: nameOrObject.entries,
      hash: nameOrObject.hash ?? corpusHash(nameOrObject.entries),
      // an ad-hoc corpus is treated as a glyph-identification task unless it says otherwise — the
      // no-repeat rule is the safe default; the exemption must be explicit.
      glyphIdentificationTask: nameOrObject.glyphIdentificationTask ?? true
    };
  }
  const name = nameOrObject;
  const tier = CORPORA[name];
  if (!tier) {
    throw new Error(`readabilityProbe: unknown corpus tier "${name}" (expected one of: ${Object.keys(CORPORA).join(', ')})`);
  }
  return { name, entries: tier.entries, hash: corpusHash(tier.entries), glyphIdentificationTask: tier.glyphIdentificationTask };
}

// --- signal D --------------------------------------------------------------------------------

function computeSignalD(measurements) {
  const byText = new Map(measurements.map((m) => [m.text, m]));

  const confusablePairs = [];
  for (const [charA, charB] of CONFUSABLE_PAIRS) {
    const a = byText.get(charA);
    const b = byText.get(charB);
    if (!a || !b || a.error || b.error || !a.stones || !b.stones) continue;
    confusablePairs.push({
      pair: [charA, charB],
      chamferDistance: chamferDistance(normalizedStonePoints(a.stones), normalizedStonePoints(b.stones)),
      stoneCountA: a.stoneCount,
      stoneCountB: b.stoneCount
    });
  }

  const glyphStoneCounts = [];
  for (const m of measurements) {
    if (m.error) continue;
    const isSingleChar = [...m.text].length === 1;
    glyphStoneCounts.push({
      text: m.text,
      stoneCount: m.stoneCount,
      counterBearing: isSingleChar && COUNTER_BEARING_CHARACTERS.has(m.text)
    });
  }

  return {
    nearIdenticalChamferThreshold: NEAR_IDENTICAL_CHAMFER_THRESHOLD,
    minMeaningfulStoneCount: MIN_MEANINGFUL_STONE_COUNT,
    minStoneCountForCounterBearing: MIN_STONE_COUNT_FOR_COUNTER_BEARING,
    confusablePairs,
    glyphStoneCounts
  };
}

// --- signal F --------------------------------------------------------------------------------

/**
 * READ-005 §3 — glyph separation, measured on whole words (the level at which crowding exists and
 * signal B, which isolates glyphs, structurally cannot see). Recorded on every probe record;
 * gates nothing (§3.4: F does not gate until it clears the held-out validation block).
 *
 * Per corpus entry of two or more characters, reusing the analyzeOne() clusterCount already
 * measured for it (at pitchMm * 1.6 — not recomputed):
 *
 *     separationRatio = clusterCount / expectedComponentCount(engine, fontId, entryText)
 *
 * Single-character entries have no letter-to-letter separation to measure and are omitted.
 * Aggregation is by minimum: one merged letter pair spoils the design, so the worst entry governs.
 * The full `entries` array is recorded so any other aggregation can be re-derived later.
 *
 * Returns `null` for a font with no vector outline (authored rhinestone fonts — rs-block/rs-modern):
 * signal F's denominator is undefined there, and `expectedComponentCount()` reports that by
 * returning `null` rather than throwing.
 */
async function computeSignalF({ engine, fontId, providerId, measurements }) {
  const entries = [];
  for (const m of measurements) {
    if (m.error || [...m.text].length < 2 || !Number.isFinite(m.clusterCount)) continue;
    const expectedComponents = await expectedComponentCount(engine, fontId, m.text, providerId);
    if (expectedComponents === null) return null;
    const separationRatio = expectedComponents > 0 ? m.clusterCount / expectedComponents : null;
    entries.push({ text: m.text, clusterCount: m.clusterCount, expectedComponents, separationRatio });
  }
  const ratios = entries.map((e) => e.separationRatio).filter((r) => Number.isFinite(r));
  const minSeparationRatio = ratios.length > 0 ? Math.min(...ratios) : null;
  return {
    entries,
    minSeparationRatio,
    threshold: F_SEPARATION_THRESHOLD,
    passed: minSeparationRatio === null ? null : minSeparationRatio >= F_SEPARATION_THRESHOLD
  };
}

// --- the probe -------------------------------------------------------------------------------

/**
 * @param {object} params
 * @param {object} params.engine A GeometryEngine wired to a font provider registry that resolves `fontId`.
 * @param {string} params.fontId
 * @param {string} [params.providerId] READ-005a: the font's manifest providerId, threaded into
 *   every analyzeOne() call so authored rhinestone fonts (rs-block/rs-modern) resolve to their own
 *   provider instead of throwing an OpenType load error that runProbe() would otherwise turn into a
 *   false signal-A rejection. Undefined for every ordinary font — analyzeOne() then behaves exactly
 *   as before (the registry falls back to its own default).
 * @param {number} params.stemWidthRatio The font's manifest stemWidthRatio (or undefined/null for
 *   authored / legacy fonts — signal A's stroke check then no-ops, exactly like the live app).
 * @param {string} params.mode 'outline' | 'fill' | 'staggered' | 'radial' | 'contour'
 * @param {number} params.heightMm
 * @param {string} params.stoneSizeId 'ss6' | 'ss10' | 'ss16' | 'ss20' | 'ss30'
 * @param {number} [params.gapMm] absolute mm, defaults to PRODUCTION_GAP_MM (0.3)
 * @param {string | object} params.corpus tier name ('search'|'full'|'words') or a resolved corpus object
 * @param {object|null} [params.curve] when non-null, spread verbatim into generateTextLayout
 *   (curveEnabled/curveRadiusMm/curveDirection/curveStartAngleDeg/curveSweepAngleDeg/curveAlignment)
 * @returns {Promise<object>} the probe record
 */
export async function runProbe({ engine, fontId, providerId = undefined, stemWidthRatio, mode, heightMm, stoneSizeId, gapMm = PRODUCTION_GAP_MM, corpus, curve = null }) {
  const stoneSizeMm = STONE_SIZE_BY_ID[stoneSizeId]?.diameterMm;
  if (!Number.isFinite(stoneSizeMm)) {
    throw new Error(`readabilityProbe: unknown stoneSizeId "${stoneSizeId}"`);
  }
  const resolved = resolveCorpus(corpus);

  const base = {
    harnessVersion: HARNESS_VERSION,
    fontId,
    providerId: providerId ?? null,
    mode,
    heightMm,
    stoneSizeId,
    stoneSizeMm,
    gapMm,
    stemWidthRatio: Number.isFinite(stemWidthRatio) ? stemWidthRatio : null,
    curve: curve ?? null,
    corpusName: resolved.name,
    corpusHash: resolved.hash
  };

  // --- Signal A, part 1: the pure physical-impossibility check. First, always, no geometry. ---
  const strokeHit = strokeNarrowerThanOneStone({ stemWidthRatio, heightMm, stoneSizeMm, mode });
  if (strokeHit) {
    return {
      ...base,
      signalA: {
        passed: false,
        reasons: [
          `stroke ~${strokeHit.stemWidthMm.toFixed(2)}mm is narrower than one ${stoneSizeMm}mm stone in ${mode} mode ` +
          `(stemWidthRatio ${stemWidthRatio} × ${heightMm}mm height)`
        ]
      },
      oracleRequired: false,
      measurements: null,
      signalD: null,
      signalF: null
    };
  }

  // --- layout measurements for every corpus entry (the real pipeline) ---
  const measurements = [];
  for (const text of resolved.entries) {
    measurements.push(await analyzeOne(engine, fontId, text, stoneSizeId, heightMm, { mode, gapMm, curve, providerId }));
  }

  // --- Signal A, part 2: collectProductionIssues()-equivalent over the measured layouts ---
  const reasons = [];
  for (const m of measurements) {
    if (m.error) {
      reasons.push(`layout error for ${JSON.stringify(m.text)}: ${m.error}`);
      continue;
    }
    if (m.collisionCount > 0) {
      reasons.push(`${m.collisionCount} stone collision(s) for ${JSON.stringify(m.text)}`);
    }
    if (m.stoneCount === 0 && m.text.trim().length > 0) {
      reasons.push(`zero stones generated for non-blank text ${JSON.stringify(m.text)}`);
    }
  }
  const passed = reasons.length === 0;

  return {
    ...base,
    signalA: { passed, reasons },
    oracleRequired: passed,
    measurements,
    signalD: computeSignalD(measurements),
    signalF: await computeSignalF({ engine, fontId, providerId, measurements })
  };
}
