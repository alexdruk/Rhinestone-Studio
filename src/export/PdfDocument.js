/**
 * PdfDocument — minimal, dependency-free, deterministic single-page vector PDF writer.
 *
 * Generic: no knowledge of Stone/StoneLayout/production sheets. Supports lines, stroked/filled
 * rectangles, stroked/filled circles (four-Bezier approximation), and left-aligned text set in the
 * standard, non-embedded Helvetica font (WinAnsiEncoding — no font file is embedded, matching
 * docs/AI_ENGINEER.md's "prefer existing dependencies / browser-native capabilities" and "do not
 * add a dependency unless it materially reduces risk or complexity": every PDF viewer already has
 * Helvetica).
 *
 * All draw-method coordinates are PDF points in the PDF coordinate convention (origin bottom-left,
 * Y increases upward) — callers working in a top-down millimeter page space must convert units
 * (PT_PER_MM) and flip Y themselves before calling in.
 *
 * toBytes() never reads the clock, a random source, or any other non-deterministic input, so
 * identical draw calls always produce byte-identical output (per docs/ARCHITECTURE.md's
 * "deterministic output" engineering rule) — no /CreationDate or /ID is emitted, since neither can
 * be deterministic and both are optional per the PDF spec.
 */

export const PT_PER_MM = 72 / 25.4;

const CIRCLE_KAPPA = 0.5522847498307936;

function n(value) {
  // Fixed-precision formatting keeps output deterministic and compact; PDF readers accept any
  // number of decimal places on a real number operand.
  return (Math.round(value * 1000) / 1000).toString();
}

function escapePdfText(value) {
  return String(value).replace(/([()\\])/g, '\\$1');
}

// A PDF string literal drawn with a non-embedded standard font is interpreted through that font's
// declared encoding (WinAnsiEncoding here, essentially Latin-1/Windows-1252 for the printable
// range). Bytes are taken directly from each JS string character's code point; code points beyond
// Latin-1 have no representation in that encoding and are replaced with '?' rather than silently
// corrupting the byte stream (see docs/specifications/RS-1005-ProductionSheetGenerator.md, "Out of
// Scope" — full Unicode PDF text is an explicitly documented limitation, not a bug).
function latin1Bytes(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    bytes[i] = code <= 0xff ? code : 0x3f;
  }
  return bytes;
}

function concatBytes(chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function assertPositiveFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`PdfDocument requires a positive finite ${name}.`);
  }
}

export class PdfDocument {
  constructor({ widthPt, heightPt } = {}) {
    assertPositiveFiniteNumber(widthPt, 'widthPt');
    assertPositiveFiniteNumber(heightPt, 'heightPt');
    this.widthPt = widthPt;
    this.heightPt = heightPt;
    this.ops = [];
  }

  setLineWidth(pt) {
    this.ops.push(`${n(pt)} w`);
    return this;
  }

  setStrokeColor([r, g, b]) {
    this.ops.push(`${n(r)} ${n(g)} ${n(b)} RG`);
    return this;
  }

  setFillColor([r, g, b]) {
    this.ops.push(`${n(r)} ${n(g)} ${n(b)} rg`);
    return this;
  }

  drawLine(x1, y1, x2, y2) {
    this.ops.push(`${n(x1)} ${n(y1)} m`, `${n(x2)} ${n(y2)} l`, 'S');
    return this;
  }

  drawRect(x, y, w, h, { fill = false, stroke = true } = {}) {
    this.ops.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re`, fill && stroke ? 'B' : fill ? 'f' : 'S');
    return this;
  }

  /**
   * Four-cubic-Bezier circle approximation (kappa constant), the same technique
   * src/geometry/ArcProjection.js's neighbors in this codebase already use for curves elsewhere —
   * standard, widely documented, and exact to well within print tolerance.
   */
  drawCircle(cx, cy, r, { fill = false, stroke = true } = {}) {
    const k = r * CIRCLE_KAPPA;
    this.ops.push(
      `${n(cx + r)} ${n(cy)} m`,
      `${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)} c`,
      `${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)} c`,
      `${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)} c`,
      `${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)} c`,
      'h',
      fill && stroke ? 'B' : fill ? 'f' : 'S'
    );
    return this;
  }

  drawText(x, y, text, { sizePt = 10, color = [0, 0, 0] } = {}) {
    this.ops.push(
      `${n(color[0])} ${n(color[1])} ${n(color[2])} rg`,
      'BT',
      `/F1 ${n(sizePt)} Tf`,
      `${n(x)} ${n(y)} Td`,
      `(${escapePdfText(text)}) Tj`,
      'ET'
    );
    return this;
  }

  /**
   * Serializes a single-page PDF document (Catalog, Pages, Page, content stream, standard
   * Helvetica font — five objects total) with a correct cross-reference table, tracking byte
   * offsets by construction instead of guessing/measuring after the fact.
   *
   * @returns {Uint8Array}
   */
  toBytes() {
    const contentBytes = latin1Bytes(this.ops.join('\n'));

    const objectBodies = [
      latin1Bytes('<< /Type /Catalog /Pages 2 0 R >>'),
      latin1Bytes('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
      latin1Bytes(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(this.widthPt)} ${n(this.heightPt)}] ` +
          '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'
      ),
      concatBytes([
        latin1Bytes(`<< /Length ${contentBytes.length} >>\nstream\n`),
        contentBytes,
        latin1Bytes('\nendstream')
      ]),
      latin1Bytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    ];

    const chunks = [latin1Bytes('%PDF-1.4\n')];
    const objectOffsets = [];

    for (let i = 0; i < objectBodies.length; i++) {
      let offset = 0;
      for (const chunk of chunks) offset += chunk.length;
      objectOffsets.push(offset);
      chunks.push(latin1Bytes(`${i + 1} 0 obj\n`), objectBodies[i], latin1Bytes('\nendobj\n'));
    }

    let xrefOffset = 0;
    for (const chunk of chunks) xrefOffset += chunk.length;

    const objectCount = objectBodies.length + 1; // +1 for the free-list head (object 0)
    let xref = `xref\n0 ${objectCount}\n0000000000 65535 f \n`;
    for (const offset of objectOffsets) {
      xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    chunks.push(latin1Bytes(xref));
    chunks.push(
      latin1Bytes(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)
    );

    return concatBytes(chunks);
  }
}

export function createPdfDocument(options) {
  return new PdfDocument(options);
}
