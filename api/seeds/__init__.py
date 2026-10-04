import azure.functions as func

from shared.http import error_response, json_response, validated
from shared.models import Account, Seed, SeedPatch, Utterance, UtteranceList
from shared.store import get_store, storage_errors

bp = func.Blueprint()


@bp.route(route="seeds", methods=["POST"])
@validated
@storage_errors
def create_seed(req: func.HttpRequest):
    seed = Seed.model_validate(req.get_json())
    saved = get_store().create_seed(seed)
    if saved is None:
        return error_response(409, "CONFLICT", "Seed already exists.")
    return json_response(saved.model_dump(mode="json"), 201)


@bp.route(route="seeds/{id}", methods=["PATCH"])
@validated
@storage_errors
def update_seed(req: func.HttpRequest):
    meeting_id = req.params.get("meetingId")
    if not meeting_id:
        return error_response(400, "INVALID_REQUEST", "meetingId query parameter is required.")
    patch = SeedPatch.model_validate(req.get_json())
    saved = get_store().patch_seed(meeting_id, req.route_params["id"], patch)
    if saved is None:
        return error_response(404, "NOT_FOUND", "Seed not found.")
    return json_response(saved.model_dump(mode="json"))


@bp.route(route="meetings/{meetingId}/grove", methods=["GET"])
@storage_errors
def get_grove(req: func.HttpRequest):
    return json_response(get_store().get_grove(req.route_params["meetingId"]).model_dump(mode="json"))


@bp.route(route="utterances", methods=["POST"])
@validated
@storage_errors
def save_utterance(req: func.HttpRequest):
    utterance = Utterance.model_validate(req.get_json())
    saved = get_store().save_utterance(utterance)
    return json_response(saved.model_dump(mode="json"))


@bp.route(route="meetings/{meetingId}/utterances", methods=["GET"])
@storage_errors
def list_utterances(req: func.HttpRequest):
    # Ordered by startSec. An unknown meeting has no utterances, so it is an empty list, not 404.
    utterances = get_store().list_utterances(req.route_params["meetingId"])
    return json_response(UtteranceList(utterances=utterances).model_dump(mode="json"))


@bp.route(route="accounts", methods=["GET"])
@storage_errors
def list_accounts(req: func.HttpRequest):
    # A bare array, as the account dashboard expects.
    return json_response([account.model_dump(mode="json") for account in get_store().list_accounts()])


@bp.route(route="accounts", methods=["POST"])
@validated
@storage_errors
def create_account(req: func.HttpRequest):
    account = Account.model_validate(req.get_json())
    saved = get_store().create_account(account)
    if saved is None:
        return error_response(409, "CONFLICT", "Account already exists.")
    return json_response(saved.model_dump(mode="json"), 201)
