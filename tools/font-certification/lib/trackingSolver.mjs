/**
 * The per-case letter-spacing (tracking) solver shared by the READ-005 tracking experiment and the
 * READ-011C rating-pass render.
 *
 * Relocated here (READ-011C) from tools/font-certification/tracking-renders.mjs so the READ-011
 * render builder (tools/font-certification/read-011-renders.mjs) resolves `trackingTarget:
 * 'separation'` entries with the *exact same* sweep tracking-renders.mjs already used, rather than a
 * second copy that could drift — the same one-implementation consolidation READ-007A did for the
 * script-face lists (see ./scriptFaceFonts.mjs).
 *
 * `chooseTracking()` walks `TRACKING_XPITCH_LADDER` (multiples of the stone pitch) and returns the
 * LOWEST rung whose separation ratio (clusterCount / expectedComponentCount) reaches
 * `SEPARATION_TARGET` (0.95). `separationRatio` is not monotone in `letterSpacingMm`, so a caller
 * that wants the best *achievable* value when the target is unreachable should inspect the returned
 * `rungs` array rather than assuming the last rung is best — see `bestRung()`.
 */
import {
  expectedComponentCount,
  SEPARATION_TARGET,
  TRACKING_XPITCH_LADDER
} from '../../../src/geometry/index.js';
import { STONE_SIZE_BY_ID } from '../../../src/renderer/StoneSizes.js';
import { analyzeOne, PRODUCTION_GAP_MM } from './productionAnalysis.mjs';

export { SEPARATION_TARGET, TRACKING_XPITCH_LADDER };

/** One measurement of `spec` at a given letterSpacingMm. `spec` is { fontId, text, stoneSizeId, heightMm, mode }. */
export async function measure(engine, providerId, spec, letterSpacingMm) {
  return analyzeOne(engine, spec.fontId, spec.text, spec.stoneSizeId, spec.heightMm, {
    mode: spec.mode,
    providerId,
    letterSpacingMm
  });
}

export function pitchMmFor(stoneSizeId) {
  return STONE_SIZE_BY_ID[stoneSizeId].diameterMm + PRODUCTION_GAP_MM;
}

/**
 * Sweep the tracking ladder for one spec. Returns:
 *   { pitchMm, expectedComponents, before, chosen, separationAchieved, rungs }
 * where `before` is the 0-tracking rung, `chosen` is the lowest rung reaching SEPARATION_TARGET (or,
 * when none does, the last ladder rung with `separationAchieved: false`), and `rungs` is every rung
 * measured — each { xPitch, letterSpacingMm, separationRatio, widthMm, error }.
 */
export async function chooseTracking(engine, providerId, spec) {
  const pitchMm = pitchMmFor(spec.stoneSizeId);
  const expectedComponents = await expectedComponentCount(engine, spec.fontId, spec.text, providerId);
  const rungs = [];
  for (const xPitch of TRACKING_XPITCH_LADDER) {
    const ls = Number((xPitch * pitchMm).toFixed(6));
    const m = await measure(engine, providerId, spec, ls);
    const ratio = (!m.error && expectedComponents > 0 && Number.isFinite(m.clusterCount))
      ? m.clusterCount / expectedComponents
      : null;
    rungs.push({ xPitch, letterSpacingMm: ls, separationRatio: ratio, widthMm: m.boundingBoxMm?.widthMm ?? null, error: m.error });
  }
  const before = rungs[0];
  let chosen = rungs.find((r) => Number.isFinite(r.separationRatio) && r.separationRatio >= SEPARATION_TARGET) ?? null;
  let separationAchieved = true;
  if (!chosen) {
    chosen = rungs[rungs.length - 1]; // 4 x pitch
    separationAchieved = false;
  }
  return { pitchMm, expectedComponents, before, chosen, separationAchieved, rungs };
}

/**
 * The ladder rung with the highest finite separation ratio — the best value actually achievable for
 * a spec that never reaches SEPARATION_TARGET. Ties resolve to the lower letterSpacingMm (rungs are
 * in ascending order). Returns null if no rung produced a finite ratio.
 */
export function bestRung(rungs) {
  let best = null;
  for (const r of rungs) {
    if (!Number.isFinite(r.separationRatio)) continue;
    if (best === null || r.separationRatio > best.separationRatio) best = r;
  }
  return best;
}
