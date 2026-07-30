"""
Repo-root path resolution shared by every FONT-GEN-001 script.

Mirrors tools/font-certification/lib/repoPaths.mjs's convention (derive every path from one root
instead of scattering repo-relative or hard-coded absolute strings through the codebase).
"""
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

TOOL_ROOT = REPO_ROOT / "tools" / "font-generator"
CONFIG_DIR = TOOL_ROOT / "config"
OUTPUT_ROOT = REPO_ROOT / "output"
REVIEW_ROOT = REPO_ROOT / "review"
REVIEW_ASSETS = REVIEW_ROOT / "assets"
DOCS_SPEC_DIR = REPO_ROOT / "docs" / "specifications"

SOURCE_FONT = REPO_ROOT / "fonts" / "sources" / "Sacramento" / "Sacramento.ttf"

CORPUS_FILE = TOOL_ROOT / "corpus.json"

# FONT-GEN-002 -- registry of source fonts this pipeline can generate rhinestone variants from.
# "Sacramento" (FONT-GEN-001) stays the unprefixed default everywhere below, so its existing
# output/ filenames are untouched -- every other family gets a family-qualified filename instead
# (see variant_filename/sized_json_filename) so runs never collide with Sacramento's artifacts.
DEFAULT_FAMILY = "Sacramento"

FAMILY_SOURCE_FONTS = {
    "Sacramento": SOURCE_FONT,
    # Baloo 2 ships only as a variable font (wght 400-800); FONT-GEN-002 instances it to its
    # heaviest available weight (wght=800, ExtraBold) once, ahead of time, via fontTools
    # varLib.instancer -- see generation-metadata for the note. This static file is the actual
    # source every generate/measure step below reads.
    "Baloo2": REPO_ROOT / "fonts" / "sources" / "Baloo2" / "Baloo2-Bold.ttf",
    # FONT-GEN-004 -- same Sacramento.ttf source as FONT-GEN-001, unchanged; only the transform
    # strategy differs (skeleton-rebuild, see generate.py's TRANSFORM_FOR_FAMILY), a deliberate
    # single-variable comparison against FONT-GEN-001's own numbers.
    "SacramentoSkeleton": SOURCE_FONT,
}

# FONT-GEN-003 -- families whose source font differs *per stone size* instead of being fixed for
# the whole family. Baloo2Variable instances Baloo2.ttf's wght axis (400/500/600/700/800) to a
# static TTF per named weight (tools/font-generator/select_source_weight.py), then, per size,
# selects whichever instance's own native geometry needs the smallest correction to clear that
# size's thresholds -- see docs/specifications/FONT-GEN-003-*.md Step 1/2. All 5 sizes selected
# Regular (400) this run; the per-size registry is kept explicit rather than collapsed to a single
# path so a future size/threshold change can select a different weight without code changes here.
_BALOO2_WEIGHT_DIR = REPO_ROOT / "fonts" / "sources" / "Baloo2"
FAMILY_SIZE_SOURCE_FONTS = {
    "Baloo2Variable": {
        "SS6": _BALOO2_WEIGHT_DIR / "Baloo2-wght400.ttf",
        "SS10": _BALOO2_WEIGHT_DIR / "Baloo2-wght400.ttf",
        "SS16": _BALOO2_WEIGHT_DIR / "Baloo2-wght400.ttf",
        "SS20": _BALOO2_WEIGHT_DIR / "Baloo2-wght400.ttf",
        "SS30": _BALOO2_WEIGHT_DIR / "Baloo2-wght400.ttf",
    },
}


def source_font_for(family: str, size_id: str = None) -> Path:
    if family in FAMILY_SIZE_SOURCE_FONTS:
        if size_id is None:
            raise SystemExit(f"family {family!r} has a per-size source font; size_id is required")
        try:
            return FAMILY_SIZE_SOURCE_FONTS[family][size_id.upper()]
        except KeyError:
            raise SystemExit(f"No source font registered for family {family!r} size {size_id!r}")
    try:
        return FAMILY_SOURCE_FONTS[family]
    except KeyError:
        raise SystemExit(f"Unknown family {family!r}; add it to FAMILY_SOURCE_FONTS in paths.py")


def variant_filename(family: str, size_id_upper: str) -> str:
    return f"{family}Rhinestone_{size_id_upper}.ttf"


def sized_json_filename(prefix: str, family: str, size_id_upper: str) -> str:
    if family == DEFAULT_FAMILY:
        return f"{prefix}.{size_id_upper}.json"
    return f"{prefix}.{family}.{size_id_upper}.json"


def repo_path(*segments: str) -> Path:
    return REPO_ROOT.joinpath(*segments)


def output_dir(size_id: str) -> Path:
    d = OUTPUT_ROOT / size_id.upper()
    d.mkdir(parents=True, exist_ok=True)
    return d


def repo_relative(path: Path) -> str:
    return str(Path(path).resolve().relative_to(REPO_ROOT))
