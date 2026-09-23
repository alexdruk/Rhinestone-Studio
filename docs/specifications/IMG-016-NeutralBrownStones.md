# IMG-016 — Neutral and Brown Stones

**Status: spec only.** File:line citations are against `develop` @ `9a107de` plus this branch's
wording-only commit to `tools/test-img-012-auto-colour-count.mjs`. Neither commit moves any line cited
here. Figures marked "provided" come from the lead architect and are recorded as given. Figures
marked "measured" come from this spec's own scratch probes, run on the pristine tip and on a scratch
copy of the tree with the six entries below appended. The copy lives in the session scratchpad, not
under `tools/scratch/`.

## Objective

`src/renderer/CrystalColors.js` holds 17 colours. Its only neutrals are `crystal-clear`, `crystal`
(Crystal AB), `jet` and `silver`, and it has no browns. The catalogue serves every user of the app, so
it should cover the stone colours in common supplier use, under generic names.

Photographs show the gap most clearly. IMG-015 labels every subject pixel with its nearest catalogue
colour. With nothing between jet (L≈6) and silver (L≈88), a greyscale portrait's mid-greys have to
land on jet, silver or light-sapphire. With no browns, a tiger's fur has to land on topaz, siam or
silver.

IMG-016 appends six entries: three neutrals and three browns. Nothing else changes.

| id | name | group | fill |
|---|---|---|---|
| `hematite` | Hematite | Metallic | `#3e3f44` |
| `black-diamond` | Black Diamond | Clear & Neutral | `#6b6b72` |
| `grey` | Grey | Clear & Neutral | `#9a9ca2` |
| `smoked-topaz` | Smoked Topaz | Brown & Peach (new) | `#6e4a2e` |
| `light-colorado` | Light Colorado Topaz | Brown & Peach (new) | `#b98a5c` |
| `light-peach` | Light Peach | Brown & Peach (new) | `#eec6a4` |

The fill hex values are the lead architect's provisional values.

## Measured comparison — real images

### Provided figures, reproduced

These are raw nearest-colour mean ΔE (CIE76) over subject pixels, before the floor. Settings are the
app defaults: subject mask, `maxWidthPx`/`maxHeightPx` 400, threshold 128, no invert, no blur, and
`transparent:'ignore'` (the default at `app.js:5513`). The photo fixtures are IMG-015's own `.rgba`
decodes in `tools/scratch/img-015/`. Every provided figure reproduces.

| Image | 17 colours, provided | 17 colours, measured | 23 colours, provided | 23 colours, measured |
|---|---|---|---|---|
| portrait | 18.8 | 18.79 | 5.7 | 5.66 |
| Einstein | 25.1 | 25.06 | 14.2 | 14.18 |
| tiger | 23.3 | 23.27 | 11.0 | 11.04 |
| butterfly | 22.6 | 22.59 | 16.3 | 16.32 |
| cartoon | 23.4 | 23.39 | 23.0 | 23.04 |

The provided shares also reproduce:

* **Portrait:** raw shares with 23 colours are jet 38.9, black-diamond 24.0, grey 19.3 and hematite
  17.0 percent. Light-sapphire (11.6% with 17 colours) no longer clears the floor.
* **Tiger:** topaz (11.0% raw with 17 colours) no longer clears the floor. The fur goes to
  light-colorado 16.9% and smoked-topaz 15.3%.

### Floor and cap with 23 colours (decision 4)

The rule is IMG-015's, unchanged: a colour needs a raw share of at least 1.2% to be kept. When more
than eight colours clear the floor, the cap keeps the eight with the largest raw share (ties go to
palette order), and the pixels of the dropped colours are relabelled to their nearest kept colour.
Auto resolves to max(2, n), where n is the number of kept colours. All figures below are measured.

| Image | Clear, 17 | Clear, 23 | Auto, 23 | Dropped by the cap, 23 |
|---|---|---|---|---|
| portrait | 3 | 4 | 4 | — |
| Einstein | 7 | 11 | 8 | siam, rose, crystal-clear |
| tiger | 6 | 9 | 8 | crystal-clear |
| butterfly | 10 | 16 | 8 | grey, light-colorado, citrine, silver, siam, crystal-clear, sapphire, gold |
| cartoon | 8 | 8 | 8 | — |
| logo | 3 | 5 | 5 | — |
| furry | 8 | 11 | 8 | topaz, light-peach, crystal-clear |

With 17 colours, only butterfly hits the cap (it drops sapphire and gold).

The colours kept with 23 colours, after relabelling (final share, %):

* **portrait:** jet 38.9, black-diamond 24.0, grey 20.1, hematite 17.0
* **Einstein:** smoked-topaz 28.3, grey 19.0, jet 12.2, light-colorado 11.5, black-diamond 10.2,
  silver 9.5, light-peach 5.8, hematite 3.6
* **tiger:** light-colorado 17.2, silver 16.3, smoked-topaz 15.4, grey 14.7, jet 13.0, black-diamond
  8.3, hematite 7.8, light-peach 7.3
* **butterfly:** hematite 16.7, topaz 16.6, smoked-topaz 14.0, light-peach 12.1, jet 11.4,
  black-diamond 11.1, light-sapphire 9.5, aquamarine 8.5
* **cartoon:** gold 35.6, topaz 19.2, light-siam 9.6, siam 9.3, peridot 7.7, jet 6.6, smoked-topaz
  6.5, citrine 5.5 (smoked-topaz replaces rose, which falls under the floor)
* **logo:** jet 87.7, grey 4.6, silver 3.5, black-diamond 2.4, hematite 1.7
* **furry:** grey 26.0, silver 20.3, black-diamond 18.8, smoked-topaz 9.9, light-colorado 8.5,
  hematite 8.2, light-sapphire 4.4, jet 3.9

## Decisions

### 1. Six entries appended to `CRYSTAL_COLOR_LIST`; one derivation rule for the render channels

The six `defineColor()` calls go after `silver`, the current last entry (`CrystalColors.js:125-129`),
before the closing `];` at `:130`, in the table's order. No existing entry moves.

**Groups:**

* `black-diamond` and `grey` join **Clear & Neutral**. They are tinted transparent neutrals, like
  `crystal-clear` and `jet`.
* `hematite` joins **Metallic**. In supplier use, hematite is a metallic-coated dark stone, the
  darker counterpart of `silver`.
* The three browns form a new group, **Brown & Peach**, named in the existing "X & Y" style. They do
  not fit **Yellow & Amber**: `light-peach` is a skin tone, not an amber, and the group would then mix
  saturated ambers with muted browns.

**Resulting flat list order** (the order `CRYSTAL_COLORS`, `STONE_COLORS` and `imageColorPalette()`
return): crystal-clear, crystal, jet, siam, light-siam, rose, fuchsia, amethyst, sapphire,
light-sapphire, aquamarine, emerald, peridot, topaz, citrine, gold, silver, **hematite,
black-diamond, grey, smoked-topaz, light-colorado, light-peach**.

**Resulting selector order.** Both `listCrystalColorGroups()` (`CrystalColors.js:149`) and
`populateStoneColorOptions()` (`app.js:242`) group by a colour's first appearance in catalogue order.
Appended entries therefore join the end of their existing group, and the new group comes last. This
was measured on the scratch copy, both headless and in the browser:

| Group | Colours |
|---|---|
| Clear & Neutral | crystal-clear, crystal, jet, **black-diamond, grey** |
| Red & Pink | siam, light-siam, rose, fuchsia |
| Purple & Blue | amethyst, sapphire, light-sapphire |
| Green & Aqua | aquamarine, emerald, peridot |
| Yellow & Amber | topaz, citrine |
| Metallic | gold, silver, **hematite** |
| **Brown & Peach** | **smoked-topaz, light-colorado, light-peach** |

Appending, rather than inserting each entry inside its group, keeps every existing palette index
unchanged. Palette order is IMG-015's tie-break for labelling, the cap and relabelling, and the
order of `colorGroups`. With appending, a new colour never wins a tie against an old one.

**Render-channel rule.** The existing entries' `stroke`, `shine` and `accent` are hand-picked, but
they follow one consistent pattern. The three constants below are the medians, rounded to two
decimals, of the 45 per-channel ratios over the 15 entries other than `jet` and `crystal` (medians
0.557, 0.768 and 0.833). The rule is applied per sRGB channel `v` of `fill`, rounded with
`Math.round`:

* `stroke = round(0.56 × v)`
* `accent = round(0.77 × v)`
* `shine = round(v + 0.83 × (255 − v))`

Over those 15 entries, the rule reproduces the hand-picked values to a mean absolute error of 8.5
per channel. Two entries are exceptions and keep their pre-existing RS-0003.5C2 values:

* `jet` has a light stroke (`#d9d9d9`).
* `crystal` (Crystal AB) has an iridescent blue `accent`.

The rule is not applied to either. `hematite` follows the rule like every other entry: its stroke
(`#232326`) is darker than its fill.

**Pinned values:**

| id | fill | stroke | shine | accent |
|---|---|---|---|---|
| `hematite` | `#3e3f44` | `#232326` | `#dededf` | `#303134` |
| `black-diamond` | `#6b6b72` | `#3c3c40` | `#e6e6e7` | `#525258` |
| `grey` | `#9a9ca2` | `#56575b` | `#eeeeef` | `#77787d` |
| `smoked-topaz` | `#6e4a2e` | `#3e291a` | `#e6e0db` | `#553923` |
| `light-colorado` | `#b98a5c` | `#684d34` | `#f3ebe3` | `#8e6a47` |
| `light-peach` | `#eec6a4` | `#856f5c` | `#fcf5f0` | `#b7987e` |

`defineColor()` (`:31`) derives `previewColor`, `highlight` and `shadow` from these, as it does for
every entry. All six pass `validateCrystalColorCatalog()` (checked on the scratch copy).

### 2. Existing ids and values are untouched

No existing entry's `id`, `name`, `group`, `fill`, `stroke`, `shine` or `accent` changes, and no entry
moves. So:

* every saved project's `layer.color` and `colorMap` still names a valid colour;
* every generated stone's `color` id still resolves to the same values;
* `DEFAULT_CRYSTAL_COLOR_ID` (`:138`) stays `'gold'`.

A project saved with a new id and opened in an older build is outside the backward-compatibility
guarantee. In that case the 2D renderers and exporters fall back to `crystal`
(`CanvasRenderer2D.js:29`, `SvgExporter.js:58`), and `Preview3DRenderer.js:560` reads
`getCrystalColor(id).fill` with no fallback. That fallback behaviour predates this milestone, and
applies to any unknown id.

### 3. Image layers regenerate differently; nothing else does

A stone's colour is derived at generation time only for image layers. Wherever a new colour is now
nearer to a subject pixel than every old one, that pixel's label changes. So the colour groups, the
Auto count, the per-stone modal colour and the Studio hint can all change for existing image layers
on their next regeneration.

* `colorMap` overrides keep IMG-015's semantics (decision 5 of that spec). An override keyed by an old
  catalogue id no longer applies if that id is no longer a kept group for the layer.
* Single-colour image layers (`colorCount: 1`) are unaffected. They never label against the palette.
* Every non-image layer (text, shapes, SVG, paths, monogram, Stamp/Trace/Paint marks) is unaffected.
  Its colour is a stored id, never derived.

**Line Design output changes too, including its geometry, not only its colours.**
`LineDesignSampler.js` labels every pixel against the same palette (`:652`, `:682`). Its ink
structure (decision d of IMG-010) is exactly the set of pixels labelled `'jet'` (`:58-60`, `:78-84`).
Dark pixels that labelled jet with 17 colours now partly label hematite or black-diamond. The ink
region shrinks, and with it the `line` stones and the fill/pocket split. The outline is traced from
the silhouette and does not change.

Measured with a 100 mm-wide placement and a 0.3 mm gap:

| Image | Stones, 17 → 23 | line | fill | pocket | Jet stones | Unchanged positions (23) |
|---|---|---|---|---|---|---|
| portrait | 1049 → 1061 | 34 → 45 | 653 → 628 | 129 → 155 | 717 → 476 | 503 of 1061 |
| Einstein | 676 → 658 | 96 → 69 | 254 → 281 | 186 → 168 | 165 → 110 | 167 of 658 |
| tiger | 972 → 971 | 122 → 137 | 408 → 399 | 263 → 256 | 315 → 162 | 211 of 971 |
| butterfly | 473 → 443 | 66 → 54 | 105 → 125 | 152 → 114 | 184 → 48 | 172 of 443 |
| cartoon | 593 → 568 | 66 → 57 | 115 → 139 | 170 → 130 | 70 → 59 | 352 of 568 |
| logo | 247 → 251 | 26 → 30 | 40 → 40 | 50 → 50 | 244 → 249 | 229 of 251 |
| furry | 432 → 397 | 36 → 3 | 123 → 175 | 111 → 57 | 106 → 21 | 244 of 397 |

The furry image loses almost all of its interior lines (36 → 3), because its jet share falls from
20.0% to 3.9%. See open question 1.

### 4. The 8-colour cap and the 1.2% floor are unchanged

`AUTO_MAX_K` (`src/image/AutoColourCount.js:20`) stays 8, and `MIN_CATALOG_COLOR_SHARE`
(`src/image/ColorQuantize.js:40`) stays 0.012. The table above records the per-image outcome. A
larger catalogue means more colours clear the floor, so the cap binds more often: on five of the seven
images instead of one. Where it binds, the cap keeps the largest raw shares. A small but visually
distinct colour can lose to a large neutral this way (butterfly drops citrine, siam and sapphire).
That is an accepted consequence, not a change of rule.

### 5. Out of scope

* **A vividness or chroma control.** More neutrals mean a saturated colour needs a larger share to
  survive. Tiger topaz, for example, drops under the floor. A control that boosts subject chroma
  before labelling would trade that back. This is a later milestone: see the new `docs/BACKLOG.md`
  row, with the lead's measurement.
* **Any change to the hex values of existing colours**, including a recalibration of the six new
  fills beyond the provisional values above.

### 6. One catalogue feeds every stone-colour selector

Every stone-colour `<select>` is empty in `index.html`. Each is populated at startup by
`populateStoneColorOptions(targetId)` (`app.js:242`), which iterates `Object.values(STONE_COLORS)`.

| `<select>` | `index.html` | Population site in `app.js` |
|---|---|---|
| `stoneColor` | `:1503` | `:7480`, `populateStoneColorOptions()` (the default target) |
| `stampColor` | `:654` | `:7480` |
| `traceColor` | `:662` | `:7480` |
| `paintColor` | `:670` | `:7480` |
| `monogramColor` | `:887` | `:6340` |
| `monogramFrameColor` | `:894` | `:6341` |
| `imgColorPick0` … `imgColorPick7` | `:1193-1200` | `:7480`, the `for(let i=0;i<8;i++)` loop |

The brief cites `app.js:168` for `populateStoneColorOptions()`. At this tip, `:168` is a comment in
the `#font` selector's header that mentions the function. The definition is at `:242`.

* **No hand-written option lists.** None of the 14 has an `<option>` in `index.html`. The only other
  places that create options in `app.js` are the stone-size custom option (`:266`), the legacy font
  option (`:336`) and the retired text-mode option (`:366`). None touches a colour select.
* **Image picks set values only.** Studio rendering (`:6549-6550`) and the write-back (`:2800`) only
  set or read `pickEl.value`.
* **The new colours need no further change.** On the scratch copy in Chrome, every one of the 14
  selects showed 23 options in 7 optgroups, ending Smoked Topaz, Light Colorado Topaz, Light Peach,
  with no page errors.
* **Product colours stay outside the catalogue.** `cupColor` (`index.html:511`) and `plateColor`
  (`:520`) are product colours with hand-written option lists, by design. They describe the vessel,
  not a stone.

**No per-id handling is needed anywhere downstream.** Every consumer resolves a stone's colour
generically, by id lookup:

* `src/renderer/CrystalAppearance.js` does not read the catalogue at all.
* `CrystalStoneRenderer.js:170` and `CanvasRenderer2D.js:29` look up `STONE_COLORS[colorKey]`, with
  a `crystal` fallback.
* `Preview3DRenderer.js:560` reads `getCrystalColor(stone.color).fill`.
* `SvgExporter.js:38`, `:58` and `ProductionSheetExporter.js:105`, `:118`, `:524` look up
  `STONE_COLORS[...]`. The legend lists `.name`, so new names appear with no change.
* `DrawingCanvasTool.js` has no catalogue reference beyond the `'gold'` defaults (`:166`, `:169`).
  Its dots take their colour through app.js's resolver (`app.js:2378-2380`).
* `RhsFixtureBridge.js:79-84` builds a name→id map from the catalogue, so the six new names resolve
  with no change. No new name collides with an existing one.
* `DxfExporter.js:31` derives layer names from the id, for example `STONES_LIGHT-COLORADO`.

A grep for every existing id as a quoted literal across `src/` and `app.js` finds only `'gold'`
defaults and `LineDesignSampler.js`'s `'jet'`. The new ids have no special cases.

**Build obligation: a selector guard test.** It reads `app.js` and `index.html` as text and fails if
any of the following holds:

1. The set of `<select>` ids in `index.html` that `populateStoneColorOptions` populates differs from
   the pinned list above. Adding or removing a stone-colour selector fails until the test's list is
   updated.
2. Any pinned select has an `<option>` or `<optgroup>` in `index.html`.
3. Any `<select>` whose id matches `/colou?r/i` is neither in the pinned list nor in the pinned
   product-colour list (`cupColor`, `plateColor`). This catches a new colour select populated some
   other way.
4. `populateStoneColorOptions()`'s body reads anything but `Object.values(STONE_COLORS)`, or any
   other site in `app.js` writes `innerHTML`, `.add(` or `appendChild` into a pinned select.
5. Executed for real via the established slice-and-`new Function` pattern against a fake `el()`, the
   function does not emit exactly `CRYSTAL_COLORS.length` options, grouped as
   `listCrystalColorGroups()` groups them.

## Existing tests

A grep of `tools/test-*.mjs` found the files that pin the catalogue size, a list of ids, a colour
selector's contents, group labels, Production Sheet legend content, or catalogue-derived image
outcomes. Each was run on the scratch copy with the six entries appended:

crystal-color-catalog, crystal-color-integration, stone-color, crystal-appearance,
crystal-stone-renderer, img-002, img-008, img-009, img-010, img-011, img-012, img-013, img-014,
img-015, fill-algorithms-integration, mono-006-monogram-ui, preview3d-instanced-stones,
render-export-pipeline, s200-app-integration, variable-stone-sizes, architecture-module-boundaries,
gallery, geometry-engine, history-manager, mono-005, mono-007-010-coverage, mono-021,
production-export-validation, production-sheet-exporter, rs-3037-flat-sheet, rs3036-dxf-exporter,
stone-sprite-cache.

**31 of 32 pass unchanged. One fails:** `tools/test-img-015-direct-catalogue-colour.mjs`.

### Pinned literals expected to change

**`tools/test-img-015-direct-catalogue-colour.mjs`, Item 1 (`:182-193`), Fixture A.** Fixture A's
two close dark greys, (20,20,20) and (50,50,50), were both nearest jet with 17 colours. With 23
colours, (50,50,50) is nearest hematite. The fixture now splits into two groups:

| Line | Old | New |
|---|---|---|
| `:182` title | `…Auto 2, one group jet (32,32,32) 100.00%, 169 jet stones, hint "Auto: 1 colour"` | `…Auto 2, jet (20,20,20) 60.00% + hematite (50,50,50) 40.00%, 169 stones jet 104 hematite 65, hint "Auto: 2 colours"` |
| `:185` `auto` | 2 | 2 (unchanged) |
| `:187` groups | `[{ id: 'jet', rgb: [32, 32, 32], share: '100.00' }]` | `[{ id: 'jet', rgb: [20, 20, 20], share: '60.00' }, { id: 'hematite', rgb: [50, 50, 50], share: '40.00' }]` |
| `:189` stones | 169 | 169 (unchanged) |
| `:190` colour counts | `{ jet: 169 }` | `{ jet: 104, hematite: 65 }` |
| `:191` `colorGroups.length` | 1 | 2 |
| `:192` hint | `'Auto: 1 colour'` | `'Auto: 2 colours'` |

Item 1 stops being an example of "Auto 2 with a single group" (IMG-015 decision 7). Item 2
(Fixture B, orange plus a darker shade, `:195-206`) still covers that case, and passes unchanged:
topaz (202,125,35) 100.00%, 169 topaz stones, `'Auto: 1 colour'`. Nothing is lost by updating Item 1.
The fixture generator is pinned verbatim in IMG-015's spec, so the fixture itself does not change.
Only the expectations do.

### Unchanged, noted

* **`tools/test-crystal-color-catalog.mjs`** keeps passing. Item 1 (`:58-59`) asserts `>= 17`, and
  `REQUIRED_NAMES` (`:39-43`) lists the 17 existing names. The build adds the six new names to
  `REQUIRED_NAMES`. The build also adds a byte-identity pin for all 17 existing entries' four channels
  and group (decision 2); Item 5 (`:106`) today covers only the 7 pre-RS-1007 ids. It also pins the
  23-entry order and the six new entries' values (decision 1).
* **`tools/test-crystal-color-integration.mjs`** Item 2 (`:77-87`) matches `populateStoneColorOptions`
  and `<optgroup` by pattern only, so the count is not pinned.
* **img-002, 008, 009, 010, 012 and 013** all pass unchanged. Their fixtures are synthetic, or use
  their own test palettes, or their colours stay nearest an old entry. Item 1 of img-008 pins a photo
  SVG sha256; its fixture is unaffected. img-010's Line Design fixture is unaffected even though real
  photographs change (decision 3). No existing test covers Line Design on a photograph.
* **Production Sheet:** no test pins legend content that the six entries change.

## Code sites the build touches (at `9a107de`)

| File | Line(s) | Change |
|---|---|---|
| `src/renderer/CrystalColors.js` | `:125-130` | Append the six `defineColor()` entries after `silver`, before `];` |
| `src/renderer/CrystalColors.js` | `:46` | Comment: note that appended entries join their group at its end |
| `app.js` | `:66`, `:237` | Comments "17-color" / "(17 entries)" → 23 |
| `src/renderer/StoneColors.js` | `:6` | Comment "17 entries" → 23 |
| `docs/ARCHITECTURE.md` | `:293` | "17-color" → 23, plus one sentence citing IMG-016 |
| `tools/test-crystal-color-catalog.mjs` | `:39-43`, `:58-59`, after `:106` | Six names added, count, full 17-entry byte pin, new-entry pin |
| `tools/test-img-015-direct-catalogue-colour.mjs` | `:182-192` | Item 1 literals, per the table above |
| `tools/test-img-016-neutral-brown-stones.mjs` | new | Selector guard (decision 6), derivation rule (decision 1), the 23-colour floor/cap outcome on a synthetic fixture |

No change to `app.js` code, `index.html`, `src/image/**`, `src/geometry/**`, `src/export/**`,
`src/preview3d/**` or `src/drawing/**`.

## Open questions for the lead

1. **Line Design ink structure.** The ink structure is exactly the jet-labelled region, so adding
   hematite and black-diamond thins the interior lines on photographs (furry 36 → 3 line stones).
   Options:
   * accept the change;
   * widen the ink structure to `{jet, hematite}` (a one-set change at `LineDesignSampler.js:60`,
     with its own before/after measurement);
   * keep labelling Line Design's ink against the 17-colour set.

   This spec assumes the first option (no Line Design change), pending the lead's decision.
2. **Group name.** "Brown & Peach" is this spec's choice for the new group. "Brown & Nude" and "Earth"
   are alternatives, if the product prefers different wording.
