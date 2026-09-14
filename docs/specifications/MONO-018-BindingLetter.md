# MONO-018 — Report the binding letter in `CHAIN_TOO_THIN`

**Status:** implemented. Branch `feature/mono-018-binding-letter` off `develop` @ `573c4e5` (the
MONO-017 merge). Local only.

**Authorises:** hoisting the single-chain minimum gate out of `MonogramGenerator.generate()`'s
per-letter OpenType loop so that the `CHAIN_TOO_THIN` failure names the **binding** letter; a
sub-floor count in the failure message; a `diagnostics.allLetterStemStones` array. No geometry
change — `CHAIN_TOO_THIN` emits `layers: null`, so no committed baseline moves.

Read `docs/specifications/MONO-017-StemReportDiagnosis.md` first. The root cause is established there
and is not re-litigated here.

---

## 1. The defect (from MONO-017)

`MonogramGenerator.generate()`'s per-letter OpenType branch iterates letters in slot-index order,
fits each into its slot, and — inside the loop — `return`s `CHAIN_TOO_THIN` on the **first** letter
whose fitted stem falls below `minChainStones`. Letters shrink by different amounts to fill an
identical slot, so the identity of the first sub-floor letter changes with frame size, and with it
the quoted stem figure. For Great Vibes `A,K,L` / `equal-three` / `none` / SS6 / `letterSpacingMm` 0:

| frame | develop reports | true worst (`K`) |
|---|---|---|
| 150×150 | K 0.470 | 0.470 |
| 120×120 | K 0.376 | 0.376 |
| 100×100 | **A 0.591** | 0.309 |

The reported sequence 0.470 → 0.376 → **0.591** rises as the user shrinks the frame, implying they
got closer to legal when in fact every letter got thinner. Every statement the message makes is
true — it names its subject, `Letter "A" (slot 0)` — but `A` is an arbitrary sub-floor letter, not
the one that governs.

(The MONO-017 tables render `K` at 100×100 as `0.310`; that is a display rounding of the real
`0.30946`. `toFixed(3)` — what the message and `diagnostics` use — yields `0.309`. The MONO-018
tests pin `0.309`.)

---

## 2. The decision

**Hoist the gate out of the letter loop and report the binding letter.**

- Inside the loop, a sub-floor letter is recorded (`belowFloor` on its `letterResults` entry) and
  fitting **continues**.
- After the loop, if any letter is below its floor, fail with the letter having the **minimum**
  `achievedStemStones`. **Ties break on the lower slot index.**
- The message keeps its shape — `Letter <x> (slot N): font <f> with <s> mm stones fits this slot
  only at <v> stones across the stem, below <bound>.` plus the existing remedy sentence, which still
  names letter spacing (MONO-016) — and gains a sub-floor count, e.g. `2 of 3 letters fall below`,
  so the reported letter reads as the worst of several rather than the only one. The count clause is
  omitted for a single-letter monogram (it would always be "1 of 1").
- `diagnostics` keeps `letter`, `slotIndex`, `achievedStemStones`, `minChainStones`,
  `fittedHeightMm`, `stoneSizeMm`, `stemWidthRatio`, `boundThatBound` — all now the binding
  letter's — and gains `allLetterStemStones`: one `{ letter, slotIndex, achievedStemStones,
  belowFloor }` per letter, in slot order. Its minimum `achievedStemStones` is the reported figure.

### Scope of the deferral

**Only the `CHAIN_TOO_THIN` gate defers.** Every other failure inside the loop still fails fast and
returns immediately:

- `INVALID_FONT` — `generateTextLayout()` threw for a letter.
- `FITTING_FAILED` — a letter produced no stones.

These are not restructured. A `FITTING_FAILED` at slot 1 of a three-letter mark still never fits
slot 2.

### Not touched

- The `script` layout (`_generateScriptMonogram`) — one joined string, one stem value, no per-letter
  loop, structurally immune (MONO-017 §2).
- The authored-font branch — no single-chain axis, no stem figure. Its own fail-fast
  `BELOW_MINIMUM_SCALE` / `FITTING_FAILED` shape is unchanged.
- Any successful generation — the gate's failure branch is never entered, so emitted geometry is
  byte-identical to develop.

---

## 3. The rejected alternative

**Keep fail-fast; reword the message so the number reads as one-of-several** (e.g. "at least one
letter, here `A`, fits only at 0.591…").

Rejected. It leaves the user without the number that actually governs their layout: they would still
see 0.591 at 100×100 and 0.376 at 120×120 and conclude, wrongly, that the smaller frame is closer to
legal. Naming the figure as "one of several" does not fix a misleading figure.

### The cost argument against hoisting does not hold

Monogram generation is **button-triggered**, not a live re-render (`test-mono-006-monogram-ui.mjs`
test 4 — Generate builds one request on click). And letters converge in 1–3 fit iterations in
practice, not the full 6 (MONO-017 §3: observed 1–5 across the whole matrix). So a failing
three-letter mark moves from roughly 2–6 engine calls (fail-fast on letter 1 or 2) to 6–9 (all
three fitted). The **success path is unchanged** — every letter was always fitted regardless.

Measured on the MONO-018 test cases: a `FITTING_FAILED` fast path is 3 engine calls; a full
three-letter `equal-three` fit is 11.

---

## 4. Where it lives

`src/monogram/MonogramGenerator.js`, the `!fontIsAuthored` branch of the letter loop:

- The in-loop gate (was a `return failure(R.CHAIN_TOO_THIN, …)`) is now
  `const belowFloor = achievedStemStones < minStones;`, recorded onto the letter's `letterResults`
  entry.
- The hoisted gate runs immediately after the loop, before the frame layer is generated. It filters
  `letterResults` for `belowFloor`, picks the minimum by `stemStoneCount` (tie → lower `slotIndex`),
  and returns `CHAIN_TOO_THIN` with the message and `diagnostics` described in §2. It is guarded on
  `!fontIsAuthored` (defensive — fonts are homogeneous per monogram).

---

## 5. Tests

`tools/test-mono-018-binding-letter.mjs`:

1. The MONO-017 case is now monotone — `equal-three` / `A,K,L` / Great Vibes / `none` / SS6 reports
   `K` 0.470 / 0.376 / 0.309 across 150×150 / 120×120 / 100×100, strictly decreasing; the 0.591 is
   gone.
2. The reported letter is the minimum, not the first — at 100×100 the message and `diagnostics` name
   `K` (slot 1), not `A` (slot 0).
3. Negative control — `equal-three` / `K,A,L` at 100×100, where `K` (slot 0) is both the first
   sub-floor letter and the thinnest. Develop and MONO-018 both report `K`; the last sub-floor
   letter `L` is not reported. This distinguishes "reports the minimum" from "reports the last
   letter", which test 2 alone cannot.
4. `allLetterStemStones` — one entry per letter, in slot order; its minimum equals the reported
   `achievedStemStones`.
5. Sub-floor count — `two-letter` `A,K` (one sub-floor → `1 of 2`) and `equal-three` `A,K,L` (two
   sub-floor → `2 of 3`).
6. Other failures still fail fast — a space letter at slot 1 returns `FITTING_FAILED` in ~3 engine
   calls; slot 2 is never fitted.
7. Success path unchanged — a passing Dancing Script `two-letter` monogram emits byte-identical
   layers to develop @ `573c4e5` (full `JSON.stringify` golden), and re-rendered stone records match.

Re-run clean, no committed baseline moved: `test-mono-012`, `test-mono-013`, `test-mono-014`,
`test-mono-015`, `test-mono-016`, `test-mono-006`, `test-examples-regression`,
`test-architecture-module-boundaries`, `test-documentation-consistency`. Confirmed unchanged:
MONO-013 goldens 372 / 369 stones and 136.501458 / 131.901458 mm; regression fixtures 147 / 66 /
441; MONO-015 Step 1 = 85, Step 2 = 68; MONO-016 test 1 per-layout counts (single 202, two-letter
361, traditional-three 300, equal-three 374, script 372).

### One existing assertion's reported letter moves (correctly)

`test-mono-012`'s `Great Vibes / traditional-three / 60 mm / SS10` case: all three of `A,B,C` are
sub-floor, and `C` fits thinner (~0.111) than the first sub-floor letter `A` (~0.118). Develop
reported `A`; MONO-018 reports `C`. The test's assertions pin only `reason` and
`diagnostics.boundThatBound` — both unchanged — so it still passes; its stale explanatory comment
was refreshed. `test-mono-012`'s single-letter `Cookie` case cannot change (one letter). The
`test-mono-016` `two-letter` `CHAIN_TOO_THIN` cases assert only the `(slot N)` and `less letter
spacing` regexes, both preserved.

---

## 6. BACKLOG

The MONO-017 row in `docs/BACKLOG.md` ("Deferred technical follow-ups") is marked
`**Resolved by MONO-018:**` per the convention at `docs/BACKLOG.md:26`, keeping the original finding
text.
