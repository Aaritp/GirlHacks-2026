import azure.functions as func
from shared.http import error_response, json_response, validated
from shared.models import WhiteboardRequest
from shared.store import get_store, storage_errors
from extract.model import ModelFailed, ModelNotConfigured
from whiteboard.service import WhiteboardFailed, decode_image, process_whiteboard

bp = func.Blueprint()


@bp.route(route="whiteboard", methods=["POST"])
@validated
@storage_errors
def whiteboard(req: func.HttpRequest):
    request = WhiteboardRequest.model_validate(req.get_json())
    decode_image(request.imageBase64)  # Bad image remains 400 even without storage configuration.
    try:
        result = process_whiteboard(get_store(), request.meetingId, request.imageBase64)
        return json_response(result.model_dump(mode="json"))
    except ModelNotConfigured as exc:
        return error_response(503, "SERVICE_NOT_CONFIGURED", str(exc))
    except (WhiteboardFailed, ModelFailed):
        return error_response(502, "UPSTREAM_ERROR", "Whiteboard processing failed. Retry the same image safely.")
