"""Errors the layout service reports to its callers.

Every error carries the machine code that app.py puts in the response body
({"error": code, "message": text}) and the HTTP status the code maps to.
"""


class LayoutError(Exception):
    code = "layout-failed"
    status = 500

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class BadImage(LayoutError):
    code = "bad-image"
    status = 400


class NoAlpha(LayoutError):
    code = "no-alpha"
    status = 400


class NoStones(LayoutError):
    code = "no-stones"
    status = 422


class CatalogueMismatch(LayoutError):
    code = "catalogue-mismatch"
    status = 422
