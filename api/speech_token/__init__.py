"""Exchanges the server-held Speech key for a short-lived (10 minute) authorization token."""
import json
import logging
import os
import urllib.error
import urllib.request

import azure.functions as func

from shared.http import error_response

bp = func.Blueprint()
TIMEOUT_SEC = 10


def speech_settings():
    key = os.getenv("AZURE_SPEECH_KEY", "").strip()
    region = os.getenv("AZURE_SPEECH_REGION", "").strip()
    # Optional custom-domain resource endpoint, e.g. https://my-speech.cognitiveservices.azure.com
    endpoint = os.getenv("AZURE_SPEECH_ENDPOINT", "").strip().rstrip("/")
    missing = [name for name, value in (("AZURE_SPEECH_KEY", key), ("AZURE_SPEECH_REGION", region)) if not value]
    return key, region, endpoint or f"https://{region}.api.cognitive.microsoft.com", missing


def issue_token(key: str, token_endpoint: str) -> str:
    request = urllib.request.Request(
        f"{token_endpoint}/sts/v1.0/issueToken", data=b"", method="POST",
        headers={"Ocp-Apim-Subscription-Key": key, "Content-Length": "0"},
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SEC) as response:
        return response.read().decode("utf-8").strip()


@bp.route(route="speech-token", methods=["POST"])
def speech_token(req: func.HttpRequest):
    key, region, token_endpoint, missing = speech_settings()
    if missing:
        return error_response(503, "SERVICE_NOT_CONFIGURED", f"Azure Speech is missing: {', '.join(missing)}.")
    try:
        token = issue_token(key, token_endpoint)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        status = getattr(exc, "code", None)
        logging.warning("Speech token exchange failed (status %s)", status)
        return error_response(502, "UPSTREAM_ERROR", "Azure Speech did not issue a token.")
    if not token:
        return error_response(502, "UPSTREAM_ERROR", "Azure Speech returned an empty token.")
    return func.HttpResponse(
        json.dumps({"token": token, "region": region}), status_code=200, mimetype="application/json",
        headers={"Cache-Control": "no-store"},
    )
