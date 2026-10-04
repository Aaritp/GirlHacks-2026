import azure.functions as func
from shared.http import error_response, json_response, validated
from shared.models import SuggestRequest
from shared.store import get_store, storage_errors
from extract.model import ModelFailed, ModelNotConfigured
from leaves_suggest.service import recent_context, suggest_from_context

bp = func.Blueprint()


@bp.route(route="leaves/suggest", methods=["POST"])
@validated
@storage_errors
def suggest(req: func.HttpRequest):
    request = SuggestRequest.model_validate(req.get_json())
    context = recent_context(get_store(), request.meetingId, request.recentText)
    try:
        return json_response(suggest_from_context(context).model_dump(mode="json"))
    except ModelNotConfigured as exc:
        return error_response(503, "SERVICE_NOT_CONFIGURED", str(exc))
    except ModelFailed:
        return error_response(502, "UPSTREAM_ERROR", "Meeting suggestions are temporarily unavailable.")
