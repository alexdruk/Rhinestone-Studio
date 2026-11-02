"""HTTP front of the layout service: POST /layout and GET /health.

Models load at startup and stay loaded. A process-wide lock lets one layout run
at a time (IMG-026 S7); a second request waits for it. The service has no auth and
is meant to be bound to 127.0.0.1.
"""
import json
import logging
import math
import os
import threading
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

import strass_layout
from strass_layout import LayoutError, layout, load_models
from strass_layout.bw import DEFAULT_BW_THRESHOLD

MAX_IMAGE_BYTES = 20 * 1024 * 1024
DEFAULT_PITCH_MM = 2.1
MODES = ("colour", "bw")


def bw_threshold_setting(environ=os.environ):
    """IMG-026P: BW_THRESHOLD, the CIE L* below which a Black & white stone is Jet (default 55)."""
    text = environ.get("BW_THRESHOLD", "").strip()
    if not text:
        return DEFAULT_BW_THRESHOLD
    value = float(text)
    if not math.isfinite(value) or not 0 < value < 100:
        raise ValueError("BW_THRESHOLD must be a number between 0 and 100.")
    return value


BW_THRESHOLD = bw_threshold_setting()

layout_lock = threading.Lock()
log = logging.getLogger("strass_layout")
status = {"modelsLoaded": False}


@asynccontextmanager
async def lifespan(_app):
    load_models()
    status["modelsLoaded"] = True
    yield


app = FastAPI(lifespan=lifespan)


def error_response(http_status, code, message):
    return JSONResponse(status_code=http_status, content={"error": code, "message": message})


@app.exception_handler(RequestValidationError)
async def request_validation_error(_request: Request, exc: RequestValidationError):
    return error_response(400, "bad-request", "The request needs an image file and an options field.")


def parse_options(text):
    try:
        options = json.loads(text) if text else {}
    except ValueError:
        raise ValueError("options is not valid JSON.")
    if not isinstance(options, dict):
        raise ValueError("options must be a JSON object.")
    color_ids = options.get("colorIds")
    if color_ids is not None and (not isinstance(color_ids, list) or not all(isinstance(c, str) for c in color_ids)):
        raise ValueError("colorIds must be a list of strings.")
    pitch = options.get("targetPitchMm", DEFAULT_PITCH_MM)
    if isinstance(pitch, bool) or not isinstance(pitch, (int, float)) or not math.isfinite(pitch) or pitch <= 0:
        raise ValueError("targetPitchMm must be a positive number.")
    # IMG-026P: "colour" (the default, and every request before build P) or "bw" (Black & white).
    mode = options.get("mode", "colour")
    if mode not in MODES:
        raise ValueError("mode must be colour or bw.")
    return color_ids, float(pitch), mode


def unexpected_message(exc):
    """The exception text plus the package file and line where it was raised."""
    frames = traceback.extract_tb(exc.__traceback__)
    inside = [f for f in frames if "strass_layout" in f.filename]
    frame = (inside or frames or [None])[-1]
    where = " (at %s:%d)" % (os.path.basename(frame.filename), frame.lineno) if frame else ""
    return (str(exc) or exc.__class__.__name__) + where


@app.post("/layout")
def post_layout(image: UploadFile = File(...), options: str = Form("{}")):
    data = image.file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        return error_response(413, "too-large", "The image is larger than 20 MB.")
    try:
        color_ids, pitch, mode = parse_options(options)
    except ValueError as exc:
        return error_response(400, "bad-request", str(exc))
    try:
        with layout_lock:
            return layout(data, color_ids, pitch, mode=mode, bw_threshold=BW_THRESHOLD)
    except LayoutError as exc:
        return error_response(exc.status, exc.code, exc.message)
    except Exception as exc:
        log.error("layout failed:\n%s", traceback.format_exc())
        return error_response(500, "layout-failed", unexpected_message(exc))


# RS-3043: names this service, so `npm run studio` can tell it from another one on the same port
# (PatternNifty's own strass service runs on the same Mac).
SERVICE_NAME = "rhinestone-studio-layout"


@app.get("/health")
def get_health():
    return {
        "ok": True,
        "service": SERVICE_NAME,
        "modelsLoaded": status["modelsLoaded"],
        "version": strass_layout.__version__,
        "busy": layout_lock.locked(),
    }
