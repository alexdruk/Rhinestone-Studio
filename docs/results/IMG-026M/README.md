# IMG-026M: eyes, colour reading and skin rules (BUILD_J → new DEFAULT)

1 Nov 2026, branch `feature/img-026m-eyes-colour-skin`. No provider calls.

IMG-026M copies PatternNifty's (IS, commit `e9e7014`) face rules into the layout service and makes
IS's face defaults the service's `DEFAULT`. `BUILD_J` freezes the previous `DEFAULT`. This page
compares the two on every RS test image.

## Looks worse, or does not match what the plan expected

1. **Stones move near people's eyes (S4, `human_iris` off).** The plan's done criterion says
   stones and sizes match `BUILD_J` except where S1 drops an eye stage. That cannot hold with
   `human_iris` off: the rule removes the SS4 iris rings round a person's pupils, and the gap is
   filled with ordinary stones instead. On einstein, portrait and woman, 26 to 48 stones are
   removed or added, all within 7.4 mm of a pupil; ring SS4s become SS6s (einstein −20 SS4, portrait
   −18, woman −15), and the portrait ends with 4 fewer stones, the woman with 1 more. Nothing moves
   anywhere else, and nothing moves on the animals. With `human_iris` on, the new rules leave every
   position and size as `BUILD_J` (tested in `test_build_m.ImagesAgainstBuildJ`). IS did the same:
   its own `test_build_j` ran with `human_iris` on for this reason.
2. **The woman's eyes may read less like eyes** (`woman-eyes.jpg`). `BUILD_J` put grey and white
   ring stones round each pupil; the new layout fills that space with skin and dark stones, so the
   pupils sit in skin. This is what IS chose ("no goggle rings"), but on this image the eye white is
   mostly gone. The portrait and einstein keep some light stones by the pupil.
3. **Jesus's colour error rises** (all pixels 7.94 → 8.64, stone pixels 6.82 → 6.97). MediaPipe finds
   no person's face in this profile, so the face rules do not apply, but `skin_nearest_inner` reads
   all skin-coloured stones from the inner part of the stone, and here it lightens the hair strands
   and skin: 134 Copper → Golden Shadow, 98 Golden Shadow → Silk. In the picture the hair looks
   paler than the AI image.
4. **The woman's all-pixel colour error rises** (8.09 → 8.31), while her stone-pixel error falls
   (7.54 → 6.79). `skin_nearest_inner` alone raises it by 0.57; turning `soft_outlines` off takes
   back 0.42. Read on the stones themselves (IS's measure) she is better.
5. **Small rises elsewhere, all pixels:** tulips 10.58 → 10.71 (from `sample_delivered`: 41 Fuchsia →
   Scarlet, 38 Metallic Sunshine → Citrine), logo 3.78 → 3.86 (29 Light Topaz → Gold; its stone-pixel
   error falls 3.56 → 3.41), dog 8.98 → 9.02, cat 8.09 → 8.10.
6. **The portrait's greys are re-split across the whole design by `human_iris` off.** Besides the
   moves by the eyes, 411 stones change grey tone, 381 of them more than 10 mm from a pupil (for
   example 136 Graphite → Jet Hematite, 106 Silver → Grey). `distinct_tones` spreads neighbouring
   tones apart over the whole design; with the Silver ring stones gone it splits the grey family
   differently. The portrait's colour error falls (12.71 → 12.00 from this step), so this is not
   worse by the measure, but it is a change far from the eyes.

No eye stage was dropped by S1 (`plausible_eyes`) on any of the 13 images: every image's pupils
were already one plausible pair, a single pupil, or none. No image reports `face: null`.

## How it was measured

- Both layouts on the same Intel iMac and `.venv`, from this branch's code: `BUILD_J` and the new
  `DEFAULT` are both rule sets, so one code base runs both. StarDist detection does not depend on
  the rules, so it ran once per image and was reused.
- From `BUILD_J`, the build M rules were switched on one at a time, in the plan's order, to show
  what each changes ("Rule by rule"). The last step equals `DEFAULT`. `DEFAULT` with `soft_outlines`
  on was also laid out, to isolate that rule.
- **Colour error,** as IS measured it (IS `tools/is05b-tint.mjs`): the design is cut into 2 mm
  cells. The AI cell is the mean sRGB of the AI image's opaque pixels in the cell; the design cell is
  the mean of its stones' catalogue fills (stones whose centre is in the cell, weighted by area).
  ΔE2000 between them, averaged over the cells that have stones and whose counted AI pixels cover at
  least 20 % of the cell. Two variants: **all pixels** (every opaque AI pixel, as the brief defines
  it) and **stone pixels** (only AI pixels within 80 % of a stone's radius, IS's "AI stones" figure).
- Positions are in mm, in the returned stone coordinates (as in `aiLayout.stones`).
- "face animal" means "no person's face found", as in IMG-026L; the logo, lake, rose, tulips and
  sunburst also say it.

## Pictures

`<image>.jpg`: `BUILD_J` left, new `DEFAULT` right, 5 px per mm. Magenta ring: colour changed. Blue
ring: a stone only on that side (moved, added or removed). Red ring: a pupil (from
`report.pupilsAtMm`). Every image except the sunburst changes, so 12 pictures. `einstein-eyes.jpg`,
`portrait-eyes.jpg` and `woman-eyes.jpg` are close-ups of the eyes at 22 px per mm.

`comparison.json` has every number on this page.

## Table

| Image | Stones | By size, BUILD_J | By size, new | Moved, added or removed (J / new) | Colour changed | Eye stage | Pupils (mm) | Pupil centres, new (x, y mm) | Violations | ΔE all pixels, J → new | ΔE stone pixels, J → new |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cat | 2150 → 2150 | ss4 347, ss6 1801, ss20 2 | ss4 347, ss6 1801, ss20 2 | 0 / 0 | 118 | kept (face animal) | 5.91, 5.91 | (33.4, 54.2); (66.1, 54.3) | 0 → 0 | 8.09 → 8.10 | 6.77 → 6.78 |
| dog | 1671 → 1671 | ss4 141, ss6 1528, ss30 2 | ss4 141, ss6 1528, ss30 2 | 0 / 0 | 91 | kept (face animal) | 6.66, 6.66 | (21.5, 41.1); (42.8, 43.8) | 0 → 0 | 8.98 → 9.02 | 5.36 → 5.31 |
| einstein | 3591 → 3591 | ss4 358, ss6 3231, ss20 2 | ss4 338, ss6 3251, ss20 2 | 48 / 48 | 213 | kept (face human) | 5.62, 5.62 | (85.4, 70.1); (111.0, 74.4) | 0 → 0 | 8.51 → 8.50 | 7.85 → 7.80 |
| jesus | 3298 → 3298 | ss4 417, ss6 2880, ss20 1 | ss4 417, ss6 2880, ss20 1 | 0 / 0 | 390 | kept (face animal) | 4.9 | (84.0, 72.4) | 0 → 0 | 7.94 → 8.64 | 6.82 → 6.97 |
| lake | 4089 → 4089 | ss4 162, ss6 3927 | ss4 162, ss6 3927 | 0 / 0 | 587 | none (no pupils) (face animal) | none | none | 0 → 0 | 10.61 → 10.49 | 9.67 → 9.64 |
| leopard | 2431 → 2431 | ss4 224, ss6 2205, ss20 2 | ss4 224, ss6 2205, ss20 2 | 0 / 0 | 240 | kept (face animal) | 4.71, 4.71 | (56.2, 35.3); (82.3, 35.3) | 0 → 0 | 11.10 → 10.94 | 8.65 → 8.42 |
| logo | 833 → 833 | ss4 9, ss6 824 | ss4 9, ss6 824 | 0 / 0 | 30 | none (no pupils) (face animal) | none | none | 0 → 0 | 3.78 → 3.86 | 3.56 → 3.41 |
| parrot | 2542 → 2542 | ss4 234, ss6 2307, ss20 1 | ss4 234, ss6 2307, ss20 1 | 0 / 0 | 242 | kept (face animal) | 4.51 | (129.9, 87.5) | 0 → 0 | 12.54 → 11.88 | 10.54 → 10.05 |
| portrait | 3995 → 3991 | ss4 421, ss6 3572, ss10 2 | ss4 403, ss6 3586, ss10 2 | 30 / 26 | 965 | kept (face human) | 3.46, 3.46 | (74.3, 76.5); (38.6, 80.2) | 0 → 0 | 13.90 → 12.20 | 8.68 → 7.13 |
| rose | 1846 → 1846 | ss4 157, ss6 1689 | ss4 157, ss6 1689 | 0 / 0 | 37 | none (no pupils) (face animal) | none | none | 0 → 0 | 8.63 → 8.57 | 8.45 → 8.39 |
| tulips | 2673 → 2673 | ss4 126, ss6 2547 | ss4 126, ss6 2547 | 0 / 0 | 135 | none (no pupils) (face animal) | none | none | 0 → 0 | 10.58 → 10.71 | 9.89 → 9.89 |
| woman | 2611 → 2612 | ss4 217, ss6 2392, ss30 2 | ss4 202, ss6 2408, ss30 2 | 35 / 36 | 525 | kept (face human) | 6.32, 6.32 | (112.3, 37.1); (92.4, 37.4) | 0 → 0 | 8.09 → 8.31 | 7.54 → 6.79 |
| sunburst_flower | 1011 → 1011 | ss4 48, ss6 963 | ss4 48, ss6 963 | 0 / 0 | 0 | none (no pupils) (face animal) | none | none | 0 → 0 | 7.03 → 7.03 | 6.30 → 6.30 |

Mean over the 13 images: all pixels 9.21 → 9.10; stone pixels 7.70 → 7.45.

Violations are 0 on every image before and after; the minimum gap and coverage are unchanged
except coverage on einstein (0.670 → 0.672) and woman (0.672 → 0.674), from the eye changes.

## Colour changes in full (BUILD_J → new, same position and size)

- **cat** (118): light-siam → siam 18, golden-shadow → light-colorado 12, hematite → jet 10, light-siam → padparadscha 10, crystal-clear → silk 9, light-smoked-topaz → smoked-topaz 6, silver → crystal-clear 6, crystal-clear → smoked-topaz 6, golden-shadow → copper 4, indian-siam → siam 4, smoked-topaz → colorado-topaz 3, light-colorado → copper 3, colorado-topaz → copper 3, smoked-topaz → hematite 2, light-colorado → golden-shadow 2, copper → light-colorado 2, light-smoked-topaz → colorado-topaz 2, light-smoked-topaz → greige 1, smoked-topaz → greige 1, copper → colorado-topaz 1, graphite → jet-hematite 1, copper → golden-shadow 1, greige → light-smoked-topaz 1, rose-peach → silk 1, silk → golden-shadow 1, silver → golden-shadow 1, silver → silk 1, smoked-topaz → jet 1, light-siam → scarlet 1, silver → smoked-topaz 1, greige → grey 1, hematite → silk 1, jet → citrus-green 1
- **dog** (91): copper → light-colorado 21, light-peach → silk 11, silver → crystal-clear 10, crystal-clear → silver 6, metallic-sunshine → gold 5, light-colorado → light-topaz 5, silk → light-peach 5, colorado-topaz → light-smoked-topaz 4, light-colorado → copper 2, golden-shadow → silk 2, crystal-clear → golden-shadow 2, colorado-topaz → copper 2, metallic-sunshine → citrine 1, light-smoked-topaz → greige 1, colorado-topaz → light-colorado 1, light-colorado → golden-shadow 1, grey → silver 1, crystal-clear → grey 1, jet → hematite 1, golden-shadow → copper 1, light-smoked-topaz → golden-shadow 1, rose-gold → golden-shadow 1, vintage-rose → light-peach 1, light-smoked-topaz → colorado-topaz 1, light-smoked-topaz → smoked-topaz 1, crystal-clear → light-colorado 1, crystal-clear → smoked-topaz 1, metallic-sunshine → smoked-topaz 1
- **einstein** (213): jet → hematite 47, smoked-topaz → jet 27, smoked-topaz → colorado-topaz 23, silver → crystal-clear 16, grey → silver 12, indian-siam → siam 11, siam → smoked-topaz 10, colorado-topaz → copper 10, silk → rose-gold 10, copper → rose-gold 7, graphite → grey 7, siam → light-siam 4, rose-gold → silk 4, copper → colorado-topaz 3, rose-gold → copper 2, smoked-topaz → hematite 2, grey → light-sapphire 2, siam → scarlet 1, light-siam → scarlet 1, scarlet → padparadscha 1, smoked-topaz → siam 1, padparadscha → scarlet 1, jet → smoked-topaz 1, colorado-topaz → rose-gold 1, graphite → hematite 1, crystal-clear → silver 1, light-smoked-topaz → greige 1, hematite → graphite 1, grey → greige 1, graphite → jet-hematite 1, greige → graphite 1, smoked-topaz → indian-siam 1, graphite → silver 1
- **jesus** (390): copper → golden-shadow 133, golden-shadow → silk 98, greige → grey 34, crystal-clear → silk 16, light-smoked-topaz → copper 13, colorado-topaz → copper 12, jet → hematite 10, jet → smoked-topaz 9, smoked-topaz → colorado-topaz 8, light-smoked-topaz → colorado-topaz 7, greige → golden-shadow 7, light-siam → scarlet 6, smoked-topaz → jet 5, silk → crystal-clear 5, grey → silver 4, silver → crystal-clear 3, light-smoked-topaz → golden-shadow 2, colorado-topaz → golden-shadow 2, graphite → grey 2, golden-shadow → copper 1, smoked-topaz → light-smoked-topaz 1, light-peach → silk 1, light-smoked-topaz → smoked-topaz 1, graphite → black-diamond 1, greige → silk 1, smoked-topaz → siam 1, grey → smoked-topaz 1, jet → light-smoked-topaz 1, copper → light-smoked-topaz 1, vintage-rose → grey 1, jet → copper 1, scarlet → grey 1, jet → greige 1
- **lake** (587): sapphire → capri-blue 282, light-sapphire → sapphire 105, silver → crystal-clear 33, light-sapphire → crystal 16, jet → hematite 14, khaki → jet 13, light-smoked-topaz → colorado-topaz 11, emerald → fern-green 9, khaki → emerald 8, golden-shadow → silk 8, crystal-clear → crystal 8, colorado-topaz → copper 7, crystal → crystal-clear 7, jet-hematite → graphite 6, capri-blue → sapphire 6, smoked-topaz → colorado-topaz 5, copper → light-colorado 5, greige → grey 5, fern-green → citrus-green 4, silver → crystal 4, jet → khaki 3, light-colorado → golden-shadow 3, jet → jet-hematite 3, light-sapphire → crystal-clear 3, graphite → greige 3, metallic-sunshine → silk 2, light-sapphire → silver 2, crystal-clear → silver 2, light-sapphire → capri-blue 2, smoked-topaz → light-smoked-topaz 1, hematite → jet 1, emerald → khaki 1, grey → crystal-clear 1, crystal-clear → silk 1, jet-hematite → greige 1, grey → silver 1, fern-green → emerald 1
- **leopard** (240): gold → light-topaz 78, smoked-topaz → colorado-topaz 49, silver → crystal-clear 21, metallic-sunshine → gold 20, metallic-sunshine → light-topaz 8, golden-shadow → silk 8, metallic-sunshine → silk 7, crystal-clear → silk 6, crystal-clear → silver 4, light-smoked-topaz → colorado-topaz 3, light-smoked-topaz → smoked-topaz 3, jet → silk 3, smoked-topaz → jet 2, hematite → jet 2, light-topaz → gold 2, light-smoked-topaz → copper 2, jet → silver 2, colorado-topaz → smoked-topaz 1, citrine → metallic-sunshine 1, grey → silver 1, greige → metallic-sunshine 1, copper → colorado-topaz 1, silver → grey 1, jet → hematite 1, colorado-topaz → copper 1, light-peach → silk 1, light-topaz → metallic-sunshine 1, jet → golden-shadow 1, jet → gold 1, crystal-clear → copper 1, jet → smoked-topaz 1, jet → metallic-sunshine 1, light-smoked-topaz → golden-shadow 1, light-topaz → jet 1, metallic-sunshine → crystal-clear 1, metallic-sunshine → jet 1, jet → crystal-clear 1
- **logo** (30): light-topaz → gold 29, gold → light-topaz 1
- **parrot** (242): light-sapphire → sapphire 102, hematite → jet 29, jet → hematite 24, fern-green → peridot 22, emerald → fern-green 8, peridot → fern-green 4, fern-green → citrus-green 3, citrine → citrus-green 2, aquamarine → chrysolite 2, peridot → chrysolite 2, capri-blue → sapphire 2, light-siam → padparadscha 2, colorado-topaz → rose-gold 2, sapphire → jet 2, citrus-green → fern-green 2, capri-blue → hematite 2, citrine → gold 1, peridot → citrus-green 1, citrus-green → citrine 1, gold → citrine 1, chrysolite → peridot 1, fern-green → olivine 1, emerald → chrysolite 1, grey → light-sapphire 1, olivine → fern-green 1, jet-hematite → hematite 1, emerald → aquamarine 1, emerald → jet-hematite 1, khaki → hematite 1, hematite → khaki 1, jet-hematite → emerald 1, jet → smoked-topaz 1, hematite → jet-hematite 1, capri-blue → jet 1, sapphire → hematite 1, citrus-green → peridot 1, gold → fern-green 1, chrysolite → hematite 1, sapphire → graphite 1, aquamarine → hematite 1, aquamarine → emerald 1, gold → citrus-green 1, fern-green → emerald 1, golden-shadow → smoked-topaz 1, citrus-green → silk 1, citrus-green → olivine 1, citrus-green → metallic-sunshine 1, chrysolite → emerald 1
- **portrait** (965): graphite → jet-hematite 124, silver → grey 106, hematite → jet-hematite 93, graphite → jet 74, smoked-topaz → jet 58, hematite → jet 46, grey → graphite 44, light-peach → silk 43, grey → jet 36, crystal-clear → silk 32, golden-shadow → silk 30, greige → jet 24, golden-shadow → light-peach 23, light-smoked-topaz → golden-shadow 20, rose-gold → light-peach 19, golden-shadow → rose-gold 19, graphite → greige 15, jet-hematite → jet 13, greige → grey 12, rose-gold → silk 11, jet → hematite 11, light-smoked-topaz → rose-gold 10, greige → graphite 9, grey → greige 8, greige → golden-shadow 8, graphite → hematite 7, hematite → graphite 7, greige → rose-gold 5, grey → jet-hematite 5, jet-hematite → graphite 5, silk → light-peach 3, smoked-topaz → light-smoked-topaz 3, jet-hematite → greige 3, smoked-topaz → jet-hematite 3, rose-gold → golden-shadow 2, light-peach → rose-gold 2, greige → silk 2, golden-shadow → greige 2, light-smoked-topaz → greige 2, siam → light-siam 2, greige → jet-hematite 2, indian-siam → jet 2, grey → silk 1, crystal-clear → grey 1, silver → crystal-clear 1, greige → light-peach 1, grey → light-peach 1, light-smoked-topaz → silk 1, greige → vintage-rose 1, graphite → grey 1, silk → golden-shadow 1, light-smoked-topaz → light-peach 1, siam → scarlet 1, light-siam → siam 1, indian-siam → siam 1, jet-hematite → hematite 1, grey → smoked-topaz 1, smoked-topaz → hematite 1, vintage-rose → light-peach 1, scarlet → padparadscha 1, greige → black-diamond 1, jet-hematite → smoked-topaz 1
- **rose** (37): hyacinth → padparadscha 26, padparadscha → hyacinth 9, hyacinth → scarlet 2
- **tulips** (135): fuchsia → scarlet 41, metallic-sunshine → citrine 38, silk → metallic-sunshine 10, silver → crystal-clear 7, silk → crystal-clear 5, light-colorado → light-topaz 5, emerald → erinite 4, rose → scarlet 4, metallic-sunshine → silk 4, light-topaz → gold 3, scarlet → rose 3, silk → citrine 2, silk → light-topaz 2, golden-shadow → light-topaz 2, citrine → gold 1, rose → rose-peach 1, light-topaz → metallic-sunshine 1, fuchsia → rose 1, citrine → rose 1
- **woman** (525): smoked-topaz → colorado-topaz 149, rose-gold → silk 147, smoked-topaz → jet 96, copper → rose-gold 64, colorado-topaz → copper 38, colorado-topaz → rose-gold 12, golden-shadow → silk 7, jet → hematite 3, copper → silk 2, rose-gold → copper 2, light-smoked-topaz → copper 1, light-peach → silk 1, silk → crystal-clear 1, smoked-topaz → light-siam 1, jet → smoked-topaz 1
- **sunburst_flower**: none

## Rule by rule

| Image | plausible_eyes | sample_delivered | human_iris_off | skin_nearest_inner | warm_shadow | lone_white_skin | soft_outlines_off |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cat | – | 68 colours | – | 40 colours | 7 colours | 10 colours | – |
| dog | – | 37 colours | – | 57 colours | 1 colours | – | – |
| einstein | – | 120 colours | −48 +48 stones, 9 colours | 46 colours | 17 colours | – | 28 colours |
| jesus | – | 109 colours | – | 286 colours | 2 colours | 1 colours | – |
| lake | – | 547 colours | – | 36 colours | 5 colours | – | – |
| leopard | – | 169 colours | – | 41 colours | 33 colours | 1 colours | – |
| logo | – | 30 colours | – | – | – | – | – |
| parrot | – | 239 colours | – | 3 colours | – | – | – |
| portrait | – | 433 colours | −30 +26 stones, 411 colours | 204 colours | – | 4 colours | 41 colours |
| rose | – | 37 colours | – | – | – | – | – |
| tulips | – | 135 colours | – | – | – | – | – |
| woman | – | 12 colours | −35 +36 stones, 4 colours | 363 colours | 75 colours | – | 95 colours |
| sunburst_flower | – | – | – | – | – | – | – |

Steps are cumulative from `BUILD_J`; each cell is what that rule changed against the step before.
`plausible_eyes` changed nothing on any image.

## What each rule changed, in plain words

- **`plausible_eyes` (S1).** Drops the eye stage when the pupils it found are not one believable
  pair (very different sizes, far from level, too far apart), and then reports `face: null`. On
  these 13 images every pupil set was believable, so nothing changed. The new
  `report.pupilsAtMm` gives each pupil's centre; it is added on every image.
- **`sample_delivered` (S3).** Each stone's colour is now read where the stone actually ends up,
  from the inner 60 % of its disc, instead of from the AI disc it came from. This changes colours on
  every image except the sunburst (where every stone sits on its disc), most on the lake (547: deep
  blue water Sapphire → Capri Blue, pale Light Sapphire → Sapphire), the portrait (433: greys to Jet
  in the dark hair) and the parrot (239: Light Sapphire → Sapphire, greens shuffled). On all
  pixels it lowered the colour error on 8 images (most on the portrait, −1.19, and the parrot,
  −0.67) and raised it on 4: the tulips +0.13, Jesus +0.09, the logo +0.08 and einstein +0.01 (on
  stone pixels the logo and einstein fell).
- **`human_iris` off (S4).** People no longer get the SS4 ring stones round the pupil that were
  read from the AI's eye white and came out Grey and Silver ("goggles"). Animals keep them. See
  items 1, 2 and 6 at the top.
- **`skin_nearest_inner` (S5).** The skin-colour choice reads the inner 60 % of each stone, not the
  whole disc, which reached into the AI's dark gaps between discs and pulled warm shadow skin to
  Smoked Topaz. Skin goes lighter and warmer: the woman 150 Rose Gold → Silk, 77 Smoked Topaz →
  Colorado Topaz; Jesus 134 Copper → Golden Shadow (item 3); the portrait mixes light skin tones.
  Only skin colours change.
- **`warm_shadow`, ΔE 3 (S6).** A skin stone whose nearest skin colour is Smoked Topaz takes
  Colorado Topaz instead when that is at most 3 ΔE2000 further away. Smoked Topaz → Colorado Topaz
  only: woman 75, leopard 33, einstein 17, cat 6, lake 5, Jesus 2, dog 1.
- **`lone_white_skin` (S8).** A single white stone (Crystal Clear, Crystal or Silver) surrounded by
  skin, away from the eyes, takes its neighbours' colour. Cat 10, portrait 4, Jesus 1, leopard 1.
- **`soft_outlines` off (S2).** The black outline stones on a person's skin, which `BUILD_J` turned
  Smoked Topaz, are Jet again: einstein 28, portrait 41, woman 95. Laid out with everything else
  equal (new `DEFAULT` with `soft_outlines` on → off), these are the only changes, on the three
  people only; no other image changes. It lowers the colour error on all three.
- **S10 (`colour.py` edge fix) and S11 (`eyes.py` edge crash)** are code fixes, not rules, so
  both sides of this comparison already include them. S10 gives a stone whose sampling window
  falls outside the image the colour of the nearest pixel; S11 stops the eye stage crashing on a
  dark disc cut by the image border. Their tests are `StoneBeyondTheEdge` and `DarkDiscAtTheEdge`
  in `services/strass-layout/tests/test_build_m.py`; the S11 test fails on the old code with
  `IndexError` and passes after the fix.
