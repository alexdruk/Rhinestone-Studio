"""Which IMG-026E to J rules the pipeline applies on top of the prototype.

PROTOTYPE reproduces the prototype exactly (the equivalence and golden tests run with it);
BUILD_E to BUILD_I are what builds E to I shipped; DEFAULT is what the service ships.
See docs/specifications/IMG-026-StrassLayoutService.md, "Layout quality (build E)",
"Colour and eyes (build F)", "Pupils and stone colours (build G)",
"More catalogue colours (build H)", "Faces and eyes (build I)" and "Skin and fur tones (build J)".
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
DEFAULT = Rules(pupil_core_only=True, keep_chains=True, extra_colours=True, mean_colour=True, human_iris=True, eye_keep=True,
                pupil_inscribed=True, real_colours=True, more_colours=True, lively_eyes=True, skin_no_wine=True,
                soft_outlines=True, calm_skin=True, skin_nearest=True)
