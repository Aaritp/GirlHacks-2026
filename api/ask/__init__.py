import logging

import azure.functions as func

from ask import service
from shared.http import error_response, json_response, validated
from shared.models import AskRequest
from shared.openai_client import ModelFailed, ModelNotConfigured, openai_settings
from shared.store import get_store, storage_errors

bp = func.Blueprint()


@bp.route(route="ask", methods=["POST"])
@validated
@storage_errors
def ask(req: func.HttpRequest):
    """Ask the Grove: a cited answer from stored seeds, sources and transcripts, or "I don't have that"."""
    request = AskRequest.model_validate(req.get_json())
    store = get_store()
    try:
        openai_settings()
        result = service.ask(store, request, complete=service.complete_json)
    except ModelNotConfigured as exc:
        return error_response(503, "SERVICE_NOT_CONFIGURED", str(exc))
    except ModelFailed as exc:
        logging.warning("Ask the Grove model failed: %s", exc)
        return error_response(502, "UPSTREAM_ERROR", "Azure OpenAI could not answer right now. You can retry.")
    return json_response(result.model_dump(mode="json"))
