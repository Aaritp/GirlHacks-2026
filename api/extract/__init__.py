import logging

import azure.functions as func

from extract import model
from extract.pipeline import SourceConflict, extract_and_save
from shared.http import error_response, json_response, validated
from shared.models import ExtractRequest
from shared.store import get_store, storage_errors

bp = func.Blueprint()


def _run(extraction):
    """Shared error mapping. Never returns partial or mock success when a service fails."""
    try:
        model.model_settings()
        grove = extraction()
    except model.ModelNotConfigured as exc:
        return error_response(503, "SERVICE_NOT_CONFIGURED", str(exc))
    except model.ModelFailed as exc:
        logging.warning("Extraction model failed: %s", exc)
        return error_response(502, "UPSTREAM_ERROR", "Azure OpenAI extraction failed; nothing was extracted.")
    except SourceConflict as exc:
        return error_response(409, "CONFLICT", str(exc))
    return json_response(grove.model_dump(mode="json"))


@bp.route(route="extract", methods=["POST"])
@validated
@storage_errors
def extract(req: func.HttpRequest):
    request = ExtractRequest.model_validate(req.get_json())
    store = get_store()
    return _run(lambda: extract_and_save(store, request.meetingId, request.utterances, model.call_model,
                                         account_id=request.accountId))
