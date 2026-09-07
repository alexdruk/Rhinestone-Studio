# FONT-LIB-005 — Montserrat ships as Thin: retire it from the library

Status: **Implemented.** The library ships without Montserrat. The `.ttf` stays bundled, tracked and
unchanged, so projects already using Montserrat keep rendering byte-identically.

---

## 1. What was wrong

`assets/fonts/manifest.json` declared `montserrat-regular` as `"style": "Regular", "weight": 400`.
The bundled file is not a Regular.

`assets/fonts/Montserrat-Regular.ttf` is **byte-identical** to Google Fonts' official
`ofl/montserrat/Montserrat[wght].ttf` (sha256
`0f7b311b2f3279e4eef9b2f968bcdbab6e28f4daeb1f049f4f278a902bcd82f7`). It is a **variable** font whose
`wght` axis is min 100 / default 100 / max 900. `opentype.js` reads a variable font's `glyf` table
at its **default instance**, and this font's default instance is Thin: it reports
`usWeightClass = 100` and full name "Montserrat Thin".

This is not a mis-bundled file. There is no static `Montserrat-Regular.ttf` anywhere in
`google/fonts` — both canonical static paths 404. The only Montserrat binary Google publishes is the
variable font, and its default master is weight 100.

## 2. Sweep result

Of the 32 records in `assets/fonts/manifest.json`, `montserrat-regular` is the **only** one whose
declared weight disagrees with the weight `opentype.js` actually renders. The four other bundled
variable fonts — Playfair Display, Cinzel, Caveat, Dancing Script — all have a `wght` default of
400, so their default-instance outlines *are* the Regular weight the manifest claims. Montserrat is
the lone exception.

## 3. Why a hairline cannot be manufactured

READ-003 measured `montserrat-regular`'s `stemWidthRatio` at **0.0145** — the lowest in the library
by a wide margin (the next-lowest measured font is roughly 2× heavier). The rhinestone stroke width
is `stemWidthMm = stemWidthRatio × heightMm`, so:

- Reaching the **smallest catalogued stone** (SS6, 2.0 mm) needs `heightMm ≥ 2.0 / 0.0145 ≈ 138 mm`.
- A **mug's `printableHeightMm` is 85 mm** (`getVesselDefaults('mug')`). At that height the stroke
  is `0.0145 × 85 ≈ 1.23 mm` — well under one 2.0 mm stone.

So on the default product Montserrat trips READ-003's `strokeNarrowerThanOneStone()` gate at **every
reachable height and every stone size**. There is no configuration in which it produces a
manufacturable layout.

## 4. Product decision

**The library ships without Montserrat.** `manifest.json` now carries, for `montserrat-regular`:

| field | was | now |
|---|---|---|
| `style` | `"Regular"` | `"Thin"` |
| `weight` | `400` | `100` |
| `enabled` | `true` | `false` |

`id`, `family`, `path`, `role` and `stemWidthRatio` are unchanged. `family` stays `"Montserrat"` so
`fontFamilyEntries()` grouping and `findBolderSibling()` keep working; `stemWidthRatio` stays 0.0145
because it is frozen READ-011 data referenced by `docs/data/read-011/render-plan.json` and
`render-key.json`.

Poppins already covers the modern geometric-sans role, at three real static weights (400 / 600 /
700).

### What would have to change for anyone to revisit this

Producing a true Montserrat Regular means instancing the variable font at `wght=400` and writing out
a static `.ttf`. The only maintained tool for that is Python `fontTools` — a second language in a
Node-only toolchain, stood up for one binary. That is the record, not a plan.

## 5. Saved-project guarantee

The `.ttf` is **retained deliberately**, tracked and unchanged. `fontManager.listFonts()` keeps
disabled records; only `productionFonts()` filters them out of the picker. So a project whose text
layer has `font: "montserrat-regular"` still resolves through `FontManager.getFont()` and still
renders exactly as before — the retirement removes the font from *new* choices, it does not touch
existing layouts. Deleting the file would flip those layers to the unknown-font path and stop them
rendering; that would be user-visible data loss.

`app.js` builds `TEXT_ENGINE_FONT_IDS` from `fontManager.listFonts({ includeDisabled: true })` (this
milestone) so the text engine keeps accepting a disabled-but-renderable font id — which also keeps a
saved Montserrat layer **duplicable** (`addText()` inherits the source layer's font only if
`TEXT_ENGINE_FONT_IDS.has()` it, otherwise silently substitutes the default).

## 6. Changes

- `assets/fonts/manifest.json` — the three fields above; `notes` rewritten to state the real cause.
- `assets/fonts/README.md` — Montserrat row and the variable-font paragraph corrected.
- `app.js` — `TEXT_ENGINE_FONT_IDS` built with `includeDisabled: true` (line ~1055); comments at
  lines ~159 and ~1056.
- Test tripwires updated consciously: `test-font-manager.mjs` (enabled count 31 → 30, two disabled
  records), `test-read-003-stem-width.mjs` (in-scope 29 → 28, disabled count 1 → 2),
  `test-read-011-stem-regime.mjs` and `test-read-011b-render-plan.mjs` (montserrat is now
  *classified/rated but not enabled* — `RETIRED_RATED_FONT_IDS`; every frozen READ-011 number is
  unchanged), `test-typography-font-library.mjs` (enabled count 31 → 30, `pickFont` case switched to
  `poppins-regular`).
- New: `tools/test-font-lib-005-montserrat-retired.mjs` — manifest / arithmetic / sha256 checks,
  registered in the `text` group.
