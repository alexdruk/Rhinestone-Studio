# RS-3041 — Multi-page Production Sheets

**Status:** spec. Branch `feature/rs-3041-multi-page` off `develop` @ `c546685`. No source or test
file changes in this step.

**Authorises:** a Production Sheet that does not fit one page is exported as a PDF of a cover page
plus N tiled pages at true size, instead of failing. The single-page sheet, and every byte of its
SVG/PDF/PNG output, is unchanged.

The decisions below (D1–D14) are Claude's and are product-approved by Sasha. They are recorded
here, not reopened.

---

## 1. Current state (`develop` @ `c546685`)

Anchors re-grepped at this tip.

`src/export/ProductionSheetExporter.js`

| Anchor | Line | Today |
|---|---|---|
| `PAGE_SIZES` | 35 | A4 210×297, Letter 215.9×279.4, A3 297×420 |
| `computeHeaderHeightMm(extraBodyLineCount)` | 59 | 2 + 7.5 + (7 + extra) × 4.4 + 10 mm |
| `FOOTER_HEIGHT_MM` | 62 | 16 mm; scale bar sits in it |
| `resolvePageOrientation()` | 191 | portrait, then landscape; throws the fit `RangeError` at 204 when neither fits |
| `computeProductionSheetLayout()` | 272 | one page; mirror is `W - x` at 358 |
| `productionSheetToSvg()` | 439 | renders `computeProductionSheetLayout()` |
| `productionSheetToPdf()` | 481 | renders `computeProductionSheetLayout()` into one `PdfDocument` |

`src/export/PdfDocument.js`

| Anchor | Line | Today |
|---|---|---|
| `class PdfDocument` | 68 | one `widthPt`/`heightPt`, one `ops` array |
| `toBytes()` | 140 | single page, five objects: 1 Catalog, 2 Pages (`/Kids [3 0 R] /Count 1`), 3 Page, 4 content stream, 5 Helvetica |

`app.js`

| Anchor | Line |
|---|---|
| import of the exporter | 98 |
| `updateProdSheetReadabilityValidation()` | 5612 (RS-3038 outside-area block 5621–5633) |
| `currentProductionSheetOptions()` | 5636 |
| `#exportProdSheetSVG` handler | 5638 |
| `#exportProdSheetPDF` handler | 5639 |
| `#exportProdSheetPNG` handler | 5645 (calls `productionSheetToSvg()` at 5648 before `computeProductionSheetLayout()` at 5649) |
| option-change refresh loop | 5665 |
| lightbox `onOpen` refresh | 5724 |

`index.html`: `#prodSheetPageSize` at 1291 (A4, Letter, A3); `#prodSheetValidation` at 1303.

The tests that pin today's fit `RangeError` live in `tools/`, not `tests/`:
`tools/test-production-sheet-exporter.mjs` tests 2 (line 76) and 16 (line 282), and
`tools/test-rs-3037-flat-sheet.mjs` test 12 (line 412). Test 13 of the exporter test (line 225,
margin too large) also pins it.

---

## 2. Decisions

**D1. `computeProductionSheetLayout()` is unchanged**, including its `RangeError` when one page does
not fit. Every existing test that pins that `RangeError` stays as it is:
`tools/test-production-sheet-exporter.mjs` tests 2 and 16, `tools/test-rs-3037-flat-sheet.mjs`
test 12 (and exporter test 13, which pins the same error).

**D2. New pure export `computeProductionSheetDocument(stoneLayout, options)`**, same options as
`computeProductionSheetLayout()`. It first calls `computeProductionSheetLayout()`; if that succeeds it
returns `{ multiPage: false, pages: [thatLayout] }`. Only when that throws the fit `RangeError` does
it build a multi-page document. Any other error (a `TypeError` from input validation) propagates
unchanged.

**D3. Grid choice.** New constants `TILE_LABEL_HEIGHT_MM = 8` and `OVERLAP_MM = 8`; the tile footer
reuses `FOOTER_HEIGHT_MM` (16). With `W`/`H` the production size and `margin` the margin, for
portrait first, then landscape, of the chosen page size:

```
cellW = pageW - 2*margin - 2*OVERLAP_MM
cellH = pageH - 2*margin - TILE_LABEL_HEIGHT_MM - FOOTER_HEIGHT_MM - 2*OVERLAP_MM
```

Skip an orientation where either is `<= 0`. `cols = ceil(W / cellW)`, `rows = ceil(H / cellH)`. Pick
the fewest `cols * rows`, strict less-than, so ties stay portrait. Tiles split the production area
evenly: `tileW = W / cols`, `tileH = H / rows`. Every page of the document, cover included, uses that
one orientation. If neither orientation works, throw a `RangeError` whose message is exactly:

```
Production sheet does not fit <pageSize> at margin <margin>mm, even split across pages. Reduce the margin or choose a larger page size.
```

`<margin>` is formatted the way `resolvePageOrientation()` formats it today
(`ProductionSheetExporter.js:205`, the raw `marginMm` value interpolated as `${marginMm}mm`).

**D4. Mirror first, then tiling.** Mirror is applied first (`x` becomes `W - x`, as today at
`ProductionSheetExporter.js:358`), then tiling, in that order.

**D5. Ownership.** Each stone belongs to exactly one tile:
`col = clamp(floor(x / tileW), 0, cols - 1)`, `row = clamp(floor(y / tileH), 0, rows - 1)`, with `x`
already mirrored. Clamping keeps stones outside the production area (RS-3038) on the edge tiles, so
the owned counts always sum to the total.

**D6. Overlap ghosts.** A stone is a ghost on tile `(r, c)` when it is not owned by `(r, c)` and its
centre lies in the half-open box
`[c*tileW - 8, (c+1)*tileW + 8) × [r*tileH - 8, (r+1)*tileH + 8)`. Diagonal neighbours count. Ghosts
are drawn as light grey outlines with no fill, and are never counted as stones.

**D7. Labels.** Rows are lettered A, B, C… from top to bottom; columns are numbered 1, 2, 3… from
left to right as printed, after mirroring. Pages are ordered row by row: A1, A2, B1, B2…

**D8. Cover page, first.** The same header lines as today, plus one line
`Pages: cover + N (C columns × R rows), overlap 8 mm`. Below that, a page map: the production area
split into its tile grid, each tile labelled with its name and owned stone count, scaled to fit the
remaining printable area, and captioned `Page map, not to scale`. The map needs at least 40 mm of
height, otherwise throw a `RangeError` whose message is exactly:

```
Production sheet cover page has no room for the page map on <pageSize> at margin <margin>mm. Reduce the margin or choose a larger page size.
```

`<margin>` is formatted as in D3.

**D9. Tile page.** Top line (`TILE_LABEL_HEIGHT_MM`):
`<project> · Page B2 of N · <owned count> stones · grey stones belong to neighbouring pages`. The tile
is placed at true size, centred in its cell, with its outline drawn dashed as the cut line.
Registration marks go at the tile's four corners when registration marks are on. Owned stones are
drawn exactly as today, whole even where they cross the cut line. Ghosts as in D6. The scale bar goes
in the footer, as today.

**D10. PDF.** `PdfDocument` gains multi-page output (for example an `addPage()` and a `toBytes()` that
writes N pages). Single-page PDF bytes must stay byte-identical to today's.
`productionSheetToPdf()` renders `computeProductionSheetDocument()`.

**D11. SVG and PNG.** `productionSheetToSvg()` still produces one page. When the design needs more
than one page it throws a `RangeError` whose message uses "page" when N is 1 and "pages" otherwise,
exactly:

```
This Production Sheet needs 1 page on <pageSize> plus a cover page. Export it as PDF.
This Production Sheet needs N pages on <pageSize> plus a cover page. Export it as PDF.
```

The PNG path goes through the SVG path (`app.js:5648`), so it gets the same message; the existing
RS-3038 catch blocks show it.

**D12. Panel note.** When multi-page applies, `#prodSheetValidation` shows a non-blocking line

```
Spans N pages on <pageSize> (C × R) plus a cover page; export as PDF.
```

alongside the RS-3038 outside-area warning, never replacing it. Nothing is disabled.

**D13. No stone moves, no project or schema change, and object templates are not special-cased.**
This applies to plates on A4/Letter too.

**D14. Two BACKLOG rows:** page seams shown in Design; per-colour counts on each tile page. Added to
`docs/BACKLOG.md` in this commit.

---

## 3. Build notes

These pin down what D1–D14 leave to the implementation. They do not change any decision.

### 3.1 `ProductionSheetExporter.js`

- `computeProductionSheetDocument()` recognises the fit error as a `RangeError` thrown by
  `computeProductionSheetLayout()` after its own input validation has passed; the simplest correct
  form is to catch `RangeError` only and rethrow everything else.
- The multi-page result is `{ multiPage: true, pageSize, orientation, pageWidthMm, pageHeightMm,
  cols, rows, tileWidthMm, tileHeightMm, pages: [cover, ...tiles] }`. `pages.length === N + 1`,
  `N = cols * rows`. Each tile page carries its `name` (`A1`…), `ownedCount`, `ownedStones` and
  `ghostStones` (both already in page space), its tile rect, cut-line rect, registration marks and
  scale reference, in the same shape `computeProductionSheetLayout()` already returns them so the SVG
  and PDF renderers share drawing code.
- Tile page geometry, in top-down page mm: cell left = `margin + OVERLAP_MM`, cell top =
  `margin + TILE_LABEL_HEIGHT_MM + OVERLAP_MM`; the `tileW × tileH` rect is centred in the
  `cellW × cellH` cell; a stone at mirrored `(x, y)` lands at
  `(tileLeft + x - c*tileW, tileTop + y - r*tileH)`. Because `tileW <= cellW` and `tileH <= cellH`,
  every ghost centre falls inside the 8 mm overlap band around the tile. Footer top =
  `pageH - margin - FOOTER_HEIGHT_MM`; scale bar at the tile rect's left edge, as today.
- Registration marks reuse `REG_MARK_GAP_MM`/`REG_MARK_ARM_MM` (5.5 mm total), which stays inside the
  8 mm overlap band.
- Cover page: header built by the same code path as today's header, with the D8 `Pages:` line
  appended and counted in `computeHeaderHeightMm()`. The map's available height is the printable
  height minus the cover header height; below 40 mm → `RangeError`. Worked examples: the fixture
  below (2 colours) has a 63.5 mm cover header, leaving 213.5 mm on A4 portrait and 126.5 mm on A4
  landscape; test 12's 8-colour layout has an 89.9 mm header, leaving 169.5 mm on Letter portrait.
- A dashed cut line is new to both renderers: SVG `stroke-dasharray`, PDF the `d` operator via a new
  `PdfDocument.setDash()`. Ghost grey and the dash pattern are named constants.
- The owned-stones loop must not recompute or move a stone: it only re-projects `stone.xMm`/`yMm`,
  exactly like `computeProductionSheetLayout()` does today (D13).

### 3.2 `PdfDocument.js`

Object numbering that makes D10's byte identity hold by construction: 1 Catalog, 2 Pages
(`/Kids [3 0 R 5 0 R …] /Count N`), then for page `i` (0-based) Page object `3 + 2i` and its content
stream `4 + 2i`, then Helvetica last at `3 + 2N`. For N = 1 that is exactly today's 1–5, and every
page references the single font object. Each page keeps its own `widthPt`/`heightPt` and its own
`/MediaBox`. The constructor still opens the first page, so every existing caller and
`tools/test-pdf-document.mjs` are untouched.

### 3.3 `app.js`

- Line 98's import adds `computeProductionSheetDocument`.
- `updateProdSheetReadabilityValidation()`: after the RS-3038 outside-area block, when `layout` is
  ready, call `computeProductionSheetDocument(layout, currentProductionSheetOptions())` inside a
  `try`; if `multiPage` is true, append the D12 line with the same `message=message?…:…` join. If it
  throws, add nothing: the export handlers already report that error. It is already refreshed on
  option change (5665) and on lightbox open (5724).
- The three export handlers need no change: SVG and PNG surface the D11 `RangeError` through their
  existing catch blocks, and PDF simply stops failing.

### 3.4 Existing tests expected to move

Source-scraping tests the build will have to update (not a behaviour change):

- `tools/test-production-sheet-exporter.mjs` test 20 regex-matches line 98's exact import list.
- `tools/test-rs-3038-prod-sheet-messages.mjs` tests 2 and 3 build
  `updateProdSheetReadabilityValidation()` via `new Function(...)` with an explicit dependency list
  (line 108), which must gain `computeProductionSheetDocument` and `currentProductionSheetOptions`
  (a stub).

---

## 4. Pinned figures

Fixture generator, verbatim:

```js
function fixture(W,H){const s=[];const p=2.3,rh=p*Math.sqrt(3)/2;let r=0;for(let y=1;y<=H-1+1e-9;y+=rh,r++){for(let x=1+(r%2?p/2:0);x<=W-1+1e-9;x+=p)if(x<=0.7*W)s.push({xMm:x,yMm:y,sizeMm:2,color:x<W/2?'jet':'crystal'})}return s}
```

The layout is `{ stones: fixture(W, H) }`; options are `marginMm 10`, `registrationMarks true`,
`gapMm [0.3]`, `units 'mm'`, mirror off unless stated.

Owned / ghost per page, in page order:

| Case | Grid | Tile | Total | Owned | Ghost |
|---|---|---|---|---|---|
| 220×220 A4 | portrait, 2 cols × 1 row | 110×220 | 7370 | A1 5225, A2 2145 | A1 385, A2 385 |
| 220×220 A4, mirror on | same grid | 110×220 | 7370 | A1 2145, A2 5225 | A1 385, A2 385 |
| 300×300 A4 | portrait, 2 × 2 | 150×150 | 13650 | A1 4875, A2 1950, B1 4875, B2 1950 | A1 537, A2 380, B1 536, B2 381 |
| 500×500 A4 | landscape, 2 cols × 4 rows | 250×125 | 38152 | A1 6836, A2 2740, B1 6835, B2 2741, C1 6727, C2 2697, D1 6836, D2 2740 | A1 668, A2 409, B1 1117, B2 596, C1 1225, C2 640, D1 668, D2 409 |
| 150×150 A4 | single page, `{ multiPage: false }` | — | — | — | — |
| `tools/test-rs-3037-flat-sheet.mjs` test 12's 8-colour layout, 158×158 Letter | `computeProductionSheetLayout()` still throws; cover + 1 page, 1 × 1, portrait | 158×158 | 24 | A1 24 | A1 0 |
| 300×300 A4, margin 54 | landscape, 2 cols × 5 rows; cover map 38.5 mm → D8 `RangeError` | — | — | — | — |
| 300×300 A4, margin 53 | portrait, 4 cols × 2 rows, 8 pages; succeeds | — | — | — | — |

150×150 A4: the PDF bytes are identical to `productionSheetToPdf()` at `c546685` (911 434 bytes,
SHA-256 `723020417f9cb8befdddf28ac73dce5218d50d9cc653ce9537f4f98e8e7e4928` with the options above).
The SVG is identical to `productionSheetToSvg()` at `c546685` (397 684 characters, SHA-256
`3414abee87a8bd597dc916a43e78a760cace4d71f9575db1eb1b556747853bd2`, same options).

Margin 54/53 (map floor, D8): the cover header is 63.5 mm (two colour lines plus the `Pages:` line).
At margin 54 landscape (2 × 5 = 10) beats portrait (4 × 3 = 12), leaving 210 − 108 − 63.5 = 38.5 mm
for the map. At margin 53 portrait (4 × 2 = 8) beats landscape (2 × 5 = 10), leaving
297 − 106 − 63.5 = 127.5 mm.

220×220 A4 is the tie case: portrait gives 2 × 1 and landscape gives 1 × 2, so portrait wins (D3).

**Independent derivation at this tip.** A scratch script (not committed) implementing D3–D6 directly
over `computeProductionSheetLayout()` and `PAGE_SIZES` reproduced every figure above exactly,
including the owned sums (7370, 13650, 38152, 24). It also confirmed both mutants fail: tiling before
mirroring gives 220×220 mirror-on owned A1 5225 / A2 2145 (pinned 2145 / 5225), and ghosts off gives
0 on every 500×500 page. A second scratch script reproduced the margin 54/53 rows and the SVG
character count and SHA-256.

---

## 5. Test plan

New `tools/test-rs-3041-multi-page.mjs` (the build step writes it):

Items 4, 5 and 9 are audit checks, run by hand when reviewing the build, not test code: tests never
mutate source or run git. Items 1 and 3 are what kill the mirror and ghost mutants in the test file.

1. Every pinned figure in §4: grid, orientation, tile size, total, owned and ghost per page, in page
   order.
2. Owned counts sum to the total for every multi-page case.
3. No stone is owned twice: each input stone index appears in exactly one tile's owned set.
4. *(Audit check.)* Mirror mutant: tiling before mirroring fails the 220×220 mirror-on row.
5. *(Audit check.)* Ghost mutant: a document with ghosts off fails the ghost counts.
6. D11: `productionSheetToSvg()` throws a `RangeError` whose message equals exactly
   `This Production Sheet needs 4 pages on A4 plus a cover page. Export it as PDF.` for 300×300 A4,
   and exactly
   `This Production Sheet needs 1 page on Letter plus a cover page. Export it as PDF.` for
   `tools/test-rs-3037-flat-sheet.mjs` test 12's layout at 158×158 Letter.
7. Single page is byte-identical: 150×150 A4 SVG string and PDF bytes equal today's, both against
   the §4 figures (SVG 397 684 characters, SHA-256 `3414abee…53bd2`; PDF 911 434 bytes, SHA-256
   `72302041…e4928`).
8. The multi-page PDF has N + 1 pages (`/Count N+1`, N+1 `/Type /Page` objects), each with the right
   `/MediaBox` (A4 portrait 595.276 × 841.89 pt for 220 and 300; A4 landscape 841.89 × 595.276 pt for
   500), and every xref offset points at its own `N 0 obj`.
9. *(Audit check.)* The three pinned `RangeError` tests are untouched: `git diff c546685 --` on
   `tools/test-production-sheet-exporter.mjs` shows no change to tests 2 or 16, and on
   `tools/test-rs-3037-flat-sheet.mjs` none to test 12; all three still pass.
10. D12: the note appears in `#prodSheetValidation` only when multi-page applies (present for
    300×300 A4, absent for 150×150 A4), and appears alongside, not instead of, the RS-3038
    outside-area warning.
11. D8's 40 mm floor, on the §4 fixture at 300×300 A4: margin 54 throws a `RangeError` whose message
    equals exactly
    `Production sheet cover page has no room for the page map on A4 at margin 54mm. Reduce the margin or choose a larger page size.`
    (landscape 2 × 5, map 38.5 mm); margin 53 succeeds, portrait 4 × 2, 8 tile pages.

---

## 6. Out of scope

- Page seams in Design, and per-colour counts on each tile page (D14, BACKLOG).
- Any stone move, project or schema change, or template special case (D13).
- Multi-page SVG or PNG (D11).
