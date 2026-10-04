"""Development reset: guarded by a server opt-in and a typed confirmation phrase."""
import json

import azure.functions as func
import pytest

from conftest import function_handlers
from fake_cosmos import FakeDatabase, service_error
from shared.cosmos import CosmosStore
from shared.models import Account, Seed, Source, Utterance
from shared.store import MemoryStore, use_store

HANDLERS = function_handlers()


def fill(store):
    store.create_account(Account(id="acct-contoso", name="Contoso Ltd"))
    store.create_source(Source(id="meet-1", meetingId="meet-1", type="meeting", title="Test call",
                               createdAt="2026-10-03T13:00:00Z", accountId="acct-contoso"))
    store.save_utterance(Utterance(id="u1", meetingId="meet-1", speaker="Alex", text="Test line.", startSec=1, via="voice"))
    store.create_seed(Seed.model_validate({
        "id": "s1", "meetingId": "meet-1", "text": "Test task", "owner": None, "deadline": None, "kind": "commitment",
        "status": "seed", "health": 1, "sourceType": "meeting", "sourceId": "meet-1", "timestampSec": 1,
        "lastActivity": "2026-10-03T13:00:00Z", "size": 1, "accountId": "acct-contoso"}))


@pytest.fixture(params=["memory", "cosmos"])
def store(request):
    instance = MemoryStore() if request.param == "memory" else CosmosStore(FakeDatabase())
    fill(instance)
    use_store(instance)
    yield instance
    use_store(None)


def call(body):
    return HANDLERS["clear_all"](func.HttpRequest(method="POST", url="/api/maintenance/clear-all",
                                                  body=json.dumps(body).encode()))


def test_clears_test_data_and_keeps_accounts_by_default(store, monkeypatch):
    monkeypatch.setenv("GROVEKEEPER_ALLOW_CLEAR_ALL", "true")
    response = call({"confirm": "CLEAR ALL"})
    assert response.status_code == 200
    body = json.loads(response.get_body())
    assert body == {"deleted": {"seeds": 1, "roots": 0, "utterances": 1, "sources": 1}, "keptAccounts": True}
    assert store.get_grove("meet-1").seeds == [] and store.list_utterances("meet-1") == []
    assert store.get_source("meet-1", "meet-1") is None
    assert [a.id for a in store.list_accounts()] == ["acct-contoso"]


def test_can_also_remove_accounts(store, monkeypatch):
    monkeypatch.setenv("GROVEKEEPER_ALLOW_CLEAR_ALL", "true")
    body = json.loads(call({"confirm": "CLEAR ALL", "keepAccounts": False}).get_body())
    assert body["deleted"]["accounts"] == 1 and body["keptAccounts"] is False
    assert store.list_accounts() == []


def test_refused_unless_the_server_opts_in(store, monkeypatch):
    monkeypatch.delenv("GROVEKEEPER_ALLOW_CLEAR_ALL", raising=False)
    response = call({"confirm": "CLEAR ALL"})
    assert (response.status_code, json.loads(response.get_body())["error"]["code"]) == (403, "CLEAR_DISABLED")
    assert len(store.list_account_seeds("acct-contoso")) == 1


@pytest.mark.parametrize("body", [{"confirm": "clear all"}, {"confirm": ""}, {}, {"confirm": "CLEAR ALL", "x": 1}])
def test_requires_the_exact_phrase(store, monkeypatch, body):
    monkeypatch.setenv("GROVEKEEPER_ALLOW_CLEAR_ALL", "true")
    assert call(body).status_code == 400
    assert len(store.list_account_seeds("acct-contoso")) == 1


def test_storage_failure_is_reported_not_hidden(monkeypatch):
    database = FakeDatabase()
    instance = CosmosStore(database)
    fill(instance)
    use_store(instance)
    try:
        monkeypatch.setenv("GROVEKEEPER_ALLOW_CLEAR_ALL", "true")
        database.containers["seeds"].fail_with = service_error()
        response = call({"confirm": "CLEAR ALL"})
        assert (response.status_code, json.loads(response.get_body())["error"]["code"]) == (503, "STORAGE_UNAVAILABLE")
    finally:
        use_store(None)
