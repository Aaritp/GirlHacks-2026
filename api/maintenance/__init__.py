"""Development maintenance: clear all stored data so test runs do not clutter the demo.

Off unless the server opts in with GROVEKEEPER_ALLOW_CLEAR_ALL=true (local settings only;
never set it on a shared or deployed environment), and the request must carry the exact
confirmation phrase. Client accounts are kept unless keepAccounts is false.
"""
import logging
import os

import azure.functions as func

from shared.http import error_response, json_response, validated
from shared.models import CLEAR_ALL_PHRASE, ClearAllRequest, ClearAllResult
from shared.store import get_store, storage_errors

bp = func.Blueprint()


def clear_all_enabled():
    return os.getenv("GROVEKEEPER_ALLOW_CLEAR_ALL", "").strip().lower() == "true"


@bp.route(route="maintenance/clear-all", methods=["POST"])
@validated
@storage_errors
def clear_all(req: func.HttpRequest):
    request = ClearAllRequest.model_validate(req.get_json())
    if not clear_all_enabled():
        return error_response(403, "CLEAR_DISABLED",
                              "Clearing is turned off on this server. Set GROVEKEEPER_ALLOW_CLEAR_ALL=true in "
                              "api/local.settings.json and restart func to allow it.")
    if request.confirm != CLEAR_ALL_PHRASE:
        return error_response(400, "INVALID_REQUEST", f"Type {CLEAR_ALL_PHRASE} exactly to confirm.")
    deleted = get_store().clear_all(keep_accounts=request.keepAccounts)
    logging.warning("All data cleared (accounts kept: %s): %s", request.keepAccounts, deleted)
    return json_response(ClearAllResult(deleted=deleted, keptAccounts=request.keepAccounts).model_dump(mode="json"))
