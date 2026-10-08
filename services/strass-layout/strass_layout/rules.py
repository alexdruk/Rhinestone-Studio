"""Which IMG-026E rules the pipeline applies on top of the prototype.

PROTOTYPE reproduces the prototype exactly (the equivalence and golden tests run with it);
DEFAULT is what the service ships. See docs/specifications/IMG-026-StrassLayoutService.md,
"Layout quality (build E)".
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Rules:
    pupil_core_only: bool
    keep_chains: bool
    chain_dark_l: float = 30.0
    chain_min_len: int = 3
    chain_link: float = 1.35


PROTOTYPE = Rules(pupil_core_only=False, keep_chains=False)
DEFAULT = Rules(pupil_core_only=True, keep_chains=True)
