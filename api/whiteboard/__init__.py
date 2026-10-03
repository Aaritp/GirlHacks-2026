import azure.functions as func
from shared.http import not_implemented, validated
from shared.models import WhiteboardRequest

bp = func.Blueprint()


@bp.route(route="whiteboard", methods=["POST"])
@validated
def whiteboard(req: func.HttpRequest):
    WhiteboardRequest.model_validate(req.get_json())
    return not_implemented("Azure Vision whiteboard OCR")
