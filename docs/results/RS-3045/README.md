# RS-3045: pale skin by small groups (BUILD_RS3044 → new DEFAULT)

4 Nov 2026, branch `feature/rs-3045-pale-skin-groups`. No provider calls: every layout here is of an
AI image already on this Mac.

RS-3044's `pale_skin` repeated in rounds, stone by stone, so next to a white animal it crept into the
fur (PatternNifty measured it on painting-ermine and an archive cat). This replaces it with
PatternNifty's version (alexdruk/imagetostrass `6e097d5`, PN-11): candidates found once, touching
candidates form a group, and a group of at most 4 stones changes only when at least half of its
outside neighbours (at least 4, each counted once) are light skin colours (catalogue L\* at least 70:
Silk and Light Peach). One pass. `BUILD_RS3044` freezes RS-3044's `DEFAULT`.

## Anything else that changes

Nothing. Apart from ai.png and the woman's lip stone, which were expected, no stone changes on any
of the 21 layouts; positions, sizes and order are equal everywhere, every report value except
`colours` is equal, and no filled stone changes.

## Done criteria

- **ai.png matches PatternNifty.** Against no pale skin (`BUILD_O`), 22 stones change: Crystal →
  Silk 10, Metallic Sunshine → Silk 9, Citrine → Silk 3. These are the same 22 stones, at the same
  positions (to 0.001 mm) and with the same colours, as the `pale_skin_portrait` row of PatternNifty's
  `docs/pn-11/light/comparison.json`.
- **Against RS-3044 (`BUILD_RS3044`), 2 stones on ai.png change** (`ai-face.jpg`, `ai-chest.jpg`):
  - the Crystal on the forehead beside the gold head chain (stone mm 28.433, 31.979) stays Crystal
    (RS-3044 made it Silk); its 5 outside neighbours are Silk 2, Light Topaz 2 and Light Colorado 1,
    so 2 of 5 are light skin;
  - a Metallic Sunshine on the chest (49.146, 126.438) becomes Silk. It has only three neighbours, so
    RS-3044 skipped it, but its pair has six outside neighbours, all skin.
- **Woman: the lower-lip stone stays Crystal** (`woman-mouth.jpg`; RS-3044 made it Silk). Its
  neighbours are Silk 2, Copper, Colorado Topaz and Light Siam: 2 of 5 light skin.
- **Black & white unchanged:** the 4 IMG-026P layouts are identical in all three builds.
- **The freeze is exact:** on all 21 layouts `BUILD_RS3044` gives exactly the RS-3044 `DEFAULT`
  layouts and `BUILD_O` the RS-3044 "before" layouts (the stone lists of
  `tools/scratch/rs-3044/runs/`, not committed).

## Table

Before is `BUILD_RS3044` (RS-3044's rounds), after is the new `DEFAULT`. "From no pale skin" counts
the stones each rule changes against `BUILD_O`, which is how PatternNifty reports them.

| Image | Mode | Face | Stones | Changed | From → to | From no pale skin: RS-3044 | From no pale skin: RS-3045 |
| --- | --- | --- | ---: | ---: | --- | ---: | ---: |
| ai.png (white-stones diagnosis) | Colour | human | 2826 | 2 | Silk → Crystal 1 (forehead), Metallic Sunshine → Silk 1 (chest) | 22 | 22 |
| cat | Colour | animal | 2162 | 0 | | 0 | 0 |
| dog | Colour | animal | 1683 | 0 | | 0 | 0 |
| einstein | Colour | human | 3594 | 0 | | 0 | 0 |
| jesus | Colour | animal | 3308 | 0 | | 0 | 0 |
| lake | Colour | animal | 4100 | 0 | | 0 | 0 |
| leopard | Colour | animal | 2437 | 0 | | 0 | 0 |
| logo | Colour | animal | 833 | 0 | | 0 | 0 |
| parrot | Colour | animal | 2552 | 0 | | 0 | 0 |
| portrait | Colour | human | 4051 | 0 | | 0 | 0 |
| rose | Colour | animal | 1846 | 0 | | 0 | 0 |
| tulips | Colour | animal | 2675 | 0 | | 0 | 0 |
| woman | Colour | human | 2626 | 1 | Silk → Crystal 1 (lower lip) | 1 | 0 |
| sunburst_flower | Colour | animal | 1011 | 0 | | 0 | 0 |
| portrait-curls (IMG-026N) | Colour | human | 3458 | 0 | | 0 | 0 |
| portrait-flower-crown (IMG-026N) | Colour | none (`null`) | 3252 | 0 | | 0 | 0 |
| portrait-freckles (IMG-026N) | Colour | human | 3156 | 0 | | 0 | 0 |
| portrait-freckles Bold (IMG-026P) | Black & white | human | 2998 | 0 | | 0 | 0 |
| portrait-freckles Shaded (IMG-026P) | Black & white | human | 3791 | 0 | | 0 | 0 |
| portrait-curls Bold (IMG-026P) | Black & white | human | 3036 | 0 | | 0 | 0 |
| portrait-curls Shaded (IMG-026P) | Black & white | human | 4156 | 0 | | 0 | 0 |

"Face" is `report.face`: the rule runs only with `human`.

ai.png against no pale skin: RS-3044 changed Crystal → Silk 11, Metallic Sunshine → Silk 8,
Citrine → Silk 3; RS-3045 changes Crystal → Silk 10, Metallic Sunshine → Silk 9, Citrine → Silk 3.

## Not measured here

The fur cases that motivated the change (painting-ermine, the archive cat) are PatternNifty designs,
not in this repository; their figures are in PatternNifty's `docs/pn-11-results.md` (ermine 18 → 0;
the cat, which MediaPipe takes for a person, still loses 12 white fur stones among Silk fur).

## Pictures

- `ai.jpg`, `woman.jpg`: AI image | before | after, 6 px per mm, flat catalogue colours, every
  changed stone circled in blue.
- `ai-face.jpg`, `ai-chest.jpg` (16 px per mm), `woman-mouth.jpg` (24 px per mm): AI image | no pale
  skin (`BUILD_O`, red: what the new rule changes from it) | before | after (blue: changed from before).

`comparison.json` has every row, each changed stone's position, and the stones changed from `BUILD_O`.
