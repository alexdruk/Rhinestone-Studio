/**
 * Shared QA-sheet rendering kit for authored rhinestone font families (FONT-002, Part 3).
 *
 * Extracted from RS Block's original generator (tools/generate-rs-block-qa-sheets.mjs, TXT-101B) so
 * a second family (RS Modern) doesn't need to duplicate the word-card/glyph-card SVG rendering, page
 * shell, static-server, and Playwright screenshot pipeline -- only the family-specific wiring
 * (fontId, descriptor, vertical metrics, content corpus) differs, and that's supplied by the caller.
 * Every string is still rendered through one real generateTextLayout() call (RhinestoneFontProvider
 * -> GeometryEngine -> StoneLayout), exactly as generateTextStonesLive() does for a real text layer,
 * kerning included -- this kit renders, it never judges readability (that's the browser-verification
 * step of whichever milestone calls it).
 *
 * @param {object} options
 * @param {string} options.fontId Rhinestone font family id (e.g. 'rs-block', 'rs-modern').
 * @param {string} options.displayName Family display name, used in page titles/headings.
 * @param {object} options.descriptor Family descriptor (recommendedStoneSizeMm/recommendedGapMm).
 * @param {number} options.capHeightMm Family's CAP_HEIGHT_MM constant.
 * @param {number} options.totalHeightMm Family's TOTAL_HEIGHT_MM constant.
 * @param {import('../src/text/rhinestoneFont/RhinestoneFontRegistry.js').RhinestoneFontRegistry} options.registry
 * @param {{file:string,title:string,words:string[],glyphGrid:string[]|null}[]} options.sheets
 * @param {string} options.profileDir Playwright persistent-profile directory (must differ per family
 *   so concurrent/repeated runs never collide).
 */
export function createRhinestoneFontQaRunner({ fontId, displayName, descriptor, capHeightMm, totalHeightMm, registry, sheets, profileDir }) {
  const STONE_SIZE_MM = descriptor.recommendedStoneSizeMm;
  const GAP_MM = descriptor.recommendedGapMm;
  const HEIGHT_MM_UNUSED_PLACEHOLDER = 30; // Required by IFontProvider; unused (fixed-pitch font).
  const PX_PER_MM_WORD = 3;
  const PX_PER_MM_GLYPH = 14;

  return async function run({ RhinestoneFontProvider, GeometryEngine, mkdir, writeFile, path, chromium }) {
    const provider = new RhinestoneFontProvider({ registry });
    const engine = new GeometryEngine({
      fontProviderRegistry: {
        getTextPath: (o) => provider.getTextPath(o),
        getKerningAdjustmentMm: (o) => provider.getKerningAdjustmentMm(o.fontId, o.prevChar, o.nextChar)
      }
    });
    const supportedCharacters = new Set(registry.getMetadata(fontId).supportedCharacters);
    const family = registry.get(fontId);

    function stoneCircleSvg(xMm, yMm, pxPerMm) {
      const r = (STONE_SIZE_MM / 2) * pxPerMm;
      return `<circle cx="${(xMm * pxPerMm).toFixed(1)}" cy="${(yMm * pxPerMm).toFixed(1)}" r="${r.toFixed(1)}" fill="#f3bd32" stroke="#5c4200" stroke-width="${(0.15 * pxPerMm).toFixed(1)}"/>`;
    }

    async function renderWordCard(text) {
      const pxPerMm = PX_PER_MM_WORD;
      const padMm = 4;
      const unsupported = Array.from(text).filter((c) => !supportedCharacters.has(c));

      const layout = await engine.generateTextLayout({
        text, fontId, providerId: 'rhinestone', layerId: 'qa',
        heightMm: HEIGHT_MM_UNUSED_PLACEHOLDER, stoneSizeMm: STONE_SIZE_MM, gapMm: GAP_MM, mode: 'outline', color: 'gold'
      });
      const baselineOffsetMm = capHeightMm + padMm;
      const stoneParts = layout.stones.map((s) => stoneCircleSvg(s.xMm + padMm, baselineOffsetMm + s.yMm, pxPerMm));
      const maxXmm = layout.stones.length > 0 ? Math.max(...layout.stones.map((s) => s.xMm)) : 0;

      const widthMm = maxXmm + padMm * 2;
      const heightMm = totalHeightMm + padMm * 2;

      const statusLine = unsupported.length > 0
        ? `<span class="unsupported-flag">UNSUPPORTED: ${unsupported.join(', ')}</span>`
        : '';

      return `
    <div class="word-card">
      <div class="word-label">"${text}" ${statusLine}</div>
      <svg width="${(widthMm * pxPerMm).toFixed(0)}" height="${(heightMm * pxPerMm).toFixed(0)}" viewBox="0 0 ${(widthMm * pxPerMm).toFixed(0)} ${(heightMm * pxPerMm).toFixed(0)}">
        <rect width="100%" height="100%" fill="#1c1c22"/>
        ${stoneParts.join('')}
      </svg>
    </div>`;
    }

    async function renderGlyphCard(character) {
      const pxPerMm = PX_PER_MM_GLYPH;
      const layout = await engine.generateTextLayout({
        text: character, fontId, providerId: 'rhinestone', layerId: 'qa',
        heightMm: HEIGHT_MM_UNUSED_PLACEHOLDER, stoneSizeMm: STONE_SIZE_MM, gapMm: GAP_MM, mode: 'outline', color: 'gold'
      });
      const padMm = 3;
      const glyph = family.getGlyphStoneMap(character);
      const widthMm = glyph.advanceWidthMm;
      const heightMm = totalHeightMm + padMm * 2;
      const baselineOffsetMm = capHeightMm + padMm;
      const circles = layout.stones.map((s) => stoneCircleSvg(s.xMm + padMm, baselineOffsetMm + s.yMm, pxPerMm)).join('');
      return `
    <div class="glyph-card">
      <div class="glyph-label">${character === ' ' ? '␣' : character}</div>
      <svg width="${(widthMm * pxPerMm).toFixed(0)}" height="${(heightMm * pxPerMm).toFixed(0)}" viewBox="0 0 ${(widthMm * pxPerMm).toFixed(0)} ${(heightMm * pxPerMm).toFixed(0)}">
        <rect width="100%" height="100%" fill="#1c1c22"/>
        ${circles}
      </svg>
      <div class="glyph-meta">${layout.stones.length} stones</div>
    </div>`;
    }

    function pageShell({ title, bodyHtml }) {
      return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${displayName} QA -- ${title}</title>
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
  <h1>${displayName} &mdash; ${title}</h1>
  <div class="meta">
    Rendered through the real production pipeline (RhinestoneFontProvider &rarr; GeometryEngine.generateTextLayout &rarr; StoneLayout), not a mockup.<br>
    Stone size: ${STONE_SIZE_MM}mm &middot; Gap: ${GAP_MM}mm &middot; Fill mode: Outline (fill-mode independent)<br>
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

    const outputDir = process.argv[2] || 'tmp/qa';
    const onlyFiles = process.argv[3] ? new Set(process.argv[3].split(',').map((s) => s.trim())) : null;
    const sheetsToRender = onlyFiles ? sheets.filter((s) => onlyFiles.has(s.file)) : sheets;
    await mkdir(outputDir, { recursive: true });

    const indexLinks = sheets.map((sheet) => `<li><a href="./${sheet.file}.html">${sheet.title}</a></li>`);
    const htmlFiles = [];

    for (const sheet of sheetsToRender) {
      const html = await renderSheetHtml(sheet);
      const htmlPath = path.join(outputDir, `${sheet.file}.html`);
      await writeFile(htmlPath, html, 'utf8');
      htmlFiles.push({ file: sheet.file, path: htmlPath });
      console.log(`Wrote ${htmlPath}`);
    }

    const indexHtml = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${displayName} QA -- Index</title>
<style>body{font-family:-apple-system,sans-serif;padding:24px;} li{margin-bottom:8px;font-size:14px;}</style>
</head>
<body>
  <h1>${displayName} visual acceptance package</h1>
  <ul>${indexLinks.join('\n')}</ul>
</body>
</html>`;
    await writeFile(path.join(outputDir, 'index.html'), indexHtml, 'utf8');
    console.log(`Wrote ${path.join(outputDir, 'index.html')}`);

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

    const browser = await chromium.launchPersistentContext(profileDir, {
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
  };
}
