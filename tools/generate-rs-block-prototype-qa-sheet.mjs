#!/usr/bin/env node
/**
 * Generates a static HTML QA sheet for RS Block Prototype (SS10) -- TXT-101A restart.
 *
 * Renders the 12 diagnostic glyphs (individually and side by side) and 6 test words through the
 * real production pipeline (RhinestoneFontProvider -> GeometryEngine.generateTextLayout ->
 * StoneLayout, the same call generateTextStonesLive() makes for a real layer), at the family's own
 * recommended SS10 (2.8mm) stone size and 0.3mm gap. This script does not judge readability --
 * only a human looking at the output can. It exists to put the real, unmodified production geometry
 * in front of a reviewer, not a mockup.
 *
 * Unsupported characters (everything outside A B C D G M N O P R S 8) are never silently rendered
 * as empty space or a malformed glyph: they show as an explicit red "UNSUPPORTED" placeholder box
 * with the missing character labeled, positioned inline at the same advance width a real glyph
 * would occupy, so a reviewer can see exactly which letters a full word is missing.
 *
 * Usage: node tools/generate-rs-block-prototype-qa-sheet.mjs [output-path.html]
 */
import { writeFile } from 'node:fs/promises';
import {
  createDefaultRhinestoneFontRegistry,
  RhinestoneFontProvider
} from '../src/text/rhinestoneFont/index.js';
import { getGlyphStoneMap, descriptor, ADVANCE_WIDTH_MM, CAP_HEIGHT_MM } from '../src/text/rhinestoneFont/families/rsBlockPrototypeSS10.js';
import { GeometryEngine } from '../src/geometry/GeometryEngine.js';

const FONT_ID = 'rs-block-prototype-ss10';
const STONE_SIZE_MM = descriptor.recommendedStoneSizeMm; // 2.8mm (SS10)
const GAP_MM = descriptor.recommendedGapMm; // 0.3mm
const HEIGHT_MM_UNUSED_PLACEHOLDER = 30; // Required by the IFontProvider contract; not applied (fixed-pitch font, see RhinestoneFontProvider.js).

const DIAGNOSTIC_GLYPHS = ['A', 'B', 'C', 'D', 'G', 'M', 'N', 'O', 'P', 'R', 'S', '8'];
const TEST_WORDS = ['ABCD', 'GROOM', 'MINIMUM', 'PERSON', 'RHINESTONE', '2026'];

const registry = createDefaultRhinestoneFontRegistry();
const provider = new RhinestoneFontProvider({ registry });
const engine = new GeometryEngine({ fontProviderRegistry: { getTextPath: (options) => provider.getTextPath(options) } });
const supportedCharacters = new Set(registry.getMetadata(FONT_ID).supportedCharacters);

const PX_PER_MM = 10; // Fixed render scale for the whole sheet -- makes every cell's stone-to-stone spacing visually comparable.

function stoneCircleSvg(xMm, yMm, label = '') {
  const r = (STONE_SIZE_MM / 2) * PX_PER_MM;
  return `<circle cx="${(xMm * PX_PER_MM).toFixed(1)}" cy="${(yMm * PX_PER_MM).toFixed(1)}" r="${r.toFixed(1)}" fill="#f3bd32" stroke="#5c4200" stroke-width="${(0.15 * PX_PER_MM).toFixed(1)}"><title>${label}</title></circle>`;
}

/**
 * Renders one glyph individually: a labeled card with its stone dots plus its authored 5x7 grid
 * overlay for cross-reference, generated through the real single-character production call.
 */
async function renderDiagnosticGlyphCard(character) {
  const layout = await engine.generateTextLayout({
    text: character, fontId: FONT_ID, providerId: 'rhinestone', layerId: 'qa',
    heightMm: HEIGHT_MM_UNUSED_PLACEHOLDER, stoneSizeMm: STONE_SIZE_MM, gapMm: GAP_MM, mode: 'outline', color: 'gold'
  });
  const padMm = 4;
  const widthMm = ADVANCE_WIDTH_MM;
  const heightMm = CAP_HEIGHT_MM + padMm * 2;
  const circles = layout.stones.map((s) => stoneCircleSvg(s.xMm + padMm, heightMm - (s.yMm + padMm), character)).join('');
  return `
    <div class="glyph-card">
      <div class="glyph-label">${character}</div>
      <svg width="${(widthMm * PX_PER_MM).toFixed(0)}" height="${(heightMm * PX_PER_MM).toFixed(0)}" viewBox="0 0 ${(widthMm * PX_PER_MM).toFixed(0)} ${(heightMm * PX_PER_MM).toFixed(0)}">
        <rect width="100%" height="100%" fill="#1c1c22"/>
        ${circles}
      </svg>
      <div class="glyph-meta">${layout.stones.length} stones &middot; advance ${ADVANCE_WIDTH_MM.toFixed(1)}mm</div>
    </div>`;
}

/** Renders all 12 diagnostic glyphs side by side as one continuous string, real pipeline output. */
async function renderSideBySideStrip() {
  const text = DIAGNOSTIC_GLYPHS.join('');
  const layout = await engine.generateTextLayout({
    text, fontId: FONT_ID, providerId: 'rhinestone', layerId: 'qa',
    heightMm: HEIGHT_MM_UNUSED_PLACEHOLDER, stoneSizeMm: STONE_SIZE_MM, gapMm: GAP_MM, mode: 'outline', color: 'gold'
  });
  const padMm = 4;
  const widthMm = ADVANCE_WIDTH_MM * DIAGNOSTIC_GLYPHS.length;
  const heightMm = CAP_HEIGHT_MM + padMm * 2;
  const circles = layout.stones.map((s) => stoneCircleSvg(s.xMm + padMm, heightMm - (s.yMm + padMm))).join('');
  return `
    <div class="strip-card">
      <svg width="${(widthMm * PX_PER_MM).toFixed(0)}" height="${(heightMm * PX_PER_MM).toFixed(0)}" viewBox="0 0 ${(widthMm * PX_PER_MM).toFixed(0)} ${(heightMm * PX_PER_MM).toFixed(0)}">
        <rect width="100%" height="100%" fill="#1c1c22"/>
        ${circles}
      </svg>
      <div class="glyph-meta">"${text}" &middot; ${layout.stones.length} stones</div>
    </div>`;
}

/**
 * Renders one test word character-by-character: supported characters go through the real
 * single-character production call (translated by a running pen position computed the same way
 * GeometryEngine's own pen walk does -- advanceWidthMm per character, no letter spacing);
 * unsupported characters render as an explicit labeled placeholder box at the same advance width,
 * never silently skipped or shown as a malformed glyph.
 */
async function renderTestWord(word) {
  const padMm = 4;
  let penXMm = 0;
  const stoneParts = [];
  // Rendered in plain (already y-down) SVG space, outside the stones' flip group below -- so the
  // "UNSUPPORTED" label text reads right-side up instead of mirrored by that flip.
  const overlayParts = [];
  const unsupportedInWord = [];

  for (const character of Array.from(word)) {
    if (supportedCharacters.has(character)) {
      const layout = await engine.generateTextLayout({
        text: character, fontId: FONT_ID, providerId: 'rhinestone', layerId: 'qa',
        heightMm: HEIGHT_MM_UNUSED_PLACEHOLDER, stoneSizeMm: STONE_SIZE_MM, gapMm: GAP_MM, mode: 'outline', color: 'gold'
      });
      for (const stone of layout.stones) {
        stoneParts.push(stoneCircleSvg(stone.xMm + penXMm + padMm, stone.yMm, character));
      }
      penXMm += ADVANCE_WIDTH_MM;
    } else {
      const boxX = penXMm + padMm;
      overlayParts.push(`
        <g>
          <rect x="${(boxX * PX_PER_MM).toFixed(1)}" y="0" width="${(ADVANCE_WIDTH_MM * 0.9 * PX_PER_MM).toFixed(1)}" height="${(CAP_HEIGHT_MM * PX_PER_MM).toFixed(1)}"
                fill="none" stroke="#e0464f" stroke-width="${(0.25 * PX_PER_MM).toFixed(1)}" stroke-dasharray="${(1.2 * PX_PER_MM).toFixed(1)},${(0.8 * PX_PER_MM).toFixed(1)}"/>
          <text x="${((boxX + ADVANCE_WIDTH_MM * 0.45) * PX_PER_MM).toFixed(1)}" y="${(CAP_HEIGHT_MM * PX_PER_MM * 0.58).toFixed(1)}"
                fill="#e0464f" font-family="monospace" font-size="${(PX_PER_MM * 5.5).toFixed(1)}" text-anchor="middle">${character === ' ' ? '␣' : character}</text>
        </g>`);
      penXMm += ADVANCE_WIDTH_MM;
      unsupportedInWord.push(character);
    }
  }

  const widthMm = penXMm + padMm * 2;
  const heightMm = CAP_HEIGHT_MM + padMm * 2;
  // Stones were computed in a "y grows up from baseline" space; flip once here for SVG's y-down
  // convention. The unsupported-box overlay (rect + text) is already authored directly in y-down
  // space, so it stays outside this flip.
  const flippedStones = `<g transform="translate(0, ${(heightMm * PX_PER_MM).toFixed(1)}) scale(1,-1) translate(0, ${(padMm * PX_PER_MM).toFixed(1)})">${stoneParts.join('')}</g>`;

  const statusLine = unsupportedInWord.length > 0
    ? `<span class="unsupported-flag">UNSUPPORTED: ${unsupportedInWord.join(', ')}</span>`
    : '<span class="supported-flag">all characters supported</span>';

  return `
    <div class="word-card">
      <div class="word-label">"${word}" ${statusLine}</div>
      <svg width="${(widthMm * PX_PER_MM).toFixed(0)}" height="${(heightMm * PX_PER_MM).toFixed(0)}" viewBox="0 0 ${(widthMm * PX_PER_MM).toFixed(0)} ${(heightMm * PX_PER_MM).toFixed(0)}">
        <rect width="100%" height="100%" fill="#1c1c22"/>
        ${flippedStones}
        ${overlayParts.join('')}
      </svg>
    </div>`;
}

async function main() {
  const outputPath = process.argv[2] || 'rs-block-prototype-qa-sheet.html';

  const glyphCards = (await Promise.all(DIAGNOSTIC_GLYPHS.map(renderDiagnosticGlyphCard))).join('\n');
  const strip = await renderSideBySideStrip();
  const wordCards = (await Promise.all(TEST_WORDS.map(renderTestWord))).join('\n');

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>RS Block Prototype (SS10) -- QA Sheet</title>
<style>
  body { background:#fff; font-family: -apple-system, sans-serif; color:#1a1a1a; padding: 24px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color:#555; font-size: 13px; margin-bottom: 24px; line-height:1.5; }
  h2 { font-size: 15px; margin-top: 36px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
  .glyph-grid { display:flex; flex-wrap:wrap; gap: 14px; margin-top: 14px; }
  .glyph-card { border:1px solid #ddd; border-radius: 6px; padding: 8px; text-align:center; background:#fafafa; }
  .glyph-label { font-weight:700; font-size: 14px; margin-bottom: 4px; }
  .glyph-meta { font-size: 11px; color:#777; margin-top: 4px; }
  .strip-card { border:1px solid #ddd; border-radius:6px; padding:10px; display:inline-block; margin-top:12px; background:#fafafa; }
  .word-card { border:1px solid #ddd; border-radius:6px; padding:10px; margin-top:14px; background:#fafafa; }
  .word-label { font-size: 13px; font-weight:600; margin-bottom: 6px; }
  .unsupported-flag { color:#c0202b; font-weight:700; margin-left: 10px; }
  .supported-flag { color:#1c7a3c; font-weight:600; margin-left: 10px; }
  svg { display:block; }
</style>
</head>
<body>
  <h1>RS Block Prototype (SS10) &mdash; QA Sheet</h1>
  <div class="meta">
    Diagnostic-only. Rendered through the real production pipeline (RhinestoneFontProvider &rarr; GeometryEngine.generateTextLayout &rarr; StoneLayout), not a mockup.<br>
    Stone size: SS10 (${STONE_SIZE_MM}mm) &middot; Gap: ${GAP_MM}mm &middot; Pitch: ${(STONE_SIZE_MM + GAP_MM).toFixed(1)}mm &middot; Fill mode: Outline<br>
    Supported characters: ${DIAGNOSTIC_GLYPHS.join(' ')} (12 total &mdash; no lowercase, no other digits/punctuation, no adaptive scaling to other stone sizes/heights).<br>
    Generated ${new Date().toISOString()}
  </div>

  <h2>12 diagnostic glyphs, individually</h2>
  <div class="glyph-grid">
    ${glyphCards}
  </div>

  <h2>12 diagnostic glyphs, side by side</h2>
  ${strip}

  <h2>Test words (unsupported characters clearly marked, never silently substituted)</h2>
  ${wordCards}
</body>
</html>`;

  await writeFile(outputPath, html, 'utf8');
  console.log(`QA sheet written to ${outputPath}`);
}

await main();
