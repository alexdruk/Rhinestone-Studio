/**
 * READ-004 — probe record store.
 *
 * Records are JSON files on disk under a gitignored output directory. READ-005 is roughly 800–960
 * probes; it must be resumable across sessions and re-runnable per font, so a record whose cache
 * key already exists is returned as-is without re-rendering or re-reading.
 *
 * ## Cache key
 *
 * sha256 over the canonical (recursively key-sorted) JSON of:
 *   { fontId, mode, heightMm, stoneSizeId, gapMm, corpusName, corpusHash, sheetPngSha256, modelId }
 *
 * Every one of those fields feeds the key, so changing any of them — the geometry inputs, the
 * corpus, the rendered image, or the model — is a cache miss rather than a silent stale hit.
 * `sheetPngSha256` folds in the pixels actually read: for a multi-sheet probe it is the sha256 of
 * the per-sheet PNG hashes joined in order.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { repoPath } from './repoPaths.mjs';

export const PROBE_RECORDS_DIR = repoPath('tools/font-certification/output/read-004/probe-records');

/** Recursively sort object keys so JSON.stringify is canonical. Arrays keep their order. */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonicalize(value[k])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

/** sha256 of the per-sheet PNG hashes joined in order — the single `sheetPngSha256` for the key. */
export function combineSheetPngHashes(perSheetSha256) {
  return sha256Hex(perSheetSha256.join('\n'));
}

const KEY_FIELDS = ['fontId', 'mode', 'heightMm', 'stoneSizeId', 'gapMm', 'corpusName', 'corpusHash', 'sheetPngSha256', 'modelId'];

/**
 * @param {object} fields must contain every KEY_FIELD
 * @returns {string} hex sha256 cache key
 */
export function computeCacheKey(fields) {
  const picked = {};
  for (const field of KEY_FIELDS) {
    if (fields[field] === undefined) throw new Error(`computeCacheKey: missing key field "${field}"`);
    picked[field] = fields[field];
  }
  return sha256Hex(canonicalJson(picked));
}

function recordPath(cacheKey) {
  return path.join(PROBE_RECORDS_DIR, `${cacheKey}.json`);
}

/** @returns {Promise<object|null>} the stored record for this key, or null if absent. */
export async function readRecord(cacheKey) {
  try {
    return JSON.parse(await readFile(recordPath(cacheKey), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function hasRecord(cacheKey) {
  return (await readRecord(cacheKey)) !== null;
}

/** Writes the record to `${cacheKey}.json`. The record must carry `.cacheKey`. */
export async function writeRecord(record) {
  if (!record || typeof record.cacheKey !== 'string') {
    throw new Error('writeRecord: record must carry a string cacheKey');
  }
  await mkdir(PROBE_RECORDS_DIR, { recursive: true });
  await writeFile(recordPath(record.cacheKey), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return recordPath(record.cacheKey);
}

/** Every stored record, newest-first by mtime is not tracked — returns them in filename order. */
export async function listRecords() {
  let names;
  try {
    names = await readdir(PROBE_RECORDS_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    out.push(JSON.parse(await readFile(path.join(PROBE_RECORDS_DIR, name), 'utf8')));
  }
  return out;
}

/**
 * Drops the heavy `stones` arrays from a probe record's measurements — the persisted record keeps
 * counts and bounding boxes (everything signal A / signal D actually used); the stone positions
 * are re-derivable by re-running the probe (deterministic geometry).
 */
function slimMeasurements(measurements) {
  if (!Array.isArray(measurements)) return measurements;
  return measurements.map(({ stones, ...rest }) => ({ ...rest, stoneCount: rest.stoneCount ?? (stones ? stones.length : 0) }));
}

/**
 * Assemble the full on-disk record from a probe result plus the per-sheet oracle + scoring output.
 *
 * @param {object} params
 * @param {object} params.probeRecord from readabilityProbe.runProbe()
 * @param {string} params.modelId the oracle's reported model id
 * @param {{ index:number, cls:string, tileInventory:{index:string,expectedText:string}[],
 *           pngSha256:string, rawReadings:string[], scoring:object }[]} params.sheets
 * @returns {object} record with `.cacheKey` set, ready for writeRecord()
 */
export function assembleRecord({ probeRecord, modelId, sheets }) {
  const perSheetSha256 = sheets.map((s) => s.pngSha256);
  const sheetPngSha256 = perSheetSha256.length === 1 ? perSheetSha256[0] : combineSheetPngHashes(perSheetSha256);

  const keyFields = {
    fontId: probeRecord.fontId,
    mode: probeRecord.mode,
    heightMm: probeRecord.heightMm,
    stoneSizeId: probeRecord.stoneSizeId,
    gapMm: probeRecord.gapMm,
    corpusName: probeRecord.corpusName,
    corpusHash: probeRecord.corpusHash,
    sheetPngSha256,
    modelId
  };

  const aggregateCer = sheets.length
    ? sheets.reduce((sum, s) => sum + s.scoring.totalDistance, 0) / Math.max(1, sheets.reduce((sum, s) => sum + s.scoring.totalExpectedChars, 0))
    : null;

  return {
    cacheKey: computeCacheKey(keyFields),
    ...keyFields,
    harnessVersion: probeRecord.harnessVersion,
    curve: probeRecord.curve ?? null,
    stemWidthRatio: probeRecord.stemWidthRatio ?? null,
    signalA: probeRecord.signalA,
    oracleRequired: probeRecord.oracleRequired,
    signalD: probeRecord.signalD,
    measurements: slimMeasurements(probeRecord.measurements),
    sheets: sheets.map((s) => ({
      index: s.index,
      cls: s.cls,
      pngSha256: s.pngSha256,
      tileInventory: s.tileInventory,
      rawReadings: s.rawReadings,
      scoring: s.scoring
    })),
    aggregateCer,
    createdAt: new Date().toISOString()
  };
}
