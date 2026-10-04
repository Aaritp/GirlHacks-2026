import json

import azure.functions as func
import pytest

from conftest import function_handlers
from extract import model
from extract.pipeline import SourceConflict, extract_and_save, extract_source_and_save
from fake_cosmos import FakeDatabase
from shared.cosmos import CosmosStore
from shared.models import Account, Seed, Source, Utterance
from shared.store import MemoryStore, use_store

HANDLERS = function_handlers()
ACCOUNT = Account(id="acct-northwind", name="Northwind Logistics", aliases=["NWL"], industry="Transportation",
                  contacts=[{"name": "Dana Whitfield", "role": "Payroll director"}])
EMAIL_TEXT = ("Hi Alex, the sandbox credentials still have not arrived and our testers are blocked. "
              "If this slips past Friday we will miss the pilot window. "
              "We also need bilingual pay statements for Quebec. Dana")


@pytest.fixture(params=["memory", "cosmos"])
def backend(request):
    instance = MemoryStore() if request.param == "memory" else CosmosStore(FakeDatabase())
    use_store(instance)
    yield instance
    use_store(None)


@pytest.fixture
def openai_env(monkeypatch):
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.openai.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "secret")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-extract")
    return monkeypatch


def http(body=None, method="POST", route_params=None):
    return func.HttpRequest(method=method, url="http://localhost/api/test", route_params=route_params or {},
                            headers={"Content-Type": "application/json"},
                            body=json.dumps(body).encode() if body is not None else b"")


def body(response):
    return json.loads(response.get_body())


def email(**changes):
    return Source.model_validate({
        "id": "src-nw-email", "meetingId": "src-nw-email", "type": "email", "title": "Re: sandbox credentials",
        "createdAt": "2026-09-28T13:00:00Z", "accountId": ACCOUNT.id, "text": EMAIL_TEXT, **changes,
    })


def utterance(uid, start, text, speaker="Alex", meeting="meet-1"):
    return Utterance(id=uid, meetingId=meeting, speaker=speaker, text=text, startSec=start, via="voice")


def item(key, kind, text, quote, owner=None, deadline=None, evidence=None, depends=()):
    return {"key": key, "kind": kind, "text": text, "owner": owner, "deadline": deadline,
            "deadlineEvidence": evidence, "quote": quote, "dependsOn": list(depends)}


# --- storage ---------------------------------------------------------------------------

def test_accounts_round_trip_sorted_and_conflict(backend):
    assert backend.create_account(ACCOUNT) == ACCOUNT
    assert backend.create_account(ACCOUNT) is None
    backend.create_account(Account(id="acct-harbor", name="Harbor Health"))
    assert [a.name for a in backend.list_accounts()] == ["Harbor Health", "Northwind Logistics"]
    assert backend.get_account("acct-northwind").contacts[0].name == "Dana Whitfield"
    assert backend.get_account("missing") is None


def test_account_reads_span_meetings_and_are_isolated(backend):
    backend.create_source(email())
    backend.create_source(email(id="src-hb", meetingId="src-hb", accountId="acct-harbor"))
    backend.create_source(Source(id="meet-1", meetingId="meet-1", type="meeting", title="Kickoff",
                                 createdAt="2026-09-20T13:00:00Z", accountId=ACCOUNT.id))
    assert sorted(s.id for s in backend.list_account_sources(ACCOUNT.id)) == ["meet-1", "src-nw-email"]
    assert [s.id for s in backend.list_account_sources("acct-harbor")] == ["src-hb"]
    assert backend.list_account_sources("acct-none") == []


def test_seeds_stored_before_accounts_still_load():
    database = FakeDatabase()
    backend = CosmosStore(database)
    database.containers["seeds"].items[("m", "old")] = {
        "id": "old", "meetingId": "m", "text": "Send it", "owner": None, "deadline": None, "kind": "commitment",
        "status": "seed", "health": 1, "sourceType": "meeting", "sourceId": "m", "timestampSec": 1,
        "lastActivity": "2026-10-03T13:00:00Z", "size": 1, "_etag": "x"}
    seed = backend.get_seed("m", "old")
    assert (seed.accountId, seed.quote) == (None, None)


# --- routes ----------------------------------------------------------------------------

def test_utterances_route_returns_meeting_transcript_in_order(backend):
    backend.save_utterance(utterance("u2", 20, "Second."))
    backend.save_utterance(utterance("u1", 5, "First."))
    backend.save_utterance(utterance("x", 1, "Other meeting.", meeting="meet-2"))
    result = body(HANDLERS["list_utterances"](http(method="GET", route_params={"meetingId": "meet-1"})))
    assert [u["id"] for u in result["utterances"]] == ["u1", "u2"]
    empty = HANDLERS["list_utterances"](http(method="GET", route_params={"meetingId": "nothing"}))
    assert (empty.status_code, body(empty)) == (200, {"utterances": []})


def test_accounts_routes(backend):
    created = HANDLERS["create_account"](http(ACCOUNT.model_dump(mode="json")))
    assert created.status_code == 201
    assert HANDLERS["create_account"](http(ACCOUNT.model_dump(mode="json"))).status_code == 409
    assert HANDLERS["create_account"](http({"id": "a/b", "name": "Bad"})).status_code == 400
    listed = body(HANDLERS["list_accounts"](http(method="GET")))
    assert isinstance(listed, list) and listed[0]["id"] == ACCOUNT.id


# --- meeting extraction ----------------------------------------------------------------

def test_meeting_seeds_get_quote_new_kinds_and_account(backend):
    transcript = [utterance("u1", 3, "Our testers are blocked on the sandbox.", speaker="Dana"),
                  utterance("u2", 9, "We need bilingual pay statements.", speaker="Dana")]
    model_items = [
        {"key": "r", "kind": "risk", "text": "Testers blocked on sandbox", "owner": None, "deadline": None,
         "deadlineEvidence": None, "utteranceIds": ["u1"], "dependsOn": []},
        {"key": "n", "kind": "customer_need", "text": "Bilingual pay statements", "owner": None, "deadline": None,
         "deadlineEvidence": None, "utteranceIds": ["u2", "u2"], "dependsOn": []},
    ]
    result = extract_and_save(backend, "meet-1", transcript, lambda window: model_items, account_id=ACCOUNT.id)
    risk, need = result.seeds
    assert (risk.kind, risk.quote, risk.accountId) == ("risk", "Our testers are blocked on the sandbox.", ACCOUNT.id)
    assert (need.kind, need.quote) == ("customer_need", "We need bilingual pay statements.")
    assert backend.get_source("meet-1", "meet-1").accountId == ACCOUNT.id
    assert [s.id for s in backend.list_account_seeds(ACCOUNT.id)] == [risk.id, need.id]


def test_meeting_account_link_is_fixed_once_set(backend):
    extract_and_save(backend, "meet-1", [utterance("u1", 1, "Hello.")], lambda window: [], account_id=ACCOUNT.id)
    # Later windows may omit accountId and still inherit it.
    later = [utterance("u2", 2, "I'll send it.")]
    seed_item = {"key": "a", "kind": "commitment", "text": "Send it", "owner": "Alex", "deadline": None,
                 "deadlineEvidence": None, "utteranceIds": ["u2"], "dependsOn": []}
    assert extract_and_save(backend, "meet-1", later, lambda window: [seed_item]).seeds[0].accountId == ACCOUNT.id
    with pytest.raises(SourceConflict):
        extract_and_save(backend, "meet-1", later, lambda window: [], account_id="acct-harbor")


def test_meeting_extract_route_maps_account_conflict_to_409(backend, openai_env):
    openai_env.setattr(model, "call_model", lambda window: [])
    payload = {"meetingId": "meet-1", "utterances": [utterance("u1", 1, "Hi.").model_dump(mode="json")]}
    assert HANDLERS["extract"](http({**payload, "accountId": ACCOUNT.id})).status_code == 200
    conflict = HANDLERS["extract"](http({**payload, "accountId": "acct-harbor"}))
    assert (conflict.status_code, body(conflict)["error"]["code"]) == (409, "CONFLICT")


# --- source extraction -----------------------------------------------------------------

SOURCE_ITEMS = [
    item("blocked", "risk", "Testers blocked on sandbox credentials",
         "the sandbox credentials still have not arrived and our testers are blocked"),
    item("quebec", "customer_need", "Bilingual pay statements for Quebec",
         "We also need bilingual pay statements for Quebec"),
    item("send", "commitment", "Send sandbox credentials", "the sandbox credentials still have not arrived",
         owner="Alex", deadline="2026-10-02", evidence="past Friday", depends=["blocked"]),
]


def test_source_extraction_saves_source_and_traceable_seeds(backend):
    result = extract_source_and_save(backend, email(), lambda payload: SOURCE_ITEMS)
    assert [s.kind for s in result.seeds] == ["risk", "customer_need", "commitment"]
    seed = result.seeds[2]
    assert (seed.meetingId, seed.sourceId, seed.sourceType, seed.accountId) == (
        "src-nw-email", "src-nw-email", "email", ACCOUNT.id)
    assert seed.timestampSec is None
    assert (seed.owner, seed.deadline.isoformat()) == ("Alex", "2026-10-02")
    assert seed.lastActivity.isoformat() == "2026-09-28T13:00:00+00:00"
    assert result.roots[0].toSeedId == result.seeds[0].id
    assert backend.get_source("src-nw-email", "src-nw-email").text == EMAIL_TEXT
    assert len(backend.list_account_seeds(ACCOUNT.id)) == 3


def test_source_extraction_never_invents_quotes_owners_or_deadlines(backend):
    items = [
        item("fake", "risk", "Customer threatened to cancel", "we will cancel the contract"),
        item("guess", "commitment", "Fix the testers' access", "our testers are blocked", owner="Priya",
             deadline="2026-10-09", evidence="next Thursday"),
        item("bad-kind", "rumor", "Something", "Dana"),
    ]
    seeds = extract_source_and_save(backend, email(), lambda payload: items).seeds
    assert [s.text for s in seeds] == ["Fix the testers' access"]
    assert (seeds[0].owner, seeds[0].deadline) == (None, None)


def test_reingesting_the_same_source_is_idempotent(backend):
    first = extract_source_and_save(backend, email(), lambda payload: SOURCE_ITEMS)
    reworded = [dict(SOURCE_ITEMS[0], text="Sandbox access is blocking testing")] + SOURCE_ITEMS[1:]
    second = extract_source_and_save(backend, email(), lambda payload: reworded)
    assert [s.id for s in second.seeds] == [s.id for s in first.seeds]
    assert len(backend.list_seeds("src-nw-email")) == 3


def test_source_with_same_id_but_different_content_is_a_conflict(backend):
    extract_source_and_save(backend, email(), lambda payload: [])
    with pytest.raises(SourceConflict):
        extract_source_and_save(backend, email(text="Completely different email."), lambda payload: [])


def test_source_route_validation_and_failures(backend, openai_env):
    openai_env.setattr(model, "call_source_model", lambda payload: SOURCE_ITEMS[:1])
    ok = HANDLERS["extract_source"](http({"source": email().model_dump(mode="json")}))
    assert ok.status_code == 200 and body(ok)["seeds"][0]["quote"].startswith("the sandbox credentials")
    meeting = email(type="meeting").model_dump(mode="json")
    assert HANDLERS["extract_source"](http({"source": meeting})).status_code == 400
    assert HANDLERS["extract_source"](http({"source": email(text="  ").model_dump(mode="json")})).status_code == 400
    clash = HANDLERS["extract_source"](http({"source": email(text="Other").model_dump(mode="json")}))
    assert clash.status_code == 409

    def failing(payload):
        raise model.ModelFailed("timeout")
    openai_env.setattr(model, "call_source_model", failing)
    other = email(id="src-2", meetingId="src-2")
    failed = HANDLERS["extract_source"](http({"source": other.model_dump(mode="json")}))
    assert (failed.status_code, body(failed)["error"]["code"]) == (502, "UPSTREAM_ERROR")
    assert backend.list_seeds("src-2") == []


def test_source_model_prompt_is_sent_with_reasoning_parameters(openai_env):
    import openai
    from types import SimpleNamespace
    sent = {}

    class FakeClient:
        def __init__(self, **kwargs):
            def create(**options):
                sent.update(options)
                message = SimpleNamespace(content=json.dumps({"items": []}))
                return SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=message)])
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))

    openai_env.setattr(openai, "OpenAI", FakeClient)
    assert model.call_source_model({"text": "hi"}) == []
    assert sent["reasoning_effort"] == "low"
    assert sent["response_format"]["json_schema"]["name"] == "source_extraction"
    kinds = sent["response_format"]["json_schema"]["schema"]["properties"]["items"]["items"]["properties"]["kind"]["enum"]
    assert kinds == ["commitment", "decision", "risk", "customer_need"]
