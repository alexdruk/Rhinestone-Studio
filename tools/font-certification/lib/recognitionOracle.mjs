/**
 * READ-004 — recognition oracle adapter.
 *
 * The oracle is the ONE stage of the pipeline that is not deterministically re-derivable from the
 * stored record (geometry→PNG is deterministic; reading→CER→floor is deterministic; PNG→reading is
 * not). Per READ-000 §3 and §5 it is therefore pinned and its raw output is recorded verbatim, so
 * a later disagreement is audited by resampling rather than re-litigated.
 *
 * ## What an oracle is
 *
 * A function `oracle({ pngPath?, pngBuffer?, tileCount }) → Promise<{ modelId, rawReadings }>`
 * where `rawReadings[i]` is the verbatim string the model returned for tile `i` (0-indexed, one
 * entry per tile, `tileCount` entries total). The oracle receives the PNG and the tile count and
 * NOTHING ELSE — never the `tileInventory`. It does no scoring and returns no verdict.
 *
 * ## This milestone
 *
 * `createPinnedOracle()` is implemented but **not invoked anywhere in READ-004** — not in the CLI,
 * not in tests, not "just to check it works". Its first real call happens under review (READ-005),
 * where the reviewer pins a dated model snapshot, commits neither the key nor the PNGs, and keeps
 * the raw readings for audit. Everything READ-004 runs end to end uses `createStubOracle()`.
 */
import { readFile } from 'node:fs/promises';

// The pinned recognition model. READ-000 §5 requires the model identifier to be recorded next to
// every derived floor. `claude-opus-5` is the most capable vision model available at authoring
// time; when READ-005 first invokes the pinned oracle for real, whoever runs it should pin the
// dated snapshot that is current then and record it in each probe record's `modelId` field.
export const PINNED_MODEL_ID = 'claude-opus-5';

// Recorded as the modelId for stub-driven runs so a stubbed record can never be mistaken for a
// real recognition pass in the store.
export const STUB_MODEL_ID = 'stub-oracle';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * A deterministic oracle for tests and dry runs. `readingsByTileIndex` maps a tile index — either
 * the 1-based number or its label string ("01", "a", …) — to the string the oracle should return
 * for that tile. Missing tiles read as the empty string.
 *
 * The returned function carries a mutable `invocationCount` and `calls` log so a test can assert
 * the oracle was never called (the signal-A-fails-first contract).
 *
 * @param {Record<string|number, string>} [readingsByTileIndex]
 */
export function createStubOracle(readingsByTileIndex = {}) {
  async function stubOracle({ tileCount }) {
    if (!Number.isInteger(tileCount) || tileCount < 0) {
      throw new Error(`createStubOracle: tileCount must be a non-negative integer, got ${tileCount}`);
    }
    stubOracle.invocationCount += 1;
    stubOracle.calls.push({ tileCount });
    const rawReadings = [];
    for (let i = 1; i <= tileCount; i++) {
      const byNumber = readingsByTileIndex[i];
      const byLabel = readingsByTileIndex[String(i)] ?? readingsByTileIndex[String(i).padStart(2, '0')];
      rawReadings.push(byNumber ?? byLabel ?? '');
    }
    return { modelId: STUB_MODEL_ID, rawReadings };
  }
  stubOracle.invocationCount = 0;
  stubOracle.calls = [];
  return stubOracle;
}

/**
 * The real, pinned oracle. NOT invoked by READ-004. Uses raw HTTPS against the Messages API (this
 * repo has no Anthropic SDK dependency, by design). Reads `process.env.ANTHROPIC_API_KEY` unless an
 * explicit `apiKey` is passed. Never commit a key.
 *
 * @param {object} [options]
 * @param {string} [options.apiKey] defaults to process.env.ANTHROPIC_API_KEY
 * @param {string} [options.modelId] defaults to PINNED_MODEL_ID
 */
export function createPinnedOracle({ apiKey = process.env.ANTHROPIC_API_KEY, modelId = PINNED_MODEL_ID } = {}) {
  if (!apiKey) {
    throw new Error('createPinnedOracle: no API key (pass { apiKey } or set ANTHROPIC_API_KEY)');
  }

  return async function pinnedOracle({ pngPath, pngBuffer, tileCount }) {
    if (!Number.isInteger(tileCount) || tileCount < 1) {
      throw new Error(`createPinnedOracle: tileCount must be a positive integer, got ${tileCount}`);
    }
    const bytes = pngBuffer ?? (pngPath ? await readFile(pngPath) : null);
    if (!bytes) throw new Error('createPinnedOracle: neither pngBuffer nor pngPath was supplied');
    const base64 = Buffer.from(bytes).toString('base64');

    // The oracle is told the tile count and the label scheme, and NOTHING about the answers.
    const instruction =
      `This image is a grid of ${tileCount} numbered tiles. Each tile shows a single piece of text ` +
      `rendered as a pattern of round dots (rhinestones). Read each tile and report exactly what ` +
      `text you see, guessing your best if it is degraded. Reply with exactly ${tileCount} lines, ` +
      `one per tile, in the form "<label>\\t<text>" using the label printed on the tile. Output ` +
      `nothing else.`;

    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
            { type: 'text', text: instruction }
          ]
        }]
      })
    });
    if (!response.ok) {
      throw new Error(`createPinnedOracle: Messages API returned ${response.status} ${await response.text()}`);
    }
    const body = await response.json();
    const text = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

    // Parse "<label>\t<text>" lines in the order they appear; fall back to positional if a line
    // has no tab. The verbatim per-line text is what gets recorded — no normalisation here.
    const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.length > 0);
    const rawReadings = [];
    for (let i = 0; i < tileCount; i++) {
      const line = lines[i] ?? '';
      const tab = line.indexOf('\t');
      rawReadings.push(tab >= 0 ? line.slice(tab + 1) : line);
    }
    return { modelId, rawReadings };
  };
}
