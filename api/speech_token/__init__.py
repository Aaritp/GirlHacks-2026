import azure.functions as func
from shared.http import not_implemented

bp = func.Blueprint()


@bp.route(route="speech-token", methods=["POST"])
def speech_token(req: func.HttpRequest):
    return not_implemented("Azure Speech token exchange")
