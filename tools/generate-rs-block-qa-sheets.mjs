#!/usr/bin/env node
/**
 * Generates the 10 repository-local, gitignored QA sheets for RS Block (TXT-101B) -- see tmp/qa/.
 *
 * Every string is rendered through the real production pipeline (RhinestoneFontProvider ->
 * GeometryEngine.generateTextLayout -> StoneLayout), exactly as generateTextStonesLive() does for a
 * real text layer, at the family's own recommended SS10 (2.8mm) stone size and 0.3mm gap. This
 * script does not judge readability -- only a human looking at the output can (see the standard
 * workflow's browser-verification step). Unsupported characters (there should be none in this
 * content) render as an explicit red "UNSUPPORTED" placeholder rather than silently vanishing.
 *
 * Usage: node tools/generate-rs-block-qa-sheets.mjs [output-dir]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createDefaultRhinestoneFontRegistry,
  RhinestoneFontProvider
} from '../src/text/rhinestoneFont/index.js';
import {
  descriptor,
  PITCH_MM,
  CAP_TOP_ROW,
  DESCENDER_BOTTOM_ROW,
  TOTAL_HEIGHT_MM
} from '../src/text/rhinestoneFont/families/rsBlock.js';
import { GeometryEngine } from '../src/geometry/GeometryEngine.js';

const FONT_ID = 'rs-block';
const STONE_SIZE_MM = descriptor.recommendedStoneSizeMm;
const GAP_MM = descriptor.recommendedGapMm;
const HEIGHT_MM_UNUSED_PLACEHOLDER = 30; // Required by IFontProvider; unused (fixed-pitch font).
const PX_PER_MM = 8;

const registry = createDefaultRhinestoneFontRegistry();
const provider = new RhinestoneFontProvider({ registry });
const engine = new GeometryEngine({ fontProviderRegistry: { getTextPath: (o) => provider.getTextPath(o) } });
const supportedCharacters = new Set(registry.getMetadata(FONT_ID).supportedCharacters);

function stoneCircleSvg(xMm, yMm) {
  const r = (STONE_SIZE_MM / 2) * PX_PER_MM;
  return `<circle cx="${(xMm * PX_PER_MM).toFixed(1)}" cy="${(yMm * PX_PER_MM).toFixed(1)}" r="${r.toFixed(1)}" fill="#f3bd32" stroke="#5c4200" stroke-width="${(0.15 * PX_PER_MM).toFixed(1)}"/>`;
}

/** Renders one string, character-by-character, through the real production call per character
 * (so unsupported characters can be flagged individually), with kerning applied exactly the way
 * RhinestoneFontProvider.getTextPath() applies it for the family's reviewed pairs. */
async function renderCard(text, { label = null } = {}) {
  const padMm = 4;
  let penXMm = 0;
  let previousCharacter = null;
  const stoneParts = [];
  const overlayParts = [];
  const unsupported = [];
  const family = registry.get(FONT_ID);

  for (const character of Array.from(text)) {
    if (previousCharacter !== null && typeof family.getKerningAdjustmentMm === 'function') {
      penXMm += family.getKerningAdjustmentMm(previousCharacter, character);
    }

    if (supportedCharacters.has(character)) {
      const layout = await engine.generateTextLayout({
        text: character, fontId: FONT_ID, providerId: 'rhinestone', layerId: 'qa',
        heightMm: HEIGHT_MM_UNUSED_PLACEHOLDER, stoneSizeMm: STONE_SIZE_MM, gapMm: GAP_MM, mode: 'outline', color: 'gold'
      });
      for (const stone of layout.stones) {
        stoneParts.push(stoneCircleSvg(stone.xMm + penXMm + padMm, stone.yMm));
      }
      penXMm += family.getGlyphStoneMap(character).advanceWidthMm;
    } else {
      const advanceMm = 3.1 * 6;
      overlayParts.push(`
        <g>
          <rect x="${((penXMm + padMm) * PX_PER_MM).toFixed(1)}" y="0" width="${(advanceMm * 0.9 * PX_PER_MM).toFixed(1)}" height="${(TOTAL_HEIGHT_MM * PX_PER_MM).toFixed(1)}"
                fill="none" stroke="#e0464f" stroke-width="2" stroke-dasharray="6,4"/>
          <text x="${((penXMm + padMm + advanceMm * 0.45) * PX_PER_MM).toFixed(1)}" y="${(TOTAL_HEIGHT_MM * PX_PER_MM * 0.55).toFixed(1)}"
                fill="#e0464f" font-family="monospace" font-size="${(PX_PER_MM * 4).toFixed(1)}" text-anchor="middle">${character === ' ' ? '␣' : character}</text>
        </g>`);
      penXMm += advanceMm;
      unsupported.push(character);
    }
    previousCharacter = character;
  }

  const widthMm = penXMm + padMm * 2;
  const heightMm = TOTAL_HEIGHT_MM + padMm * 2;
  const bottomPadMm = padMm - DESCENDER_BOTTOM_ROW * PITCH_MM;
  const flippedStones = `<g transform="translate(0, ${(heightMm * PX_PER_MM).toFixed(1)}) scale(1,-1) translate(0, ${(bottomPadMm * PX_PER_MM).toFixed(1)})">${stoneParts.join('')}</g>`;

  const statusLine = unsupported.length > 0
    ? `<span class="unsupported-flag">UNSUPPORTED: ${unsupported.join(', ')}</span>`
    : '';

  return `
    <div class="word-card">
      <div class="word-label">"${label ?? text}" ${statusLine}</div>
      <svg width="${(widthMm * PX_PER_MM).toFixed(0)}" height="${(heightMm * PX_PER_MM).toFixed(0)}" viewBox="0 0 ${(widthMm * PX_PER_MM).toFixed(0)} ${(heightMm * PX_PER_MM).toFixed(0)}">
        <rect width="100%" height="100%" fill="#1c1c22"/>
        ${flippedStones}
        ${overlayParts.join('')}
      </svg>
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
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color:#555; font-size: 13px; margin-bottom: 24px; line-height:1.5; }
  .word-card { border:1px solid #ddd; border-radius:6px; padding:10px; margin-top:14px; background:#fafafa; display:inline-block; }
  .word-label { font-size: 13px; font-weight:600; margin-bottom: 6px; }
  .unsupported-flag { color:#c0202b; font-weight:700; margin-left: 10px; }
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
  <nav>
    <a href="./index.html">Index</a>
  </nav>
  ${bodyHtml}
</body>
</html>`;
}

const SHEETS = [
  {
    file: '01-complete-alphabet.html',
    title: '1. Complete alphabet',
    items: ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz']
  },
  {
    file: '02-digits.html',
    title: '2. Digits',
    items: ['0123456789', '0 1 l I', '5 S', 'O 0', 'B 8', 'C G', 'P R', 'M N']
  },
  {
    file: '03-punctuation.html',
    title: '3. Punctuation',
    items: ["Hello, world!", "Wait... really?", "Bride's Squad", 'Est. 2026', "Rock & Roll", 'A-Frame']
  },
  {
    file: '04-mixed-upper-lower.html',
    title: '4. Mixed upper/lower',
    items: ['Jennifer', 'Alexander', 'McKenzie', 'DeShawn', 'Rhinestone Studio', 'Sparkle Boutique']
  },
  {
    file: '05-kerning-pairs.html',
    title: '5. Kerning pairs',
    items: ['AV', 'VA', 'WA', 'AW', 'To', 'Yo', 'LA', 'LT', 'TT', 'TA', 'FA', 'PA', 'LY', 'RY']
  },
  {
    file: '06-typical-names.html',
    title: '6. Typical names',
    items: ['ALEX', 'Jennifer', 'Michael', 'Sarah', 'Christopher', 'Olivia']
  },
  {
    file: '07-sports-team-names.html',
    title: '7. Sports/team names',
    items: ['Panthers', 'Wildcats', 'RHINESTONE', 'Eagles', 'Warriors', 'Class of 2026']
  },
  {
    file: '08-wedding-phrases.html',
    title: '8. Wedding phrases',
    items: ['Wedding', 'Bride', 'Bride Squad', "Mr & Mrs", 'Just Married', 'Happily Ever After']
  },
  {
    file: '09-short-business-names.html',
    title: '9. Short business names',
    items: ['Sparkle Boutique', "Lucky's Diner", 'The Bead Shop', 'Bloom & Co', 'Crafted']
  },
  {
    file: '10-random-mixed-words.html',
    title: '10. Random mixed words',
    items: ['MINIMUM', 'MISSISSIPPI', 'BOOKKEEPER', 'zigzag', 'Quixotic', 'Fuzzy Wuzzy', '2026']
  }
];

async function main() {
  const outputDir = process.argv[2] || 'tmp/qa';
  await mkdir(outputDir, { recursive: true });

  const indexLinks = [];

  for (const sheet of SHEETS) {
    const cards = (await Promise.all(sheet.items.map((item) => renderCard(item)))).join('\n');
    const html = pageShell({ title: sheet.title, bodyHtml: `<h2>${sheet.title}</h2>${cards}` });
    await writeFile(path.join(outputDir, sheet.file), html, 'utf8');
    indexLinks.push(`<li><a href="./${sheet.file}">${sheet.title}</a></li>`);
    console.log(`Wrote ${path.join(outputDir, sheet.file)}`);
  }

  const indexHtml = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>RS Block QA -- Index</title>
<style>body{font-family:-apple-system,sans-serif;padding:24px;} li{margin-bottom:8px;font-size:14px;}</style>
</head>
<body>
  <h1>RS Block QA sheets (TXT-101B)</h1>
  <ul>${indexLinks.join('\n')}</ul>
</body>
</html>`;
  await writeFile(path.join(outputDir, 'index.html'), indexHtml, 'utf8');
  console.log(`Wrote ${path.join(outputDir, 'index.html')}`);
}

await main();
