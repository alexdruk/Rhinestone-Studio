#!/usr/bin/env node
/**
 * Generates RS Block's pre-merge visual acceptance package (TXT-101B) -- 12 numbered QA sheets plus
 * an index, each as both HTML and a high-resolution PNG, written to the repository-local gitignored
 * tmp/qa/. Content is the shared corpus in tools/rsBlockQaCorpus.mjs (also used by the automated
 * corpus-wide checks in tools/test-rs-block.mjs, so sheet content and test coverage never drift).
 *
 * Every string is rendered through one real generateTextLayout() call (RhinestoneFontProvider ->
 * GeometryEngine -> StoneLayout), exactly as generateTextStonesLive() does for a real text layer, at
 * the family's own recommended SS10 (2.8mm) stone size and 0.3mm gap -- kerning included, applied by
 * GeometryEngine itself between characters (see FontProviderRegistry.getKerningAdjustmentMm()'s
 * module doc). This script does not judge readability -- only a human looking at the PNGs can (see
 * the standard workflow's browser-verification step). Unsupported characters (there should be none
 * in this corpus -- see tools/test-rs-block.mjs test 27) are flagged in the card label.
 *
 * Usage: node tools/generate-rs-block-qa-sheets.mjs [output-dir]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  createDefaultRhinestoneFontRegistry,
  RhinestoneFontProvider
} from '../src/text/rhinestoneFont/index.js';
import {
  descriptor,
  PITCH_MM,
  DESCENDER_BOTTOM_ROW,
  TOTAL_HEIGHT_MM
} from '../src/text/rhinestoneFont/families/rsBlock.js';
import { GeometryEngine } from '../src/geometry/GeometryEngine.js';
import { SHEETS } from './rsBlockQaCorpus.mjs';

const FONT_ID = 'rs-block';
const STONE_SIZE_MM = descriptor.recommendedStoneSizeMm;
const GAP_MM = descriptor.recommendedGapMm;
const HEIGHT_MM_UNUSED_PLACEHOLDER = 30; // Required by IFontProvider; unused (fixed-pitch font).
// Word cards use a smaller render scale than glyph cards -- some corpus phrases are 20+ characters
// long (e.g. "Best Friends Forever!"), and at a large px/mm scale a single card would be wider than
// any reasonable viewport, defeating flex-wrap packing and blowing past Chromium's screenshot pixel
// limit for the 126-phrase sheet. Glyph cards are always exactly one character, so they use a much
// higher scale for close-up detail inspection without any of that risk. Both are made "high
// resolution" in the PNG via deviceScaleFactor below, independent of this layout-scale choice.
const PX_PER_MM_WORD = 3;
const PX_PER_MM_GLYPH = 14;

const registry = createDefaultRhinestoneFontRegistry();
const provider = new RhinestoneFontProvider({ registry });
// Mirrors the real FontProviderRegistry's two delegated methods (see FontProviderRegistry.js) --
// including getKerningAdjustmentMm here is required for kerning to actually apply: an earlier
// version of this generator manually replicated the family's kerning table in its own per-character
// loop, which visually looked correct but masked a real bug (kerning was dead code in the actual
// GeometryEngine pipeline -- see tools/test-rs-block.mjs test 28's discovery and
// RhinestoneFontProvider.js's module doc for the fix). Rendering through the same call shape the
// real app uses is the whole point of this script.
const engine = new GeometryEngine({
  fontProviderRegistry: {
    getTextPath: (o) => provider.getTextPath(o),
    getKerningAdjustmentMm: (o) => provider.getKerningAdjustmentMm(o.fontId, o.prevChar, o.nextChar)
  }
});
const supportedCharacters = new Set(registry.getMetadata(FONT_ID).supportedCharacters);
const family = registry.get(FONT_ID);

function stoneCircleSvg(xMm, yMm, pxPerMm) {
  const r = (STONE_SIZE_MM / 2) * pxPerMm;
  return `<circle cx="${(xMm * pxPerMm).toFixed(1)}" cy="${(yMm * pxPerMm).toFixed(1)}" r="${r.toFixed(1)}" fill="#f3bd32" stroke="#5c4200" stroke-width="${(0.15 * pxPerMm).toFixed(1)}"/>`;
}

/** Renders one string with a single real generateTextLayout() call -- the exact same call shape
 * generateTextStonesLive() makes for a real text layer, kerning included. Unsupported characters
 * (there should be none in this corpus -- see tools/test-rs-block.mjs test 27) are flagged in the
 * label rather than positioned individually, since GeometryEngine already silently advances the pen
 * past them without producing stones. */
async function renderWordCard(text) {
  const pxPerMm = PX_PER_MM_WORD;
  const padMm = 4;
  const unsupported = Array.from(text).filter((c) => !supportedCharacters.has(c));

  const layout = await engine.generateTextLayout({
    text, fontId: FONT_ID, providerId: 'rhinestone', layerId: 'qa',
    heightMm: HEIGHT_MM_UNUSED_PLACEHOLDER, stoneSizeMm: STONE_SIZE_MM, gapMm: GAP_MM, mode: 'outline', color: 'gold'
  });
  const stoneParts = layout.stones.map((s) => stoneCircleSvg(s.xMm + padMm, s.yMm, pxPerMm));
  const maxXmm = layout.stones.length > 0 ? Math.max(...layout.stones.map((s) => s.xMm)) : 0;

  const widthMm = maxXmm + padMm * 2;
  const heightMm = TOTAL_HEIGHT_MM + padMm * 2;
  const bottomPadMm = padMm - DESCENDER_BOTTOM_ROW * PITCH_MM;
  const flippedStones = `<g transform="translate(0, ${(heightMm * pxPerMm).toFixed(1)}) scale(1,-1) translate(0, ${(bottomPadMm * pxPerMm).toFixed(1)})">${stoneParts.join('')}</g>`;

  const statusLine = unsupported.length > 0
    ? `<span class="unsupported-flag">UNSUPPORTED: ${unsupported.join(', ')}</span>`
    : '';

  return `
    <div class="word-card">
      <div class="word-label">"${text}" ${statusLine}</div>
      <svg width="${(widthMm * pxPerMm).toFixed(0)}" height="${(heightMm * pxPerMm).toFixed(0)}" viewBox="0 0 ${(widthMm * pxPerMm).toFixed(0)} ${(heightMm * pxPerMm).toFixed(0)}">
        <rect width="100%" height="100%" fill="#1c1c22"/>
        ${flippedStones}
      </svg>
    </div>`;
}

/** Renders one glyph individually, with a fixed frame spanning the family's full ascender-to-
 * descender range, for per-glyph detail inspection (uppercase/lowercase/digit sheets). */
async function renderGlyphCard(character) {
  const pxPerMm = PX_PER_MM_GLYPH;
  const layout = await engine.generateTextLayout({
    text: character, fontId: FONT_ID, providerId: 'rhinestone', layerId: 'qa',
    heightMm: HEIGHT_MM_UNUSED_PLACEHOLDER, stoneSizeMm: STONE_SIZE_MM, gapMm: GAP_MM, mode: 'outline', color: 'gold'
  });
  const padMm = 3;
  const glyph = family.getGlyphStoneMap(character);
  const widthMm = glyph.advanceWidthMm;
  const heightMm = TOTAL_HEIGHT_MM + padMm * 2;
  const bottomPadMm = padMm - DESCENDER_BOTTOM_ROW * PITCH_MM;
  const circles = layout.stones.map((s) => stoneCircleSvg(s.xMm + padMm, s.yMm, pxPerMm)).join('');
  const flipped = `<g transform="translate(0, ${(heightMm * pxPerMm).toFixed(1)}) scale(1,-1) translate(0, ${(bottomPadMm * pxPerMm).toFixed(1)})">${circles}</g>`;
  return `
    <div class="glyph-card">
      <div class="glyph-label">${character === ' ' ? '␣' : character}</div>
      <svg width="${(widthMm * pxPerMm).toFixed(0)}" height="${(heightMm * pxPerMm).toFixed(0)}" viewBox="0 0 ${(widthMm * pxPerMm).toFixed(0)} ${(heightMm * pxPerMm).toFixed(0)}">
        <rect width="100%" height="100%" fill="#1c1c22"/>
        ${flipped}
      </svg>
      <div class="glyph-meta">${layout.stones.length} stones</div>
    </div>`;
}

function pageShell({ title, bodyHtml }) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>RS Block QA -- ${title}</title>
<style>
  body { background:#fff; font-family: -apple-system, sans-serif; color:#1a1a1a; padding: 24px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .meta { color:#555; font-size: 13px; margin-bottom: 24px; line-height:1.5; }
  h2 { font-size: 16px; margin-top: 28px; }
  .word-grid { display:flex; flex-wrap:wrap; gap: 12px; margin-top: 12px; align-items:flex-start; }
  .word-card { border:1px solid #ddd; border-radius:6px; padding:10px; background:#fafafa; }
  .word-label { font-size: 13px; font-weight:600; margin-bottom: 6px; }
  .unsupported-flag { color:#c0202b; font-weight:700; margin-left: 10px; }
  .glyph-grid { display:flex; flex-wrap:wrap; gap: 12px; margin-top: 12px; }
  .glyph-card { border:1px solid #ddd; border-radius: 6px; padding: 6px; text-align:center; background:#fafafa; }
  .glyph-label { font-weight:700; font-size: 14px; margin-bottom: 4px; }
  .glyph-meta { font-size: 10px; color:#777; margin-top: 4px; }
  svg { display:block; }
  nav { margin-bottom: 20px; font-size: 13px; }
  nav a { margin-right: 12px; }
</style>
</head>
<body>
  <h1>RS Block &mdash; ${title}</h1>
  <div class="meta">
    Rendered through the real production pipeline (RhinestoneFontProvider &rarr; GeometryEngine.generateTextLayout &rarr; StoneLayout), not a mockup.<br>
    Stone size: SS10 (${STONE_SIZE_MM}mm) &middot; Gap: ${GAP_MM}mm &middot; Fill mode: Outline (fill-mode independent)<br>
    Generated ${new Date().toISOString()}
  </div>
  <nav><a href="./index.html">Index</a></nav>
  ${bodyHtml}
</body>
</html>`;
}

async function renderSheetHtml(sheet) {
  const wordCards = (await Promise.all(sheet.words.map((w) => renderWordCard(w)))).join('\n');
  let glyphGridHtml = '';
  if (sheet.glyphGrid) {
    const glyphCards = (await Promise.all(sheet.glyphGrid.map((c) => renderGlyphCard(c)))).join('\n');
    glyphGridHtml = `<h2>Individual glyphs</h2><div class="glyph-grid">${glyphCards}</div>`;
  }
  return pageShell({ title: sheet.title, bodyHtml: `<h2>${sheet.title}</h2><div class="word-grid">${wordCards}</div>${glyphGridHtml}` });
}

async function main() {
  const outputDir = process.argv[2] || 'tmp/qa';
  await mkdir(outputDir, { recursive: true });

  const indexLinks = [];
  const htmlFiles = [];

  for (const sheet of SHEETS) {
    const html = await renderSheetHtml(sheet);
    const htmlPath = path.join(outputDir, `${sheet.file}.html`);
    await writeFile(htmlPath, html, 'utf8');
    htmlFiles.push({ file: sheet.file, path: htmlPath });
    indexLinks.push(`<li><a href="./${sheet.file}.html">${sheet.title}</a></li>`);
    console.log(`Wrote ${htmlPath}`);
  }

  const indexHtml = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>RS Block QA -- Index (TXT-101B)</title>
<style>body{font-family:-apple-system,sans-serif;padding:24px;} li{margin-bottom:8px;font-size:14px;}</style>
</head>
<body>
  <h1>RS Block pre-merge visual acceptance package (TXT-101B)</h1>
  <ul>${indexLinks.join('\n')}</ul>
</body>
</html>`;
  await writeFile(path.join(outputDir, 'index.html'), indexHtml, 'utf8');
  console.log(`Wrote ${path.join(outputDir, 'index.html')}`);

  // High-resolution PNGs, one per sheet, via a headless Playwright pass over the just-written HTML
  // files (deviceScaleFactor 2 on top of the already-high PX_PER_MM render scale above).
  const server = await import('node:http').then((http) => new Promise((resolve) => {
    const staticServer = http.createServer(async (req, res) => {
      try {
        const { readFile } = await import('node:fs/promises');
        const filePath = path.join(outputDir, decodeURIComponent(req.url.replace(/^\//, '')) || 'index.html');
        const body = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    staticServer.listen(0, '127.0.0.1', () => resolve(staticServer));
  }));
  const port = server.address().port;

  const browser = await chromium.launchPersistentContext('/tmp/rs-block-qa-profile', {
    headless: true,
    deviceScaleFactor: 2,
    viewport: { width: 1800, height: 1000 }
  });
  const page = await browser.newPage();
  for (const { file } of htmlFiles) {
    await page.goto(`http://127.0.0.1:${port}/${file}.html`, { waitUntil: 'networkidle' });
    const pngPath = path.join(outputDir, `${file}.png`);
    await page.screenshot({ path: pngPath, fullPage: true });
    console.log(`Wrote ${pngPath}`);
  }
  await browser.close();
  server.close();
}

await main();
