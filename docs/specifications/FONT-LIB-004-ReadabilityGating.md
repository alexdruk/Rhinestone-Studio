# FONT-LIB-004 — Readability gating: text height, not per-font stone-size disabling

Status: **Implemented**, but *not* as originally scoped. The milestone was opened to extend
per-font `unsupportedStoneSizes` across the whole font library using objective analysis. Running
that analysis showed the premise was wrong, and the milestone shipped a different fix. This document
records both, because the negative result is the more useful half.

---

## 1. Problem as reported

After FONT-LIB-002 opened the picker from 6 fonts to 31, users reported that many of the newly
available fonts render unreadably "at certain settings (stone size and others)". The obvious
hypothesis: some of the 25 newly-bundled fonts are simply not viable at some stone sizes, and should
carry `unsupportedStoneSizes` entries the way FONT-PORTFOLIO-001's three human-rated fonts already
do.

## 2. What the audit actually found

`tools/font-certification/audit-manifest-readability.mjs` (added by this milestone) runs every
enabled OpenType font in the manifest through FONT-CERT-001/002's existing, unmodified analysis
pipeline — `runProductionAnalysis()` + `computeReadabilityFindings()` — across all five catalog
stone sizes, and applies a per-(font, size) bar: any stone collision, any unusable/zero-stone
layout, or more than 10% of the required glyph corpus falling below
`MIN_MEANINGFUL_STONE_COUNT`/`MIN_STONE_COUNT_FOR_COUNTER_BEARING`.

**Height choice matters and was the key correction.** `runProductionAnalysis()`'s default
`SPECIMEN_HEIGHT_MM_BY_SIZE` holds a fixed height/stone-diameter ratio of 12.5, which is *below* the
app's own FONT-DECISION-001-validated `supportedHeightRangeMm` at every size:

| size | stone Ø | app's validated height range | cert default | app default (midpoint) |
|---|---|---|---|---|
| SS6 | 2.0 mm | 35–50 mm | 25 mm | 43 mm |
| SS10 | 2.8 mm | 45–60 mm | 35 mm | 53 mm |
| SS16 | 4.0 mm | 65–90 mm | 50 mm | 78 mm |
| SS20 | 4.7 mm | 80–110 mm | 59 mm | 95 mm |
| SS30 | 6.4 mm | 106–111 mm | 80 mm | 109 mm |

Auditing at the cert default would measure a configuration the app never produces, and would
over-flag. The audit therefore overrides `heightMmBySize` with each size's real app default —
exactly what `applyStoneSizeHeightAutoSet()` gives a fresh text layer.

**Result: zero fonts flagged at any stone size.** All 29 enabled OpenType fonts, all 5 sizes, clean.
No `unsupportedStoneSizes` entry is objectively warranted for any of the 25 newly-added fonts.

A height sweep explains why, and finds the real variable:

```
Legend: "." readable   "X" flagged   "-" height below the app's validated range for that size
                          h=15mm       h=25mm       h=35mm       h=45mm
                        6 10 16 20 30  6 10 16 20 30  6 10 16 20 30  6 10 16 20 30
great-vibes-regular     X X  X  X  X   - -  X  X  X   . -  X  X  X   . .  -  -  X
alex-brush-regular      X X  X  X  X   - -  X  X  X   . -  -  X  X   . .  -  -  X
parisienne-regular      - X  X  X  X   - -  X  X  X   . -  -  X  X   . .  -  -  X
poppins-bold            - X  X  X  X   - -  -  X  X   . -  -  -  X   . .  -  -  -
anton-regular           - -  X  X  X   - -  -  X  X   . -  -  -  X   . .  -  -  -
bebas-neue-regular      - X  X  X  X   - -  X  X  X   . -  -  -  X   . .  -  -  X
```

Two things are visible. First, the failure boundary tracks the **height-to-stone-diameter ratio**,
not the font — a bold geometric sans (Poppins Bold, Anton) fails at 15 mm/SS16 just as a fine
calligraphic script does. Second, the "X" region and the "-" region (height below that size's
already-validated range) very nearly coincide: **the app already encodes the correct constraint in
`supportedHeightRangeMm`.**

## 3. The actual defect

`isHeightWithinStoneSizeRange()` is referenced in exactly one place in `app.js`: inside
`applyStoneSizeHeightAutoSet()`, which fires only on a **stone size** change. No code path checks
height against the range when the user edits `#height` directly, loads a project, converts through
TXT-104's capHeight mode, or lets Auto Fit shrink the text. So a user could set SS6 + 15 mm and get
unreadable output with no feedback of any kind — which is exactly the reported symptom, and has
nothing to do with which font was picked.

FONT-LIB-003's crowding hint already fires in some of these cases, but it is framed as a *font*
problem ("Great Vibes is thin at this stone size"), which — per the sweep above — misattributes a
height problem to the font, and points the user at a font switch that will not fix it.

## 4. Decision

Add one font-independent check: warn whenever the selected text layer's height is below the current
stone size's validated minimum, whatever route produced it.

- **Warning, not a clamp.** Existing projects may already hold out-of-range heights, and a
  deliberately tiny accent word is a legitimate if fragile choice. Same "explain, never silently
  override" stance `#stoneSizeCrowdingHint` and `#stoneSizeOverlapWarning` already take.
- **No manifest changes.** No `unsupportedStoneSizes` value was added, removed, or altered.
- **Authored Production Fonts exempt.** RS Block / RS Modern carry their own baked-in stone pitch;
  `supportedHeightRangeMm` is an OpenType-sampling concept that does not apply to them.

### Rejected: extending `unsupportedStoneSizes` objectively

Beyond being unnecessary (zero flags), it would have been actively harmful. The audit's objective
bar **disagrees with the three existing human-rated entries** — it finds Anton, Sacramento, and
Dancing Script all clean at SS30, where FONT-PORTFOLIO-001's human raters measured 6% Readable.
A `--write` run would therefore have *deleted* three correct, human-reviewed gates. Those entries
are left exactly as they are.

That disagreement is itself the argument against this mechanism: stone counts and collision
detection do not capture what human raters saw at SS30, whose 106–111 mm height range is a 5 mm
window clamped by printable area (FONT-DIAG-001 / FONT-POLICY-001 already identify SS30's height
ceiling, not any font's outline, as the underlying issue). Objective metrics are a good floor, not a
replacement for the rating pass.

### Noted, not implemented

The audit rule uses a >10% affected-glyph fraction rather than all-or-nothing, so one marginal glyph
does not disqualify a whole size. This never became load-bearing (nothing was flagged), but the
threshold is there in `evaluateSizeForFont()` if the tool is used for future candidate fonts.

## 5. What shipped

- `tools/font-certification/audit-manifest-readability.mjs` — batch audit, dry-run by default,
  `--write` and `--only=` flags. Retained as the tool for vetting future font additions.
- `app.js` — `updateTextHeightReadabilityUI()`, called from `updateEditingUI()` (deliberately last:
  `tools/test-rs2012-text-gap-mixed-size-ux.mjs` test 8 requires
  `updateTextFontCapabilityUI()`/`updateMixedSizeCapabilityUI()` to stay adjacent).
- `index.html` — `#heightBelowReadableWarning`.
- `tools/test-font-lib-004-height-readability.mjs` — 10 tests.
- `tools/test-font-lib-003-crowding-hint.mjs` — updated for the reworded hint, plus new test 5c for
  the precedence rule (§6).

`assets/fonts/manifest.json` is untouched.

## 6. Crowding-hint precedence and rewording (resolved here, not deferred)

FONT-LIB-003's crowding hint said *"Great Vibes is thin at this stone size — try Poppins SemiBold,
…"*. Per §2's sweep that misattributes a height problem to the font whenever height is the real
cause, and points the user at a font switch that cannot fix it. Two changes:

**Precedence.** The crowding hint is suppressed entirely when `textHeightBelowReadableMinimum()` is
true — the shared predicate this milestone's warning also uses. In that regime
`#heightBelowReadableWarning` is already on screen saying the accurate thing, and two warnings
blaming two different causes is worse than one correct one. Same mutual-exclusivity idiom
`updateStoneSizeOverlapCapabilityUI()` already applies for genuine overlap. Note the display toggle
now keys off the message text rather than the `crowded` flag, since this branch deliberately
produces an empty message while `crowded` is still true.

**Wording.** When height *is* inside the validated range and the layout still crowds, the font's own
stroke geometry genuinely is the differentiator, so naming it is fair — but the phrasing now
describes the stroke rather than delivering a verdict on the typeface, and presents all three
remedies as equals instead of leading with a font switch:

> Poppins Regular's strokes are narrow at this stone size — a heavier weight (Poppins SemiBold), a
> larger stone size, or a taller letter height would each give more even coverage.

Single-style families drop the weight clause. Non-text layers keep the original generic wording,
unchanged.

`tools/test-font-lib-003-crowding-hint.mjs` gains test 5c for the precedence rule (silent below the
minimum; font-aware message once height is adequate — proving the suppression is the height check,
not a blanket disable).
