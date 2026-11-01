# IMG-026L: face finding before and after (dlib → MediaPipe)

31 Oct 2026, branch `feature/img-026l-face-landmarks`. No provider calls.

The layout service used dlib's 68-point face model to decide whether a design shows a person, and
to place the two eye boxes it looks for pupils in. That model may not be used commercially. IMG-026L
replaces it with MediaPipe Face Landmarker, ported from PatternNifty (IS) commit `e9e7014`
(IS-07a). This page shows what changed on RS's own test images.

## How it was measured

- **Before:** `develop` at `db41ffd` (dlib), in a separate worktree.
- **After:** this branch (MediaPipe).
- Both on the same Intel iMac (macOS 13.7) and the same `.venv`, with the service's `DEFAULT`
  rules. Every RS test image was laid out: the 12 in `services/strass-layout/prototype/img/` and
  `tests/fixtures/sunburst_flower.png`.
- The eye boxes and pupil centres were read from inside the pipeline. The service code was not
  changed for this; the run wrapped two functions from outside.
- Positions are in mm, in the returned stone coordinates (as in `aiLayout.stones`).

In the service, "face found: no" is reported as `face: "animal"`, so the logo, rose, tulips and
sunburst also say "animal". It only means "no person's face".

## Table

| Image | Face found, before | Face found, after | Pupils | Pupil centres after (x, y mm) | Pupils before vs after | Old→new pupil distance (mm) | Stones | Stones that differ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cat | no (animal) | no (animal) | 2 → 2 | (33.4, 54.2); (66.1, 54.3) | same | 0.00, 0.00 | 2150 → 2150 | 0 |
| dog | no (animal) | no (animal) | 2 → 2 | (21.5, 41.1); (42.8, 43.8) | same | 0.00, 0.00 | 1671 → 1671 | 0 |
| einstein | yes (human) | yes (human) | 2 → 2 | (85.4, 70.1); (111.0, 74.4) | same | 0.00, 0.00 | 3591 → 3591 | 0 |
| jesus | no (animal) | no (animal) | 1 → 1 | (84.0, 72.4) | same | 0.00 | 3298 → 3298 | 0 |
| **lake** | **yes (human)** | **no (animal)** | 0 → 0 | – | same | – | 4089 → 4089 | **20 (colour only)** |
| leopard | no (animal) | no (animal) | 2 → 2 | (56.2, 35.3); (82.3, 35.3) | same | 0.00, 0.00 | 2431 → 2431 | 0 |
| logo | no (animal) | no (animal) | 0 → 0 | – | same | – | 833 → 833 | 0 |
| parrot | no (animal) | no (animal) | 1 → 1 | (129.9, 87.5) | same | 0.00 | 2542 → 2542 | 0 |
| portrait | yes (human) | yes (human) | 2 → 2 | (74.3, 76.5); (38.6, 80.2) | same | 0.00, 0.00 | 3995 → 3995 | 0 |
| rose | no (animal) | no (animal) | 0 → 0 | – | same | – | 1846 → 1846 | 0 |
| tulips | no (animal) | no (animal) | 0 → 0 | – | same | – | 2673 → 2673 | 0 |
| **woman** | yes (human) | yes (human) | 2 → 2 | (112.3, 37.1); (92.4, 37.4) | same | 0.00, 0.00 | **2612 → 2611** | **1** |
| sunburst_flower | no (animal) | no (animal) | 0 → 0 | – | same | – | 1011 → 1011 | 0 |

Gap violations: 0 on every image, before and after.

**Eye boxes** (only the three people have them). Both models find the same eyes, but the box
centres sit 1.3–2.5 mm apart (10–18.5 px, at most 0.20 of the eye's width):

| Image | Box shift, image-left / image-right eye (mm) | Eye width before → after (mm) |
| --- | --- | --- |
| einstein | 1.72 / 1.59 | 11.6 → 12.2, 9.9 → 9.6 |
| portrait | 1.53 / 2.49 | 12.9 → 14.4, 18.7 → 21.7 |
| woman | 1.27 / 1.40 | 12.0 → 11.8, 7.1 → 5.8 |

The two models mark the eye corners slightly differently, which moves the boxes. The pupils are
found as dark discs inside the boxes, so they come out in exactly the same place.

## Pictures

In each picture, the old layout (dlib) is on the left and the new one (MediaPipe) on the right.
Blue squares mark the eye boxes (centre and width of the eye contour); red rings mark the pupil
stones. Pictures are included for every image with a face or pupils, and for the lake.

- [cat](cat.jpg), [dog](dog.jpg), [leopard](leopard.jpg), [parrot](parrot.jpg), [jesus](jesus.jpg)
  are identical. Neither model finds a person's face; the pupils come from the animal path.
- [einstein](einstein.jpg) and [portrait](portrait.jpg) are identical stone for stone. Only the
  eye boxes move a little.
- [woman](woman.jpg): one stone differs (below).
- [lake](lake.jpg): 20 stones change colour (below).

## Every difference, explained

**Lake: dlib saw a face in the clouds; MediaPipe sees none.** dlib put two "eyes" on a cloud edge
and the treetop (blue squares, left picture), so the old layout treated the lake as a person. No
pupil was placed either way, because there are no dark discs there. But RS's `soft_outlines` rule
(on in RS's `DEFAULT`) runs only on a person's face. It softens black stones that sit among skin colours. The lake's
warm peach and brown areas use the same catalogue colours (Silk, Golden Shadow, Smoked and Colorado
Topaz), so it turned 20 black stones there into Smoked Topaz. With MediaPipe there is no face, so those 20 stones
stay Jet, as the AI drew them. Positions and sizes are identical. The new result is the right one.

IS saw no difference on the lake because IS has `soft_outlines` off (IMG-026M will turn it off in
RS too, as decided).

**Woman: one small black stone at the outer corner of the eye on the right of the picture is no
longer added.** For a
person, the service adds small SS4 Jet stones on dark spots near each eye, within one eye-width of
the box. MediaPipe's contour of that eye is narrower than dlib's (5.8 mm against 7.1 mm), so a dark
spot 6.2 mm from the new box centre is now just outside it, and that one SS4 Jet stone
(at 117.1, 36.3 mm) is not placed. Everything else on the woman is unchanged, pupils included. IS
measured the same one-stone difference on this image.

No other image changes.

## Equivalence test

`services/strass-layout/tests/test_build_l.py`, class `FaceEquivalence` (runs only when dlib and its
model are installed: `scripts/setup_mac.sh --with-dlib-tests`):

- same face found, apart from the lake;
- eye-box centres within 0.3 of the eye width;
- the same pupil sizes;
- pupil centres less than 0.01 mm apart (measured: 0.000 mm on every image);
- 0 violations.

`comparison.json` in this folder holds the raw numbers behind the table: every eye box, every pupil
and the stones that differ.
