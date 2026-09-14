# MONO-022 — Reachable remedies in the `CHAIN_TOO_THIN` message

**Status:** implemented. Branch `feature/mono-022-chain-remedies` off `develop` @ `d0e4bfb`. Local
only, not merged.

**Authorises:** replacing the `CHAIN_TOO_THIN` failure's fixed four-remedy sentence with one built
from only the remedies actually reachable in the failing request, and adding
`diagnostics.remedies` — the same reachable set, as machine-readable codes — so a caller can act on
it without parsing prose. Message/diagnostics composition only: the gate, the thresholds, the
`reason` code, and every diagnostics field that existed before this milestone are unchanged.
`CHAIN_TOO_THIN` emits `layers: null`, so no committed geometry baseline moves.

---

## 1. The defect

Three initials is the most common monogram request there is. Great Vibes `"QWE"`, `frameId:
'circle'`, SS6 (2.0 mm), the circle at its 150 mm cap, produced (pre-MONO-022):

> The interlocked string "QWE": font "great-vibes-regular" with 2 mm stones fits this frame only at
> 0.679 stones across the stem, below the single-chain minimum (0.70 stones across the stem). Use a
> smaller stone size, a larger frame, less letter spacing, or fewer letters.

Three of those four remedies cannot work in this exact configuration:

- **A smaller stone size** — SS6 (2.0 mm) is already the smallest rung in `src/renderer/StoneSizes.js`.
- **A larger frame** — the circle's `scalingLimitsMm.maxWidthMm` is 150 and it is already there.
- **Less letter spacing** — already 0 in this request.

And the remedy that **does** work was never offered: **remove the frame.** Measured, the identical
request with `frameId: 'none'` succeeds at 365 stones — the largest single gain of the five (see §4).
The message sent the most common monogram request into a dead end written in stem-ratio decimals,
while omitting the one instruction that would have fixed it.

## 2. The decision

Both `CHAIN_TOO_THIN` sites share one helper pair (`src/monogram/MonogramGenerator.js`):

- `buildChainTooThinRemedies(...)` returns only the remedy **codes** reachable from the failing
  request, in gain order (removing the frame first — the largest single gain, §4).
- `formatChainTooThinRemedyClause(codes)` renders those codes into the sentence.

Both call sites pass the same code list into `diagnostics.remedies` (§3) that
`formatChainTooThinRemedyClause()` renders into the message, so the prose and the structured detail
can never drift apart — there is exactly one place that decides what is reachable.

### The two failure sites

| Site | Location | Subject |
|---|---|---|
| Per-letter | `MonogramGenerator.js:1059`, inside the hoisted single-chain gate (MONO-018) in the OpenType per-letter branch of `generate()` | the **binding** letter (thinnest stem, ties → lower slot index) |
| Interlocked string | `MonogramGenerator.js:1435`, inside `_generateScriptMonogram()`'s shrink-to-fit loop | the joined string as a whole |

Both call `buildChainTooThinRemedies()` with the same five inputs, drawn from each site's own
in-scope variables (`isNoFrame`, `effectiveFrame`, `normalizedFrameRect`, `stoneSizeMm` are identical
in both scopes; `letterSpacingMm` is `resolvedLetterSpacingMm` at the per-letter site and the
already-resolved `ctx.letterSpacingMm` at the script site — both are the same shared "Letter
spacing" value, MONO-016; `letterCount` is `letterResults.length` vs `letters.length`).

## 3. Eligibility rule per remedy

Five remedy codes, each gated on whether it can actually change the outcome of *this* request:

| Code | Reachable when | Source of the threshold |
|---|---|---|
| `remove-frame` | `frameId !== 'none'` (`!isNoFrame`) | `MonogramGenerator.js`'s own `NO_FRAME_ID` / `isNoFrame` — there is nothing to remove once the frame is already `'none'`. |
| `smaller-stone-size` | `listStoneSizes()` (`src/renderer/StoneSizes.js`) contains a rung with `diameterMm` strictly less than the request's `stoneSizeMm` | The shipped stone catalog is sorted ascending (`validateStoneSizeCatalog`'s invariant, `StoneSizes.js:213-214`) — SS6 at 2.0 mm is the floor; nothing is smaller. `src/monogram/FrameHierarchy.js:16` already imports `listStoneSizes` across this same geometry/monogram boundary (MONO-014 precedent), so `MonogramGenerator.js` importing it directly is not a new crossing. |
| `larger-frame` | the selected frame's own `effectiveFrame.scalingLimitsMm`: `normalizedFrameRect.widthMm < maxWidthMm` **or** `heightMm < maxHeightMm` | `scalingLimitsMm` is a **per-frame** field (`src/geometry/FrameLibrary.js`) — `COMMON_SCALING_LIMITS_MM` (`FrameLibrary.js:142`, `{20-150, 20-150}`) covers most frames including `circle` and `'none'`, but `oval` (`FrameLibrary.js:173`) overrides it to `{30-180, 20-130}`. The check reads `effectiveFrame.scalingLimitsMm` directly — never a hardcoded 150 — so an oval at 150 mm width (still below its own 180 mm cap) offers this remedy while a circle at the same 150 mm width does not (already at its own 150 mm cap). This is the same field `app.js`'s `updateMonogramFrameSizeBounds()` (`app.js:5496`) uses to bound the Frame Size width/height inputs, so "reachable" here means the same thing it means in the UI. |
| `less-letter-spacing` | the resolved `letterSpacingMm > 0` | The shared "Letter spacing" control (MONO-016); its floor is 0 for slot layouts and `-pitchMm` for script (`resolveLetterSpacingRequest`) — once already at 0 there is no more slack to remove for a slot layout, and for script, 0 is the value both call sites actually observe reaching this gate in every case measured so far. |
| `fewer-letters` | `letterCount > 1` | `letterResults.length` (per-letter) / `letters.length` (script) — a one-letter monogram cannot lose a letter. |

`formatChainTooThinRemedyClause()` renders `remove-frame` (when present) as a leading imperative
clause ("Remove the frame") and the rest as a trailing "use …" clause, joined with "or" — e.g. two
reachable remedies render as `"Remove the frame, or use fewer letters."`; all five as `"Remove the
frame, or use a smaller stone size, a larger frame, less letter spacing, or fewer letters."` (the
exact pre-MONO-022 sentence, once a frame is present). **If no remedy is reachable**, the sentence is
replaced outright: `"No production remedy is available for this configuration."` — never a sentence
naming zero options.

## 4. The measured reproduction case

Great Vibes (`great-vibes-regular`, `stemWidthRatio` 0.0357), `layoutId: 'script'`, letters `Q,W,E`,
SS6 (`stoneSizeMm: 2.0`), `frameId: 'circle'`, `frameRect` 150×150 mm (the circle's own cap),
`letterSpacingMm` unset (resolves to 0):

| Configuration | Result |
|---|---|
| `frameId: 'circle'` (as above) | `CHAIN_TOO_THIN`, 0.679105894192281 stones across the stem (0.70 needed) |
| Identical request, `frameId: 'none'` | **Succeeds**, 365 stones |

Removing the frame is the largest single gain of the five possible remedies for this exact
configuration — it is the difference between zero stones and a complete mark — which is why
`buildChainTooThinRemedies()` orders it first when reachable.

The final rendered message for this case:

> The interlocked string "QWE" is too thin to read as a continuous chain: font
> "great-vibes-regular" with 2 mm stones. Remove the frame, or use fewer letters. (0.679 stones
> across the stem; 0.700 needed to clear the single-chain minimum.)

`diagnostics.remedies` for the same case: `["remove-frame", "fewer-letters"]` — `smaller-stone-size`
absent (SS6 is the floor), `larger-frame` absent (the circle is already at its own 150 mm cap),
`less-letter-spacing` absent (already 0).

## 5. The `diagnostics.remedies` contract

Both `CHAIN_TOO_THIN` failures now carry a `remedies` field on `diagnostics`: an array of zero or
more of the five codes above (`'remove-frame'`, `'smaller-stone-size'`, `'larger-frame'`,
`'less-letter-spacing'`, `'fewer-letters'`), in the same gain order the sentence uses, containing
only the codes reachable in that exact request. It is generated by the same
`buildChainTooThinRemedies()` call that produces the sentence — there is no second, independent
computation to drift out of sync with the prose.

This was added after the initial MONO-022 landing (`ca1525e`), specifically so a caller (or a test)
can assert the reachable set directly rather than regex-matching the message text — see
`tools/test-mono-016-letter-spacing.mjs` test 7b and `tools/test-mono-022-reachable-remedies.mjs`
tests 4a/4b, which assert it explicitly rather than inferring it from prose. Every diagnostics field
that existed before MONO-022 (`letter`/`string`, `slotIndex`, `achievedStemStones`,
`minChainStones`, `fittedHeightMm`, `stoneSizeMm`, `stemWidthRatio`, `boundThatBound`,
`allLetterStemStones`) is unchanged — `remedies` is a pure addition, verified byte-identical against
a `develop` @ `d0e4bfb` baseline captured via `git stash` (see the test file's `BASELINE_*`
constants).

## 6. Not touched

- The `CHAIN_TOO_THIN` gate itself (the `achievedStemStones < minStones` comparison) and every
  threshold it uses (`minChainStones`, `MIN_HEIGHT_TO_STONE_RATIO`, `SINGLE_CHAIN_MIN_RATIO`).
- The `reason` code (`chain-too-thin`).
- Every diagnostics field that predates this milestone (§5).
- Any successful generation — `CHAIN_TOO_THIN` is a failure-only branch, so emitted geometry for a
  passing monogram is untouched.

## 7. Tests

`tools/test-mono-022-reachable-remedies.mjs`:

1. `remove-frame` appears in the message for a real frame (`circle`) and is absent for `frameId:
   'none'`, both call sites (1, 1b).
2. Unreachable remedies are dropped — SS6 / circle at its 150 mm cap / spacing 0 offers only
   `remove-frame` and `fewer-letters`; a control at SS16 / 120 mm / spacing 1 mm offers all five (2).
3. The per-frame cap is read, not assumed — an oval at 150 mm width (cap 180) offers `larger-frame`;
   a circle at the same 150 mm width (cap 150) does not (3).
4. Every pre-MONO-022 diagnostics field is byte-identical to a `develop` @ `d0e4bfb` baseline
   captured via `git stash`; `diagnostics.remedies` is asserted separately against the exact
   expected code list for both call sites (4a, 4b).
5. The reproduction case's final message text, printed for reference (5).

`tools/test-mono-016-letter-spacing.mjs` test 7b (restored in the MONO-022 correction round —
`b365736` had dropped its predecessor, a prose regex match that no longer held once the fix landed)
asserts `diagnostics.remedies` for a `none` / spacing-0 / SS10 / 3-letter script request equals
exactly `['smaller-stone-size', 'fewer-letters']`.

No other repository test asserts on `CHAIN_TOO_THIN` message text or the pre-existing diagnostics
shape in a way this milestone's message rewrite could break — confirmed by re-running
`test-mono-012`, `test-mono-013`, `test-mono-014`, `test-mono-015`, `test-mono-018` clean.

## 8. BACKLOG

A new row in `docs/BACKLOG.md` ("Deferred technical follow-ups") records this milestone. It does not
resolve the MONO-021-measurement row on three-letter interlocked script needing the `none` frame
(`docs/BACKLOG.md`, the row citing `develop` @ `abbd878`) — that row is about the underlying geometry
limitation (a framed three-letter script mark cannot clear the single-chain minimum at any reachable
frame size above SS6), which MONO-022 does not change. MONO-022 only makes the failure message honest
about which remedies can help for a *given* request; "remove the frame" being the answer for the
`"QWE"` / `circle` / SS6 case is a specific instance of that same underlying limitation, not a fix for
it.
