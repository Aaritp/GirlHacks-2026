"""GET /api/accounts/{id}/timeline for the account dashboard (Person C).

Not registered in function_app.py yet: it needs account-scoped reads on the shared
store. See README.md in this folder.
"""
from typing import Protocol

import azure.functions as func
from pydantic import BaseModel

from shared.http import error_response, json_response
from shared.store import storage_errors


class TimelineRepository(Protocol):
    """The three reads this endpoint needs from the shared store. No writes."""

    def get_account(self, account_id: str) -> BaseModel | None: ...
    # Every source for the account, across all of its meetings and uploads.
    def list_account_sources(self, account_id: str) -> list: ...
    def list_account_seeds(self, account_id: str) -> list: ...


def build_timeline(account_id: str, sources: list, seeds: list) -> dict:
    """Every source of the account, newest first, each with the seeds extracted from it.

    Records carrying a different accountId are dropped, so one account can never show another's.
    """
    by_source: dict[str, list] = {}
    for seed in seeds:
        if seed.accountId == account_id:
            by_source.setdefault(seed.sourceId, []).append(seed.model_dump(mode="json"))
    own = [source for source in sources if source.accountId == account_id]
    own.sort(key=lambda source: source.id)
    own.sort(key=lambda source: source.createdAt, reverse=True)
    return {
        "accountId": account_id,
        "items": [{"source": source.model_dump(mode="json"), "seeds": by_source.get(source.id, [])} for source in own],
    }


def create_timeline_blueprint(get_repository) -> func.Blueprint:
    """`get_repository` is called per request, like `shared.store.get_store`."""
    bp = func.Blueprint()

    @bp.route(route="accounts/{id}/timeline", methods=["GET"])
    @storage_errors
    def account_timeline(req: func.HttpRequest):
        account_id = req.route_params["id"]
        repository = get_repository()
        if repository.get_account(account_id) is None:
            return error_response(404, "NOT_FOUND", "Account not found.")
        return json_response(build_timeline(
            account_id, repository.list_account_sources(account_id), repository.list_account_seeds(account_id)))

    return bp
