import azure.functions as func
from shared.http import json_response, validated
from shared.models import ComposeRequest

bp = func.Blueprint()


@bp.route(route="leaves/compose", methods=["POST"])
@validated
def compose(req: func.HttpRequest):
    request = ComposeRequest.model_validate(req.get_json())
    # Preserve arbitrary spelling, names, punctuation, and Unicode. Composition is
    # deliberately deterministic: no model may silently rewrite the user's intent.
    sentence = " ".join(request.picked)
    if len(sentence) > 20000:
        raise ValueError("Preview is too long")
    return json_response({"sentence": sentence})
