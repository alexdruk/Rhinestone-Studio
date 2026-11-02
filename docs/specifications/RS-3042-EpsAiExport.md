# RS-3042 — Exporter fixes, EPS and AI

Part of the IS port (`docs/IS-PORT-PLAN.md`, section 3.8, items E1–E3). Source: PatternNifty at
`e9e7014`, `src/export/epsExport.js`, `src/export/aiExport.js` and `docs/IS-001-Spec.md` section 9.

## What changed

- **Gap on inch production sheets.** The Gap line is printed in mm, with the inch value after it
  at 3 decimals: `Gap: 0.1 mm (0.004 in)`. Before, `formatLengthDisplay(0.1, 'in')` rounded to 0
  and the sheet printed `Gap: 0 in`. mm sheets print exactly what they printed before, so the
  RS-3041 sheet hashes (all mm) are unchanged. `formatGapList()` in
  `src/export/ProductionSheetExporter.js`; the cover of a multi-page sheet uses the same line.
- **EPS** (`src/export/EpsExporter.js`, `stoneLayoutToEps(layout, { title })`). EPSF-3.0 written
  directly from the final StoneLayout, no Ghostscript or other tool. `%%BoundingBox` (whole points,
  rounded up) and `%%HiResBoundingBox` are the stones' footprint box at true size, origin bottom
  left. One filled circle per stone (`x y r C`) in its catalogue fill, the stones grouped by colour
  in first-appearance order, one `setrgbcolor` per colour; y is flipped. `%%Creator: Rhinestone
  Studio`; `%%Title` is the project name, non-ASCII characters replaced by `?`. Returns a string;
  IS's Node `Buffer` is not used.
- **AI** (`src/export/AiExporter.js`, `stoneLayoutToAi(layout)`). One page built with
  `PdfDocument`: the footprint box plus `AI_MARGIN_MM` (5 mm) on every side, the stones at true size
  in their catalogue fill with a 0.12 mm catalogue stroke, y flipped. Saved as `.ai`; Illustrator
  opens a PDF-compatible file.
- **Export dialog.** EPS and AI buttons under the DXF button in "Production geometry", for every
  product. Files: `rhinestone-design.eps` (`application/postscript`) and `rhinestone-design.ai`
  (`application/pdf`). An empty layout reports "Export failed: …" in the status bar.

Both exporters consume the final StoneLayout only, like every RS exporter: no GeometryEngine,
project, layer type or DOM, and they never create, move or resize stones.

## Not ported

- IS's production-sheet text (PatternNifty title and footer, no product lines): PatternNifty-only.
- E4, the PDF Info dictionary (`pdfInfo.js`), and E5, the PNG `pHYs` chunk: not in this brief.

## Tests

`tools/test-rs-3042-eps-ai-export.mjs` (exporters group): the inch and mm Gap lines (single page
and multi-page cover); the EPS header, bounding boxes, one circle per stone, colour groups and y
flip; the AI page size, page count, xref offsets, one circle per stone at its position and fill; on
a real multi-colour layout (`examples/multi-color-mixed-layers.rhs` through GeometryEngine), a
mixed-size multi-colour layout and a Jet/Crystal layout. `tools/test-production-export-validation.mjs`
test 14 now counts 12 export handlers.
