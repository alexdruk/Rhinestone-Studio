"""HTTP front of the layout service: POST /layout and GET /health.

Models load at startup and stay loaded. A process-wide lock lets one layout run
at a time (IMG-026 S7); a second request waits for it. The service has no auth and
is meant to be bound to 127.0.0.1.
"""
import json
import math
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

import strass_layout
from strass_layout import LayoutError, layout, load_models

MAX_IMAGE_BYTES = 20 * 1024 * 1024
DEFAULT_PITCH_MM = 2.1

layout_lock = threading.Lock()
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
    return color_ids, float(pitch)


@app.post("/layout")
def post_layout(image: UploadFile = File(...), options: str = Form("{}")):
    data = image.file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        return error_response(413, "too-large", "The image is larger than 20 MB.")
    try:
        color_ids, pitch = parse_options(options)
    except ValueError as exc:
        return error_response(400, "bad-request", str(exc))
    try:
        with layout_lock:
            return layout(data, color_ids, pitch)
    except LayoutError as exc:
        return error_response(exc.status, exc.code, exc.message)
    except Exception as exc:
        return error_response(500, "layout-failed", str(exc) or exc.__class__.__name__)


@app.get("/health")
def get_health():
    return {
        "ok": True,
        "modelsLoaded": status["modelsLoaded"],
        "version": strass_layout.__version__,
        "busy": layout_lock.locked(),
    }
