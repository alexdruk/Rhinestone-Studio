# MONO-017 — Non-monotonic reported stem in `CHAIN_TOO_THIN`: diagnosis

**Status:** diagnosis only. No behaviour change in this milestone. Branch
`feature/mono-017-stem-diagnosis` off `develop` @ `e469349` (local only).

**Scope of this document:** name the root cause of the `docs/BACKLOG.md` (MONO-016) row
"the OpenType single-chain slot fit loop does not converge monotonically in frame size", with a
reproducible 3×3 matrix from the real `MonogramGenerator.generate()` entry point; classify it as a
reporting defect vs a fitting defect; state how far it generalises; and recommend a fix scope. The
fix is a separate milestone (the affected file underpins MONO-012, MONO-013, MONO-015 and MONO-016
and needs its own regression baseline).

All evidence below is from `MonogramGenerator.generate()` driven through
`tools/scratch/mono017-matrix.mjs` (gitignored). The per-letter iteration traces labelled `RECON`
are a standalone replay of the fit loop used only to *explain* the values `generate()` already
produced — the replay reproduces every `generateTextLayout()` call `generate()` makes, byte-for-byte,
at all three frame sizes.

---

## 1. The full matrix

Fixed for every row: `frameId: 'none'`, SS6 (`stoneSizeMm` 2.0), `gapMm` 0.3, `letterSpacingMm` 0,
`canvasMm` 200×200. `none`-frame `COMMON_SCALING_LIMITS_MM` is 20–150 mm on both axes
(`src/geometry/FrameLibrary.js:142`), so every frame size below is UI-reachable. The frame is square
at each listed size.

`stemWidthRatio` per font (`assets/fonts/manifest.json`): Great Vibes 0.0357, Alex Brush 0.0309,
Allura 0.0302, Dancing Script 0.0417. `achievedStemStones` = `stemWidthRatio · fitHeightMm /
stoneSizeMm` (`MonogramGenerator.js:784-788`); the readability/chain floor is
`minChainStones` = 0.70 for all four fonts (the flat `SINGLE_CHAIN_MIN_RATIO` binds; each font's
`16 · stemWidthRatio` floor is lower).

### 1a. `equal-three` / `A,K,L` / Great Vibes — the BACKLOG case

Each of the three slots is identical in size at a given frame (equal-three slot widths are all
`EQUAL_THREE_WIDTH_RATIO` = 0.30 of the interior; the three letters differ only in glyph shape):
150→45.00×129.00 mm, 120→36.00×103.20 mm, 100→30.00×86.00 mm.

| letter (slot) | frame | `fitHeightMm` | `fittedBox` w×h (mm) | `achievedStemStones` | fit iters |
|---|---|---|---|---|---|
| A (0) | 150 | 47.619 | 42.243 × 41.994 | **0.850** | 1 |
| A (0) | 120 | 40.231 | 35.959 × 35.776 | **0.718** | 2 |
| A (0) | 100 | 33.102 | 30.000 × 29.763 | **0.591** | 3 |
| K (1) | 150 | 26.339 | 45.000 × 29.327 | **0.470** | 5 |
| K (1) | 120 | 21.052 | 35.624 × 23.055 | **0.376** | 2 |
| K (1) | 100 | 17.337 | 29.110 × 18.922 | **0.310** | 2 |
| L (2) | 150 | 46.388 | 44.904 × 53.086 | **0.828** | 2 |
| L (2) | 120 | 36.644 | 36.000 × 42.316 | **0.654** | 3 |
| L (2) | 100 | 30.206 | 29.966 × 35.274 | **0.539** | 2 |

**`generate()` returns `CHAIN_TOO_THIN` at all three sizes, reporting:**

| frame | reported letter (slot) | reported `achievedStemStones` | true worst letter | true worst value |
|---|---|---|---|---|
| 150×150 | **K** (1) | 0.470 | K | 0.470 |
| 120×120 | **K** (1) | 0.376 | K | 0.376 |
| 100×100 | **A** (0) | **0.591** | K | 0.310 |

The reported sequence 0.470 → 0.376 → **0.591** is the BACKLOG finding, reproduced exactly.

### 1b. Generalisation matrix (same fixed conditions, `achievedStemStones`; **bold** = the value `generate()` reports)

| layout / letters / font | frame 150 | frame 120 | frame 100 |
|---|---|---|---|
| `equal-three` A,K,L Great Vibes | A 0.850 / **K 0.470** / L 0.828 | A 0.718 / **K 0.376** / L 0.654 | **A 0.591** / K 0.310 / L 0.539 |
| `equal-three` A,B,C Great Vibes | A 0.850 / B 0.711 / C 0.850 — **ok** | A 0.718 / **B 0.563** / C 0.764 | **A 0.591** / B 0.463 / C 0.630 |
| `traditional-three` A,K,L Great Vibes | A 0.718 / **K 0.637** / L 0.654 | **A 0.566** / K 0.508 / L 0.516 | **A 0.465** / K 0.420 / L 0.424 |
| `two-letter` A,K Great Vibes | A 0.850 / K 0.735 — **ok** | A 0.850 / **K 0.588** | A 0.850 / **K 0.486** |
| `equal-three` A,K,L Alex Brush | **A 0.587** / K 0.425 / L 0.777 | **A 0.464** / K 0.336 / L 0.614 | **A 0.382** / K 0.277 / L 0.506 |
| `equal-three` A,K,L Allura | A 0.728 / K 0.705 / L 0.850 — **ok** | **A 0.582** / K 0.557 / L 0.755 | **A 0.479** / K 0.459 / L 0.622 |
| `equal-three` / `traditional-three` / `two-letter` A,K,L Dancing Script | all letters **ok** (≥0.72, mostly 0.850) | all **ok** | all **ok** |

Reported-value non-monotonicity in frame size is confirmed for **`equal-three` A,K,L Great Vibes**
(0.470→0.376→0.591) and **`equal-three` A,B,C Great Vibes** (0.563→0.591 between 120 and 100). Every
other failing row here has the *same underlying defect* (see §3) but does not happen to cross into a
visibly non-monotone reported sequence at these three sample sizes.

---

## 2. How the reported letter is selected on failure

`MonogramGenerator.js`, `generate()`, the `!fontIsAuthored` (OpenType) branch:

- **`MonogramGenerator.js:722`** — `for (let i = 0; i < letters.length; i++)` iterates letters in
  **slot-index order** (`letters[i]` → slot `index === i`; `drawOrder` only affects paint order).
- **`MonogramGenerator.js:741-771`** — the shrink-only fit loop for letter `i`: start at
  `singleChainHeightMm()`, regenerate at a halo-aware multiplicative shrink of `fitHeightMm` until
  the box fits its slot or `shrink >= 1`, capped at `MAX_OPENTYPE_FIT_ITERATIONS` (6).
- **`MonogramGenerator.js:784-788`** — `achievedStemStones` for **this** letter `i`.
- **`MonogramGenerator.js:791-802`** —
  `if (achievedStemStones < minStones) return failure(R.CHAIN_TOO_THIN, …)`. The message interpolates
  `${achievedStemStones.toFixed(3)}` and the diagnostics carry `letter`, `slotIndex` and
  `fittedHeightMm` for **this same `i`**.

So the reported value is **the first letter, in slot-index order, whose fitted stem falls below
`minChainStones`** — a fail-fast `return` inside the loop. It is **not** the minimum across letters,
and **not** the letter that binds the failure. Letters after the first failure are never generated
or measured (visible in the matrix: at `equal-three` A,K,L / GV / frame 100 the trace contains only
`A` calls — `K` and `L` are never touched).

`_generateScriptMonogram()` (`MonogramGenerator.js:1198` onward, the `script` layout) is
structurally immune: it fits **one** joined string, computes **one** `achievedStemStones`
(`MonogramGenerator.js:1314-1332`), and has no per-letter loop.

---

## 3. Reporting defect, not a fitting defect

**Every individual letter's `fitHeightMm` decreases monotonically as the frame shrinks**, in every
row of every matrix in §1:

- `equal-three` A,K,L / GV: A 47.619 → 40.231 → 33.102; K 26.339 → 21.052 → 17.337;
  L 46.388 → 36.644 → 30.206.
- `equal-three` A,B,C / GV: A 47.619 → 40.231 → 33.102; B 39.851 → 31.531 → 25.967;
  C 47.619 → 42.800 → 35.293.
- every other row likewise (traces in the scratch output).

The geometry the generator fits is monotone and correct. `generate()` also returns the **correct
outcome** at every size — `CHAIN_TOO_THIN` genuinely applies (at least one letter is always below
the chain minimum), and no geometry is emitted (`layers: null`). Only the **number quoted in the
failure message** is non-monotone, and only because the identity of the *first* sub-floor letter
changes with frame size:

- `A` is a narrow glyph in every cursive font (natural box ≈ 42 mm wide at the ideal single-chain
  height for Great Vibes). It fills its `equal-three` slot with little or no shrink at large frames,
  so it clears the 0.70 floor down to a frame of ≈ 113 mm, then drops below it.
- `K` (natural box ≈ 79 mm) and `B` (≈ 53 mm) must shrink hard to fit the same slot, so they sit
  below 0.70 from 150 mm down.

At frames 150 and 120 the loop passes `A` (i=0), then returns on `K`/`B` (i=1). At frame 100 the
loop returns on `A` (i=0) itself — and `A`, being the *least-shrunk* letter, carries a **higher**
stem value (0.591) than the more-shrunk `K`/`B` did at the previous, larger frame (0.376 / 0.563).
Hence the up-tick. This is a first-not-worst reporting artefact of the fail-fast `return` at
`MonogramGenerator.js:795`.

### The BACKLOG hypothesis is wrong

The BACKLOG row states "a larger frame yielding a smaller letter means the loop is landing on the
iteration cap, not converging." It does not. Observed fit-iteration counts across the whole matrix
are 1–5 against a cap of 6; the cap is never the binding stop. The standalone `RECON` replay of the
loop reproduces `generate()`'s captured `generateTextLayout()` calls exactly at 150, 120 **and**
100. The MONO-016 §5a reconstruction "diverged at 100 (0.310 vs the reported 0.591)" only because it
computed **`K`** at frame 100, whereas `generate()` at frame 100 reports **`A`** — `A` genuinely
fits at 0.591; `K` would be 0.310 but is never evaluated. There is no arithmetic divergence and no
convergence failure anywhere.

---

## 4. Scope

**Affected:** `MonogramGenerator.generate()`'s per-letter OpenType branch — i.e. the slot layouts
`two-letter`, `traditional-three`, `equal-three` — with an OpenType (single-chain) font and ≥ 2
letters, whenever the result is `CHAIN_TOO_THIN` and more than one letter is below the floor. In that
situation the reported letter/stem/`fittedHeightMm` are the first sub-floor letter's, not the
binding one's. Confirmed across Great Vibes (`A,K,L` and `A,B,C`), Alex Brush and Allura.

**Visibly non-monotone in frame size:** `equal-three` `A,K,L` / Great Vibes and `equal-three`
`A,B,C` / Great Vibes at SS6. It is Great-Vibes-and-letter-set specific *as a non-monotonicity*;
it is general *as a wrong-letter report*.

**Not affected:**
- The `script` layout (`_generateScriptMonogram`, one joined string, one stem value).
- Authored (`providerId: 'rhinestone'`) fonts — no single-chain axis, no stem number. The authored
  branch (`MonogramGenerator.js:879-893`) has the same fail-fast-on-first-letter shape for its
  `BELOW_MINIMUM_SCALE` / `FITTING_FAILED` failures, but reports no stem figure, so the BACKLOG
  finding does not apply to it.
- Fonts that never fail at reachable frame sizes (e.g. Dancing Script for these letter sets).
- Any successful generation (`ok: true`) — the gate's failure branch is never entered.

---

## 5. Recommended fix scope

**Message/diagnostics only.** In the per-letter OpenType loop, evaluate every letter's fitted stem
before deciding the outcome, and on failure report the **binding (minimum) letter** — ideally
listing every sub-floor letter and quoting `min(achievedStemStones)` in the "fits this slot only at
X stones across the stem" sentence. Equivalent: hoist the `CHAIN_TOO_THIN` decision out of the
`for` loop, after all letters are fitted.

Keep it a separate milestone with its own captured baseline: `MonogramGenerator.js` is the shared
spine of MONO-012/013/015/016, and restructuring the loop (even for a message-only outcome) should
be regression-checked against a pre-change capture the way MONO-012 §8 and MONO-016 test 1 do.

### Does the fix change any generated geometry?

**No.** `CHAIN_TOO_THIN` returns `layers: null` — no stones are emitted for a failing configuration.
Successful generations never reach the gate's failure branch. The fix changes only the failure
**message text** and the **`diagnostics`** object (`letter`, `slotIndex`, `achievedStemStones`,
`fittedHeightMm`, `boundThatBound`) for configurations that already fail.

**No committed baseline moves:**

| baseline | value(s) | moves? |
|---|---|---|
| MONO-013 script goldens | 372 / 369 stones, 136.501458 / 131.901458 mm | no — `script` branch untouched |
| examples/ regression fixtures | 147 / 66 / 441 | no — no monogram, successful generation |
| MONO-015 Step 1 / Step 2 goldens | 85 / 68 (screenshots 95 / 71) | no — successful generation |
| MONO-016 test 1 per-layout counts | single 202, two-letter 361, traditional-three 300, equal-three 374, script 372 | no — all successful generations |

**No committed test assertion breaks.** The existing `CHAIN_TOO_THIN` tests assert only `reason`,
`boundThatBound`, and a message regex (`/single-chain minimum/`, `/readability floor/`,
`/\(slot \d\)/`, `/less letter spacing/`) — none pins a letter identity or a stem value:
`test-mono-012` lines 221 & 242, `test-mono-016` test 7 (line 232). The fix milestone should still
refresh the now-stale explanatory comments in those tests (e.g. `test-mono-012:222` "a Great Vibes
capital A shrunk into Traditional Three's side slot").

---

## 6. Reproduction

`tools/scratch/mono017-matrix.mjs` (gitignored). Instantiates a real `GeometryEngine` +
`MonogramGenerator` from `assets/fonts/manifest.json`, wraps `engine.generateTextLayout` to log every
call, runs `generate()` for the matrices in §1, and replays the fit loop per letter/slot for the
letters `generate()` skipped after its early `return`. `npm ci` first; run with `node`.
