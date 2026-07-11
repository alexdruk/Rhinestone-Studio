import assert from 'node:assert/strict';

// RS-1005 — verifies the generic, dependency-free PdfDocument writer: valid PDF structure (header/
// xref/trailer, correct byte offsets, correct /MediaBox), determinism, and that circle/text draw
// calls emit the expected operators. No knowledge of Stone/StoneLayout/production sheets here —
// see tools/test-production-sheet-exporter.mjs for that layer.

const { PdfDocument, PT_PER_MM, createPdfDocument } = await import('../src/export/PdfDocument.js');

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

function decode(bytes) {
  return Buffer.from(bytes).toString('latin1');
}

// Parses the trailing xref table of a document produced by PdfDocument and returns the byte
// offset recorded for each object number (1-indexed), by reading the table itself -- not by
// re-deriving offsets independently, so this is a genuine structural check of what toBytes()
// wrote, not a tautology.
function parseXrefOffsets(text) {
  const startxrefMatch = text.match(/startxref\n(\d+)\n%%EOF\s*$/);
  assert.ok(startxrefMatch, 'expected a startxref pointer before %%EOF');
  const xrefOffset = Number(startxrefMatch[1]);
  assert.equal(text.slice(xrefOffset, xrefOffset + 4), 'xref', 'startxref must point at the literal "xref" keyword');

  const sizeMatch = text.match(/xref\n0 (\d+)\n/);
  assert.ok(sizeMatch, 'expected "xref\\n0 <count>\\n"');
  const count = Number(sizeMatch[1]);

  const tableStart = xrefOffset + text.slice(xrefOffset).indexOf('\n', 5) + 1;
  const lines = text.slice(tableStart).split('\n');
  const offsets = [];
  for (let i = 0; i < count; i++) {
    const line = lines[i];
    assert.match(line, /^\d{10} \d{5} [nf] $/, `xref entry ${i} must be exactly 20 bytes: "nnnnnnnnnn ggggg n "`);
    offsets.push(Number(line.slice(0, 10)));
  }
  return offsets; // index 0 is the free-list head
}

function buildSampleDoc() {
  const doc = new PdfDocument({ widthPt: 300, heightPt: 200 });
  doc.setStrokeColor([0, 0, 0]).setLineWidth(1).drawLine(5, 5, 100, 100);
  doc.setFillColor([1, 0.5, 0]).drawCircle(60, 60, 20, { fill: true, stroke: true });
  doc.drawText(10, 180, 'Hello Production', { sizePt: 12 });
  return doc;
}

await test('1. toBytes() starts with %PDF-1.4 and ends with %%EOF', () => {
  const bytes = buildSampleDoc().toBytes();
  const text = decode(bytes);
  assert.ok(text.startsWith('%PDF-1.4'), 'expected the document to start with the PDF header');
  assert.ok(text.trimEnd().endsWith('%%EOF'), 'expected the document to end with %%EOF');
});

await test('2. every non-free xref offset points at the matching "N 0 obj"', () => {
  const bytes = buildSampleDoc().toBytes();
  const text = decode(bytes);
  const offsets = parseXrefOffsets(text);
  assert.equal(offsets[0], 0, 'object 0 (free-list head) always records offset 0');
  for (let objectNumber = 1; objectNumber < offsets.length; objectNumber++) {
    const offset = offsets[objectNumber];
    const slice = text.slice(offset, offset + `${objectNumber} 0 obj`.length);
    assert.equal(slice, `${objectNumber} 0 obj`, `object ${objectNumber}'s xref offset must point at its own "N 0 obj"`);
  }
});

await test('3. /MediaBox matches the requested widthPt/heightPt', () => {
  const bytes = new PdfDocument({ widthPt: 421.5, heightPt: 297.6 }).toBytes();
  const text = decode(bytes);
  assert.match(text, /\/MediaBox \[0 0 421\.5 297\.6\]/);
});

await test('4. identical draw calls produce byte-identical output (deterministic, no timestamp/ID)', () => {
  const a = buildSampleDoc().toBytes();
  const b = buildSampleDoc().toBytes();
  assert.equal(decode(a), decode(b));
  assert.equal(a.length, b.length);
});

await test('5. different draw calls produce different output (not hardcoded)', () => {
  const a = buildSampleDoc().toBytes();
  const other = new PdfDocument({ widthPt: 300, heightPt: 200 });
  other.drawText(10, 180, 'Something else entirely', { sizePt: 12 });
  const b = other.toBytes();
  assert.notEqual(decode(a), decode(b));
});

await test('6. drawCircle emits four Bezier "c" operators and a fill+stroke ("B") operator', () => {
  const doc = new PdfDocument({ widthPt: 100, heightPt: 100 });
  doc.drawCircle(50, 50, 10, { fill: true, stroke: true });
  const text = decode(doc.toBytes());
  const cCount = (text.match(/ c\n/g) || []).length;
  assert.equal(cCount, 4, 'expected exactly four cubic-Bezier "c" operators for one circle');
  assert.match(text, /\nB\n/, 'expected a fill+stroke "B" operator');
});

await test('7. drawCircle with only stroke emits "S", only fill emits "f"', () => {
  const strokeOnly = decode(new PdfDocument({ widthPt: 50, heightPt: 50 }).drawCircle(25, 25, 5, { stroke: true, fill: false }).toBytes());
  assert.match(strokeOnly, /\nS\n/);
  const fillOnly = decode(new PdfDocument({ widthPt: 50, heightPt: 50 }).drawCircle(25, 25, 5, { stroke: false, fill: true }).toBytes());
  assert.match(fillOnly, /\nf\n/);
});

await test('8. drawText emits a BT/Tf/Td/Tj/ET sequence containing the escaped string', () => {
  const doc = new PdfDocument({ widthPt: 100, heightPt: 100 });
  doc.drawText(3, 4, 'Gap (0.3mm)', { sizePt: 9 });
  const text = decode(doc.toBytes());
  assert.match(text, /BT\n\/F1 9 Tf\n3 4 Td\n\(Gap \\\(0\.3mm\\\)\) Tj\nET/, 'expected parentheses to be escaped and operators in order');
});

await test('9. text outside Latin-1 is replaced with "?" instead of corrupting the byte stream', () => {
  const doc = new PdfDocument({ widthPt: 100, heightPt: 100 });
  doc.drawText(0, 0, 'CJK: 中文', { sizePt: 9 });
  const bytes = doc.toBytes();
  const text = decode(bytes);
  assert.match(text, /\(CJK: \?\?\) Tj/);
  // The document must still be structurally valid (byte offsets unaffected by the substitution).
  parseXrefOffsets(text);
});

await test('10. PT_PER_MM converts 25.4mm to exactly 72pt', () => {
  assert.ok(Math.abs(25.4 * PT_PER_MM - 72) < 1e-9);
});

await test('11. constructor rejects non-positive/non-finite widthPt/heightPt', () => {
  assert.throws(() => new PdfDocument({ widthPt: 0, heightPt: 100 }), TypeError);
  assert.throws(() => new PdfDocument({ widthPt: 100, heightPt: -1 }), TypeError);
  assert.throws(() => new PdfDocument({ widthPt: NaN, heightPt: 100 }), TypeError);
  assert.throws(() => new PdfDocument({ widthPt: 100, heightPt: undefined }), TypeError);
});

await test('12. createPdfDocument() is a functional equivalent of "new PdfDocument()"', () => {
  const doc = createPdfDocument({ widthPt: 100, heightPt: 100 });
  assert.ok(doc instanceof PdfDocument);
});

console.log('PdfDocument tests passed.');
