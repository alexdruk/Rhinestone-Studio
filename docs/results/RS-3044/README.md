# RS-3044: pale skin (BUILD_O → new DEFAULT)

2 Nov 2026, branch `feature/rs-3044-pale-skin`. No provider calls.

The AI paints lit skin in one pale cream (about L\* 93–96) that is not in the palette. The snap splits
it into Silk, Crystal, Metallic Sunshine and Citrine, so lit skin gets single white and gold stones,
and `lone_white_skin` leaves them because each touches a non-skin neighbour (often another stone of
the same cream). The new rule `pale_skin` gives such a stone the skin colour nearest its read colour
when at least half its neighbours are skin. `BUILD_O` freezes the previous `DEFAULT`.

## Changes outside skin

1. **Woman: one stone on the lower lip, Crystal → Silk** (`woman-mouth.jpg`). The AI drew the
   lower lip as a row of lit, pale peach stones; this one is the palest (read L\* 92.5, chroma 12,
   hue 78), so the snap made it Crystal. Its five neighbours are Silk, Colorado Topaz, Silk, Copper
   and Light Siam: four in skin colours, because the lip's highlight stones are Silk and the skin
   below the lip is brown. So the rule makes it Silk, the colour of the lip stones beside it. It is
   not a tooth (the mouth is closed). In stones it now reads as part of the lit lip instead of a white
   dot on it.

Nothing changes in hair, fabric, flowers, fur or anywhere on the 11 images without a person's face
(the rule runs only when a person's face is found). No position or size changes anywhere.

## Done criteria

- **Flag off = `BUILD_O` exactly.** `DEFAULT` with `pale_skin` off is `BUILD_O` (same `Rules`). The
  `BUILD_O` layouts here are develop's: on ai.png it gives the diagnosis's `stones.json` exactly,
  and every stone count equals `docs/results/IMG-026O/` (colour) and `docs/results/IMG-026P/`
  (Black & white).
- **ai.png:** the 11 skin Crystal stones of the diagnosis become Silk, and so do 8 Metallic
  Sunshine and 3 Citrine stones on lit skin. The eye white (#5) and the catch-light (#14) keep
  Crystal.
- **Black & white unchanged:** the 4 IMG-026P layouts are identical before and after (`bw.py` never
  reads the colours the rule sets).

## Table

Before is `BUILD_O`, after is the new `DEFAULT`. Positions, sizes and order are equal on every image;
apart from `colours`, every report value is equal too.

| Image | Mode | Face | Stones | Changed | From → to |
| --- | --- | --- | ---: | ---: | --- |
| ai.png (white-stones diagnosis) | Colour | human | 2826 | 22 | Crystal → Silk 11, Metallic Sunshine → Silk 8, Citrine → Silk 3 |
| cat | Colour | animal | 2162 | 0 | |
| dog | Colour | animal | 1683 | 0 | |
| einstein | Colour | human | 3594 | 0 | |
| jesus | Colour | animal | 3308 | 0 | |
| lake | Colour | animal | 4100 | 0 | |
| leopard | Colour | animal | 2437 | 0 | |
| logo | Colour | animal | 833 | 0 | |
| parrot | Colour | animal | 2552 | 0 | |
| portrait | Colour | human | 4051 | 0 | |
| rose | Colour | animal | 1846 | 0 | |
| tulips | Colour | animal | 2675 | 0 | |
| woman | Colour | human | 2626 | 1 | Crystal → Silk 1 (lower lip, see above) |
| sunburst_flower | Colour | animal | 1011 | 0 | |
| portrait-curls (IMG-026N) | Colour | human | 3458 | 0 | |
| portrait-flower-crown (IMG-026N) | Colour | none (`null`) | 3252 | 0 | |
| portrait-freckles (IMG-026N) | Colour | human | 3156 | 0 | |
| portrait-freckles Bold (IMG-026P) | Black & white | human | 2998 | 0 | |
| portrait-freckles Shaded (IMG-026P) | Black & white | human | 3791 | 0 | |
| portrait-curls Bold (IMG-026P) | Black & white | human | 3036 | 0 | |
| portrait-curls Shaded (IMG-026P) | Black & white | human | 4156 | 0 | |

"Face" is `report.face`: `animal` means no person's face was found (the logo and flowers say this
too), so the rule does not run.

**Why so few changes elsewhere.** The other people's AI images rarely use the pale cream: the
portrait has 735 stones read as pale cream, all already in skin colours; einstein 2, the woman 10,
portrait-freckles 42, portrait-curls none.

## What the rule leaves on ai.png

Four stones on ai.png are read as pale cream and are still not in skin colours:

- the eye white (#5), inside 1.5 eye-zone radii;
- a Citrine in the dress, whose two neighbours are Scarlet and Light Siam;
- two Metallic Sunshine stones on the chest, each with only three neighbours (the rule needs four).

The remaining Metallic Sunshine stones on the face are not the AI's cream. They read L\* 78–83 with
chroma 41–51, so the AI painted them as gold.

On portrait-freckles, one Crystal stone is read as pale cream and stays. It is a tooth, among Crystal
and Scarlet stones, with no skin neighbour.

## Known limit (fixture only)

Teeth the AI paints in its Crystal (`#f5f5f5`, chroma 0) are not pale cream and always stay. Teeth
read as pale cream stay when the lips around them are not skin colours (`test_rs_3044_pale_skin`,
both cases). In a constructed mouth whose upper lip is Vintage Rose (a skin colour) and whose teeth
read as cream, the upper row of teeth turns Silk. No image here shows it.

## Pictures

- `<image>.jpg`: AI image | before | after, 6 px per mm, flat catalogue colours, every changed stone
  circled in blue (ai.png and the woman; nothing changes on the other images).
- `ai-face.jpg`, `ai-chest.jpg`: close-ups of ai.png's face and chest, 16 px per mm. Blue: changed.
  Grey: Crystal kept (the eye white and the catch-lights).
- `woman-mouth.jpg`: the woman's lower lip, 24 px per mm.

`comparison.json` has every row of the table and the changed stones' positions.
