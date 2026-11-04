import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-3042 — exporter fixes and EPS/AI. Verifies:
//   - the inch production sheet prints the gap in mm with the inch value after it, and the mm
//     sheet's Gap line is unchanged;
//   - stoneLayoutToEps(): EPSF-3.0 header, bounding boxes equal to the design size in points, one
//     circle per stone at the y-flipped position, stones grouped by colour in the catalogue fill;
//   - stoneLayoutToAi(): a one-page PDF (design + 5 mm on every side) with one circle per stone,
//     checked the way tools/test-pdf-document.mjs and tools/test-rs-3041-multi-page.mjs check PDFs;
//   - all of that on a real multi-colour layout (examples/multi-color-mixed-layers.rhs through
//     GeometryEngine), a mixed-size multi-colour layout, and a Black & white (Jet and Crystal)
//     layout;
//   - both exporters read the StoneLayout only and leave it unchanged; app.js and index.html wire
//     both buttons next to DXF.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const { stoneLayoutToEps } = await import('../src/export/EpsExporter.js');
const { stoneLayoutToAi, AI_MARGIN_MM } = await import('../src/export/AiExporter.js');
const { PT_PER_MM } = await import('../src/export/PdfDocument.js');
const { computeProductionSheetLayout, computeProductionSheetDocument, productionSheetToPdf } = await import('../src/export/ProductionSheetExporter.js');
const { StoneLayout } = await import('../src/geometry/StoneLayout.js');
const { STONE_COLORS } = await import('../src/renderer/StoneColors.js');
const { FontManager } = await import('../src/fonts/index.js');
const { createDefaultFontProviderRegistry } = await import('../src/text/index.js');
const { GeometryEngine } = await import('../src/geometry/index.js');
const { validateRhsProject, generateProjectStoneLayout } = await import('./lib/rhsProject.mjs');

const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const epsSource = await readFile(path.join(repoRoot, 'src/export/EpsExporter.js'), 'utf8');
const aiSource = await readFile(path.join(repoRoot, 'src/export/AiExporter.js'), 'utf8');

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

// --- fixtures ------------------------------------------------------------------------------------

// Colours interleaved row by row, so grouping by colour is a real reordering; sizes mixed; the
// design starts away from the origin, so the exporters must shift it to the footprint box.
function mixedColourLayout() {
  const colours = ['siam', 'sapphire', 'gold', 'emerald', 'jet'];
  const sizes = [2, 2.8, 4];
  const stones = [];
  for (let row = 0; row < 12; row += 1) {
    for (let col = 0; col < 18; col += 1) {
      stones.push({
        layerId: 'project', xMm: 23.5 + col * 4.4 + (row % 2) * 2.2, yMm: 41.25 + row * 3.9,
        sizeMm: sizes[(row + col) % 3], color: colours[(row * 7 + col) % colours.length]
      });
    }
  }
  return new StoneLayout({ layerId: 'project', stones });
}

// A Black & white layout as the service's bw mode gives it: Jet and Crystal only, mixed sizes.
function blackWhiteLayout() {
  const stones = [];
  for (let row = 0; row < 20; row += 1) {
    for (let col = 0; col < 25; col += 1) {
      const dark = Math.hypot(col - 12, row - 10) < 6 || (row + col) % 5 === 0;
      stones.push({
        layerId: 'project', xMm: 8 + col * 3.1 + (row % 2) * 1.55, yMm: 12 + row * 2.7,
        sizeMm: row % 4 === 0 ? 2.8 : 2.4, color: dark ? 'jet' : 'crystal-clear'
      });
    }
  }
  return new StoneLayout({ layerId: 'project', stones });
}

async function realMultiColourLayout() {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
  const fontManager = new FontManager(manifest);
  async function loadFontBufferFromRepoRoot(relativePath) {
    const buffer = await readFile(path.join(repoRoot, relativePath));
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const engine = new GeometryEngine({ fontProviderRegistry: createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot }) });
  const raw = JSON.parse(await readFile(path.join(repoRoot, 'examples/multi-color-mixed-layers.rhs'), 'utf8'));
  return generateProjectStoneLayout(validateRhsProject(raw, 'multi-color-mixed-layers.rhs'), engine);
}

const LAYOUTS = [
  ['multi-colour (examples/multi-color-mixed-layers.rhs)', await realMultiColourLayout()],
  ['multi-colour, mixed sizes', mixedColourLayout()],
  ['Black & white', blackWhiteLayout()]
];

const round3 = (v) => Math.round(v * 1000) / 1000;
const round4 = (v) => Math.round(v * 10000) / 10000;
const fillRgb = (id) => [0, 2, 4].map((i) => parseInt(STONE_COLORS[id].fill.slice(1 + i, 3 + i), 16) / 255);

// Stones in the order the exporter must write them: grouped by colour in first-appearance order.
function groupedByColour(layout) {
  const groups = new Map();
  for (const stone of layout.stones) {
    if (!groups.has(stone.color)) groups.set(stone.color, []);
    groups.get(stone.color).push(stone);
  }
  return groups;
}

function parseEps(text) {
  const lines = text.split('\n');
  const header = Object.fromEntries(lines.filter((l) => /^%%\w+:/.test(l)).map((l) => [l.slice(2, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
  const groups = [];
  for (const line of lines) {
    const colour = line.match(/^([\d.]+) ([\d.]+) ([\d.]+) setrgbcolor$/);
    if (colour) groups.push({ rgb: colour.slice(1).map(Number), circles: [] });
    const circle = line.match(/^(-?[\d.]+) (-?[\d.]+) ([\d.]+) C$/);
    if (circle) groups[groups.length - 1].circles.push(circle.slice(1).map(Number));
  }
  return { lines, header, groups };
}

// --- 1. inch production sheet Gap line ------------------------------------------------------------

const SHEET_OPTIONS = {
  projectName: 'RS-3042', objectType: 'Mug', productionWidthMm: 100, productionHeightMm: 80,
  pageSize: 'Letter', marginMm: 10, mirror: false, registrationMarks: true
};
const gapLine = (sheet) => sheet.headerLines.map((l) => l.text).find((t) => t.startsWith('Gap:'));

await test('1. the inch sheet prints the gap in mm with the inch value after it; it never rounds to 0', () => {
  const layout = blackWhiteLayout();
  assert.equal(gapLine(computeProductionSheetLayout(layout, { ...SHEET_OPTIONS, gapMm: [0.1], units: 'in' })), 'Gap: 0.1 mm (0.004 in)');
  assert.equal(gapLine(computeProductionSheetLayout(layout, { ...SHEET_OPTIONS, gapMm: [0.1, 0.3], units: 'in' })), 'Gap: 0.1, 0.3 mm (0.004, 0.012 in)');
  assert.equal(gapLine(computeProductionSheetLayout(layout, { ...SHEET_OPTIONS, gapMm: [], units: 'in' })), 'Gap: —');
  const pdf = Buffer.from(productionSheetToPdf(layout, { ...SHEET_OPTIONS, gapMm: [0.1], units: 'in' })).toString('latin1');
  assert.ok(pdf.includes('(Gap: 0.1 mm \\(0.004 in\\)) Tj'), 'the PDF prints the same line');
  assert.ok(!pdf.includes('(Gap: 0 in) Tj'));
});

await test('2. the multi-page inch sheet\'s cover prints the same Gap line', () => {
  const doc = computeProductionSheetDocument(mixedColourLayout(), { ...SHEET_OPTIONS, productionWidthMm: 300, productionHeightMm: 300, gapMm: [0.1], units: 'in' });
  assert.equal(doc.multiPage, true);
  const pdf = Buffer.from(productionSheetToPdf(mixedColourLayout(), { ...SHEET_OPTIONS, productionWidthMm: 300, productionHeightMm: 300, gapMm: [0.1], units: 'in' })).toString('latin1');
  assert.ok(pdf.includes('(Gap: 0.1 mm \\(0.004 in\\)) Tj'));
});

await test('3. the mm sheet\'s Gap line is unchanged', () => {
  const layout = blackWhiteLayout();
  assert.equal(gapLine(computeProductionSheetLayout(layout, { ...SHEET_OPTIONS, gapMm: [0.1], units: 'mm' })), 'Gap: 0.1 mm');
  assert.equal(gapLine(computeProductionSheetLayout(layout, { ...SHEET_OPTIONS, gapMm: [0.1, 0.3] })), 'Gap: 0.1, 0.3 mm');
  assert.equal(gapLine(computeProductionSheetLayout(layout, { ...SHEET_OPTIONS, gapMm: [], units: 'mm' })), 'Gap: —');
});

// --- 4-8. EPS --------------------------------------------------------------------------------------

for (const [label, layout] of LAYOUTS) {
  await test(`4. EPS (${label}): EPSF-3.0 header, Creator, one page, ASCII only, ends with %%EOF`, () => {
    const eps = stoneLayoutToEps(layout, { title: 'Mugs – “Ané”' });
    const { lines, header } = parseEps(eps);
    assert.equal(lines[0], '%!PS-Adobe-3.0 EPSF-3.0');
    assert.equal(header.Creator, 'Rhinestone Studio');
    assert.equal(header.Title, 'Mugs ? ?An??');
    assert.equal(header.Pages, '1');
    assert.ok(eps.endsWith('%%EOF\n'));
    assert.match(eps, /^[\x0a\x20-\x7e]*$/, 'printable ASCII and newlines only');
  });

  await test(`5. EPS (${label}): both bounding boxes equal the design size in points`, () => {
    const { header } = parseEps(stoneLayoutToEps(layout));
    const wPt = layout.widthMm * PT_PER_MM;
    const hPt = layout.heightMm * PT_PER_MM;
    assert.equal(header.HiResBoundingBox, `0 0 ${round3(wPt)} ${round3(hPt)}`);
    assert.equal(header.BoundingBox, `0 0 ${Math.ceil(wPt - 1e-6)} ${Math.ceil(hPt - 1e-6)}`);
  });

  await test(`6. EPS (${label}): one circle per stone, each colour in exactly one group in its catalogue fill`, () => {
    const { groups } = parseEps(stoneLayoutToEps(layout));
    const expected = groupedByColour(layout);
    assert.equal(groups.reduce((n, g) => n + g.circles.length, 0), layout.count);
    assert.equal(groups.length, expected.size, 'one setrgbcolor per colour');
    [...expected.entries()].forEach(([id, stones], i) => {
      assert.deepEqual(groups[i].rgb, fillRgb(id).map(round4), id);
      assert.equal(groups[i].circles.length, stones.length, id);
    });
  });

  await test(`7. EPS (${label}): every circle at the stone's position, y flipped, radius = size / 2`, () => {
    const { groups } = parseEps(stoneLayoutToEps(layout));
    const box = layout.getBoundingBox();
    const written = groups.flatMap((g) => g.circles);
    const expected = [...groupedByColour(layout).values()].flat();
    expected.forEach((s, i) => {
      assert.deepEqual(written[i], [
        round3((s.xMm - box.minXmm) * PT_PER_MM),
        round3((layout.heightMm - (s.yMm - box.minYmm)) * PT_PER_MM),
        round3(s.sizeMm / 2 * PT_PER_MM)
      ], `stone ${i}`);
    });
    // The top-most stone (smallest yMm) is the highest circle in the EPS.
    const top = expected.reduce((a, b) => (b.yMm < a.yMm ? b : a));
    assert.equal(Math.max(...written.map((c) => c[1])), round3((layout.heightMm - (top.yMm - box.minYmm)) * PT_PER_MM));
    // Every stone's footprint lies inside the bounding box.
    const hiRes = [layout.widthMm * PT_PER_MM, layout.heightMm * PT_PER_MM];
    for (const [x, y, r] of written) {
      assert.ok(x - r >= -0.002 && y - r >= -0.002 && x + r <= hiRes[0] + 0.002 && y + r <= hiRes[1] + 0.002, `${x} ${y} ${r}`);
    }
  });
}

// --- 8-10. AI ----------------------------------------------------------------------------------------

function xrefOffsets(text) {
  const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF/)[1]);
  const xref = text.slice(startxref);
  const count = Number(xref.match(/^xref\n0 (\d+)\n/)[1]);
  return xref.split('\n').slice(2, 2 + count).map((entry) => Number(entry.slice(0, 10)));
}

// A PdfDocument circle is "cx+r cy m", four "c" curves, "h", then the paint operator.
function parsePdfCircles(content) {
  const lines = content.split('\n');
  const circles = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(-?[\d.]+) (-?[\d.]+) m$/);
    if (!m || lines[i + 5] !== 'h') continue;
    const end = lines[i + 1].split(' ').map(Number); // ... cx cy+r c
    circles.push({ cx: end[4], cy: Number(m[2]), r: round3(Number(m[1]) - end[4]), paint: lines[i + 6] });
  }
  return circles;
}

for (const [label, layout] of LAYOUTS) {
  await test(`8. AI (${label}): a valid one-page PDF whose page is the design plus ${AI_MARGIN_MM} mm on every side`, () => {
    const text = Buffer.from(stoneLayoutToAi(layout)).toString('latin1');
    assert.ok(text.startsWith('%PDF-1.4'));
    assert.ok(text.endsWith('%%EOF'));
    assert.match(text, /\/Type \/Pages \/Kids \[3 0 R\] \/Count 1 >>/);
    const pages = text.match(/<< \/Type \/Page \/Parent[^\n]*/g) || [];
    assert.equal(pages.length, 1);
    const wPt = round3((layout.widthMm + 10) * PT_PER_MM);
    const hPt = round3((layout.heightMm + 10) * PT_PER_MM);
    assert.ok(pages[0].includes(`/MediaBox [0 0 ${wPt} ${hPt}]`), pages[0]);
    const offsets = xrefOffsets(text);
    assert.equal(offsets.length, 6, 'free head, catalog, pages, page, content, font');
    for (let objectNumber = 1; objectNumber < offsets.length; objectNumber += 1) {
      assert.equal(text.slice(offsets[objectNumber], offsets[objectNumber] + `${objectNumber} 0 obj`.length), `${objectNumber} 0 obj`);
    }
    const length = Number(text.match(/<< \/Length (\d+) >>\nstream\n/)[1]);
    const streamStart = text.indexOf('stream\n') + 'stream\n'.length;
    assert.equal(text.slice(streamStart + length, streamStart + length + '\nendstream'.length), '\nendstream', '/Length matches the content');
  });

  await test(`9. AI (${label}): one filled and stroked circle per stone at true size, y flipped, inside the margin`, () => {
    const text = Buffer.from(stoneLayoutToAi(layout)).toString('latin1');
    const circles = parsePdfCircles(text);
    assert.equal(circles.length, layout.count);
    assert.ok(circles.every((c) => c.paint === 'B'));
    const box = layout.getBoundingBox();
    const pageHMm = layout.heightMm + 2 * AI_MARGIN_MM;
    layout.stones.forEach((s, i) => {
      const c = circles[i];
      assert.ok(Math.abs(c.cx - (s.xMm - box.minXmm + AI_MARGIN_MM) * PT_PER_MM) <= 0.0006, `stone ${i} x`);
      assert.ok(Math.abs(c.cy - (pageHMm - (s.yMm - box.minYmm + AI_MARGIN_MM)) * PT_PER_MM) <= 0.0006, `stone ${i} y`);
      assert.ok(Math.abs(c.r - s.sizeMm / 2 * PT_PER_MM) <= 0.0011, `stone ${i} r`);
    });
    const marginPt = AI_MARGIN_MM * PT_PER_MM;
    assert.ok(Math.abs(Math.min(...circles.map((c) => c.cx - c.r)) - marginPt) < 0.002, 'left edge at the margin');
    assert.ok(Math.abs(Math.min(...circles.map((c) => c.cy - c.r)) - marginPt) < 0.002, 'bottom edge at the margin');
  });

  await test(`10. AI (${label}): every stone is filled in its catalogue colour`, () => {
    const text = Buffer.from(stoneLayoutToAi(layout)).toString('latin1');
    const fills = text.match(/^[\d.]+ [\d.]+ [\d.]+ rg$/gm);
    assert.equal(fills.length, layout.count);
    layout.stones.forEach((s, i) => {
      assert.equal(fills[i], `${fillRgb(s.color).map(round3).join(' ')} rg`, `stone ${i}`);
    });
  });
}

// --- 11-13. boundaries and wiring ---------------------------------------------------------------------

await test('11. both exporters leave the StoneLayout unchanged and are deterministic', () => {
  for (const [label, layout] of LAYOUTS) {
    const before = JSON.stringify(layout);
    const eps = stoneLayoutToEps(layout);
    const ai = stoneLayoutToAi(layout);
    assert.equal(JSON.stringify(layout), before, label);
    assert.equal(stoneLayoutToEps(layout), eps, label);
    assert.deepEqual(stoneLayoutToAi(layout), ai, label);
  }
  assert.throws(() => stoneLayoutToEps(new StoneLayout({ layerId: 'project' })), TypeError);
  assert.throws(() => stoneLayoutToAi(new StoneLayout({ layerId: 'project' })), TypeError);
  assert.throws(() => stoneLayoutToEps(null), TypeError);
  assert.throws(() => stoneLayoutToAi({}), TypeError);
});

await test('12. EpsExporter.js and AiExporter.js reference no GeometryEngine, project, layer type, Buffer or DOM', () => {
  for (const [name, source] of [['EpsExporter.js', epsSource], ['AiExporter.js', aiSource]]) {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const word of ['GeometryEngine', 'project', 'layer.type', 'Buffer', 'document', 'window', 'canvas']) {
      assert.ok(!code.includes(word), `${name} must not reference ${word}`);
    }
  }
});

await test('13. app.js wires #exportEPS and #exportAI like every other export handler; index.html puts them in the Production geometry group after DXF', () => {
  assert.match(appJs, /el\('exportEPS'\)\.onclick=\(\)=>\{if\(!layout\)\{[^}]*return\}try\{download\('rhinestone-design\.eps','application\/postscript',stoneLayoutToEps\(layout,/);
  assert.match(appJs, /el\('exportAI'\)\.onclick=\(\)=>\{if\(!layout\)\{[^}]*return\}try\{download\('rhinestone-design\.ai','application\/pdf',stoneLayoutToAi\(layout\)\)/);
  const groupStart = indexHtml.indexOf('Production geometry');
  const groupHtml = indexHtml.slice(groupStart, indexHtml.indexOf('<div class="export-group">', groupStart));
  const dxfAt = groupHtml.indexOf('id="exportDXF"');
  assert.ok(dxfAt !== -1 && groupHtml.indexOf('id="exportEPS"') > dxfAt && groupHtml.indexOf('id="exportAI"') > dxfAt);
});

if (process.exitCode !== 1) console.log('RS-3042 EPS/AI export tests passed.');
