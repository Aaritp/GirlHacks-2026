import json

import azure.functions as func
import pytest
from pydantic import ValidationError

from conftest import indexed_functions
from shared.models import ExtractRequest, Seed, SeedPatch
from shared.store import MemoryStore, store

# Index once, as the Functions host does. SDK indexing tracks registered names.
FUNCTIONS = indexed_functions()


@pytest.fixture
def seed():
    return Seed(
        id="seed-1", meetingId="meeting-a", text="Send the checklist", owner="Alex",
        deadline="2026-10-05", kind="commitment", status="seed", health=1,
        sourceType="meeting", sourceId="meeting-a", timestampSec=12,
        lastActivity="2026-10-03T13:00:00Z", size=1,
    )


@pytest.fixture
def handlers(monkeypatch):
    monkeypatch.setenv("GROVEKEEPER_STORAGE_MODE", "memory")
    store.seeds.clear()
    store.utterances.clear()
    return {function.get_function_name(): function.get_user_function() for function in FUNCTIONS}


def request(body=None, *, method="POST", params=None, route_params=None):
    return func.HttpRequest(
        method=method, url="http://localhost/api/test", headers={"Content-Type": "application/json"},
        params=params or {}, route_params=route_params or {},
        body=json.dumps(body).encode() if body is not None else b"",
    )


def payload(response):
    return json.loads(response.get_body())


def test_partition_isolation_and_copying(seed):
    memory = MemoryStore()
    memory.create_seed(seed)
    memory.create_seed(seed.model_copy(update={"meetingId": "meeting-b"}))
    memory.patch_seed("meeting-b", seed.id, SeedPatch(status="bloom"))
    assert memory.get_grove("meeting-a").seeds[0].status == "seed"
    assert memory.get_grove("meeting-b").seeds[0].status == "bloom"
    result = memory.get_grove("meeting-a")
    result.seeds[0].text = "External mutation"
    assert memory.get_grove("meeting-a").seeds[0].text == "Send the checklist"
    assert memory.create_seed(seed) is None


@pytest.mark.parametrize("patch", [{}, {"id": "new"}, {"meetingId": "new"}, {"sourceId": "new"},
                                    {"health": 2}, {"size": 0}, {"status": None}])
def test_patch_rejects_invalid_mutations(patch):
    with pytest.raises(ValidationError):
        SeedPatch.model_validate(patch)


def test_nullable_fields_can_be_cleared():
    assert SeedPatch(owner=None, deadline=None).model_dump(exclude_unset=True) == {"owner": None, "deadline": None}


def test_extract_rejects_cross_meeting_context():
    with pytest.raises(ValidationError):
        ExtractRequest.model_validate({"meetingId": "a", "utterances": [{
            "id": "u", "meetingId": "b", "speaker": "Alex", "text": "A promise",
            "startSec": 0, "via": "voice",
        }]})


def test_seed_http_flow(seed, handlers):
    created = handlers["create_seed"](request(seed.model_dump(mode="json")))
    assert created.status_code == 201
    assert handlers["create_seed"](request(seed.model_dump(mode="json"))).status_code == 409
    patched = handlers["update_seed"](request({"status": "sprout", "owner": None}, method="PATCH",
        params={"meetingId": seed.meetingId}, route_params={"id": seed.id}))
    assert payload(patched)["status"] == "sprout"
    assert payload(patched)["owner"] is None
    grove = handlers["get_grove"](request(method="GET", route_params={"meetingId": seed.meetingId}))
    assert len(payload(grove)["seeds"]) == 1
    other = handlers["get_grove"](request(method="GET", route_params={"meetingId": "other"}))
    assert payload(other) == {"seeds": [], "roots": []}


def test_patch_requires_partition_and_unknown_seed_is_404(handlers):
    assert handlers["update_seed"](request({"status": "bloom"}, route_params={"id": "missing"})).status_code == 400
    response = handlers["update_seed"](request({"status": "bloom"},
        params={"meetingId": "a"}, route_params={"id": "missing"}))
    assert response.status_code == 404


def test_storage_is_opt_in(seed, handlers, monkeypatch):
    monkeypatch.delenv("GROVEKEEPER_STORAGE_MODE")
    response = handlers["create_seed"](request(seed.model_dump(mode="json")))
    assert response.status_code == 503
    assert payload(response)["error"]["code"] == "STORAGE_NOT_CONFIGURED"


def test_invalid_json_is_a_contract_error(handlers):
    response = handlers["create_seed"](func.HttpRequest(method="POST", url="http://localhost/api/seeds", body=b"{"))
    assert response.status_code == 400


def test_service_stubs_do_not_claim_success(handlers, monkeypatch):
    monkeypatch.delenv("AZURE_SPEECH_KEY", raising=False)
    assert handlers["speech_token"](request()).status_code == 503
    response = handlers["compose"](request({"meetingId": "a", "picked": ["hello"]}))
    assert response.status_code == 501
    assert payload(response)["error"]["code"] == "NOT_IMPLEMENTED"


def test_all_contract_routes_are_registered():
    routes = {function.get_trigger().get_dict_repr()["route"] for function in FUNCTIONS}
    assert routes == {"health", "speech-token", "utterances", "extract", "seeds", "seeds/{id}",
                      "meetings/{meetingId}/grove", "meetings/{meetingId}/utterances", "accounts", "accounts/{id}/timeline",
                      "whiteboard", "leaves/suggest", "leaves/compose"}
