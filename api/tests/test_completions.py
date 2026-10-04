"""Self-updating commitments: the transcript can suggest closing an open commitment; never auto-close."""
import json

import azure.functions as func
import pytest

from conftest import function_handlers
from extract import model
from extract.pipeline import extract_and_save
from fake_cosmos import FakeDatabase
from shared.cosmos import CosmosStore
from shared.models import Account, CompletedBy, Seed, SeedPatch, Utterance
from shared.store import MemoryStore, use_store

HANDLERS = function_handlers()
ACCOUNT = "acct-contoso"


@pytest.fixture(params=["memory", "cosmos"])
def backend(request):
    instance = MemoryStore() if request.param == "memory" else CosmosStore(FakeDatabase())
    instance.create_account(Account(id=ACCOUNT, name="Contoso Ltd"))
    use_store(instance)
    yield instance
    use_store(None)


def seed(seed_id, text, meeting="meet-old", status="sprout", kind="commitment", account=ACCOUNT):
    return Seed.model_validate({
        "id": seed_id, "meetingId": meeting, "text": text, "owner": "Alex Kim", "deadline": None, "kind": kind,
        "status": status, "health": 1, "sourceType": "meeting", "sourceId": meeting, "timestampSec": 3,
        "lastActivity": "2026-10-01T13:00:00Z", "size": 1, "accountId": account})


def said(uid, start, text, speaker="Alex Kim", meeting="meet-new"):
    return Utterance(id=uid, meetingId=meeting, speaker=speaker, text=text, startSec=start, via="voice")


class Recorder:
    def __init__(self, output):
        self.output, self.windows = output, []

    def __call__(self, window):
        self.windows.append(window)
        return self.output


def done(seed_id, quote, ids=()):
    return {"seedId": seed_id, "evidenceQuote": quote, "utteranceIds": list(ids)}


def test_account_commitments_from_other_meetings_are_offered_and_a_done_statement_is_suggested(backend):
    backend.create_seed(seed("s-checklist", "Send the payroll integration checklist"))
    backend.create_seed(seed("s-done", "Book the venue", status="bloom"))
    backend.create_seed(seed("s-decision", "Pilot at Columbus", kind="decision"))
    backend.create_seed(seed("s-other", "Call the bank", account="acct-fabrikam"))
    window = [said("u1", 12, "Quick update: the payroll checklist is done and sent over.")]
    fake = Recorder({"items": [], "completions": [done("s-checklist", "the payroll checklist is done", ["u1"])]})

    result = extract_and_save(backend, "meet-new", window, fake, account_id=ACCOUNT)

    offered = [entry["id"] for entry in fake.windows[0]["openCommitments"]]
    assert offered == ["s-checklist"]  # open commitments of this account only
    (suggestion,) = result.completions
    assert suggestion.model_dump(mode="json") == {
        "seedId": "s-checklist", "meetingId": "meet-old", "seedText": "Send the payroll integration checklist",
        "evidenceQuote": "the payroll checklist is done", "sourceId": "meet-new", "sourceType": "meeting",
        "timestampSec": 12}
    # Only a suggestion: nothing changed in storage.
    assert backend.get_seed("meet-old", "s-checklist").status == "sprout"


def test_unverifiable_or_unknown_completions_are_dropped(backend):
    backend.create_seed(seed("s-checklist", "Send the payroll integration checklist"))
    backend.create_seed(seed("s-done", "Book the venue", status="bloom"))
    window = [said("u1", 5, "We still need to finish the checklist next week.")]
    fake = Recorder({"items": [], "completions": [
        done("s-checklist", "the checklist is done"),          # not what was said
        done("s-invented", "we still need to finish"),          # not an offered commitment
        done("s-done", "finish the checklist"),                  # already complete, never offered
        "not an object",
    ]})
    assert extract_and_save(backend, "meet-new", window, fake, account_id=ACCOUNT).completions == []


def test_meeting_without_account_offers_its_own_commitments_and_dedupes(backend):
    backend.create_seed(seed("s-slides", "Send the slides", meeting="meet-solo", account=None))
    window = [said("u1", 1, "I sent the slides this morning.", meeting="meet-solo"),
              said("u2", 9, "Yes, I sent the slides.", meeting="meet-solo")]
    fake = Recorder({"items": [], "completions": [done("s-slides", "I sent the slides"), done("s-slides", "sent the slides")]})
    result = extract_and_save(backend, "meet-solo", window, fake)
    assert [entry["id"] for entry in fake.windows[0]["openCommitments"]] == ["s-slides"]
    assert [(c.seedId, c.timestampSec) for c in result.completions] == [("s-slides", 1)]


def test_no_open_commitments_means_no_completion_prompt_and_list_models_still_work(backend):
    fake = Recorder([])  # a model returning only items (the ingest contract)
    result = extract_and_save(backend, "meet-new", [said("u1", 1, "Hello.")], fake, account_id=ACCOUNT)
    assert "openCommitments" not in fake.windows[0]
    assert result.completions == []


def test_confirming_records_the_completing_source_and_reopening_clears_it(backend):
    backend.create_seed(seed("s-checklist", "Send the payroll integration checklist"))
    evidence = CompletedBy(sourceId="meet-new", sourceType="meeting", quote="the checklist is done", timestampSec=12)
    bloomed = backend.patch_seed("meet-old", "s-checklist", SeedPatch(status="bloom", completedBy=evidence))
    assert bloomed.status == "bloom" and bloomed.completedBy == evidence
    reopened = backend.patch_seed("meet-old", "s-checklist", SeedPatch(status="sprout", completedBy=None))
    assert reopened.completedBy is None
    with pytest.raises(ValueError):
        SeedPatch(status=None)


def test_extract_route_returns_completions(backend, monkeypatch):
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.openai.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "secret")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-extract")
    backend.create_seed(seed("s-checklist", "Send the payroll integration checklist"))
    monkeypatch.setattr(model, "call_extraction", lambda window: {
        "items": [], "completions": [done("s-checklist", "checklist is done")]})
    body = {"meetingId": "meet-new", "accountId": ACCOUNT,
            "utterances": [said("u1", 4, "Good news, the checklist is done.").model_dump(mode="json")]}
    response = HANDLERS["extract"](func.HttpRequest(method="POST", url="/api/extract", body=json.dumps(body).encode()))
    assert response.status_code == 200
    payload = json.loads(response.get_body())
    assert payload["completions"][0]["seedId"] == "s-checklist"
    assert payload["seeds"] == [] and payload["roots"] == []


def test_call_model_still_returns_items_only_for_ingest(monkeypatch):
    monkeypatch.setattr(model, "complete_json", lambda *a, **k: {"items": [{"key": "a"}], "completions": [{"seedId": "x"}]})
    assert model.call_model({"utterances": []}) == [{"key": "a"}]
    assert model.call_extraction({"utterances": []})["completions"] == [{"seedId": "x"}]
    schema = model.RESPONSE_SCHEMA
    assert schema["required"] == ["items", "completions"]
    assert "openCommitments" in model.SYSTEM_PROMPT
