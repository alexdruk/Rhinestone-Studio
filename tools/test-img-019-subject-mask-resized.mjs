import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  prepareImageField, resizeImageBuffer, SUBJECT_MASK_RESIZE_TRIGGER_PX, SUBJECT_MASK_MAX_DIMENSION_PX
} from '../src/image/ImageFieldPipeline.js';
import { resizeField } from '../src/image/Resize.js';
import { blurMask } from '../src/image/Blur.js';
import { computeSubjectMask } from '../src/image/SubjectMask.js';
import { generateLineDesignStonePoints } from '../src/geometry/LineDesignSampler.js';
import { STONE_COLORS } from '../src/renderer/StoneColors.js';

// IMG-019 -- subject mask on a resized copy. Above SUBJECT_MASK_RESIZE_TRIGGER_PX on the longer side,
// prepareImageField()'s 'subject' mask is computed on a box-resized RGBA copy capped at
// SUBJECT_MASK_MAX_DIMENSION_PX (decision 1) and mapped back to native size by nearest lookup
// (decision 2). Line Design keeps the native mask (decision 3); 'threshold' and 'whole' are unchanged
// (decision 4). See docs/specifications/IMG-019-SubjectMaskResized.md.
//
// T1 pins the on-counts either side of the trigger, T2 the trigger boundary on both axes, T3 the
// one-pass RGBA resize against four resizeField() calls, T4 Line Design and T5 the other mask modes.
// Mutation-tested: trigger > becoming >= (T2, T1), cap 800 becoming 400 (T1), the nearest mapping
// swapping x and y (T2), Line Design routed through the resized path (T4).

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

const PALETTE = Object.values(STONE_COLORS).map((c) => ({ id: c.id, hex: c.previewColor }));

function ringFixture(side) {
  const widthPx = side, heightPx = side;
  const data = new Uint8ClampedArray(side * side * 4);
  const c = side / 2;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const o = (y * side + x) * 4;
      const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      let rgb = [255, 255, 255];
      if (r < side * 0.1) rgb = [40, 40, 160];
      else if (Math.abs(r - side * 0.3) < 0.75) rgb = [200, 200, 200];
      data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
    }
  }
  return { widthPx, heightPx, data };
}

function cropFixture(source, widthPx, heightPx) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y++) {
    data.set(source.data.subarray(y * source.widthPx * 4, (y * source.widthPx + widthPx) * 4), y * widthPx * 4);
  }
  return { widthPx, heightPx, data };
}

function rgbaFixture() {
  const widthPx = 1237, heightPx = 611;
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const o = (y * widthPx + x) * 4;
      data[o] = (x * 7 + y * 3) % 256; data[o + 1] = (x * y) % 256; data[o + 2] = (x ^ y) & 255;
      data[o + 3] = (x + 2 * y) % 97 < 30 ? 0 : 255 - (x % 64);
    }
  }
  return { widthPx, heightPx, data };
}

const onCount = (data) => data.reduce((sum, v) => sum + (v > 127 ? 1 : 0), 0);
const assertSame = (actual, expected, message) => assert.ok(isDeepStrictEqual(actual, expected), message);

// Decision 1's definition, written out: four resizeField() calls on the separated channels,
// interleaved back into RGBA.
function resizeByChannel(buffer, maxWidthPx, maxHeightPx) {
  const n = buffer.widthPx * buffer.heightPx;
  const channels = [0, 1, 2, 3].map((c) => {
    const data = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) data[i] = buffer.data[i * 4 + c];
    return resizeField({ widthPx: buffer.widthPx, heightPx: buffer.heightPx, data }, maxWidthPx, maxHeightPx);
  });
  const { widthPx, heightPx } = channels[0];
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let i = 0; i < widthPx * heightPx; i++) {
    for (let c = 0; c < 4; c++) data[i * 4 + c] = channels[c].data[i];
  }
  return { widthPx, heightPx, data };
}

// Decisions 1 and 2, written out: the mask of the 800 px copy, mapped back by nearest lookup.
function resizedSubjectMask(buffer) {
  const small = computeSubjectMask(resizeByChannel(buffer, 800, 800), {}).mask;
  const w = small.widthPx, h = small.heightPx, W = buffer.widthPx, H = buffer.heightPx;
  const data = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      data[y * W + x] = small.data[Math.min(h - 1, Math.floor(y * h / H)) * w + Math.min(w - 1, Math.floor(x * w / W))];
    }
  }
  return { widthPx: W, heightPx: H, data };
}

const pipelineAfterMask = (mask) => resizeField(blurMask(mask, 0), 400, 400).data;

const ring1200 = ringFixture(1200);

await test('Constants: trigger 1000 px, cap 800 px (decisions 1 and 6)', () => {
  assert.equal(SUBJECT_MASK_RESIZE_TRIGGER_PX, 1000);
  assert.equal(SUBJECT_MASK_MAX_DIMENSION_PX, 800);
});

await test('T1. ringFixture(1000) gives 45528 on-pixels (native path); ringFixture(1200) gives 5034 (resized path)', () => {
  const params = { maskMode: 'subject', transparent: 'ignore', maxWidthPx: 400, maxHeightPx: 400 };
  assert.equal(onCount(prepareImageField(ringFixture(1000), params).data), 45528);
  assert.equal(onCount(prepareImageField(ring1200, params).data), 5034);
});

await test('T2. Trigger boundary: 1000x700 takes the native path; 1001x700 and 700x1001 take the resized path', () => {
  const params = { maskMode: 'subject', maxWidthPx: 400, maxHeightPx: 400 };
  const cases = [
    { widthPx: 1000, heightPx: 700, path: 'native', nativeOn: 7346, resizedOn: 6929 },
    { widthPx: 1001, heightPx: 700, path: 'resized', nativeOn: 7337, resizedOn: 6952 },
    { widthPx: 700, heightPx: 1001, path: 'resized', nativeOn: 7337, resizedOn: 6952 }
  ];
  for (const { widthPx, heightPx, path, nativeOn, resizedOn } of cases) {
    const fixture = cropFixture(ring1200, widthPx, heightPx);
    const nativeRef = pipelineAfterMask(computeSubjectMask(fixture, {}).mask);
    const resizedRef = pipelineAfterMask(resizedSubjectMask(fixture));
    assert.equal(onCount(nativeRef), nativeOn, `${widthPx}x${heightPx} native reference on-count`);
    assert.equal(onCount(resizedRef), resizedOn, `${widthPx}x${heightPx} resized reference on-count`);
    assert.ok(!isDeepStrictEqual(nativeRef, resizedRef), `${widthPx}x${heightPx}: the two references must differ`);
    const actual = prepareImageField(fixture, params).data;
    assertSame(actual, path === 'native' ? nativeRef : resizedRef, `${widthPx}x${heightPx} should take the ${path} path`);
  }
});

await test('T3. resizeImageBuffer() is byte-identical to four resizeField() calls on rgbaFixture() (800x395)', () => {
  const fixture = rgbaFixture();
  const actual = resizeImageBuffer(fixture, 800, 800);
  const expected = resizeByChannel(fixture, 800, 800);
  assert.equal(actual.widthPx, 800);
  assert.equal(actual.heightPx, 395);
  assert.equal(expected.widthPx, 800);
  assert.equal(expected.heightPx, 395);
  assertSame(actual.data, expected.data, 'the one-pass RGBA resize differs from four resizeField() calls');
});

await test('T4. Line Design on ringFixture(1200) is unchanged: 302 stones, pinned digest', () => {
  const stones = generateLineDesignStonePoints({
    imageBuffer: ring1200, placement: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 }, gapMm: 0.3, layerId: 'img019', palette: PALETTE
  });
  const kinds = {};
  for (const s of stones) kinds[s.kind] = (kinds[s.kind] || 0) + 1;
  assert.equal(stones.length, 302);
  assert.deepEqual(kinds, { outline: 77, fill: 219, pocket: 6 });
  const digest = crypto.createHash('sha256').update(JSON.stringify(stones.map((s) => [s.xMm, s.yMm, s.sizeMm, s.color, s.kind]))).digest('hex');
  assert.equal(digest, 'dc7c07a728f8951fb3ad5cdb93308e1acb0f56eaafea912112ecd67bcaeb983c');
});

await test("T5. 'threshold' and 'whole' fields on ringFixture(1200) are unchanged (pinned digests)", () => {
  const fieldDigest = (field) => {
    const hash = crypto.createHash('sha256');
    for (const channel of [field.data, field.luminance, field.alpha, field.edge]) {
      hash.update(Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength));
    }
    return hash.digest('hex');
  };
  const params = { transparent: 'ignore', maxWidthPx: 400, maxHeightPx: 400 };
  assert.equal(
    fieldDigest(prepareImageField(ring1200, { ...params, maskMode: 'threshold', threshold: 128 })),
    '54ad5095bbad8da6297a76cea23e7a7273f4b3399682a856e1774656623bbc66'
  );
  assert.equal(
    fieldDigest(prepareImageField(ring1200, { ...params, maskMode: 'whole' })),
    '1acc564dced309c349efb708c66a8650921bf31168c59eae656ed7cbebe33930'
  );
});
