import json

import azure.functions as func
import pytest

from conftest import function_handlers
from extract import model
from extract.pipeline import SourceConflict, extract_and_save
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
    openai_env.setattr(model, "call_extraction", lambda window: [])
    payload = {"meetingId": "meet-1", "utterances": [utterance("u1", 1, "Hi.").model_dump(mode="json")]}
    assert HANDLERS["extract"](http({**payload, "accountId": ACCOUNT.id})).status_code == 200
    conflict = HANDLERS["extract"](http({**payload, "accountId": "acct-harbor"}))
    assert (conflict.status_code, body(conflict)["error"]["code"]) == (409, "CONFLICT")


# --- text sources (email, chat, document, Slack via api/ingest) ----------------------------

def chunks(source, texts, authors=None):
    """How ingestion feeds a text source: one utterance-shaped chunk per message."""
    authors = authors or ["Dana"] * len(texts)
    return [Utterance(id=f"chunk-{i}", meetingId=source.meetingId, speaker=author, text=text, startSec=i, via="voice")
            for i, (author, text) in enumerate(zip(authors, texts))]


EMAIL_CHUNKS = ["Hi Alex, the sandbox credentials still have not arrived and our testers are blocked.",
                "If this slips past Friday we will miss the pilot window. We also need bilingual pay statements."]
TEXT_ITEMS = [
    {"key": "blocked", "kind": "risk", "text": "Testers blocked on sandbox credentials", "owner": None,
     "deadline": None, "deadlineEvidence": None, "utteranceIds": ["chunk-0"], "dependsOn": []},
    {"key": "quebec", "kind": "customer_need", "text": "Bilingual pay statements", "owner": None,
     "deadline": None, "deadlineEvidence": None, "utteranceIds": ["chunk-1"], "dependsOn": ["blocked"]},
    {"key": "send", "kind": "commitment", "text": "Send sandbox credentials", "owner": "Alex",
     "deadline": "2026-10-02", "deadlineEvidence": "next Tuesday", "utteranceIds": ["chunk-0"], "dependsOn": []},
]


def test_text_source_seeds_point_at_the_source_and_chunks_are_not_saved(backend):
    source = email()
    result = extract_and_save(backend, source.meetingId, chunks(source, EMAIL_CHUNKS), lambda w: TEXT_ITEMS,
                              source=source)
    risk, need, send = result.seeds
    assert (risk.sourceType, risk.sourceId, risk.meetingId, risk.accountId, risk.timestampSec) == (
        "email", "src-nw-email", "src-nw-email", ACCOUNT.id, None)
    assert risk.quote == EMAIL_CHUNKS[0] and need.kind == "customer_need"
    # Alex is named in the cited text; the deadline evidence is not, so it stays null.
    assert (send.owner, send.deadline) == ("Alex", None)
    assert result.roots[0].fromSeedId == need.id and result.roots[0].toSeedId == risk.id
    assert backend.list_utterances(source.meetingId) == []
    assert backend.get_source(source.meetingId, source.id).text == EMAIL_TEXT


def test_text_sources_sharing_a_partition_deduplicate_separately(backend):
    first = email(id="email-1", meetingId="account-nw")
    second = email(id="email-2", meetingId="account-nw")
    items = TEXT_ITEMS[:1]
    a = extract_and_save(backend, "account-nw", chunks(first, EMAIL_CHUNKS), lambda w: items, source=first)
    again = extract_and_save(backend, "account-nw", chunks(first, EMAIL_CHUNKS), lambda w: items, source=first)
    b = extract_and_save(backend, "account-nw", chunks(second, EMAIL_CHUNKS), lambda w: items, source=second)
    assert again.seeds[0].id == a.seeds[0].id
    assert b.seeds[0].id != a.seeds[0].id and b.seeds[0].sourceId == "email-2"
    assert len(backend.list_seeds("account-nw")) == 2


def test_text_source_rules(backend):
    source = email()
    evidence = chunks(source, EMAIL_CHUNKS)
    with pytest.raises(ValueError):
        extract_and_save(backend, "other-partition", evidence, lambda w: [], source=source)
    with pytest.raises(ValueError):
        meeting = Source(id="m", meetingId="src-nw-email", type="meeting", title="M", createdAt="2026-10-03T13:00:00Z")
        extract_and_save(backend, "src-nw-email", evidence, lambda w: [], source=meeting)
    with pytest.raises(SourceConflict):
        extract_and_save(backend, source.meetingId, evidence, lambda w: [], account_id="acct-harbor", source=source)
    assert backend.list_seeds(source.meetingId) == []


def test_extract_source_route_is_gone():
    assert "extract_source" not in HANDLERS
