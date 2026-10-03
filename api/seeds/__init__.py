import azure.functions as func

from shared.http import error_response, json_response, validated
from shared.models import Seed, SeedPatch, Utterance
from shared.store import memory_enabled, store

bp = func.Blueprint()


def storage_unavailable():
    return error_response(503, "STORAGE_NOT_CONFIGURED", "Configure storage, or enable memory mode for local development.")


@bp.route(route="seeds", methods=["POST"])
@validated
def create_seed(req: func.HttpRequest):
    seed = Seed.model_validate(req.get_json())
    if not memory_enabled():
        return storage_unavailable()
    saved = store.create_seed(seed)
    if saved is None:
        return error_response(409, "CONFLICT", "Seed already exists.")
    return json_response(saved.model_dump(mode="json"), 201)


@bp.route(route="seeds/{id}", methods=["PATCH"])
@validated
def update_seed(req: func.HttpRequest):
    meeting_id = req.params.get("meetingId")
    if not meeting_id:
        return error_response(400, "INVALID_REQUEST", "meetingId query parameter is required.")
    patch = SeedPatch.model_validate(req.get_json())
    if not memory_enabled():
        return storage_unavailable()
    saved = store.patch_seed(meeting_id, req.route_params["id"], patch)
    if saved is None:
        return error_response(404, "NOT_FOUND", "Seed not found.")
    return json_response(saved.model_dump(mode="json"))


@bp.route(route="meetings/{meetingId}/grove", methods=["GET"])
def get_grove(req: func.HttpRequest):
    if not memory_enabled():
        return storage_unavailable()
    return json_response(store.get_grove(req.route_params["meetingId"]).model_dump(mode="json"))


@bp.route(route="utterances", methods=["POST"])
@validated
def save_utterance(req: func.HttpRequest):
    utterance = Utterance.model_validate(req.get_json())
    if not memory_enabled():
        return storage_unavailable()
    saved = store.save_utterance(utterance)
    return json_response(saved.model_dump(mode="json"))
