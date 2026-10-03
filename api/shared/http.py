import json
from collections.abc import Callable
from functools import wraps

import azure.functions as func
from pydantic import ValidationError


def json_response(payload, status=200):
    return func.HttpResponse(json.dumps(payload), status_code=status, mimetype="application/json")


def error_response(status: int, code: str, message: str):
    return json_response({"error": {"code": code, "message": message}}, status)


def validated(handler: Callable):
    @wraps(handler)
    def wrapped(req: func.HttpRequest):
        try:
            return handler(req)
        except (ValidationError, ValueError):
            return error_response(400, "INVALID_REQUEST", "Request does not match the API contract.")
    return wrapped


def not_implemented(feature: str):
    return error_response(501, "NOT_IMPLEMENTED", f"{feature} is not connected yet.")
