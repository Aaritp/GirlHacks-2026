import azure.functions as func
from shared.http import not_implemented, validated
from shared.models import ComposeRequest

bp = func.Blueprint()


@bp.route(route="leaves/compose", methods=["POST"])
@validated
def compose(req: func.HttpRequest):
    ComposeRequest.model_validate(req.get_json())
    # Implement sentence preview only; speaking requires a separate user confirmation.
    return not_implemented("Whispering Leaves sentence composition")
