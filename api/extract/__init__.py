import azure.functions as func
from shared.http import not_implemented, validated
from shared.models import ExtractRequest

bp = func.Blueprint()


@bp.route(route="extract", methods=["POST"])
@validated
def extract(req: func.HttpRequest):
    ExtractRequest.model_validate(req.get_json())
    return not_implemented("Azure OpenAI seed extraction")
