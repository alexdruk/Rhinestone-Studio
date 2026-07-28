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


def repo_path(*segments: str) -> Path:
    return REPO_ROOT.joinpath(*segments)


def output_dir(size_id: str) -> Path:
    d = OUTPUT_ROOT / size_id.upper()
    d.mkdir(parents=True, exist_ok=True)
    return d


def repo_relative(path: Path) -> str:
    return str(Path(path).resolve().relative_to(REPO_ROOT))
