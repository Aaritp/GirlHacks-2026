import pytest

import leaves_suggest
from leaves_suggest import service as suggestion_service
from conftest import function_handlers
from extract.model import ModelFailed, ModelNotConfigured
from extract.pipeline import extract_and_save
from fake_cosmos import FakeDatabase
from shared.cosmos import CosmosStore
from shared.models import Suggestions, Utterance
from shared.store import MemoryStore, use_store
from test_foundation import payload, request


@pytest.fixture(params=["memory", "cosmos"])
def repository(request):
    store = MemoryStore() if request.param == "memory" else CosmosStore(FakeDatabase())
    use_store(store)
    yield store
    use_store(None)


def utterance(id="u", meeting="meeting-a", text="Review payroll", start=200, via="voice"):
    return Utterance(id=id, meetingId=meeting, text=text, speaker="Alex", startSec=start, via=via)


def test_suggest_reads_recent_persisted_context_and_isolates_meetings(repository, monkeypatch):
    for entry in [utterance("old", text="OLD-SECRET", start=1), utterance(),
                  utterance("other", meeting="meeting-b", text="OTHER-SECRET", start=201),
                  utterance("leaves", text="Quetzal onboarding", start=205, via="leaves")]:
        repository.save_utterance(entry)
    seen = []
    def model(context):
        seen.append(context)
        return Suggestions(words=["payroll"], phrases=["Could we clarify?"])
    monkeypatch.setattr(leaves_suggest, "suggest_from_context", model)
    result = function_handlers()["suggest"](request({"meetingId": "meeting-a", "recentText": "Supplement"}))
    assert result.status_code == 200
    assert "Review payroll" in seen[0] and "Quetzal onboarding" in seen[0] and "Supplement" in seen[0]
    assert "OLD-SECRET" not in seen[0] and "OTHER-SECRET" not in seen[0]


def test_arbitrary_spelling_is_preview_only(repository):
    result = function_handlers()["compose"](request({
        "meetingId": "meeting-a", "picked": ["I'll", "review", "Quetzal-X9", "résumé", "東京", "by Friday."]}))
    assert result.status_code == 200
    assert payload(result)["sentence"] == "I'll review Quetzal-X9 résumé 東京 by Friday."
    assert repository.list_utterances("meeting-a") == []


def test_confirmed_playback_record_retries_use_existing_utterance_route(repository):
    record = utterance(text="I will review Quetzal-X9", via="leaves")
    handler = function_handlers()["save_utterance"]
    for _ in range(2):
        assert handler(request(record.model_dump(mode="json"))).status_code == 200
    assert repository.list_utterances("meeting-a") == [record]
    assert repository.list_utterances("meeting-b") == []


def test_leaves_first_extraction_preserves_account_for_retry_and_later_transcript(repository):
    record = utterance(text="I will review Quetzal-X9", via="leaves")
    item = {"key": "review", "kind": "commitment", "text": "Review Quetzal-X9",
            "owner": "Alex", "deadline": None, "deadlineEvidence": None,
            "utteranceIds": [record.id], "dependsOn": []}
    first = extract_and_save(repository, record.meetingId, [record], lambda _: [item],
                             account_id="client-account")
    retry = extract_and_save(repository, record.meetingId, [record], lambda _: [item],
                             account_id="client-account")
    assert retry.seeds[0].id == first.seeds[0].id
    assert first.seeds[0].accountId == "client-account"
    assert first.seeds[0].sourceType == "leaves"
    assert repository.list_utterances(record.meetingId) == [record]
    later = utterance("voice-later", text="Thanks, Alex.", start=210)
    extract_and_save(repository, later.meetingId, [later], lambda _: [], account_id="client-account")
    assert repository.get_source(record.meetingId, record.meetingId).accountId == "client-account"
    assert len(repository.list_account_seeds("client-account")) == 1


@pytest.mark.parametrize("failure,status", [(ModelNotConfigured("Missing model settings"), 503),
                                         (ModelFailed("sensitive upstream data"), 502)])
def test_suggestions_explicit_service_failures(repository, monkeypatch, failure, status):
    def fail(_):
        raise failure
    monkeypatch.setattr(leaves_suggest, "suggest_from_context", fail)
    response = function_handlers()["suggest"](request({"meetingId": "meeting-a", "recentText": ""}))
    assert response.status_code == status
    assert "sensitive" not in response.get_body().decode()


def test_compose_rejects_blank_or_oversize_preview():
    handler = function_handlers()["compose"]
    for picked in [[], ["  "], ["a" * 20000, "b"]]:
        assert handler(request({"meetingId": "a", "picked": picked})).status_code == 400


def test_suggestions_use_shared_reasoning_model_helper(monkeypatch):
    calls = []
    expected = {"words": ["I", "can", "review", "payroll", "please", "clarify"],
                "phrases": ["Could you clarify?", "I can review.", "Please continue."]}
    def complete(messages, **options):
        calls.append((messages, options))
        return expected
    monkeypatch.setattr(suggestion_service, "complete_json", complete)
    assert suggestion_service.suggest_from_context("Alex: review payroll").model_dump() == expected
    messages, options = calls[0]
    assert "Alex: review payroll" in messages[1]["content"]
    assert options["reasoning_effort"] == "minimal"
    assert options["schema_name"] == "leaves_suggestions"
    assert "max_tokens" not in options and "temperature" not in options
