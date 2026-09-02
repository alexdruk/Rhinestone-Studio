/**
 * READ-004 — recognition scoring. Pure functions only: no image, no model, no I/O.
 *
 * `scoreProbe()` turns an answer key (`tileInventory`) plus verbatim model output (`rawReadings`)
 * into per-tile Levenshtein distance, per-tile normalised character error rate (CER), an aggregate
 * CER, and the list of misread tiles. This is fully reproducible from the stored record alone —
 * the deterministic second half of the audit strategy (READ-000 §5): geometry→PNG is
 * deterministic, readings→CER→floor is deterministic, only PNG→reading is not.
 */

/** Classic iterative Levenshtein edit distance over Unicode code points. */
export function levenshtein(a, b) {
  const s = [...String(a)];
  const t = [...String(b)];
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;
  let prev = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;
  for (let i = 1; i <= s.length; i++) {
    let curr = [i];
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost  // substitution
      );
    }
    prev = curr;
  }
  return prev[t.length];
}

/**
 * @param {object} params
 * @param {{ index: string, expectedText: string }[]} params.tileInventory the answer key
 * @param {string[]} params.rawReadings verbatim model output, one entry per tile, same order as
 *   `tileInventory`
 * @returns {{
 *   perTile: { index: string, expectedText: string, readText: string, distance: number, cer: number }[],
 *   aggregateCer: number,
 *   totalDistance: number,
 *   totalExpectedChars: number,
 *   misreads: { index: string, expectedText: string, readText: string, distance: number }[]
 * }}
 */
export function scoreProbe({ tileInventory, rawReadings } = {}) {
  if (!Array.isArray(tileInventory)) throw new Error('scoreProbe: tileInventory must be an array');
  if (!Array.isArray(rawReadings)) throw new Error('scoreProbe: rawReadings must be an array');
  if (tileInventory.length !== rawReadings.length) {
    throw new Error(`scoreProbe: tileInventory (${tileInventory.length}) and rawReadings (${rawReadings.length}) length mismatch`);
  }

  let totalDistance = 0;
  let totalExpectedChars = 0;
  const perTile = tileInventory.map((tile, i) => {
    const expectedText = String(tile.expectedText ?? '');
    const readText = String(rawReadings[i] ?? '');
    const distance = levenshtein(expectedText, readText);
    const expectedLen = [...expectedText].length;
    const cer = distance / Math.max(1, expectedLen);
    totalDistance += distance;
    totalExpectedChars += expectedLen;
    return { index: tile.index, expectedText, readText, distance, cer };
  });

  const misreads = perTile
    .filter((t) => t.distance > 0)
    .map(({ index, expectedText, readText, distance }) => ({ index, expectedText, readText, distance }));

  return {
    perTile,
    aggregateCer: totalDistance / Math.max(1, totalExpectedChars),
    totalDistance,
    totalExpectedChars,
    misreads
  };
}
