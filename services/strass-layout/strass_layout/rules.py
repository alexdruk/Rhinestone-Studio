"""Which IMG-026E to O, RS-3044 and RS-3045 rules the pipeline applies on top of the prototype.

PROTOTYPE reproduces the prototype exactly (the equivalence and golden tests run with it);
BUILD_E to BUILD_O are what builds E to O shipped, BUILD_RS3044 what RS-3044 shipped; DEFAULT is what the service ships.
See docs/specifications/IMG-026-StrassLayoutService.md, "Layout quality (build E)",
"Colour and eyes (build F)", "Pupils and stone colours (build G)",
"More catalogue colours (build H)", "Faces and eyes (build I)", "Skin and fur tones (build J)" and
"Eyes, colour reading and skin rules (build M)" "Size cap, overlap cleanup and hole fill (build O)" and "Pale skin (RS-3044)".

Build M ports PatternNifty's (IS, commit e9e7014) face rules; each is a flag that is off in
PROTOTYPE and every BUILD_* set, so the equivalence and golden tests are unchanged:
- plausible_eyes (IS-05b): a design whose pupils are not one plausible pair (two of very different
  sizes, far from level or too far apart for the subject; of more than two, none or several
  passing pairs) has no face: the eye stage is skipped and report.face is null. Of more than two
  pupils with exactly one plausible pair, that pair is kept and the others are ordinary stones
  (post._plausible_pupils). report.pupilsAtMm gives the pupil stones' centres.
- sample_delivered (IS-05b): each stone's colour is read at its delivered position from the inner
  60 % of its radius (ordered.delivered_lab), fill stones included, instead of at the detection it
  came from. No stone moves.
- human_iris off in DEFAULT (IS-05c): a person's SS4 iris rings, sampled from the AI's eye white,
  snapped to Grey and Silver ("goggles"). Animals keep their rings.
- skin_nearest_inner (IS-05c): skin_nearest reads the inner 60 % of each stone instead of the whole
  disc, which reached into the AI's dark gaps and turned warm shadow skin into Smoked Topaz.
- warm_shadow, warm_shadow_de (IS-05d): a skin stone whose nearest skin colour is Smoked Topaz takes
  Colorado Topaz when that is at most warm_shadow_de ΔE2000 further. DEFAULT uses 3.
- lone_white_skin (IS PN-04h): an SS4/SS6 Crystal Clear, Crystal or Silver stone whose neighbours
  (at least four) are all skin colours, outside 1.5 eye-zone radii, takes its neighbours' most
  common colour (faces.lone_white_skin).
- soft_outlines off in DEFAULT (IS-05b): it turned the AI's black outline stones on skin into
  Smoked Topaz and raised the colour error where it acted.
Not ported (experiments or unused in IS): mixed_shadow, fill_exact, fill_cover_mask,
report.fillAtMm and report.discsAtMm.

Build O ports PatternNifty's Node steps after the layout (IS e9e7014, spec 7.5) into the service,
after its own layout (cleanup.clean_up); each is a flag, off in PROTOTYPE and every BUILD_* set:
- size_cap: every stone larger than SS16 becomes SS16 at the same centre, except the two pupils of
  one plausible pair (report.pupilsAtMm with exactly two pupils and a face), capped at SS20.
- overlap_cleanup: after the cap, of every pair with a rim gap below 0.1 mm the smaller stone goes;
  on equal size the one with fewer neighbours, then the later one; worst gap first.
- hole_fill: after the cleanup, SS6 then SS4 stones in every spot of the subject (alpha >= 128,
  closed with a 1 mm disc) where one fits with 0.1 mm to every stone; they take their neighbours'
  colour by IS's weighted vote.
BUILD_M freezes the build M DEFAULT.

RS-3044 (pale skin) adds one flag, off in PROTOTYPE and every BUILD_* set before BUILD_RS3044:
- pale_skin: the AI paints lit skin in one pale cream (about L* 93-96) that is not in the palette,
  and the snap splits it into Silk, Crystal, Metallic Sunshine and Citrine; lone_white_skin leaves
  such a stone when any neighbour is not skin (often another stone of the same cream). With a
  person's face found, right after lone_white_skin: an SS4 or SS6 stone outside 1.5 eye-zone radii,
  read (inner 60 %, the skin_nearest reading) as pale warm cream (L* above 85, chroma 8 to 40, hue
  25 to 100 degrees) and not in a skin colour, with at least four neighbours of which at least half
  are skin colours, takes the skin colour nearest its read colour; repeated until nothing changes,
  at most 5 rounds (faces.pale_skin_rounds since RS-3045). No stone moves or changes size.
BUILD_O freezes the build O DEFAULT (builds P and Q changed no rule).

RS-3045 (from IS PN-11, commit 6e097d5) replaces RS-3044's rounds, which crept into white fur next to
a person: the candidates (same colour, size and eye-zone tests, not in a skin colour) are found once
and grouped by neighbours (faces.pale_groups); a group changes only when it has at most
pale_skin_group stones (default 4) and at least four outside neighbours (stones touching it, each
counted once), at least half of them light skin colours: skin colours whose catalogue L* is at least
pale_skin_min_l (default 70: Silk and Light Peach). Each stone of a changed group takes the skin
colour nearest its own read colour. One pass, no rounds. BUILD_RS3044 freezes the RS-3044 DEFAULT;
its pale_skin_rounds (off everywhere else) keeps RS-3044's rule in rounds (faces.pale_skin_rounds).
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Rules:
    pupil_core_only: bool
    keep_chains: bool
    chain_dark_l: float = 30.0
    chain_min_len: int = 3
    chain_link: float = 1.35
    extra_colours: bool = False
    mean_colour: bool = False
    human_iris: bool = False
    eye_keep: bool = False
    pupil_inscribed: bool = False
    real_colours: bool = False
    more_colours: bool = False
    lively_eyes: bool = False
    skin_no_wine: bool = False
    soft_outlines: bool = False
    calm_skin: bool = False
    skin_nearest: bool = False
    plausible_eyes: bool = False
    sample_delivered: bool = False
    skin_nearest_inner: bool = False
    warm_shadow: bool = False
    warm_shadow_de: float = 1.5
    lone_white_skin: bool = False
    size_cap: bool = False
    overlap_cleanup: bool = False
    hole_fill: bool = False
    pale_skin: bool = False
    pale_skin_group: int = 4  # RS-3045
    pale_skin_min_l: float = 70.0  # RS-3045
    pale_skin_rounds: bool = False  # RS-3045: RS-3044's rounds, BUILD_RS3044 only


PROTOTYPE = Rules(pupil_core_only=False, keep_chains=False)
BUILD_E = Rules(pupil_core_only=True, keep_chains=True)
BUILD_F = Rules(pupil_core_only=True, keep_chains=True, extra_colours=True, mean_colour=True, human_iris=True, eye_keep=True)
BUILD_G = Rules(pupil_core_only=True, keep_chains=True, extra_colours=True, mean_colour=True, human_iris=True, eye_keep=True,
                pupil_inscribed=True, real_colours=True)
BUILD_H = Rules(pupil_core_only=True, keep_chains=True, extra_colours=True, mean_colour=True, human_iris=True, eye_keep=True,
                pupil_inscribed=True, real_colours=True, more_colours=True)
BUILD_I = Rules(pupil_core_only=True, keep_chains=True, extra_colours=True, mean_colour=True, human_iris=True, eye_keep=True,
                pupil_inscribed=True, real_colours=True, more_colours=True, lively_eyes=True, skin_no_wine=True,
                soft_outlines=True, calm_skin=True)
BUILD_J = Rules(pupil_core_only=True, keep_chains=True, extra_colours=True, mean_colour=True, human_iris=True, eye_keep=True,
                pupil_inscribed=True, real_colours=True, more_colours=True, lively_eyes=True, skin_no_wine=True,
                soft_outlines=True, calm_skin=True, skin_nearest=True)
BUILD_M = Rules(pupil_core_only=True, keep_chains=True, extra_colours=True, mean_colour=True, human_iris=False, eye_keep=True,
                pupil_inscribed=True, real_colours=True, more_colours=True, lively_eyes=True, skin_no_wine=True,
                soft_outlines=False, calm_skin=True, skin_nearest=True, plausible_eyes=True, sample_delivered=True,
                skin_nearest_inner=True, warm_shadow=True, warm_shadow_de=3.0, lone_white_skin=True)
BUILD_O = Rules(pupil_core_only=True, keep_chains=True, extra_colours=True, mean_colour=True, human_iris=False, eye_keep=True,
                pupil_inscribed=True, real_colours=True, more_colours=True, lively_eyes=True, skin_no_wine=True,
                soft_outlines=False, calm_skin=True, skin_nearest=True, plausible_eyes=True, sample_delivered=True,
                skin_nearest_inner=True, warm_shadow=True, warm_shadow_de=3.0, lone_white_skin=True,
                size_cap=True, overlap_cleanup=True, hole_fill=True)
BUILD_RS3044 = Rules(pupil_core_only=True, keep_chains=True, extra_colours=True, mean_colour=True, human_iris=False, eye_keep=True,
                     pupil_inscribed=True, real_colours=True, more_colours=True, lively_eyes=True, skin_no_wine=True,
                     soft_outlines=False, calm_skin=True, skin_nearest=True, plausible_eyes=True, sample_delivered=True,
                     skin_nearest_inner=True, warm_shadow=True, warm_shadow_de=3.0, lone_white_skin=True,
                     size_cap=True, overlap_cleanup=True, hole_fill=True, pale_skin=True, pale_skin_rounds=True)
DEFAULT = Rules(pupil_core_only=True, keep_chains=True, extra_colours=True, mean_colour=True, human_iris=False, eye_keep=True,
                pupil_inscribed=True, real_colours=True, more_colours=True, lively_eyes=True, skin_no_wine=True,
                soft_outlines=False, calm_skin=True, skin_nearest=True, plausible_eyes=True, sample_delivered=True,
                skin_nearest_inner=True, warm_shadow=True, warm_shadow_de=3.0, lone_white_skin=True,
                size_cap=True, overlap_cleanup=True, hole_fill=True, pale_skin=True)
