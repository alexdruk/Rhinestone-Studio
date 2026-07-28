/**
 * PART 3 -- Rhinestone production review for FONT-CERT-001.
 *
 * Runs the candidate font through the real, unmodified production pipeline: FontManager ->
 * OpenTypeProvider -> FontProviderRegistry -> GeometryEngine.generateTextLayout() -> StoneLayout.
 * No parallel geometry/stone-generation logic is introduced here -- this module only measures the
 * StoneLayout the engine already produces (per CLAUDE.md: "Generate stones inside renderers or
 * exporters" is forbidden; this is neither -- it is read-only analysis of the engine's own output).
 */
import { FontManager } from '../../../src/fonts/index.js';
import { FontProviderRegistry, OpenTypeProvider } from '../../../src/text/index.js';
import { GeometryEngine } from '../../../src/geometry/GeometryEngine.js';
import { STONE_SIZE_BY_ID } from '../../../src/renderer/StoneSizes.js';
import { chamferDistance } from './shapeSimilarity.mjs';
import { STONE_SIZE_IDS, CONFUSABLE_PAIRS, PRODUCTION_REVIEW_GLYPHS, PRODUCTION_REVIEW_WORDS } from './requiredCharacters.mjs';

export const PRODUCTION_TEXT_HEIGHT_MM = 25; // matches defaultProject()'s own text layer height (app.js)
export const PRODUCTION_GAP_MM = 0.3; // matches defaultProject()'s own default gap (app.js)
const CLUSTER_GAP_MULTIPLIER = 1.6; // stones within (pitch * this) of each other are one connected cluster
const ISOLATION_MULTIPLIER = 2.5; // a stone farther than (pitch * this) from its nearest neighbor is "isolated"
const SIMILARITY_CHAMFER_THRESHOLD = 0.09; // normalized (unit-height) units; see chamferDistance()

const FONT_ID = 'font-cert-001-candidate';

export async function buildCandidateEngine(candidateAbsolutePath) {
  const fontManager = new FontManager({
    version: 1,
    fonts: [{ id: FONT_ID, family: 'FONT-CERT-001 Candidate', style: 'Regular', path: candidateAbsolutePath, role: 'display', enabled: true, providerId: 'opentype' }]
  });
  const registry = new FontProviderRegistry();
  registry.register(new OpenTypeProvider({ fontManager }));
  const engine = new GeometryEngine({ fontProviderRegistry: registry });
  return { engine, fontId: FONT_ID };
}

function pairwiseStats(stones, spacingMm) {
  const n = stones.length;
  if (n === 0) return { minSpacingMm: null, collisionCount: 0, nearestNeighborMm: [] };
  const nearestNeighborMm = new Array(n).fill(Infinity);
  let minSpacingMm = Infinity;
  let collisionCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(stones[i].xMm - stones[j].xMm, stones[i].yMm - stones[j].yMm);
      if (d < nearestNeighborMm[i]) nearestNeighborMm[i] = d;
      if (d < nearestNeighborMm[j]) nearestNeighborMm[j] = d;
      if (d < minSpacingMm) minSpacingMm = d;
      const collisionThresholdMm = Math.min(stones[i].sizeMm, stones[j].sizeMm);
      if (d < collisionThresholdMm) collisionCount++;
    }
  }
  return {
    minSpacingMm: Number.isFinite(minSpacingMm) ? minSpacingMm : null,
    collisionCount,
    nearestNeighborMm
  };
}

function countClusters(stones, thresholdMm) {
  const n = stones.length;
  if (n === 0) return 0;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(stones[i].xMm - stones[j].xMm, stones[i].yMm - stones[j].yMm);
      if (d <= thresholdMm) union(i, j);
    }
  }
  return new Set(Array.from({ length: n }, (_, i) => find(i))).size;
}

function normalizedStonePoints(stones) {
  if (stones.length === 0) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of stones) {
    minX = Math.min(minX, s.xMm); maxX = Math.max(maxX, s.xMm);
    minY = Math.min(minY, s.yMm); maxY = Math.max(maxY, s.yMm);
  }
  const height = maxY - minY;
  if (height <= 0) return [];
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return stones.map((s) => ({ x: (s.xMm - cx) / height, y: (s.yMm - cy) / height }));
}

/**
 * Analyze one text string's StoneLayout at one stone size.
 */
async function analyzeOne(engine, fontId, text, stoneSizeId) {
  const stoneSizeMm = STONE_SIZE_BY_ID[stoneSizeId].diameterMm;
  const pitchMm = stoneSizeMm + PRODUCTION_GAP_MM;
  let layout = null;
  let error = null;
  try {
    layout = await engine.generateTextLayout({
      text,
      fontId,
      layerId: 'font-cert-001',
      heightMm: PRODUCTION_TEXT_HEIGHT_MM,
      stoneSizeMm,
      gapMm: PRODUCTION_GAP_MM,
      mode: 'outline',
      color: 'gold'
    });
  } catch (err) {
    error = err.message;
  }

  if (error) {
    return { text, stoneSizeId, stoneSizeMm, error, stoneCount: 0 };
  }

  const stones = layout.stones.map((s) => ({ xMm: s.xMm, yMm: s.yMm, sizeMm: s.sizeMm }));
  const { minSpacingMm, collisionCount, nearestNeighborMm } = pairwiseStats(stones, pitchMm);
  const isolatedCount = nearestNeighborMm.filter((d) => Number.isFinite(d) && d > pitchMm * ISOLATION_MULTIPLIER).length;
  const clusterCount = countClusters(stones, pitchMm * CLUSTER_GAP_MULTIPLIER);
  const boundingBox = layout.getBoundingBox();

  return {
    text,
    stoneSizeId,
    stoneSizeMm,
    error: null,
    stoneCount: stones.length,
    boundingBoxMm: boundingBox ? { widthMm: boundingBox.widthMm, heightMm: boundingBox.heightMm } : null,
    minSpacingMm,
    pitchMm,
    collisionCount,
    isolatedCount,
    clusterCount,
    stones
  };
}

/**
 * Runs the full Part 3 review: every representative glyph/word at every stone size, plus
 * confusable-pair similarity checks. Returns structured results consumed by classification.mjs
 * and the HTML report -- no rendering here.
 */
export async function runProductionAnalysis(candidateAbsolutePath) {
  const { engine, fontId } = await buildCandidateEngine(candidateAbsolutePath);

  const glyphResults = new Map(); // char -> stoneSizeId -> result
  for (const char of PRODUCTION_REVIEW_GLYPHS) {
    const bySize = new Map();
    for (const sizeId of STONE_SIZE_IDS) {
      bySize.set(sizeId, await analyzeOne(engine, fontId, char, sizeId));
    }
    glyphResults.set(char, bySize);
  }

  const wordResults = new Map();
  for (const word of PRODUCTION_REVIEW_WORDS) {
    const bySize = new Map();
    for (const sizeId of STONE_SIZE_IDS) {
      bySize.set(sizeId, await analyzeOne(engine, fontId, word, sizeId));
    }
    wordResults.set(word, bySize);
  }

  // Confusable-pair similarity, evaluated at SS16 (a representative mid-size) using normalized
  // (unit-height, centered) stone positions -- objective evidence for anatomy-ambiguity findings.
  const REFERENCE_SIZE_ID = 'ss16';
  const similarityFindings = [];
  for (const [charA, charB] of CONFUSABLE_PAIRS) {
    const resultA = glyphResults.get(charA)?.get(REFERENCE_SIZE_ID);
    const resultB = glyphResults.get(charB)?.get(REFERENCE_SIZE_ID);
    if (!resultA || !resultB || resultA.error || resultB.error) continue;
    const pointsA = normalizedStonePoints(resultA.stones);
    const pointsB = normalizedStonePoints(resultB.stones);
    const distance = chamferDistance(pointsA, pointsB);
    similarityFindings.push({
      pair: [charA, charB],
      stoneSizeId: REFERENCE_SIZE_ID,
      stoneCountA: resultA.stoneCount,
      stoneCountB: resultB.stoneCount,
      chamferDistance: distance,
      flagged: distance !== null && distance < SIMILARITY_CHAMFER_THRESHOLD
    });
  }

  return {
    fontId,
    heightMm: PRODUCTION_TEXT_HEIGHT_MM,
    gapMm: PRODUCTION_GAP_MM,
    glyphResults,
    wordResults,
    similarityFindings,
    similarityThreshold: SIMILARITY_CHAMFER_THRESHOLD
  };
}
