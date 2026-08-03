# TXT-104 — Text Height Accuracy Design

Status: **design/audit only**. No `src/**`, `app.js`, `index.html`, or test file was changed for
this milestone. This document is the sole deliverable, alongside `TASK.md`/`TASK_RESULT.md`.

Reviewed against: `feature/txt-104-text-height-accuracy` @ `e3cc809` (branched from `develop`
immediately after RS-2013 step 7's texture-rendering removal).

---

## 0. Prominent finding: ARCH-REVIEW-001's "closed" claim is not accurate — re-opening this gap

**ARCH-REVIEW-001 (`docs/specifications/ARCH-REVIEW-001-FullArchitectureAndCodebaseReview.md:27`)
lists finding #5, "`heightMm` is em size, not physical letter height," as already closed:**

> `heightMm` is em size, not physical letter height | Audited end-to-end by `TXT-103A`, with a live
> clamp (`TXT-103`) already shipped.

**This is a mischaracterization of what `TXT-103A` actually did, and this milestone's audit finds
the underlying gap fully open, never measured, and never fixed by any shipped milestone.**

Having read `TXT-103A` in full (`docs/specifications/TXT-103A-TextSizingArchitectureAudit.md`), its
entire scope is a different question: *is it safe to change `heightMm`* (does it regenerate
geometry rather than illegally re-scaling already-generated stone positions?). It answers that
question thoroughly and correctly (see §1 below — every one of those findings re-checks out). But
**`TXT-103A` never once discusses em-box proportions, ascender/descender ratios, cap-height,
x-height, or any font-metrics table** — the words "cap height," "x-height," and "em box" do not
appear anywhere in that document. It never measures how far a requested `heightMm` diverges from a
font's actual rendered letter height. `TXT-103` (the clamp `TXT-103A` recommended and a later
milestone shipped, `app.js:1048-1058`) only bounds the *raw* `heightMm` field to a sane numeric
range (`[4, 111]`) — it does not correct what that number means.

So: **the actual, literal claim in ARCH-REVIEW-001's finding #5 — that a user-requested `heightMm`
does not correspond 1:1 to actual rendered letter height, because em-box conventions vary per
typeface — was never audited by `TXT-103A` and remains fully live in the current codebase.** §2
below quantifies it with real measurements from the six shipped/validated font files: it ranges
from a 14% to a 38% discrepancy between requested and actual cap height, and the ratio is
different enough per font family that no single constant correction works across the portfolio.

Everything `TXT-103A` *did* verify (safe regeneration, no illegal point-scaling, RS Block's
fixed-pitch behavior, exporter correctness) is re-confirmed still accurate below and this design
builds on top of it without re-litigating it.

---

## 1. Re-verification of TXT-103A's findings against current code

Method: every specific, checkable claim in `TXT-103A` is restated below with its current status.
"Still accurate" means re-reading the cited (or renamed/moved) code confirms the claim holds today,
unchanged in substance. Files/line numbers below are current, not `TXT-103A`'s originals, where
they've moved.

| # | TXT-103A claim | Status | Current evidence |
|---|---|---|---|
| 1 | Changing `heightMm` regenerates glyph contours and resamples at the fixed `stoneSizeMm`/`gapMm` pitch, unconditionally, every call | **Still accurate** | `OpenTypeProvider.getTextPath()` still computes `unitsToMm = heightMm / font.unitsPerEm` fresh every call and calls `glyph.getPath(advanceWidthMm, 0, heightMm)` per character (`src/text/OpenTypeProvider.js:183,202`); only the parsed `opentype.Font` object is cached, keyed by `fontId` only (`:140-162`). `GeometryEngine` still derives `spacingMm = stoneSizeMm + gapMm`, independent of `heightMm` (`src/geometry/GeometryEngine.js:149-150` region; sampling pitch is not a function of height anywhere in `src/geometry/**`). |
| 2 | No legibility floor exists inside `GeometryEngine` itself; the only floor is `app.js`'s `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO`, consulted only by `autoFit` and Fit-to-Shape — a manually typed small `height` bypasses it | **Still accurate**, with new adjacent (not contradicting) infrastructure | `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO = 6` still lives in `app.js:426`, still consulted only by `computeAutoFitScale()` (`app.js:432-438`) and `ShapeFit.computeShapeFitScale()` (`src/geometry/ShapeFit.js:135-160`, called from `app.js`'s Fit-to-Shape path). A manual `#height` edit still has no per-glyph floor inside the engine. **New since TXT-103A**: a *stone-size-level* legibility gate now exists (`StoneSizes.js`'s `supportedHeightRangeMm`, `app.js:1690-1710`'s `updateStoneSizePrintableCapabilityUI()`), from the font-portfolio human-rating program (`FONT-DECISION-001`/`FONT-PORTFOLIO-001`). This is a different mechanism (disables a stone-size *option* in the picker, doesn't touch `GeometryEngine` or clamp `heightMm`) and does not close the gap TXT-103A found — see §3.4 for why it's load-bearing for this milestone's design. |
| 3 | Recommendation: a future manual "Text Size" control should clamp/warn using the existing legibility floor | **Shipped since, consistent with the recommendation** | `TXT-103` (referenced by ARCH-REVIEW-001, no longer a separate spec file but its result is visible in code) added the `[4, 111]` clamp on `#height` (`app.js:1048-1058`). The upper bound was later raised from `TXT-103`'s original `80` to `111` by the FONT-DECISION-001 studio-integration follow-up, to match `SS30`'s validated ceiling (`app.js:1054-1057`, `StoneSizes.js:42`'s `[106,111]`). This is an evolution consistent with `TXT-103A`'s ask, not a contradiction of it. |
| 4 | RS Block: `heightMm` is validated but never used; every family authors `stoneCenters` at one fixed pitch; resizing is a no-op today | **Still accurate, and now also true of RS Modern** | `RhinestoneFontProvider.js:26-31` (module doc) and `:101-102` (validated, unused) are unchanged in substance. `FONT-002` added a second authored family, `rs-modern` (`src/text/rhinestoneFont/families/rsModern.js`), at "the same authored pitch as RS Block" (manifest note) — same no-op property, same fixed-pitch design. Nothing generalizes the audit's conclusion incorrectly. |
| 5 | Naive scaling of authored `stoneCenters` would break pitch; no safe resize mechanism exists without a new reflow/variant mechanism (Option A recommended: OpenType regeneration sizing, RS Block/RS Modern fixed-size only) | **Still accurate** | No reflow or discrete-size-variant mechanism has been built for `rsBlock.js`/`rsModern.js` since `TXT-103A`. Option A is still the live, shipped state. |
| 6 | Rigid translation (offset) and rotation (`rotateTextPoints()`) preserve all pairwise distances; the one dangerous pattern is a hypothetical point-scale that doesn't exist | **Still accurate** | `GeometryEngine.js`'s `rotateTextPoints()` is unchanged in shape (cos/sin about the point set's own bbox center); no `Stone.xMm *=`/`.yMm *=` scale-multiply exists anywhere in `src/geometry/**` today (re-grepped for this audit). |
| 7 | Collision/dedup is generic, not text-specific (`dedupeStonePoints()`/`dedupeStonesByRadius()`) | **Still accurate** | `StoneSampler.js` still implements this generically; unrelated to any height-accuracy fix. |
| 8 | Exporters apply no scaling that could mask a mismatch (`SvgExporter`'s 1:1mm mapping, `ProductionSheetExporter`'s "no scaling, hard requirement") | **Still accurate** | Neither module has changed its scaling behavior since. Still relevant: whatever `heightMm` the engine is finally given renders and exports at true 1:1mm, so a height-accuracy fix changes *what heightMm gets requested*, never how faithfully it's reproduced downstream. |
| 9 | `fitTextToShape()` throws unhandled for any font supplying authored stone centers (RS Block); flagged as a gap worth a one-line fix in the next milestone | **Fixed since — no longer a live gap** | `FONT-002` closed this exact gap: `fitTextToShape()` now checks `isAuthoredStoneFontId(fontId)` upfront and returns `{ok:false, reason:'fixed-size', message:...}` before ever calling `resolveTextPolygons()` (`app.js:2316-2320`, comment explicitly cites "closes the audit-flagged gap (TXT-103A)"). Confirmed by reading the live function body. |
| 10 | Recommended next milestone: `TXT-103B` (expose Text Size as first-class control, manual Target Width/Height, RS Block resize-affordance hiding, the `fitTextToShape` fix) | **Never done as `TXT-103B`; partially subsumed by later work under different names** | The `fitTextToShape` fix landed under `FONT-002` (see #9). A manual Target Width/Height-style fit already exists (`ShapeFit.computeShapeFitScale()`, wired to the Fit-to-Shape button). No dedicated always-visible "Text Size" control distinct from `#height` was built. `TXT-103B` was never filed; this milestone (`TXT-104`) is filed as the next free `TXT-10x` id rather than colliding with that unused, differently-scoped name (same reasoning `RS-1013`'s own numbering note gives for avoiding an already-used id). |

**Font-portfolio-program impact on TXT-103A's analysis:** the portfolio program
(`FONT-ARCH-001` → `FONT-DECISION-001` → `FONT-PORTFOLIO-001` → `FONT-POLICY-001`) changed *which*
fonts are offered and added a stone-size-level legibility gate (`supportedHeightRangeMm`,
`unsupportedStoneSizes`), but it did not touch `OpenTypeProvider.getTextPath()`'s `heightMm`
handling, `GeometryEngine`'s sampling pitch logic, or anything else `TXT-103A` examined. Its
practical effect on *this* milestone is entirely in §3.4 (SS30 gating) and in providing the exact
font files (§2) that make the em/cap-height gap concrete and measurable today, where before it was
hypothetical.

---

## 2. Confirming and quantifying the actual gap

**Confirmed: `heightMm` is literally an em-square size, not a physical letter measurement.**
`OpenTypeProvider.getTextPath()` (`src/text/OpenTypeProvider.js:183`) computes
`unitsToMm = heightMm / font.unitsPerEm` and scales every glyph coordinate by that one scalar
(`glyph.getPath(advanceWidthMm, 0, heightMm)`, opentype.js's own convention: its `fontSize`
parameter is always an em-size, not a cap-height). A capital letter's actual rendered height is
`heightMm * (capHeightUnits / unitsPerEm)` — a font-specific ratio the engine never computes or
exposes anywhere.

### Real measurements from the shipped font files

Measured directly by parsing each shipped `.ttf`/variable-font source with `opentype.js` (the same
library `OpenTypeProvider.js` already uses in production — no estimation, no new dependency) and
reading both the `OS/2` table's `sCapHeight`/`sxHeight` fields and the actual rendered bounding box
of a reference glyph (`'H'` for cap height, `'x'` for x-height) at `heightMm = unitsPerEm` (i.e.
measuring the ratio directly, unit-agnostic):

| Font (manifest id) | `unitsPerEm` | OS/2 `capHeight/em` | **measured `H`-bbox/em** | OS/2 `xHeight/em` | **measured `x`-bbox/em** |
|---|---|---|---|---|---|
| Baloo 2 (`baloo2-variable-regular`) | 1000 | 0.6020 | **0.6180** | 0.4600 | 0.4750 |
| Anton (`anton-regular`) | 2048 | 0.8594 | **0.8594** | 0.7324 | 0.7329 |
| Sacramento (`sacramento-regular`) | 2048 | 0.7568 | **0.7783** | 0.3062 | 0.3291 |
| Dancing Script (`dancing-script-regular`) | 1000 | 0.7200 | **0.8070** | 0.3320 | 0.3910 |
| RS Block (`rs-block`) | n/a | n/a — authored stone centers, no OpenType em-box; `heightMm` is already a no-op (§1 row 4) | | | |
| RS Modern (`rs-modern`) | n/a | n/a — same as RS Block | | | |

Two things worth calling out from this table itself:

- **The OS/2 table's `sCapHeight` and the actual rendered glyph bounding box disagree**, and the
  disagreement is worst for the two script faces: Dancing Script's OS/2 table says cap height is
  72.0% of the em, but the letter `H` actually renders to 80.7% of the em — a 12% relative
  difference between "what the font's own metadata claims" and "what the pipeline's real sampled
  outline measures." Sacramento is off by about 3%; Anton (a block sans with no calligraphic
  overshoot) matches exactly. This directly answers part of Required Outcome §3's question below:
  **a generic OS/2-metrics-only heuristic is not reliable enough on its own for this portfolio** —
  measuring the real glyph outline through the pipeline's own font-loading path is more faithful to
  what a customer actually receives, and this codebase's established convention (RC-004A, FONT-GEN-005,
  every FONT-DIAG-* milestone) is exactly "measure the real pipeline, don't trust an assumed value."
- **The four fonts' cap-height ratios span 0.602–0.859 of the em** — nearly 43% relative spread —
  which is the concrete evidence that no single hardcoded constant correction could work across the
  portfolio; it must be per-font.

### Real-world magnitude at a typical requested height

At a representative `heightMm = 30` (mid-range of the `[4,111]` clamp, and inside every shipped
font's `unsupportedStoneSizes`-unaffected range):

| Font | Actual rendered cap height at `heightMm = 30` | Shortfall vs. the 30mm requested |
|---|---|---|
| Baloo 2 | 18.54 mm | **38.2% smaller** |
| Anton | 25.78 mm | **14.1% smaller** |
| Sacramento | 23.35 mm | **22.2% smaller** |
| Dancing Script | 24.21 mm | **19.3% smaller** |

A customer who types "30" into the height field expecting 30mm-tall capital letters gets anywhere
from 26mm (Anton) to under 19mm (Baloo 2) depending only on which font they picked — with no
indication in the UI that this is happening. This is a real, currently-shipping, production-facing
accuracy gap for Sasha's stated #1 priority, not a hypothetical.

**This confirms ARCH-REVIEW-001's original framing is correct and current** — the only thing wrong
was the claim that `TXT-103A` had already closed it.

---

## 3. Design proposal

### 3.1 Where the correction belongs

**At the user-intent boundary (a new UI-facing input translated into the existing `heightMm`
before it ever reaches `GeometryEngine`), not inside `generateTextLayout()`/`OpenTypeProvider`
sampling.** Reasoning, weighed against the alternative:

- Every downstream consumer of `heightMm` today — `GeometryEngine.generateTextLayout()`'s line-pitch
  math (`lineHeightMm = options.heightMm * TEXT_LINE_HEIGHT_RATIO * lineSpacing`), `computeAutoFitScale()`,
  `ShapeFit.computeShapeFitScale()`, the `[4,111]` UI clamp, and the `StoneSizes.js`
  `supportedHeightRangeMm`/`unsupportedStoneSizes` legibility gates (§3.4) — was built and, in the
  legibility-gate case, *human-calibrated* against `heightMm` meaning what it means **today** (a raw
  em-size). Changing `generateTextLayout()`'s internal interpretation of `heightMm` would silently
  invalidate every one of those, including a whole human-rating study's worth of calibration data,
  for zero benefit — the engine's contract ("heightMm scales the em-square linearly, unconditionally,
  the same way today") is exactly the invariant `TXT-103A` already verified is safe and every other
  subsystem now depends on.
- The correction is fundamentally a **font-metrics fact** (a ratio derived from one specific font
  file), not a geometry-pipeline concern. `GeometryEngine` is deliberately font-agnostic beyond
  calling the registered provider's `getTextPath()` — teaching it "which of these millimeters is
  really a cap-height" would be new, unwarranted font-format knowledge leaking into the one module
  the architecture keeps generic.
- This mirrors the exact pattern `TXT-103A` itself found and endorsed for Auto Fit and Fit-to-Shape
  (§2 of that document, restated in row 1 of §1 above): **solve a scale/value in closed form from a
  measurement, then call the real engine once more at the resolved value** — never trust the
  estimate as final, never move the correction into the sampling code itself. A cap-height
  correction is the same shape of problem: "user wants a physical outcome; solve the em-size that
  produces it; call `generateTextLayout()` for real at that solved `heightMm`" — no new pattern is
  needed, the existing one generalizes directly.

Concretely: a new user-facing quantity (tentatively "Cap Height" or "Letter Height," a UI/schema
decision for the implementation milestone, not this one) is translated as
`engineHeightMm = desiredCapHeightMm / capHeightRatio(fontId)` in `app.js`'s orchestration layer
(the same layer that already owns `computeAutoFitScale()`/`fitTextToShape()`, both of which already
do exactly this kind of "translate a user-facing target into the `heightMm` the permanent engine is
called with" work). `engineHeightMm` is what gets written to `layer.height` and passed to
`generateTextLayout({heightMm: engineHeightMm, ...})`, unchanged from today.

### 3.2 Per-font granularity and where the ratio comes from

**Per-font-file, derived from the real, already-shipped pipeline — not a hand-tuned table, and not
a naive "generic OS/2 metrics" shortcut either**, per §2's measurement: the OS/2 table's
`sCapHeight`/`sxHeight` fields exist in every shipped font (confirmed above) but disagree with the
actual rendered outline by up to 12% for script faces, which is itself close to the size of the
error being corrected — using it blindly would leave a real residual error for exactly the fonts
(scripts) where the original gap is largest.

Recommended derivation: for each `providerId:'opentype'` font, render one reference glyph (`'H'`
for cap-height; `'x'`, or a rounder fallback like `'o'`, for x-height, in case a future font's
`'x'` is unusually shaped) through the **exact same `OpenTypeProvider`/`opentype.js` load path**
already used in production, at any convenient reference `heightMm` (the ratio is dimensionless — a
reference size of `unitsPerEm` mm as used in §2's measurement, or any other constant, produces the
same ratio), and measure the returned bounding box. This is a pure function of the font file, has no
dependency on the user's actual typed text (so "20mm" means the same physical thing whether the
layer says "Hello" or "xyz" — the ratio must not be measured from the live per-render string), and
requires no new parsing logic — it is the same measurement approach `tools/font-generator/measure.mjs`
/ `tools/font-cal-001/lib/measureProduction.mjs` already established as this project's convention for
offline, real-pipeline font calibration (reused from the font-portfolio program), not a new pattern.

Where to store it: **precompute once per font and add it to `assets/fonts/manifest.json`** as a new
optional field (e.g. `capHeightRatio`/`xHeightRatio`), exactly the same additive-field pattern
`rhinestoneValidated`, `unsupportedStoneSizes`, and `providerId` already use in
`FontManager.normalizeFontRecord()` (`src/fonts/FontManager.js:22-49`) — defaulting to `null`/absent
for any font record that doesn't have it, so every existing manifest entry (including the two
authored `rhinestone` fonts, which don't have this concept at all — §1 row 4) is completely
unaffected. A regression test (mirroring `tools/test-stone-size-library.mjs`'s existing "cross-check
the manifest value against a live recomputation so the two can never silently drift" pattern for
`StoneSizes.js`'s own calibration data) would re-measure the live `.ttf` files and assert the
manifest's stored ratios still match, catching a future font-file swap that silently invalidates a
stale ratio.

This answers Required Outcome §3's explicit question: **no hand-tuned per-font table is required in
the sense of "someone manually decides a number"** — it's derived mechanically from each font file —
but it **does need to be per-font-file** (not a generic constant, and not blind trust in the OS/2
table), because the measured spread (0.602–0.859 cap-height ratio, §2) and the OS/2-vs-measured
divergence are both too large to approximate away.

### 3.3 Backward compatibility

**Existing saved projects must render byte-identically after this change ships.** The mechanism
proposed in §3.1 already gets this for free in the common case — `layer.height` keeps meaning
exactly what it means today (the raw em-size `heightMm` passed to the engine) for any layer that
doesn't opt into the new corrected-intent control. But the *default UI experience* is the real risk:
if a "Letter Height" control replaces `#height` as the primary/default field for every text layer,
every legacy project's stored `layer.height` number would suddenly be *displayed*/*edited* under a
new interpretation the moment a user touches that field again, even though the stored number itself
didn't change — a subtle trap where the field's own semantics silently shift under an existing
value.

**Recommended mechanism: an additive, defaulting-to-legacy `layer` field**, the same shape as
`fillMode` (RS-1011), `autoFit`, `wrap`, and `product` before it — e.g. `layer.heightMode`
(`'raw'` | `'capHeight'`, name TBD by the implementation milestone):

- Missing/undefined `heightMode` (every project saved before this milestone) → treated as `'raw'`:
  `layer.height` is passed straight through as `heightMm`, exactly as today. Zero behavior change,
  zero project-schema version bump required (this repository has no schema-version field to bump —
  confirmed by grep; every prior backward-compat milestone, e.g. RS-2010/RS-1011/RS-1004, uses this
  same "new field defaults to legacy behavior" idiom instead, and this should too).
- New layers created after this milestone default to `heightMode: 'capHeight'` (matching
  `instancedStones`' RS-2013-step-6c precedent of flipping a *default* forward for new/fresh state
  while leaving existing stored data alone) — so new work gets the accurate behavior by default,
  without touching a single existing project.
- An existing layer's `heightMode` can be explicitly switched by the user (e.g. a "Switch to
  accurate letter-height input" affordance), which is the one point where a stored `layer.height`
  number's *effective* rendered size could change — but only as a direct, visible, user-initiated
  action, never a silent reinterpretation on load.

This is deliberately the same choice `TXT-103A`'s own §5 already reasoned through for a different
field ("no new numeric 'scale' field... a font/family selection change... requires zero
project-schema changes") — an additive, defaulting field is this codebase's established
backward-compatible-migration idiom, not a new one being invented for this milestone.

### 3.4 Interaction with Auto Fit

**Downstream of the same `heightMm`, and needs no logic change, but must consume the *same*
corrected value Auto Fit and the manual field agree on.** `computeAutoFitScale()`
(`app.js:432-438`) takes `layer.height` and a measured width and returns a scale to shrink it by if
it overflows the canvas — it has no opinion on what `layer.height` "means," it only ever multiplies
it. As long as `layer.height` continues to hold whatever `heightMm` value the engine should actually
use (per §3.1/§3.3 — the corrected value for a `capHeight`-mode layer, computed once when the field
is edited, not re-derived inside Auto Fit itself), `computeAutoFitScale()` requires zero changes:
it already re-measures the real regenerated geometry after applying its own scale
(`app.js:646`'s `generateTextLayout({...base, heightMm: scaledHeight})` re-call), so it stays correct
regardless of what real-world quantity `heightMm` was solved from. The same reasoning applies
identically to `ShapeFit.computeShapeFitScale()` (`src/geometry/ShapeFit.js:135-160`) — it already
treats `currentHeightMm` as an opaque scalar to be linearly scaled and re-measured, never as
something it needs to interpret.

The one implementation-phase-only wrinkle worth flagging now (not resolving in this design): the
`[4,111]` UI clamp on `#height` (`app.js:1058`) bounds the *engine-facing* value. A `capHeight`-mode
layer requesting, say, 70mm of actual cap height on Baloo 2 (ratio 0.618) resolves to an engine
`heightMm` of ~113mm — slightly over today's clamp, which exists to match `SS30`'s validated
`[106,111]` legibility range (§1 row 3). The clamp itself doesn't need to change for this design
(the *raw*-mode field keeps behaving exactly as today), but whichever control exposes "Letter
Height" to the user will need its own, separately-reasoned bounds (in real mm, per font) rather than
inheriting `[4,111]` unmodified — a concrete open question for §4's implementation steps, not a flaw
in this design.

### 3.5 Interaction with SS30 gating (FONT-POLICY-001)

**Untouched by this design, and must stay that way, by construction of §3.1.**
`updateStoneSizePrintableCapabilityUI()` (`app.js:1690-1710`) and `StoneSizes.js`'s
`supportedHeightRangeMm` were calibrated by the FONT-DECISION-001/FONT-PORTFOLIO-001 human-rating
studies against **the raw, engine-facing `heightMm`** — the exact quantity §3.1 deliberately keeps
unchanged. `stoneSizeEntirelyExceedsPrintableHeight()` compares a stone size's validated
`supportedHeightRangeMm` against the object's real printable height, and `unsupportedStoneSizes`
disables specific font/size combinations — neither reads `layer.height`'s *meaning*, only the
physical printable-area geometry and a per-font/per-size disable list. Since this design routes any
new "Letter Height" intent through the *same* `heightMm` value before it ever reaches
`generateTextLayout()` or the picker's gating logic, **"SS30-appropriate" continues to mean exactly
what the human-rating study measured it to mean**, for any font, unchanged. If a future milestone
ever changed what `heightMm` means at the engine level (the alternative this design explicitly
rejects in §3.1), the entire `supportedHeightRangeMm` calibration would need to be re-run — one more
concrete cost of that rejected alternative, not a cost of this design.

---

## 4. Scope and sequencing for the implementation phase

Ordered, each step independently testable and shippable/revertable on its own, following the same
incremental-and-verifiable shape RS-2013's design phase used:

1. **Derive and validate cap-height (and x-height, for completeness) ratios for the shipped
   OpenType portfolio only — no pipeline or UI changes yet.** A small offline script (reusing
   `OpenTypeProvider`/`opentype.js` exactly as §3.2 describes, following the
   `tools/font-generator/measure.mjs` precedent) computes ratios for Baloo 2, Anton, Sacramento, and
   Dancing Script; results are written into `assets/fonts/manifest.json` as a new optional field and
   locked in by a cross-check test (mirroring `tools/test-stone-size-library.mjs`). Deliverable: a
   manifest diff plus one new test file. Zero behavior change to the running app.
2. **Wire the correction into a font-metrics query the app can call, still with no user-visible
   control.** Expose the stored ratio through `FontManager`/`FontManager.getFont()` (already returns
   the whole normalized record, so this may need no new method at all — confirm during
   implementation) and add one pure helper (e.g. in `app.js` or a small new module) that solves
   `engineHeightMm` from a desired cap-height and a font id. Unit-tested in isolation against the
   manifest values from step 1. Still no UI change.
3. **Add `layer.heightMode` (additive field, default `'raw'`) and wire new-layer creation only** to
   default to the corrected mode, per §3.3. Verify via the existing example-fixture regression suite
   (`tools/test-examples-regression.mjs`) that every pre-existing `.rhs` fixture (none of which will
   have `heightMode` set) still produces byte-identical `StoneLayout` output — this is the step where
   backward compatibility is proven, not assumed.
4. **Expose the corrected control in the UI** (a "Letter Height" or equivalently-named field,
   `#height`'s exact placement/labeling a UI decision for that step) for `capHeight`-mode layers,
   including working out its own real-mm bounds per §3.4's flagged clamp question. Manual browser
   verification: same font/text, several requested cap heights, confirm exported SVG `<circle>` /
   Production Sheet stone positions produce letters whose actual measured height (bounding box of the
   rendered glyphs) matches the requested value within the sampling pitch's own tolerance.
5. **Auto Fit / Fit-to-Shape verification pass**: confirm (per §3.4, expected to require zero code
   change) that toggling `autoFit` or running Fit-to-Shape on a `capHeight`-mode layer still shrinks
   the *effective* corrected value coherently, add one regression test per feature asserting this.
6. **RS Block / RS Modern**: explicit no-op confirmation only — add/extend a regression test
   asserting `heightMode` has no effect on authored-stone-center output (same "lock in current
   behavior" pattern `TXT-103A`'s own test plan recommended for `heightMm`), since §1 row 4/row 5
   confirm no correction is meaningful for these providers. No new code expected.
7. **SS30/`supportedHeightRangeMm` regression confirmation**: a test asserting
   `updateStoneSizePrintableCapabilityUI()`'s gating decisions are unchanged for a fixed set of
   font/size/shape combinations before and after this milestone, closing the loop on §3.5's claim
   with evidence rather than argument alone.

Steps 1–2 are pure-data/pure-function, essentially risk-free. Step 3 is the one genuine
compatibility-risk step and is scoped alone specifically so it can be verified in isolation before
any UI work begins. Steps 4–7 are additive UI/verification work that can be re-sequenced or trimmed
per ChatGPT's milestone-level review without touching the compatibility-critical steps 1–3.
