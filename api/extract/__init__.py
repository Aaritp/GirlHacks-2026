import logging

import azure.functions as func

from extract import model
from extract.pipeline import extract_and_save
from shared.http import error_response, json_response, validated
from shared.models import ExtractRequest
from shared.store import get_store, storage_errors

bp = func.Blueprint()


@bp.route(route="extract", methods=["POST"])
@validated
@storage_errors
def extract(req: func.HttpRequest):
    request = ExtractRequest.model_validate(req.get_json())
    store = get_store()
    try:
        model.model_settings()
        grove = extract_and_save(store, request.meetingId, request.utterances, model.call_model)
    except model.ModelNotConfigured as exc:
        return error_response(503, "SERVICE_NOT_CONFIGURED", str(exc))
    except model.ModelFailed as exc:
        logging.warning("Extraction model failed: %s", exc)
        return error_response(502, "UPSTREAM_ERROR", "Azure OpenAI extraction failed; nothing was extracted.")
    return json_response(grove.model_dump(mode="json"))
