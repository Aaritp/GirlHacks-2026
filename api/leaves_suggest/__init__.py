import azure.functions as func
from shared.http import not_implemented, validated
from shared.models import SuggestRequest

bp = func.Blueprint()


@bp.route(route="leaves/suggest", methods=["POST"])
@validated
def suggest(req: func.HttpRequest):
    SuggestRequest.model_validate(req.get_json())
    return not_implemented("Context-aware word suggestions")
