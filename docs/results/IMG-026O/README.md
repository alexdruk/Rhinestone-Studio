# IMG-026O: size cap, overlap cleanup and hole fill (BUILD_M → new DEFAULT)

1 Nov 2026, branch `feature/img-026o-cleanup-hole-fill`. No provider calls.

IMG-026O ports PatternNifty's (IS, commit `e9e7014`) three steps after the layout into the layout
service: every stone above SS16 is capped (a plausible pupil pair at SS20), stones closer than
0.1 mm are removed, and every spot where an SS6 or SS4 still fits is filled in its neighbours'
colour. `BUILD_M` freezes the previous `DEFAULT`. This page compares the two on the 13 RS test images
and the 3 IMG-026N portrait layouts.

## Looks worse

1. **Pupils get smaller.** The cap is the decided rule, but it shows:
   - The dog's and the woman's SS30 pupils become SS20. Each now sits in a ring of free space the
     old pupil filled, and the hole fill puts 3 to 5 stones into that ring in the neighbours'
     colours: brown and skin stones touching the pupil on the woman, dark brown ones on the dog.
     The woman's eye in particular reads as a smaller pupil crowded by skin and lash stones
     (`capped-pupils.jpg`, rows 3 and 4).
   - Jesus (a profile) and the parrot have one pupil each, so it is not a pair and drops from SS20
     to SS16. It is noticeably smaller next to the AI's eye.
2. **The portrait's open curls are partly closed** (`portrait-holes.jpg`, rows 1 and 2). The subject
   is the AI alpha closed with a 1 mm disc, which counts the narrow white gaps between the AI's
   hair strands and the inside of small curl loops as subject. The fill puts Jet stones there, so
   some of the see-through curl ends become solid. It adds 60 stones on the portrait, 45 of them Jet,
   most in the hair.
3. **The dog's coverage drops a little** (0.632 → 0.631): its two pupils lose more area to the cap
   than its 12 filled stones add. Every other image's coverage stays the same or rises.

## Done criteria

- **Flags off = `BUILD_M` exactly.** All 16 images were also laid out with `develop`'s code and its
  `DEFAULT`. Stones, order, natural size and every report value are identical to this branch's
  `BUILD_M`; only the new report keys and the stage times differ.
- **With `DEFAULT`:** 0 gap violations on every image (minimum gap ≥ 0.100 mm); the cleanup removes
  0 stones everywhere (the criterion is under 3 %); the natural size is unchanged on all 16 (the
  filled stones lie inside the old footprint); after the fill no spot is left where an SS4 fits
  (`test_build_o`, 13 images).

## Table

Coverage is IS's coverage after the cleanup (`report.cleanupCoverage`). Sizes are the natural
width × height in mm.

| Image | Stones | Capped | Removed | Filled (SS6 + SS4) | Coverage | Violations | Natural size |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| cat | 2150 → 2162 | 0 | 0 (0.00 %) | 12 (0 + 12) | 0.647 → 0.649 | 0 → 0 | 103.0 × 130.8 → same |
| dog | 1671 → 1683 | 2 | 0 (0.00 %) | 12 (2 + 10) | 0.632 → 0.631 | 0 → 0 | 96.6 × 160.6 → same |
| einstein | 3591 → 3594 | 0 | 0 (0.00 %) | 3 (0 + 3) | 0.672 → 0.672 | 0 → 0 | 150.2 × 143.2 → same |
| jesus | 3298 → 3308 | 1 | 0 (0.00 %) | 10 (0 + 10) | 0.629 → 0.630 | 0 → 0 | 145.8 × 163.9 → same |
| lake | 4089 → 4100 | 0 | 0 (0.00 %) | 11 (0 + 11) | 0.660 → 0.661 | 0 → 0 | 154.7 × 152.1 → same |
| leopard | 2431 → 2437 | 0 | 0 (0.00 %) | 6 (0 + 6) | 0.645 → 0.645 | 0 → 0 | 117.2 × 153.7 → same |
| logo | 833 → 833 | 0 | 0 (0.00 %) | 0 | 0.796 → 0.796 | 0 → 0 | 144.9 × 79.1 → same |
| parrot | 2542 → 2552 | 1 | 0 (0.00 %) | 10 (0 + 10) | 0.644 → 0.645 | 0 → 0 | 168.3 × 151.6 → same |
| portrait | 3991 → 4051 | 0 | 0 (0.00 %) | 60 (7 + 53) | 0.651 → 0.658 | 0 → 0 | 149.5 × 166.0 → same |
| rose | 1846 → 1846 | 0 | 0 (0.00 %) | 0 | 0.683 → 0.683 | 0 → 0 | 121.0 × 130.5 → same |
| tulips | 2673 → 2675 | 0 | 0 (0.00 %) | 2 (0 + 2) | 0.665 → 0.665 | 0 → 0 | 140.3 × 141.7 → same |
| woman | 2612 → 2626 | 2 | 0 (0.00 %) | 14 (3 + 11) | 0.674 → 0.674 | 0 → 0 | 143.9 × 146.7 → same |
| sunburst_flower | 1011 → 1011 | 0 | 0 (0.00 %) | 0 | 0.690 → 0.690 | 0 → 0 | 92.9 × 115.3 → same |
| portrait-freckles | 3139 → 3156 | 0 | 0 (0.00 %) | 17 (0 + 17) | 0.631 → 0.633 | 0 → 0 | 135.0 × 193.9 → same |
| portrait-flower-crown | 3237 → 3252 | 0 | 0 (0.00 %) | 15 (0 + 15) | 0.644 → 0.646 | 0 → 0 | 161.2 × 165.4 → same |
| portrait-curls | 3450 → 3458 | 0 | 0 (0.00 %) | 8 (0 + 8) | 0.643 → 0.644 | 0 → 0 | 145.6 × 148.8 → same |

In total: 6 stones capped (the SS30 pupils of the dog and the woman to SS20; the single SS20 pupils
of Jesus and the parrot to SS16), 0 removed, 180 filled (12 SS6, 168 SS4).

Against IS's own figures for the same 12 RS images (IS `docs/exp-holes.md`, made with IS's earlier
layouts): the filled counts are the same on cat, jesus, lake, parrot, tulips, woman, rose and logo;
dog 12 (IS 13), einstein 3 (4), leopard 6 (3) and portrait 60 (55) differ slightly. IS's cleanup also
removed nothing from these images.

## Pictures

- `<image>.jpg`: `BUILD_M` left, new `DEFAULT` right, 6 px per mm, flat catalogue colours. Orange
  ring: capped. Red ring: removed by the cleanup (there are none). Blue ring: added by the hole
  fill. Every image changes except the logo, the rose and the sunburst, so 13 pictures.
- `<image>-holes.jpg`: the three places with the most filled stones, 24 px per mm: AI image |
  `BUILD_M` | `DEFAULT`.
- `capped-pupils.jpg`: every capped stone (all are pupils), 20 px per mm.

`comparison.json` has every number in the table, plus the filled stones' sizes and colours.

## How it was measured

- Each image was laid out once with `BUILD_M` on this branch, on the Intel iMac. `DEFAULT` was made
  by running `cleanup.clean_up` with `DEFAULT` on that layout. That is what `layout()` does: the
  steps run last, and `BUILD_M` is `DEFAULT` without the three flags. `test_build_o.Pipeline` checks
  on the woman that a real `DEFAULT` layout equals it, stone for stone.
- The flags-off check ran `develop` (`7e4d7c5`) in a separate worktree with the same `.venv`.
- The 3 IMG-026N layouts start from their saved AI images (`tools/scratch/img-026n/runs/`); no new
  provider call was made.
- The clean-up took 1.1 to 3.2 s per image on the iMac.
