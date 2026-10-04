import json

import azure.functions as func
import pytest

from extract import model
from extract.pipeline import extract_and_save, similarity
from fake_cosmos import FakeDatabase, service_error
from conftest import function_handlers
from shared.cosmos import CosmosStore
from shared.models import SeedPatch, Utterance
from shared.store import MemoryStore, use_store

HANDLERS = function_handlers()
MEETING = "meeting-a"


def utterance(uid, start, text, speaker="Alex", meeting=MEETING, via="voice"):
    return Utterance(id=uid, meetingId=meeting, speaker=speaker, text=text, startSec=start, via=via)


TRANSCRIPT = [
    utterance("u1", 12, "I'll send the payroll integration checklist by October 5."),
    utterance("u2", 28, "I'll schedule the customer onboarding review after the checklist is ready.", speaker="Sam"),
    utterance("u3", 41, "We decided to launch with the payroll pilot customers first.", speaker="Jordan"),
    utterance("u4", 55, "Someone should look at the billing export eventually.", speaker="Sam"),
]


def item(key, ids, text, kind="commitment", owner=None, deadline=None, evidence=None, depends=()):
    return {"key": key, "kind": kind, "text": text, "owner": owner, "deadline": deadline,
            "deadlineEvidence": evidence, "utteranceIds": list(ids), "dependsOn": list(depends)}


class FakeModel:
    """Returns canned items per call and records the windows it was shown."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.windows = []

    def __call__(self, window):
        self.windows.append(window)
        return self.responses.pop(0)


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


def http(body=None, method="POST", params=None, route_params=None):
    return func.HttpRequest(method=method, url="http://localhost/api/test", params=params or {},
                            route_params=route_params or {}, headers={"Content-Type": "application/json"},
                            body=json.dumps(body).encode() if body is not None else b"")


def body(response):
    return json.loads(response.get_body())


def dump(utterances):
    return [item.model_dump(mode="json") for item in utterances]


FIRST_WINDOW = [
    item("checklist", ["u1"], "Send the payroll integration checklist", owner="Alex",
         deadline="2026-10-05", evidence="by October 5"),
    item("review", ["u2"], "Schedule the customer onboarding review", owner="Sam", depends=["checklist"]),
]


def test_transcript_to_saved_seed_flow(backend, openai_env):
    fake = FakeModel(FIRST_WINDOW)
    openai_env.setattr(model, "call_extraction", fake)
    for entry in TRANSCRIPT[:2]:
        assert HANDLERS["save_utterance"](http(entry.model_dump(mode="json"))).status_code == 200
    response = HANDLERS["extract"](http({"meetingId": MEETING, "utterances": dump(TRANSCRIPT[:2])}))
    assert response.status_code == 200
    result = body(response)
    checklist, review = result["seeds"]
    assert checklist["owner"] == "Alex" and checklist["deadline"] == "2026-10-05"
    assert (checklist["sourceType"], checklist["sourceId"], checklist["timestampSec"]) == ("meeting", MEETING, 12)
    assert (review["owner"], review["deadline"], review["timestampSec"]) == ("Sam", None, 28)
    assert result["roots"][0]["fromSeedId"] == review["id"]
    assert result["roots"][0]["toSeedId"] == checklist["id"]

    grove = body(HANDLERS["get_grove"](http(method="GET", route_params={"meetingId": MEETING})))
    assert {seed["id"] for seed in grove["seeds"]} == {checklist["id"], review["id"]}
    assert len(grove["roots"]) == 1
    assert backend.get_source(MEETING, MEETING).type == "meeting"
    assert [u.id for u in backend.list_utterances(MEETING)] == ["u1", "u2"]
    assert [u["id"] for u in fake.windows[0]["utterances"]] == ["u1", "u2"]


def test_overlapping_windows_do_not_duplicate_or_reset_progress(backend):
    second_window = [
        # Same commitments, worded differently by the model on the overlapping window.
        item("a", ["u2"], "Schedule the onboarding review with the customer", owner="Sam"),
        item("b", ["u1"], "Send payroll integration checklist", owner="Alex", deadline="2026-10-05",
             evidence="by October 5"),
        item("c", ["u3"], "Launch with payroll pilot customers first", kind="decision"),
        item("c-dup", ["u3"], "Launch with the payroll pilot customers first", kind="decision"),
    ]
    fake = FakeModel(FIRST_WINDOW, second_window)
    first = extract_and_save(backend, MEETING, TRANSCRIPT[:2], fake)
    backend.patch_seed(MEETING, first.seeds[0].id, SeedPatch(status="bloom"))
    second = extract_and_save(backend, MEETING, TRANSCRIPT[:3], fake)

    assert len(second.seeds) == 3
    by_id = {seed.id: seed for seed in second.seeds}
    assert by_id[first.seeds[0].id].status == "bloom"
    assert by_id[first.seeds[0].id].text == "Send the payroll integration checklist"
    assert first.seeds[1].id in by_id
    assert len(backend.list_seeds(MEETING)) == 3
    assert len(backend.list_roots(MEETING)) == 1


def test_repeated_identical_window_is_idempotent(backend):
    fake = FakeModel(FIRST_WINDOW, FIRST_WINDOW)
    first = extract_and_save(backend, MEETING, TRANSCRIPT[:2], fake)
    second = extract_and_save(backend, MEETING, TRANSCRIPT[:2], fake)
    assert [seed.id for seed in first.seeds] == [seed.id for seed in second.seeds]
    assert len(backend.list_seeds(MEETING)) == 2
    assert len(backend.list_roots(MEETING)) == 1


def test_two_commitments_in_one_utterance_stay_distinct(backend):
    line = [utterance("u9", 70, "I'll draft the FAQ and Sam will book the training room.")]
    fake = FakeModel([item("faq", ["u9"], "Draft the FAQ", owner="Alex"),
                      item("room", ["u9"], "Book the training room", owner="Sam")])
    result = extract_and_save(backend, MEETING, line, fake)
    assert [(seed.text, seed.owner) for seed in result.seeds] == [
        ("Draft the FAQ", "Alex"), ("Book the training room", "Sam")]


def test_unsupported_owners_deadlines_and_provenance_are_not_invented(backend):
    fake = FakeModel([
        item("guess", ["u4"], "Review the billing export", owner="Priya", deadline="2026-10-10",
             evidence="by next Friday"),
        item("bad-date", ["u1"], "Send the payroll checklist", owner="Alex", deadline="October 5",
             evidence="by October 5"),
        item("hallucinated", ["u404"], "Fire the vendor", owner="Alex"),
        item("unknown", ["u5"], "Order laptops", owner="Unknown speaker"),
        {"kind": "commitment", "text": "", "utteranceIds": ["u1"]},
        "not an object",
    ])
    window = TRANSCRIPT + [utterance("u5", 80, "I'll order laptops.", speaker="Unknown speaker")]
    result = extract_and_save(backend, MEETING, window, fake)
    by_text = {seed.text: seed for seed in result.seeds}
    assert set(by_text) == {"Review the billing export", "Send the payroll checklist", "Order laptops"}
    assert by_text["Review the billing export"].owner is None
    assert by_text["Review the billing export"].deadline is None
    assert by_text["Send the payroll checklist"].owner == "Alex"
    assert by_text["Send the payroll checklist"].deadline is None
    assert by_text["Order laptops"].owner is None


def test_owner_named_in_text_is_kept_and_leaves_provenance(backend):
    line = [utterance("u7", 90, "Priya will send the contract on Monday.", speaker="Alex", via="leaves")]
    fake = FakeModel([item("contract", ["u7"], "Send the contract", owner="priya")])
    seed = extract_and_save(backend, MEETING, line, fake).seeds[0]
    assert seed.owner == "priya"
    assert (seed.sourceType, seed.sourceId) == ("leaves", MEETING)


def test_extraction_is_isolated_by_meeting(backend):
    other = [utterance("u1", 12, TRANSCRIPT[0].text, meeting="meeting-b")]
    fake = FakeModel(FIRST_WINDOW[:1], FIRST_WINDOW[:1])
    a = extract_and_save(backend, MEETING, TRANSCRIPT[:1], fake)
    b = extract_and_save(backend, "meeting-b", other, fake)
    assert a.seeds[0].id != b.seeds[0].id
    assert b.seeds[0].meetingId == "meeting-b"
    assert len(backend.list_seeds(MEETING)) == 1
    assert len(backend.list_seeds("meeting-b")) == 1


def test_missing_openai_settings_returns_503_without_saving(backend, monkeypatch):
    for name in ("AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_DEPLOYMENT"):
        monkeypatch.delenv(name, raising=False)
    response = HANDLERS["extract"](http({"meetingId": MEETING, "utterances": dump(TRANSCRIPT[:1])}))
    assert response.status_code == 503
    assert body(response)["error"]["code"] == "SERVICE_NOT_CONFIGURED"
    assert "AZURE_OPENAI_DEPLOYMENT" in body(response)["error"]["message"]
    assert backend.list_seeds(MEETING) == []


def test_model_failure_is_502_and_creates_no_seeds(backend, openai_env):
    def failing(window):
        raise model.ModelFailed("timeout")
    openai_env.setattr(model, "call_extraction", failing)
    response = HANDLERS["extract"](http({"meetingId": MEETING, "utterances": dump(TRANSCRIPT[:1])}))
    assert response.status_code == 502
    assert body(response)["error"]["code"] == "UPSTREAM_ERROR"
    assert backend.list_seeds(MEETING) == []


def test_storage_failure_is_503_not_success(openai_env):
    database = FakeDatabase()
    use_store(CosmosStore(database))
    try:
        database.containers["seeds"].fail_with = service_error()
        openai_env.setattr(model, "call_extraction", FakeModel(FIRST_WINDOW))
        response = HANDLERS["extract"](http({"meetingId": MEETING, "utterances": dump(TRANSCRIPT[:2])}))
        assert response.status_code == 503
        assert body(response)["error"]["code"] == "STORAGE_UNAVAILABLE"
        assert TRANSCRIPT[0].text not in response.get_body().decode()
    finally:
        use_store(None)


def test_extract_without_storage_is_503(monkeypatch, openai_env):
    monkeypatch.delenv("GROVEKEEPER_STORAGE_MODE", raising=False)
    monkeypatch.delenv("AZURE_COSMOS_ENDPOINT", raising=False)
    response = HANDLERS["extract"](http({"meetingId": MEETING, "utterances": dump(TRANSCRIPT[:1])}))
    assert body(response)["error"]["code"] == "STORAGE_NOT_CONFIGURED"


def test_extract_rejects_cross_meeting_utterances(backend, openai_env):
    payload = {"meetingId": "meeting-b", "utterances": dump(TRANSCRIPT[:1])}
    assert HANDLERS["extract"](http(payload)).status_code == 400


def test_similarity_ignores_filler_words():
    assert similarity("Send the payroll checklist", "send payroll checklist") == 1
    assert similarity("Draft the FAQ", "Book the training room") == 0


def test_model_call_uses_reasoning_model_parameters(openai_env):
    import openai
    from types import SimpleNamespace
    sent = {}

    class FakeCompletions:
        def create(self, **kwargs):
            sent.update(kwargs)
            message = SimpleNamespace(content=json.dumps({"items": FIRST_WINDOW}))
            return SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=message)])

    class FakeClient:
        def __init__(self, base_url, api_key, timeout, max_retries):
            sent["base_url"] = base_url
            self.chat = SimpleNamespace(completions=FakeCompletions())

    openai_env.setattr(openai, "OpenAI", FakeClient)
    assert model.call_model({"referenceDate": "2026-10-03", "utterances": []}) == FIRST_WINDOW
    assert sent["base_url"] == "https://example.openai.azure.com/openai/v1/"
    assert sent["model"] == "gpt-extract"
    assert sent["reasoning_effort"] == "low"
    assert not {"temperature", "top_p", "max_tokens"} & set(sent)
