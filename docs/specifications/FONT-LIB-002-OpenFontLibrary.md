# FONT-LIB-002 — Open Font Library

Status: **Implemented.** The font picker now offers every enabled OpenType font in the manifest,
17 more static font files were bundled, and the Browse Fonts panel groups its rows by family with
an inline weight/style selector.

---

## 1. Problem

The picker gate introduced by FONT-002 and narrowed by FONT-DECISION-001 filtered the `#font`
control and the Browse Fonts panel down to `providerId === 'rhinestone'` **plus** OpenType fonts
carrying `"rhinestoneValidated": true` in `assets/fonts/manifest.json`. Only four OpenType fonts
had ever earned that flag (Baloo 2, Anton, Sacramento, Dancing Script), so nine perfectly working,
already-bundled OpenType fonts — Courier Prime, Great Vibes, PT Serif, Montserrat, Playfair
Display, Cinzel, Lobster, Caveat — were shipped on disk, registered in the manifest, fully
resolvable by the geometry pipeline, and yet invisible in the UI. A layer could only reach them by
loading an old project that already referenced one.

## 2. Decision

- **Any `enabled` OpenType font is offered.** `productionFonts()` now returns every manifest
  record with `"enabled": true`, plus the authored `providerId: 'rhinestone'` fonts. This is the
  same set `listFonts()` already returns, so the picker and the text engine's accepted-input set
  (`TEXT_ENGINE_FONT_IDS`) are now the same list.
- **Ratings become a badge, not a gate.** `rhinestoneValidated` and `unsupportedStoneSizes` stay
  in the manifest and in `FontManager`. `rhinestoneValidated` now only renders a small muted
  ✓ "Rated legible" badge on the library row (with a title explaining it refers to
  FONT-DECISION-001 / FONT-PORTFOLIO-001's human-and-metric review). `unsupportedStoneSizes` is
  unchanged — it still greys out individual stone sizes per font in
  `updateStoneSizePrintableCapabilityUI()`.
- **"Legacy" is redefined.** In the Text Lightbox capability UI a font is "legacy" only when it is
  neither authored nor `enabled` — i.e. a project references an id whose record has since been
  disabled. The RobotoMono placeholder stub (`"enabled": false`, an intentionally unparsable
  14-byte file kept for `tools/test-opentype-provider.mjs`) is the one registered font the picker
  never lists.
- **Static instances only.** opentype.js reads a variable `[wght]` file at its default master, so
  a variable file cannot supply a real Bold. Only static `.ttf` instances were bundled.

FONT-DECISION-001 already established the production approach this milestone leans on: an
**untransformed** OpenType font, sampled by the existing `StoneSampler` with no procedural outline
modification, is what clears the legibility bar (every FONT-GEN / FONT-CAL / FONT-VIS attempt to
fatten or rebuild outlines was rejected). Opening the gate is therefore not a lowering of
standards — it exposes fonts that were always usable, and lets the operator judge fit for a given
design, with the rating badge as advisory signal.

## 3. What was added

### 3.1 Picker rule (`app.js`)

- `productionFonts()` filter changed from `f.providerId==='rhinestone' || f.rhinestoneValidated===true`
  to `f.providerId==='rhinestone' || f.enabled===true`.
- `updateTextFontCapabilityUI()`'s `legacy` classification changed from "known, not authored, not
  validated" to "known, not authored, not `enabled`". The `validated` flag is retained locally
  because TXT-104's capHeight letter-height mode still keys off it.
- The `#font` `<select>` keeps one `<option>` per font id (unchanged storage/resolution). A
  non-Regular style is now spelled out in the option label ("Poppins SemiBold"), and options
  within an optgroup sort by family then weight.

### 3.2 Browse Fonts panel — family → style rows (`app.js`, `index.html`)

`renderFontLibraryList()` now collapses the filtered font list to one row per family
(`fontFamilyEntries()`). A family with more than one bundled style gets a compact inline
`<select>` (`data-style-select`) listing its styles by `style` name; choosing one calls
`pickFont()` exactly as clicking the row does. Single-style families show no selector. The preview
canvas always renders the family's Regular / lowest-weight instance. Search now also matches the
`style` name; the category filter and per-font-id favourites are unchanged (the Favourites and
Recently Used groups keep per-style granularity).

### 3.3 Bundled fonts (`assets/fonts/`, `assets/fonts/manifest.json`)

17 static OpenType instances, all `enabled: true`, no `rhinestoneValidated` key:

| Role | Families |
|---|---|
| script | Pacifico, Alex Brush, Allura, Satisfy, Kaushan Script, Yellowtail, Cookie, Parisienne, Mr Dafoe |
| block | Bebas Neue |
| display | Righteous, Lilita One, Abril Fatface |
| sans-serif | Poppins (Regular / SemiBold / Bold) |
| decorative | Lobster Two (Bold) |

`du -sh assets/fonts`: **3.5M → 5.6M**.

Licensing: SIL OFL for all except **Satisfy** and **Yellowtail**, which `google/fonts` ships under
**Apache-2.0** (`apache/` rather than `ofl/`). Both licenses permit unrestricted commercial
rhinestone production with no attribution requirement in the finished product.

### 3.4 Skipped

Every requested *new weight for an already-bundled family*, and the two new block/display families
sourced from variable-only upstreams, were skipped because `google/fonts` ships them variable-only
with no `static/` subfolder:

- Montserrat Light / Bold / Black
- Playfair Display Bold / Black
- Baloo 2 Bold / ExtraBold
- Cinzel Bold
- Dancing Script Bold
- Fredoka Bold
- Oswald Regular / Bold (entire family — no static instance available)

Net effect: **no already-bundled family gained a weight in this milestone**; all additions are new
families.

## 4. Tests

- `tools/test-typography-font-library.mjs` — tests 1, 8, 9, 10 rewritten for the open gate
  (every enabled font offered; RobotoMono still excluded; multi-weight family label/sort).
- `tools/test-font-manager.mjs`, `tools/test-rs-block.mjs`, `tools/test-rs-modern.mjs`,
  `tools/test-rhinestone-font-prototype.mjs` — manifest-count assertions updated (15 → 32).
- Stone-size-gating tests (`test-font-portfolio-001-stone-size-gating.mjs`,
  `test-font-decision-001-stone-size-ux.mjs`) pass unchanged — `unsupportedStoneSizes` behaviour
  is untouched.
