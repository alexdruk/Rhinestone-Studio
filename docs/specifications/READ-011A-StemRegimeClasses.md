# READ-011A — Stroke-regime classes from measured stem width

**Status:** implemented. Branch `feature/read-011a-stem-regime-classes` off `develop`.

**Authorises:** a new dependency-free leaf module `src/geometry/StemRegime.js` that classifies a
font's measured `stemWidthRatio` into one of four stroke regimes, plus its test and this record.
Nothing consumes the module yet — this milestone changes no product behaviour. It exists so a later
milestone can give each regime its own auto-fit legibility floor instead of the single
`MIN_HEIGHT_TO_STONE_RATIO` that `src/geometry/TextAutoFit.js` applies to every font today.

`MIN_HEIGHT_TO_STONE_RATIO` stays **16** for every font. This milestone does not touch
`TextAutoFit.js`, `app.js`, or any floor arithmetic.

---

## 1. The mechanism the floor targets

`TextAutoFit.js`'s own comment names the failure mode:

> Below `MIN_HEIGHT_TO_STONE_RATIO` stone diameters there are too few stones across a glyph's shrunk
> stroke width for the letterform to read as anything but a blurred row of dots.

The quantity that determines "too few stones across the stroke" is the stem width relative to glyph
height. Auto-fit shrinks `heightMm`; stone diameter is fixed (a real catalog rhinestone, never
scaled); so as height falls, the number of stone diameters spanning a stem falls with it. When that
count drops below roughly one, the stroke is a single wandering row of dots and the letter stops
reading.

`stemWidthRatio` (stem width ÷ glyph height, already measured per font and stored in
`assets/fonts/manifest.json`, cross-checked by `tools/test-read-003-stem-width.mjs`) is exactly that
ratio. It is the axis the floor depends on.

## 2. Why stroke regime replaces the script / non-script axis

Earlier readability work leaned on a script / non-script split (connected cursive vs. everything
else). That axis is a proxy, and a leaky one:

- A **monoline script** (Allura, `stemWidthRatio` 0.0302) and a **monoline sans** (the hairline
  Montserrat build, 0.0145) collapse under shrink in the same way — thin even strokes, no reserve.
- A **massed script** (Pacifico, 0.0883) and a **massed block** (Anton, 0.1225) both tolerate far
  more shrink than either monoline font, script or not.

The thing that predicts how much a letterform can shrink before its stroke stops reading is how wide
the stroke is, not whether the letters join up. Stroke regime measures that directly.

## 3. Boundary derivation

Let `R` be the height-to-stone ratio, `heightMm / stoneSizeMm`. The number of stone diameters across
a stem is:

```
stones across stem = R × stemWidthRatio
```

So a `stemWidthRatio` of `1/R` puts exactly one stone across the stem at height-to-stone ratio `R`.

With SS30 out of scope, the reachable `R` band runs roughly **16 to 25** — its lower end is the
`MIN_HEIGHT_TO_STONE_RATIO` floor, its upper end the largest height-to-stone ratio the in-scope
stone sizes reach before auto-fit stops mattering. Evaluating `1/R` at each end of that band:

| Boundary | Value | Meaning |
| --- | --- | --- |
| `1 / 25` | **0.04** | Below this, a stem never reaches one stone across, even at the most favourable `R` in the band. |
| `1 / 16` | **0.0625** | At this width or above, a stem always clears one stone across, even at the least favourable `R` in the band. |

Between the two, whether a stem clears one stone across depends on `R` — the transitional band.

The two boundaries are stated in `StemRegime.js` as **literals**, not computed from
`MIN_HEIGHT_TO_STONE_RATIO`. Deriving them from the floor would make the class boundaries move
whenever the floor moves, which is precisely the coupling this classification is meant to avoid: the
regimes describe the fonts, and must stay put while the floor is tuned.

### Classes

```
stemWidthRatio < 0.04            → monoline
0.04 ≤ stemWidthRatio < 0.0625   → transitional
stemWidthRatio ≥ 0.0625          → massed
no numeric stemWidthRatio        → unmeasured
```

`unmeasured` is an explicit fourth value, never a fall-through to a regime default. Non-numeric,
`NaN`, `Infinity`, negative and zero inputs all resolve to `unmeasured`.

## 4. Resulting membership (current manifest)

Derived from `assets/fonts/manifest.json` as it stands. `tools/test-read-011-stem-regime.mjs` pins
this font-by-font, so adding a manifest font fails that test until the membership here and in the
test is consciously updated.

**monoline (7)** — `stemWidthRatio` < 0.04

| Font | `stemWidthRatio` |
| --- | --- |
| great-vibes-regular | 0.0357 |
| montserrat-regular | 0.0145 |
| cinzel-regular | 0.0398 |
| sacramento-regular | 0.0279 |
| alex-brush-regular | 0.0309 |
| allura-regular | 0.0302 |
| parisienne-regular | 0.0303 |

**transitional (10)** — 0.04 ≤ `stemWidthRatio` < 0.0625

| Font | `stemWidthRatio` |
| --- | --- |
| courier-prime-regular | 0.0537 |
| pt-serif-regular | 0.0565 |
| playfair-display-regular | 0.0568 |
| caveat-regular | 0.0443 |
| baloo2-variable-regular | 0.0542 |
| dancing-script-regular | 0.0417 |
| satisfy-regular | 0.0568 |
| yellowtail-regular | 0.0616 |
| cookie-regular | 0.0456 |
| mr-dafoe-regular | 0.062 |

**massed (12)** — `stemWidthRatio` ≥ 0.0625

| Font | `stemWidthRatio` |
| --- | --- |
| lobster-regular | 0.0871 |
| anton-regular | 0.1225 |
| pacifico-regular | 0.0883 |
| kaushan-script-regular | 0.0722 |
| bebas-neue-regular | 0.0783 |
| righteous-regular | 0.1018 |
| lilita-one-regular | 0.1355 |
| abril-fatface-regular | 0.1172 |
| poppins-regular | 0.0635 |
| poppins-semibold | 0.0968 |
| poppins-bold | 0.1173 |
| lobster-two-bold | 0.0875 |

**unmeasured (2)** — no `stemWidthRatio`

| Font | Note |
| --- | --- |
| rs-block | rhinestone-provider Production Font (default font); authored stone positions, no outline to measure |
| rs-modern | rhinestone-provider Production Font; authored stone positions, no outline to measure |

### Excluded

- **roboto-mono-regular** — `enabled: false` in the manifest, and its file
  `assets/fonts/RobotoMono-Regular.ttf` is a 14-byte non-font stub kept only so
  `tools/test-opentype-provider.mjs`'s corrupt-file coverage has something unparsable to load. It is
  not a real font and does not classify.

## 5. Out of scope: the Production Fonts need their own floor rule

`rs-block` and `rs-modern` classify as `unmeasured` because they have no vector outline — every stone
position is individually authored on a fixed pitch, so `stemWidthRatio` is undefined for them and
`heightMm` is close to a no-op. `MIN_HEIGHT_TO_STONE_RATIO` already does not really constrain them
(`TextAutoFit.js` degrades to plain fit-to-width when the height/stone inputs are unusable, and
`textHeightBelowReadableMinimum()` exempts authored Production Fonts). A regime-specific floor built
on `stemWidthRatio` therefore has nothing to say about them.

Because `rs-block` is the project default font, `unmeasured` is a live path, not a theoretical one.
A dedicated floor rule for the authored Production Fonts — expressed in their own authored pitch
rather than a measured stem width — is left to a later milestone. This one does not attempt it.
