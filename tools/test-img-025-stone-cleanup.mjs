// IMG-025 -- Stone clean-up for image layers. The port against the reference prototype's 6 measured
// fixtures, each rule on a hand-built lattice, the engine gate, byte identity for layers without the
// fields, and the app.js/index.html wiring. See docs/specifications/IMG-025-StoneCleanup.md, "Tests
// the build must add". Nothing read from tools/scratch/.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { STONE_COLORS } from '../src/renderer/StoneColors.js';
import { Stone } from '../src/geometry/Stone.js';
import { StoneLayout } from '../src/geometry/StoneLayout.js';
import { GeometryEngine } from '../src/geometry/index.js';
import { cleanupLatticeStones, CLEANUP_HOLE_MAX, CLEANUP_CRUMB_MIN, CLEANUP_SPECKLE_ROUNDS, CLEANUP_FRAME_PITCHES } from '../src/geometry/StoneCleanup.js';
import { catalogueLabs, aiStoneGridPoints } from '../src/geometry/AiStoneSampler.js';
import { generateGapFillStones, GAP_FILL_STONE_SIZE_MM } from '../src/geometry/GapFill.js';
import { fieldModalLabelAt, fieldPixelOn, NO_LABEL } from '../src/geometry/StoneSampler.js';
import { LINE_DESIGN_MODAL_COLOR_RADIUS_RATIO } from '../src/geometry/LineDesignSampler.js';
import { prepareImageField } from '../src/image/index.js';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

const repoUrl = new URL('..', import.meta.url);
const appJs = await readFile(fileURLToPath(new URL('app.js', repoUrl)), 'utf8');
const indexHtml = await readFile(fileURLToPath(new URL('index.html', repoUrl)), 'utf8');
const readFixture = (name) => readFile(fileURLToPath(new URL(`tools/fixtures/img-025/${name}`, repoUrl)), 'utf8');
const PALETTE = Object.values(STONE_COLORS).map((c) => ({ id: c.id, hex: c.previewColor }));
const engine = new GeometryEngine();
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const SQRT3_2 = Math.sqrt(3) / 2;
const parity = (r) => ((r % 2) + 2) % 2;

// ---- T1. The reference fixtures ------------------------------------------------------------------

const EXPECTED = JSON.parse(await readFixture('expected.json'));

// Spec "Acceptance figures": x/y evaluated left to right, as the script does.
function fixtureStones(text) {
  const lines = text.split('\n');
  const h = JSON.parse(lines[0]);
  const P = h.pitchMm;
  const stones = [];
  lines.slice(1).filter((line) => line !== '').forEach((line, k) => {
    const r = h.rowOffset + k;
    [...line].forEach((ch, j) => {
      if (ch === '.') return;
      const c = h.colOffset + j;
      stones.push(new Stone({ xMm: h.x0Mm + c * P + parity(r) * P / 2, yMm: h.y0Mm + r * P * SQRT3_2, sizeMm: 2, color: h.palette[ch.charCodeAt(0) - 97], layerId: 'F', index: stones.length }));
    });
  });
  return { h, stones };
}

// Re-encode output stones as a reference grid (absolute (r, c) from the header's lattice).
function gridText(h, stones) {
  const P = h.pitchMm;
  const cells = new Map();
  let R0 = Infinity, R1 = -Infinity, C0 = Infinity, C1 = -Infinity;
  for (const s of stones) {
    const r = Math.round((s.yMm - h.y0Mm) / (P * SQRT3_2));
    const c = Math.round((s.xMm - h.x0Mm - parity(r) * P / 2) / P);
    cells.set(`${r},${c}`, h.palette.indexOf(s.color));
    R0 = Math.min(R0, r); R1 = Math.max(R1, r); C0 = Math.min(C0, c); C1 = Math.max(C1, c);
  }
  const rows = [];
  for (let r = R0; r <= R1; r++) {
    let row = '';
    for (let c = C0; c <= C1; c++) {
      const v = cells.get(`${r},${c}`);
      row += v === undefined ? '.' : String.fromCharCode(97 + v);
    }
    rows.push(row);
  }
  return `${R0} ${C0}\n${rows.join('\n')}\n`;
}

await test('T1. all 6 reference fixtures, with and without outline, row-major and with an odd-row stone first: stats, count and sha256 equal expected.json', async () => {
  assert.deepEqual([CLEANUP_HOLE_MAX, CLEANUP_CRUMB_MIN, CLEANUP_SPECKLE_ROUNDS, CLEANUP_FRAME_PITCHES], [10, 4, 2, 1.1]);
  assert.deepEqual(Object.keys(EXPECTED).sort(), ['portrait_flat', 'portrait_photo', 'portrait_stones', 'tiger_flat', 'tiger_photo', 'tiger_stones']);
  for (const name of Object.keys(EXPECTED)) {
    const { h, stones } = fixtureStones(await readFixture(`${name}.grid.txt`));
    const palette = h.palette.map((id) => ({ id, hex: '#000000' }));
    const firstOdd = stones.findIndex((s) => parity(Math.round((s.yMm - h.y0Mm) / (h.pitchMm * SQRT3_2))) === 1);
    assert.ok(firstOdd > 0, `${name}: has an odd-row stone after the first`);
    const reordered = [stones[firstOdd], ...stones.slice(0, firstOdd), ...stones.slice(firstOdd + 1)];
    for (const [order, input] of [['row-major', stones], ['odd-row first', reordered]]) {
      for (const [variant, outline] of [['cleanup', false], ['outline', true]]) {
        const e = EXPECTED[name][variant];
        assert.equal(input.length, e.before, `${name}: before`);
        const out = cleanupLatticeStones({ stones: input, pitchMm: h.pitchMm, palette, placement: h.box, layerId: 'F', stoneSizeMm: 2, outline });
        const label = `${name} ${variant} ${order}`;
        assert.deepEqual(out.stats, { filled: e.filled, recoloured: e.recoloured, removed: e.removed, outlined: e.outlined }, label);
        assert.equal(out.stones.length, e.after, label);
        assert.equal(sha256(gridText(h, out.stones)), e.sha256, label);
      }
    }
  }
});

// ---- Hand-built lattices (T2-T4) -----------------------------------------------------------------

const P = 2.5;             // exact in binary, so the T2f frame distances are exact
const X0 = 20, Y0 = 30;
const FAR_BOX = { xMm: -1000, yMm: -1000, widthMm: 3000, heightMm: 3000 };
const ORDER = PALETTE.map((p) => p.id);
const COLOUR = { a: 'sapphire', b: 'gold', c: 'siam', j: 'jet', u: 'unknown-colour', z: 'zeta-unknown', y: 'alpha-unknown' };

// rows[r][c]: '.' no stone, otherwise a COLOUR key. Row r at y = Y0 + r*rowH; odd rows +P/2.
function latticeStones(rows, { colours = COLOUR } = {}) {
  const stones = [];
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch !== '.') stones.push(new Stone({ xMm: X0 + c * P + parity(r) * P / 2, yMm: Y0 + r * P * SQRT3_2, sizeMm: 2, color: colours[ch], layerId: 'T', index: stones.length }));
  }));
  return stones;
}
const cellOf = (s) => { const r = Math.round((s.yMm - Y0) / (P * SQRT3_2)); return [r, Math.round((s.xMm - X0 - parity(r) * P / 2) / P)]; };
const at = (stones, r, c) => stones.find((s) => { const [sr, sc] = cellOf(s); return sr === r && sc === c; });
const run = (stones, extra = {}) => cleanupLatticeStones({ stones, pitchMm: P, palette: PALETTE, placement: FAR_BOX, layerId: 'T', stoneSizeMm: 2, outline: false, ...extra });
const field = (rows, cols, ch = 'a') => Array.from({ length: rows }, () => ch.repeat(cols));
const put = (rows, r, c, ch) => { rows[r] = rows[r].slice(0, c) + ch + rows[r].slice(c + 1); return rows; };
// The test's own neighbour count, to check each fixture sets up the case it claims.
function neighbourCount(rows, r, c) {
  const nb = parity(r) === 0 ? [[r, c - 1], [r, c + 1], [r - 1, c - 1], [r - 1, c], [r + 1, c - 1], [r + 1, c]] : [[r, c - 1], [r, c + 1], [r - 1, c], [r - 1, c + 1], [r + 1, c], [r + 1, c + 1]];
  return nb.filter(([i, j]) => rows[i] && rows[i][j] && rows[i][j] !== '.').length;
}

await test('T2a. holes: a 3-point hole with a second colour on 2 rim stones takes the majority colour; 10 points are filled, 11 are kept', () => {
  const rows = put(put(put(put(put(field(9, 12), 4, 3, '.'), 4, 4, '.'), 4, 5, '.'), 4, 2, 'b'), 3, 2, 'b');
  assert.equal(neighbourCount(rows, 4, 3), 5, 'the first point filled has 5 rim stones, 2 of them gold');
  const out = run(latticeStones(rows));
  assert.equal(out.stats.filled, 3);
  assert.deepEqual(out.stones.slice(-3).map((s) => s.color), ['sapphire', 'sapphire', 'sapphire']);

  // Fill order: a 5-point plus-shaped hole on a column split. Most neighbours first fills (5,5)
  // before the centre (5,4), which then takes gold; row-major order would make the centre sapphire.
  const plus = 'aaaabbbbb|aaaabbbbb|aaaabbbbb|aaaabbbbb|aaaa.bbbb|aaa...bbb|aaaa.bbbb|aaaabbbbb|aaaabbbbb'.split('|');
  const plusOut = run(latticeStones(plus), { palette: [{ id: 'sapphire' }, { id: 'gold' }] });
  assert.deepEqual(plusOut.stones.slice(-5).map((s) => `${cellOf(s)}:${s.color}`), ['5,5:gold', '4,4:sapphire', '5,3:sapphire', '5,4:gold', '6,4:sapphire']);

  const line = (len, width) => { const r = field(9, width); r[4] = r[4].slice(0, 3) + '.'.repeat(len) + r[4].slice(3 + len); return r; };
  const ten = run(latticeStones(line(10, 16)));
  assert.equal(ten.stats.filled, 10);
  const eleven = latticeStones(line(11, 17));
  const kept = run(eleven);
  assert.deepEqual(kept.stats, { filled: 0, recoloured: 0, removed: 0, outlined: 0 });
  assert.equal(kept.stones.length, eleven.length);
});

await test('T2b. an edge gap open to the outside is kept; the ring round a 2-stone group is not a hole', () => {
  const rows = put(field(8, 10), 0, 4, '.');
  assert.equal(run(latticeStones(rows)).stats.filled, 0);
  const pair = run(latticeStones(['aa']));
  assert.deepEqual(pair.stats, { filled: 0, recoloured: 0, removed: 2, outlined: 0 });
});

await test('T2c. speckle: own 0 / top 6 and own 1 / top 5 recolour; a 2-2 split and a 3-neighbour stone are kept', () => {
  const single = run(latticeStones(put(field(7, 7), 3, 3, 'b')));
  assert.equal(single.stats.recoloured, 1);
  assert.ok(single.stones.every((s) => s.color === 'sapphire'));

  const pair = run(latticeStones(put(put(field(7, 8), 3, 3, 'b'), 3, 4, 'b')));
  assert.equal(pair.stats.recoloured, 2);
  assert.ok(pair.stones.every((s) => s.color === 'sapphire'));

  // Split at column 4; X = (0,4) on the top edge has neighbours a, b, a, b.
  const split = Array.from({ length: 5 }, (_, r) => (r === 0 ? 'aaaacbbbb' : 'aaaabbbbb'));
  assert.equal(neighbourCount(split, 0, 4), 4);
  const splitOut = run(latticeStones(split));
  assert.equal(at(splitOut.stones, 0, 4).color, 'siam');
  assert.equal(splitOut.stats.recoloured, 0);

  const three = ['aaaa', 'aaa', 'aaab', 'aaa', 'aaaa'];
  assert.equal(neighbourCount(three, 2, 3), 3);
  const threeOut = run(latticeStones(three));
  assert.equal(at(threeOut.stones, 2, 3).color, 'gold');
  assert.equal(threeOut.stats.recoloured, 0);
});

await test('T2d. a one-stone-wide Jet line keeps every interior Jet stone (own 2)', () => {
  // Row 4 is even and one stone longer than the field, so both end stones have 3 neighbours and
  // speckle cannot wear the line down from its ends.
  const rows = field(9, 12);
  rows[4] = 'j'.repeat(13);
  assert.deepEqual([neighbourCount(rows, 4, 0), neighbourCount(rows, 4, 12), neighbourCount(rows, 4, 6)], [3, 3, 6]);
  const out = run(latticeStones(rows));
  assert.equal(out.stats.recoloured, 0);
  for (let c = 0; c < 13; c++) assert.equal(at(out.stones, 4, c).color, 'jet', `(4,${c})`);
});

await test('T2e. crumbs: a detached 3-stone group is removed, a 4-stone group kept; removed counts stones', () => {
  const rows = field(8, 8).map((row) => row + '.'.repeat(22));
  rows[1] = rows[1].slice(0, 15) + 'bbb' + rows[1].slice(18);
  rows[5] = rows[5].slice(0, 22) + 'bbbb' + rows[5].slice(26);
  const stones = latticeStones(rows);
  const out = run(stones);
  assert.equal(out.stats.removed, 3);
  assert.equal(out.stones.length, stones.length - 3);
  for (let c = 15; c < 18; c++) assert.equal(at(out.stones, 1, c), undefined);
  for (let c = 22; c < 26; c++) assert.ok(at(out.stones, 5, c), `(5,${c}) kept`);
});

await test('T2f. Jet outline: edge stones (<= 4 neighbours) become jet, interior do not; the 1.1-pitch frame on each side (1 pitch in excluded, 1.2 in outlined); an already-Jet stone is not counted', () => {
  const rows = put(field(8, 10), 0, 0, 'j');
  const stones = latticeStones(rows);
  const isEdge = ([r, c]) => neighbourCount(rows, r, c) <= 4;
  const edge = stones.filter((s) => isEdge(cellOf(s)));
  assert.equal(edge.length, 26);
  assert.equal(stones.filter((s) => neighbourCount(rows, ...cellOf(s)) === 4).length, 16, 'straight-edge stones with exactly 4 neighbours');
  const xs = stones.map((s) => s.xMm), ys = stones.map((s) => s.yMm);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const box = ({ l = 5, t = 5, r = 5, b = 5 } = {}) => {
    const xMm = minX - l * P, yMm = minY - t * P;
    return { xMm, yMm, widthMm: maxX + r * P - xMm, heightMm: maxY + b * P - yMm };
  };
  const far = box();
  assert.ok(far.xMm !== 0 && far.yMm !== 0);
  const out = run(stones, { outline: true, placement: far });
  assert.equal(out.stats.outlined, 25);
  for (const s of out.stones) assert.equal(s.color === 'jet', isEdge(cellOf(s)), `${cellOf(s)}`);

  const sides = [
    ['l', (s) => s.xMm === minX],
    ['t', (s) => s.yMm === minY],
    ['r', (s) => s.xMm === maxX],
    ['b', (s) => s.yMm === maxY]
  ];
  for (const [side, onSide] of sides) {
    const near = edge.filter((s) => onSide(s) && s.color !== 'jet');
    assert.ok(near.length >= 3, `${side}: fixture has edge stones on that side`);
    const oneIn = run(stones, { outline: true, placement: box({ [side]: 1 }) });
    assert.equal(oneIn.stats.outlined, 25 - near.length, `${side} at 1 pitch`);
    for (const s of near) assert.equal(at(oneIn.stones, ...cellOf(s)).color, 'sapphire', `${side} at 1 pitch: ${cellOf(s)} excluded`);
    const further = run(stones, { outline: true, placement: box({ [side]: 1.2 }) });
    assert.equal(further.stats.outlined, 25, `${side} at 1.2 pitches`);
    for (const s of near) assert.equal(at(further.stones, ...cellOf(s)).color, 'jet', `${side} at 1.2 pitches: ${cellOf(s)} outlined`);
  }
});

await test('T2g. output: surviving originals in input order, then filled stones in fill order (stoneSizeMm, layer id, index from n); unchanged stones are the same objects; input untouched; recoloured excludes outlined', () => {
  const rows = put(put(put(put(field(9, 12), 4, 3, '.'), 4, 4, '.'), 4, 5, '.'), 7, 8, 'b').map((row, r) => (r === 0 ? `${row}..bb` : row));
  const stones = latticeStones(rows);
  const snapshot = JSON.stringify(stones);
  const refs = [...stones];
  const n = stones.length;
  const out = cleanupLatticeStones({ stones, pitchMm: P, palette: PALETTE, placement: FAR_BOX, layerId: 'FILL', stoneSizeMm: 2, outline: false });
  assert.deepEqual(out.stats, { filled: 3, recoloured: 1, removed: 2, outlined: 0 });
  assert.equal(JSON.stringify(stones), snapshot, 'input stones unchanged');
  assert.equal(stones.length, n);
  assert.ok(stones.every((s, i) => s === refs[i]));

  const survivors = stones.filter((s) => { const [, c] = cellOf(s); return c < 12; });
  const head = out.stones.slice(0, survivors.length);
  assert.deepEqual(head.map((s) => s.index), survivors.map((s) => s.index), 'originals keep their order');
  head.forEach((s, i) => {
    const src = survivors[i];
    if (s.color === src.color) assert.equal(s, src, 'unchanged stone passed through');
    else assert.deepEqual([s.xMm, s.yMm, s.sizeMm, s.layerId, s.index, s.metadata], [src.xMm, src.yMm, src.sizeMm, src.layerId, src.index, src.metadata]);
  });
  const tail = out.stones.slice(survivors.length);
  assert.deepEqual(tail.map(cellOf), [[4, 3], [4, 4], [4, 5]], 'fill order: most neighbours, then row, then column');
  assert.deepEqual(tail.map((s) => [s.sizeMm, s.layerId, s.index, s.color]), [[2, 'FILL', n, 'sapphire'], [2, 'FILL', n + 1, 'sapphire'], [2, 'FILL', n + 2, 'sapphire']]);
  assert.deepEqual(tail.map((s) => s.metadata), [{}, {}, {}]);

  const outlined = cleanupLatticeStones({ stones, pitchMm: P, palette: PALETTE, placement: FAR_BOX, layerId: 'FILL', stoneSizeMm: 2, outline: true });
  assert.ok(outlined.stats.outlined > 0);
  assert.equal(outlined.stats.recoloured, out.stats.recoloured);
});

// ---- T3. Ties --------------------------------------------------------------------------------------

await test('T3. ties go to the earlier palette colour (hole and speckle); a colour outside the palette loses; two outside colours rank by string order', () => {
  const pal = (...ids) => ids.map((id) => ({ id, hex: '#000000' }));
  // Split at column 4: (2,4) has 3 left-colour and 3 right-colour neighbours.
  const split = (left, right, mid) => Array.from({ length: 5 }, (_, r) => left.repeat(4) + (r === 2 ? mid : right) + right.repeat(4));
  assert.equal(neighbourCount(split('a', 'b', '.'), 2, 4), 6);
  const holeColour = (rows, palette) => run(latticeStones(rows), { palette }).stones.at(-1).color;
  assert.equal(holeColour(split('a', 'b', '.'), pal('sapphire', 'gold')), 'sapphire');
  assert.equal(holeColour(split('a', 'b', '.'), pal('gold', 'sapphire')), 'gold');
  const speckColour = (palette) => at(run(latticeStones(split('a', 'b', 'c')), { palette }).stones, 2, 4).color;
  assert.equal(speckColour(pal('sapphire', 'gold', 'siam')), 'sapphire');
  assert.equal(speckColour(pal('gold', 'sapphire', 'siam')), 'gold');
  assert.equal(holeColour(split('u', 'a', '.'), pal('sapphire')), 'sapphire', 'unknown colour loses to a palette colour');
  assert.equal(holeColour(split('a', 'u', '.'), pal('sapphire')), 'sapphire');
  assert.equal(holeColour(split('z', 'y', '.'), null), 'alpha-unknown', 'two unknown colours: string order');
});

// ---- T4. Lattice skip ------------------------------------------------------------------------------

await test('T4. off-lattice by 0.3 pitch or a shared point skips (input returned as is); 0.2 pitch does not; empty input gives zero stats', () => {
  const stones = latticeStones(field(6, 6));
  const moved = (f) => stones.map((s, i) => (i === 7 ? new Stone({ ...s, xMm: s.xMm + f * P }) : s));
  const far = moved(0.3);
  const skipped = run(far);
  assert.equal(skipped.stones, far);
  assert.deepEqual(skipped.stats, { skipped: 'not-lattice' });
  assert.ok(!('skipped' in run(moved(0.2)).stats));
  const dup = [...stones, new Stone({ ...stones[5], index: stones.length })];
  assert.deepEqual(run(dup).stats, { skipped: 'not-lattice' });
  assert.deepEqual(run([]), { stones: [], stats: { filled: 0, recoloured: 0, removed: 0, outlined: 0 } });
});

// ---- Engine fixture (T5, T6) ---------------------------------------------------------------------

const IMG_W = 120, IMG_H = 120, BLUE = [0x22, 0x69, 0xd3], RED = [0x9b, 0x1c, 0x1c], BLACK = [0, 0, 0], WHITE = [255, 255, 255];
// A two-colour disc on white with a planted hole, a single red speck in the blue half and a detached
// two-stone crumb in the top-left corner, each placed on a Staggered stone of BASE below.
function buildEngineImage() {
  const data = new Uint8ClampedArray(IMG_W * IMG_H * 4);
  for (let y = 0; y < IMG_H; y++) {
    for (let x = 0; x < IMG_W; x++) {
      let rgb = WHITE;
      if ((x - 64) ** 2 + (y - 64) ** 2 <= 48 * 48) rgb = x < 64 ? BLUE : RED;
      if ((x - 46) ** 2 + (y - 62) ** 2 <= 3.5 ** 2) rgb = WHITE;
      if ((x - 48.3) ** 2 + (y - 82) ** 2 <= 2.8 ** 2) rgb = RED;
      if (x >= 9 && x <= 18.5 && y >= 8 && y <= 12.5) rgb = BLACK;
      data.set([...rgb, 255], (y * IMG_W + x) * 4);
    }
  }
  return { widthPx: IMG_W, heightPx: IMG_H, data };
}
const IMAGE = buildEngineImage();
const BOX = { xMm: 3, yMm: 4, widthMm: 60, heightMm: 60 };
const BASE = { imageBuffer: IMAGE, layerId: 'L', ...BOX, stoneSizeMm: 2, gapMm: 0.3, mode: 'staggered', threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 120, maxHeightPx: 120, transparent: 'white', maskMode: 'threshold', colorCount: 3, palette: PALETTE, colorMap: {} };
// AI stones: a stub detection with one AI stone on each engine grid point inside the same disc
// (sapphire left, siam right), minus one (the hole), one siam speck in the sapphire half, and a
// detached two-stone crumb.
function buildStubDetection() {
  const labs = catalogueLabs(PALETTE);
  const lab = (id) => labs[PALETTE.findIndex((p) => p.id === id)];
  const sx = BOX.widthMm / IMG_W, sy = BOX.heightMm / IMG_H;
  const grid = aiStoneGridPoints(BOX, 2.3).map((p) => ({ u: (p.xMm - BOX.xMm) / sx, v: (p.yMm - BOX.yMm) / sy }));
  const nearest = (u, v) => grid.reduce((b, p) => (Math.hypot(p.u - u, p.v - v) < Math.hypot(b.u - u, b.v - v) ? p : b));
  const hole = nearest(40, 50), speck = nearest(40, 80), crumbA = nearest(12, 10);
  const crumbB = grid.find((p) => p.v === crumbA.v && p.u > crumbA.u && p.u - crumbA.u < 5);
  const stones = [];
  for (const p of grid) {
    const inDisc = (p.u - 64) ** 2 + (p.v - 64) ** 2 <= 48 * 48;
    const crumb = p === crumbA || p === crumbB;
    if ((!inDisc && !crumb) || p === hole) continue;
    const id = crumb ? 'jet' : p === speck ? 'siam' : p.u < 64 ? 'sapphire' : 'siam';
    stones.push({ xPx: p.u, yPx: p.v, lab: lab(id), jetLike: id === 'jet', fromDot: true });
  }
  return { ok: true, pitchPx: 2.3 / sx, stones };
}
const DETECTION = buildStubDetection();
const AI_BASE = { ...BASE, mode: 'ai-stones', aiStoneDetection: DETECTION };

const stonesJson = (layout) => JSON.stringify(layout.stones);
const layoutSha = (layout) => sha256(JSON.stringify(layout.toJSON()));
const PLANTED = { filled: 1, recoloured: 1, removed: 2, outlined: 0 };

// ---- T5. Engine gate ------------------------------------------------------------------------------

await test('T5. engine: runs for Staggered and AI stones (any AI size mode) when cleanup === true, before fillGaps and rotation; off for every other mode, size mode and cleanup value', () => {
  for (const base of [BASE, AI_BASE]) {
    const plain = engine.generateImageLayout(base);
    const cleaned = engine.generateImageLayout({ ...base, cleanup: true });
    assert.deepEqual(cleaned.cleanupStats, PLANTED, base.mode);
    const direct = cleanupLatticeStones({ stones: plain.stones, pitchMm: 2.3, palette: PALETTE, placement: BOX, layerId: 'L', stoneSizeMm: 2, outline: false });
    assert.equal(stonesJson(cleaned), JSON.stringify(direct.stones), `${base.mode}: the engine output is the pass on its own stones`);
    assert.equal(plain.cleanupStats, null);
  }
  const aiMixed = engine.generateImageLayout({ ...AI_BASE, cleanup: true, sizeMode: 'mixed', allowedSizesMm: [1.5, 2, 2.8] });
  assert.deepEqual(aiMixed.cleanupStats, PLANTED, 'AI stones ignores size mode');
  assert.equal(stonesJson(aiMixed), stonesJson(engine.generateImageLayout({ ...AI_BASE, cleanup: true })));

  const off = [
    ...['fill', 'radial', 'contour', 'organic', 'edge', 'line-design'].map((mode) => [mode, { mode }]),
    ['staggered brightness', { sizeMode: 'brightness', brightnessSizesMm: [2, 2.8] }],
    ['staggered mixed', { sizeMode: 'mixed', allowedSizesMm: [1.5, 2, 2.8] }]
  ];
  for (const [label, over] of off) {
    const without = engine.generateImageLayout({ ...BASE, ...over });
    const withCleanup = engine.generateImageLayout({ ...BASE, ...over, cleanup: true, jetOutline: true });
    assert.equal(withCleanup.cleanupStats, null, label);
    assert.equal(layoutSha(withCleanup), layoutSha(without), label);
  }
  const baseline = layoutSha(engine.generateImageLayout(BASE));
  for (const cleanup of [undefined, false, 'true', 1]) {
    const layout = engine.generateImageLayout({ ...BASE, cleanup, jetOutline: true });
    assert.equal(layout.cleanupStats, null, `cleanup ${JSON.stringify(cleanup)}`);
    assert.equal(layoutSha(layout), baseline, `cleanup ${JSON.stringify(cleanup)}`);
  }

  // fillGaps: at 2.8 mm the 2.0 mm fillers exist and sit off the lattice.
  const big = { ...BASE, stoneSizeMm: 2.8 };
  const cleaned = engine.generateImageLayout({ ...big, cleanup: true });
  const filled = engine.generateImageLayout({ ...big, cleanup: true, fillGaps: true });
  assert.ok(cleaned.cleanupStats && !('skipped' in cleaned.cleanupStats));
  assert.deepEqual(filled.cleanupStats, cleaned.cleanupStats);
  const n = cleaned.stones.length;
  assert.equal(JSON.stringify(filled.stones.slice(0, n)), stonesJson(cleaned));
  const imageField = prepareImageField(IMAGE, { threshold: 128, invert: false, blurRadiusPx: 0, edgeBandFraction: 6 / BOX.widthMm, maxWidthPx: 120, maxHeightPx: 120, transparent: 'white', colorCount: 3, palette: PALETTE, maskMode: 'threshold', vividness: 1, paletteRule: null });
  const colorAt = (xMm, yMm) => {
    const label = fieldModalLabelAt(imageField, BOX, xMm, yMm, (GAP_FILL_STONE_SIZE_MM / 2) * LINE_DESIGN_MODAL_COLOR_RADIUS_RATIO);
    return label === NO_LABEL ? null : imageField.colorGroups[label].nearestId;
  };
  const isInside = (xMm, yMm) => fieldPixelOn(imageField, xMm - BOX.xMm, yMm - BOX.yMm, BOX.widthMm, BOX.heightMm);
  const expectedFill = generateGapFillStones({ baseStones: cleaned.stones, gapMm: 0.3, isInside, placement: BOX, colorAt, layerId: 'L', startIndex: n });
  assert.ok(expectedFill.length > 0, 'the fixture has gaps to fill');
  assert.equal(JSON.stringify(filled.stones.slice(n)), JSON.stringify(expectedFill), 'the IMG-013 pass ran on the cleaned stones');

  // IMG-021 rotation of the cleaned stones about the placement centre.
  const upright = engine.generateImageLayout({ ...BASE, cleanup: true });
  const rotated = engine.generateImageLayout({ ...BASE, cleanup: true, rotationDeg: 30 });
  assert.deepEqual(rotated.cleanupStats, upright.cleanupStats);
  assert.equal(rotated.stones.length, upright.stones.length);
  const cx = BOX.xMm + BOX.widthMm / 2, cy = BOX.yMm + BOX.heightMm / 2, rad = 30 * Math.PI / 180;
  upright.stones.forEach((s, i) => {
    const dx = s.xMm - cx, dy = s.yMm - cy, r = rotated.stones[i];
    assert.ok(Math.abs(r.xMm - (cx + dx * Math.cos(rad) - dy * Math.sin(rad))) < 1e-9 && Math.abs(r.yMm - (cy + dx * Math.sin(rad) + dy * Math.cos(rad))) < 1e-9, `stone ${i}`);
    assert.deepEqual([r.color, r.sizeMm], [s.color, s.sizeMm]);
  });

  const jetOnly = engine.generateImageLayout({ ...BASE, jetOutline: true });
  assert.equal(jetOnly.cleanupStats, null);
  assert.equal(layoutSha(jetOnly), baseline, 'Jet outline alone changes nothing');
  const outlined = engine.generateImageLayout({ ...BASE, cleanup: true, jetOutline: true });
  assert.ok(outlined.cleanupStats.outlined > 0);
  assert.equal(outlined.stones.filter((s) => s.color === 'jet').length, outlined.cleanupStats.outlined);
});

// ---- T6. Byte identity ----------------------------------------------------------------------------

// sha256 of JSON.stringify(layout.toJSON()) per mode, captured on bd68ed0 (the build's parent)
// before GeometryEngine.js was edited.
const PINNED = {
  'fill': '42b3b20c32bcf20359f611ee4ebcacd3da63a7885227a7b14bbc4a911089d749',
  'staggered': 'dbec671e1c2b6f7c237b3bd161464360dbbcf0a5eb113e6e631d6ad6bf541d45',
  'radial': '8d28726c63bdf6b93846dd0736cd6944066dd470b32aa709a356c4d5a36805de',
  'contour': '8621219b2330551bf5d2262b4df4015e2d5c5bd1e7611c200bd1539ef8ccc728',
  'organic': 'cd885fc68d9cbcd4ed27b6aa0206a37e40805ab49dde6fd50f6769608b3c68bb',
  'edge': '168ee26d392f0919ea4dab92ce7696893e6dc96826f48f21610ac39373e325c0',
  'line-design': '7a11be569eda16f95b6b3192a3e04b8ebb24d7ba1c36e46ee4487740788ec900',
  'ai-stones': '1e06e7fa8ec0d359e6f9cbf49da2fd4ce4db838d2ba2ebad6bbb918f968b5b80'
};

async function extractProjectFunctions() {
  const validateMatch = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  const defaultMatch = appJs.match(/function defaultProject\(\)\{[\s\S]*?\}\}\n/);
  assert.ok(validateMatch && defaultMatch);
  const constantsStart = appJs.indexOf('const DEFAULT_TEXT_FONT_ID=');
  const source = `${appJs.slice(constantsStart, appJs.indexOf(defaultMatch[0]) + defaultMatch[0].length)}\n${appJs.slice(appJs.indexOf('const SUPPORTED_LAYER_TYPES=new Set'), appJs.indexOf(validateMatch[0]) + validateMatch[0].length)}`;
  const { SHAPE_LIBRARY_KINDS } = await import('../src/geometry/index.js');
  const { getObjectTemplate, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel } = await import('../src/products/index.js');
  // eslint-disable-next-line no-new-func
  return new Function(
    'getObjectTemplate', 'SHAPE_LIBRARY_KINDS', 'getPlateDefaults', 'normalizePlateParams',
    'VESSEL_PRODUCT_IDS', 'getVesselDefaults', 'normalizeVesselParams', 'deriveLegacyVesselParams', 'computeCanvasFromVessel',
    `${source}\nreturn { validateProject, defaultProject };`
  )(getObjectTemplate, SHAPE_LIBRARY_KINDS, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel);
}

const IMAGE_LAYER = { id: 'image1', type: 'image', visible: true, imageSrc: 'data:image/png;base64,AAAA', imageName: 'a.png', naturalWidthPx: 120, naturalHeightPx: 120, x: 20, y: 30, w: 60, h: 60, maskMode: 'subject', threshold: 128, stoneSize: 2, gap: 0.3, colorCount: 'auto', vividness: 1.4, rotationDeg: 0, fillMode: 'staggered', invert: false, transparent: 'ignore', blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400, fillGaps: true };

await test('T6. byte identity: every mode without the fields equals the pinned pre-build layout and cleanup:false; no cleanupStats key unless it ran; toJSON/fromJSON round trip; validateProject() round trip', async () => {
  for (const [mode, pinned] of Object.entries(PINNED)) {
    const base = mode === 'ai-stones' ? AI_BASE : { ...BASE, mode };
    const layout = engine.generateImageLayout(base);
    assert.equal(layoutSha(layout), pinned, mode);
    assert.equal(layoutSha(engine.generateImageLayout({ ...base, cleanup: false })), pinned, `${mode} cleanup:false`);
    assert.ok(!('cleanupStats' in layout.toJSON()), `${mode}: no cleanupStats key`);
  }
  const cleaned = engine.generateImageLayout({ ...BASE, cleanup: true, jetOutline: true });
  const json = cleaned.toJSON();
  assert.deepEqual(json.cleanupStats, cleaned.cleanupStats);
  const back = StoneLayout.fromJSON(json);
  assert.deepEqual(back.cleanupStats, cleaned.cleanupStats);
  assert.equal(JSON.stringify(back.toJSON()), JSON.stringify(json));
  assert.equal(StoneLayout.fromJSON({ layerId: 'L', stones: [] }).cleanupStats, null);

  const { validateProject, defaultProject } = await extractProjectFunctions();
  const p0 = validateProject({ ...defaultProject(), layers: [...defaultProject().layers, IMAGE_LAYER] });
  const p1 = validateProject(JSON.parse(JSON.stringify(p0)));
  assert.equal(JSON.stringify(p1), JSON.stringify(p0));
  assert.ok(p1.layers.every((l) => !('cleanup' in l) && !('jetOutline' in l)), 'no key added');
  const on = validateProject({ ...defaultProject(), layers: [{ ...IMAGE_LAYER, cleanup: true, jetOutline: true }] });
  assert.deepEqual([on.layers.at(-1).cleanup, on.layers.at(-1).jetOutline], [true, true], 'the fields survive a round trip');
});

// ---- T7. app.js / index.html wiring ----------------------------------------------------------------

function extractFunction(marker) {
  const start = appJs.indexOf(marker);
  assert.ok(start !== -1, `expected ${marker}`);
  let depth = 0;
  for (let i = start + marker.length - 1; i < appJs.length; i++) {
    if (appJs[i] === '{') depth++;
    else if (appJs[i] === '}') { depth--; if (depth === 0) return appJs.slice(start, i + 1); }
  }
  throw new Error(`no closing brace for ${marker}`);
}
const lineWith = (needle) => { const i = appJs.indexOf(needle); assert.ok(i !== -1, needle); return appJs.slice(appJs.lastIndexOf('\n', i) + 1, appJs.indexOf('\n', i)); };
const elStub = (values) => { const els = {}; return { els, el: (id) => (els[id] ??= { ...(values[id] ?? {}) }) }; };

await test('T7. wiring: import literal, live params, the four cache keys untouched, index.html controls, history ids; disabling, write lines and stats line run for real', () => {
  const importLine = lineWith("const layer={id:'image'+Date.now(),type:'image'");
  assert.ok(importLine.includes('fillGaps:true,cleanup:true}'));
  assert.ok(!importLine.includes('jetOutline'));
  const live = extractFunction('async generateImageStonesLive(layer,{includeStats=false}={}){');
  assert.ok(live.includes('fillGaps:Boolean(layer.fillGaps),cleanup:layer.cleanup,jetOutline:layer.jetOutline,'));
  assert.ok(live.includes('cleanupStats:result.cleanupStats??null'));
  const keys = [
    lineWith('const key=[layer.id,layer.imageSrc,layer.x,layer.y,layer.w,layer.h,layer.gap,lineDesignColorMapKey('),
    extractFunction('function aiStoneSizingKey(l){'),
    extractFunction('function autoColorCountKeyParts(layer){'),
    lineWith("const key=[layer.imageSrc,layer.threshold,layer.invert,layer.blurRadiusPx,")
  ];
  for (const key of keys) assert.ok(!/cleanup|jetOutline/i.test(key), key.slice(0, 60));

  const traceStart = indexHtml.indexOf('id="imageStudioGroupTrace"');
  const trace = indexHtml.slice(traceStart, indexHtml.indexOf('</details>', traceStart));
  const cleanupRow = '<label class="checkbox-row" title="Fills small holes, fixes single odd-coloured stones and removes stray crumbs"><input type="checkbox" id="imgCleanup"> Clean up stones</label>';
  const jetRow = '<label class="checkbox-row" title="Turns the outer edge of the design into one row of Jet stones"><input type="checkbox" id="imgJetOutline"> Jet outline</label>';
  const hint = '<p class="hint" id="imgCleanupHint" hidden>Clean-up works with Staggered Fill (one stone size) and AI stones</p>';
  const shrink = trace.indexOf('id="imgAiStoneShrinkField"');
  assert.ok(shrink !== -1 && shrink < trace.indexOf(cleanupRow) && trace.indexOf(cleanupRow) < trace.indexOf(jetRow) && trace.indexOf(jetRow) < trace.indexOf(hint), 'in the Trace section, after AI stone size, in order');
  const statsStart = indexHtml.indexOf('<div id="imageStudioStats">');
  assert.ok(indexHtml.slice(statsStart, indexHtml.indexOf('</div>', statsStart)).includes('</dl>\n        <p class="hint" id="imageStudioStatCleanup" hidden></p>'));
  const history = /const HISTORY_TRACKED_CONTROL_IDS=\[([^\]]*)\];/.exec(appJs)[1].split(',');
  assert.ok(history.includes("'imgCleanup'") && history.includes("'imgJetOutline'"));
  const sync = extractFunction('function syncSelectedControlsFromLayer(){');
  assert.ok(sync.includes("el('imgCleanup').checked=l.cleanup===true;el('imgJetOutline').checked=l.jetOutline===true;"));

  // Disabling (renderImageStudio()).
  const studio = extractFunction('async function renderImageStudio(){');
  const block = studio.slice(studio.indexOf('const cleanupEligible='), studio.indexOf("el('imgCleanupHint').hidden=cleanupEligible;") + "el('imgCleanupHint').hidden=cleanupEligible;".length);
  assert.equal(block.split('\n').length, 4);
  const resolveSizeMode = (v) => (['uniform', 'mixed', 'weight', 'brightness'].includes(v) ? v : 'uniform');
  const disable = (mode, l) => { const { els, el } = elStub({}); new Function('mode', 'l', 'el', 'resolveSizeMode', block)(mode, l, el, resolveSizeMode); return [els.imgCleanup.disabled, els.imgJetOutline.disabled, els.imgCleanupHint.hidden]; };
  assert.deepEqual(disable('staggered', {}), [false, true, true], 'eligible, Clean up off: Jet disabled, hint hidden');
  assert.deepEqual(disable('staggered', { cleanup: true, sizeMode: 'uniform' }), [false, false, true]);
  assert.deepEqual(disable('ai-stones', { cleanup: true, sizeMode: 'mixed' }), [false, false, true], 'AI stones with sizeMode mixed is eligible');
  for (const [mode, l] of [['fill', {}], ['radial', {}], ['contour', {}], ['organic', {}], ['edge', {}], ['line-design', {}], ['staggered', { sizeMode: 'mixed' }], ['staggered', { sizeMode: 'brightness' }]]) {
    assert.deepEqual(disable(mode, { ...l, cleanup: true }), [true, true, false], `${mode} ${JSON.stringify(l)}`);
  }

  // Write lines (writeSelectedControlsToLayer()).
  const write = extractFunction('function writeSelectedControlsToLayer(){');
  const writeLines = [
    "if(l.cleanup!==undefined||el('imgCleanup').checked)l.cleanup=el('imgCleanup').checked;",
    "if(l.jetOutline!==undefined||el('imgJetOutline').checked)l.jetOutline=el('imgJetOutline').checked;"
  ];
  for (const line of writeLines) assert.ok(write.includes(line));
  const writeRun = (l, cleanup, jet) => { new Function('l', 'el', writeLines.join('\n'))(l, (id) => ({ checked: id === 'imgCleanup' ? cleanup : jet })); return l; };
  assert.deepEqual(writeRun({ fillMode: 'staggered' }, false, false), { fillMode: 'staggered' }, 'an old layer gains no key');
  assert.deepEqual(writeRun({}, true, false), { cleanup: true });
  assert.deepEqual(writeRun({ cleanup: true, jetOutline: true }, false, false), { cleanup: false, jetOutline: false });

  // Stats line.
  const format = new Function(`${extractFunction('function imageCleanupStatsText(stats){')}\nreturn imageCleanupStatsText;`)();
  assert.equal(format({ filled: 3, recoloured: 605, removed: 1, outlined: 0 }), 'Clean-up: +3 filled, 605 recoloured, 1 removed');
  assert.equal(format({ filled: 3, recoloured: 605, removed: 1, outlined: 192 }), 'Clean-up: +3 filled, 605 recoloured, 1 removed, 192 outlined');
  assert.equal(format({ skipped: 'not-lattice' }), 'Clean-up: skipped (stones are not on one lattice)');
  assert.equal(format(null), '');
  assert.ok(studio.includes("const cleanupText=imageCleanupStatsText(checkFixResult.cleanupStats);\n  el('imageStudioStatCleanup').textContent=cleanupText;el('imageStudioStatCleanup').hidden=!cleanupText;"), 'hidden when there is no text');
});

// ---- T8. IMG-024 leftovers (D10) ----------------------------------------------------------------------

await test('T8. D10: the #imageRedraw title; the inline Redraw style rules', () => {
  assert.match(indexHtml, /<button id="imageRedraw" class="btn sm" hidden title="Send this image to be redrawn by AI in the chosen style">Redraw with AI<\/button>/);
  assert.ok(indexHtml.includes('.image-redraw-style{display:flex;align-items:center;gap:6px;margin:0}'));
  assert.ok(indexHtml.includes('.image-redraw-style select{width:auto;height:var(--control-height-sm)}'));
  assert.ok(indexHtml.indexOf('.image-redraw-row label[hidden]{display:none}') < indexHtml.indexOf('.image-redraw-style{'), 'the hidden rule is kept');
});

await test('Registered in tools/test-groups.mjs', () => {
  assertTestRegistered({ filename: 'test-img-025-stone-cleanup.mjs', group: 'geometry', includedInDefault: true });
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exitCode = 1;
}
