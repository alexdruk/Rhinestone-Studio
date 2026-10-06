"""Strass layout service: turns an OpenAI rhinestone image into a gap-checked stone list."""
from .errors import BadImage, CatalogueMismatch, LayoutError, NoAlpha, NoStones
from .models import DEFAULT_MODELS_DIR, load_models
from .pipeline import layout, layout_frame

__version__ = "1.0.0"
__all__ = [
    "layout", "layout_frame", "load_models", "DEFAULT_MODELS_DIR", "__version__",
    "LayoutError", "BadImage", "NoAlpha", "NoStones", "CatalogueMismatch",
]
