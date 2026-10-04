import json
from datetime import datetime, timezone

import azure.functions as func
from pydantic import BaseModel

from accounts_timeline import build_timeline, create_timeline_blueprint
from shared.store import StorageUnavailable


# Stand-ins for the shared Account/Source/Seed models until accountId lands on them.
class Account(BaseModel):
    id: str
    name: str


class Source(BaseModel):
    id: str
    accountId: str
    type: str
    title: str
    createdAt: datetime


class Seed(BaseModel):
    id: str
    accountId: str
    sourceId: str
    kind: str
    text: str


def source(id, account, type, day):
    return Source(id=id, accountId=account, type=type, title=id, createdAt=datetime(2026, 10, day, tzinfo=timezone.utc))


def seed(id, account, source_id, kind="commitment"):
    return Seed(id=id, accountId=account, sourceId=source_id, kind=kind, text=id)


SOURCES = [source("old-doc", "a", "document", 1), source("slack", "a", "slack", 5),
           source("email", "a", "email", 3), source("other", "b", "meeting", 4)]
SEEDS = [seed("s1", "a", "email"), seed("s2", "a", "email", "risk"), seed("s3", "a", "slack"),
         seed("leak", "b", "email"), seed("b1", "b", "other")]


class Repository:
    def __init__(self, fail=False):
        self.fail = fail

    def get_account(self, account_id):
        if self.fail:
            raise StorageUnavailable("down")
        return Account(id=account_id, name=account_id) if account_id in ("a", "b", "empty") else None

    def list_account_sources(self, account_id):
        return list(SOURCES)

    def list_account_seeds(self, account_id):
        return list(SEEDS)


def call(repository, account_id):
    blueprint = create_timeline_blueprint(lambda: repository)
    app = func.FunctionApp()
    app.register_functions(blueprint)
    handler = app.get_functions()[0].get_user_function()
    response = handler(func.HttpRequest("GET", f"http://localhost/api/accounts/{account_id}/timeline",
                                        route_params={"id": account_id}, body=b""))
    return response.status_code, json.loads(response.get_body())


def test_timeline_is_newest_first_with_source_types_and_seeds():
    timeline = build_timeline("a", SOURCES, SEEDS)
    assert [item["source"]["id"] for item in timeline["items"]] == ["slack", "email", "old-doc"]
    assert [item["source"]["type"] for item in timeline["items"]] == ["slack", "email", "document"]
    assert [[s["id"] for s in item["seeds"]] for item in timeline["items"]] == [["s3"], ["s1", "s2"], []]
    assert timeline["items"][0]["source"]["createdAt"] == "2026-10-05T00:00:00Z"


def test_accounts_are_isolated():
    ids = lambda account: {s["id"] for item in build_timeline(account, SOURCES, SEEDS)["items"] for s in item["seeds"]}
    assert ids("a") == {"s1", "s2", "s3"}
    assert ids("b") == {"b1"}
    assert [item["source"]["id"] for item in build_timeline("b", SOURCES, SEEDS)["items"]] == ["other"]


def test_endpoint_returns_timeline_empty_account_and_errors():
    status, body = call(Repository(), "a")
    assert status == 200 and body["accountId"] == "a" and len(body["items"]) == 3
    assert call(Repository(), "empty") == (200, {"accountId": "empty", "items": []})
    status, body = call(Repository(), "missing")
    assert status == 404 and body["error"]["code"] == "NOT_FOUND"
    status, body = call(Repository(fail=True), "a")
    assert status == 503 and body["error"]["code"] == "STORAGE_UNAVAILABLE"


# --- Through the registered route and the real shared stores ---
import pytest

from conftest import function_handlers
from fake_cosmos import FakeDatabase
from shared import models
from shared.cosmos import CosmosStore
from shared.store import MemoryStore, use_store


@pytest.fixture(params=["memory", "cosmos"])
def backend(request):
    instance = MemoryStore() if request.param == "memory" else CosmosStore(FakeDatabase())
    use_store(instance)
    yield instance
    use_store(None)


def stored_source(id, account, type, day, text=None):
    return models.Source(id=id, meetingId=id, accountId=account, type=type, title=id, text=text,
                         createdAt=datetime(2026, 10, day, tzinfo=timezone.utc))


def stored_seed(id, account, source_id, kind="commitment", quote=None):
    return models.Seed(id=id, meetingId=source_id, accountId=account, text=id, owner=None, deadline=None, kind=kind,
                       status="sprout", health=1, sourceType="email", sourceId=source_id, timestampSec=None,
                       lastActivity=datetime(2026, 10, 1, tzinfo=timezone.utc), size=1, quote=quote)


def test_registered_route_reads_the_shared_store(backend):
    for id in ("a", "b", "empty"):
        backend.create_account(models.Account(id=id, name=id))
    backend.create_source(stored_source("doc", "a", "document", 1, "Statement of work"))
    backend.create_source(stored_source("mail", "a", "email", 4, "Testers are blocked."))
    backend.create_source(stored_source("theirs", "b", "slack", 3, "Other client"))
    backend.create_seed(stored_seed("s1", "a", "mail", "risk", "Testers are blocked."))
    backend.create_seed(stored_seed("b1", "b", "theirs"))
    backend.create_seed(models.Seed.model_validate({**stored_seed("old", None, "mail").model_dump(), "accountId": None}))
    handler = function_handlers()["account_timeline"]

    def get(account_id):
        response = handler(func.HttpRequest("GET", "http://localhost/api/test", route_params={"id": account_id}, body=b""))
        return response.status_code, json.loads(response.get_body())

    status, body = get("a")
    assert status == 200
    assert [(item["source"]["id"], item["source"]["type"]) for item in body["items"]] == [("mail", "email"), ("doc", "document")]
    assert body["items"][0]["source"]["text"] == "Testers are blocked."
    assert [(s["id"], s["kind"], s["quote"]) for s in body["items"][0]["seeds"]] == [("s1", "risk", "Testers are blocked.")]
    assert body["items"][1]["seeds"] == []
    assert [item["source"]["id"] for item in get("b")[1]["items"]] == ["theirs"]
    assert get("empty") == (200, {"accountId": "empty", "items": []})
    assert get("missing")[0] == 404


def test_bookkeeping_records_stored_as_sources_are_left_out():
    class Binding(Source):
        recordType: str = "source"

    binding = Binding(id="C123", accountId="a", type="slack", title="Slack channel binding",
                      createdAt=datetime(2026, 10, 9, tzinfo=timezone.utc), recordType="slack_binding")
    timeline = build_timeline("a", [*SOURCES, binding], SEEDS)
    assert [item["source"]["id"] for item in timeline["items"]] == ["slack", "email", "old-doc"]
