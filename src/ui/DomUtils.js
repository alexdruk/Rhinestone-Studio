/**
 * ARC-001 (App.js Consolidation, Phase 1) — small, zero-dependency DOM/value helpers moved out of
 * app.js verbatim. Pure functions only: no Project/Layer/StoneLayout/layer-type knowledge, matching
 * every other permanent module's shape. app.js is the only caller.
 */
export const el = id => document.getElementById(id);

// RS-1008: `parseFloat(...)||fallback` (the pattern the rest of app.js uses for numeric field
// reads) silently discards an explicit, meaningful 0 -- harmless for fields whose fallback is also
// a sensible default at 0, but wrong for fields whose valid range starts at 0 (e.g. imgThreshold).
// parseIntOr() only falls back on genuinely invalid (NaN) input.
export function parseIntOr(value, fallback) {
  const n = Math.round(parseFloat(value));
  return Number.isFinite(n) ? n : fallback;
}
