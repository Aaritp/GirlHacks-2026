import base64
import json
from io import BytesIO
from unittest.mock import Mock
from urllib.error import HTTPError
import pytest
from pydantic import ValidationError
from pypdf import PdfWriter
from ingest.contracts import FeatureError, IngestRequest, SlackSyncRequest
from ingest.service import ingest, account_partition, parse_messages
from ingest.documents import read_document
from slack_sync import sync
from slack_sync.client import SlackClient
from followup import draft_followup
from shared.store import MemoryStore, StorageUnavailable
from shared.cosmos import CosmosStore
from shared.models import SeedPatch
from fake_cosmos import FakeDatabase

@pytest.fixture(params=["memory", "cosmos"])
def store(request):
    backend = MemoryStore() if request.param == "memory" else CosmosStore(FakeDatabase())
    # Pending Prisha account interface, injected into the EXISTING shared store.
    backend.get_account = lambda account_id: {"id": account_id, "name": account_id} if account_id in ("contoso", "fabrikam") else None
    backend.list_account_seeds = lambda account_id: backend.list_seeds(account_partition(account_id))
    backend.list_account_sources = lambda account_id: backend.list_sources(account_partition(account_id))
    return backend

def model(window):
    return [{"key": str(index), "kind": "risk" if "risk" in item["text"] else "customer_need" if "interest" in item["text"] else "commitment",
             "text": item["text"][:100], "owner": item["speaker"], "deadline": None,
             "deadlineEvidence": None, "utteranceIds": [item["id"]], "dependsOn": []}
            for index, item in enumerate(window["utterances"])]

def request(account="contoso", text="I will send the checklist."):
    return IngestRequest(accountId=account, sourceType="email", title="Follow-up",
                         text="From: Alex\nTo: Sam\nDate: 2026-10-03\n\n" + text)

def test_ingest_provenance_replay_and_account_isolation(store):
    ai = Mock(side_effect=model)
    first = ingest(store, request(text="I will send the checklist. There is a risk of delay."), ai)
    seed = first["seeds"][0]
    assert seed["kind"] == "risk"
    assert seed["owner"] == "Alex"
    assert seed["accountId"] == "contoso"
    assert seed["quote"] in first["source"]["text"]
    assert seed["sourceType"] == "email" and seed["timestampSec"] is None
    assert first["source"]["messages"][0]["recipients"] == ["Sam"]
    assert first["source"]["messages"][0]["timestamp"] == "2026-10-03"
    store.patch_seed(seed["meetingId"], seed["id"], SeedPatch(status="bloom"))
    again = ingest(store, request(text="I will send the checklist. There is a risk of delay."), ai)
    assert again["seeds"][0]["status"] == "bloom"
    assert ai.call_count == 1
    other = ingest(store, request("fabrikam"), ai)
    assert other["source"]["meetingId"] != first["source"]["meetingId"]

def test_partial_write_retry_reuses_saved_model_plan(store, monkeypatch):
    original = store.create_seed
    ai = Mock(side_effect=model)
    def broken(seed):
        raise StorageUnavailable("offline")
    monkeypatch.setattr(store, "create_seed", broken)
    with pytest.raises(StorageUnavailable):
        ingest(store, request(), ai)
    monkeypatch.setattr(store, "create_seed", original)
    result = ingest(store, request(), ai)
    assert len(result["seeds"]) == 1 and ai.call_count == 1

def test_unknown_account_and_missing_foundation_fail_closed(store):
    with pytest.raises(FeatureError) as exc:
        ingest(store, request("missing"), model)
    assert exc.value.status == 404
    with pytest.raises(FeatureError) as exc:
        ingest(MemoryStore(), request(), model)
    assert exc.value.code == "ACCOUNT_FOUNDATION_PENDING"

def test_chat_metadata_and_validation():
    messages = parse_messages("chat", "[2026-10-03T12:00:00Z] Alex: I'll send it.\nMore details\n[2026-10-03T13:00:00Z] Sam: Thanks")
    assert messages[0].author == "Alex" and messages[0].timestamp == "2026-10-03T12:00:00Z"
    assert "More details" in messages[0].text
    for bad in ({"text": " "}, {"text": "x" * 100001}, {"text": "ok", "fileBase64": "AA=="}):
        with pytest.raises(ValidationError):
            IngestRequest(accountId="contoso", sourceType="email", title="Mail", **bad)

def test_document_uploads():
    assert read_document("notes.md", base64.b64encode(b"# Meeting\nAlex will send it").decode()).startswith("# Meeting")
    for name, encoded, code in [
        ("a.exe", "YQ==", "UNSUPPORTED_FILE"), ("a.txt", "bad", "INVALID_FILE"),
        ("a.txt", "", "EMPTY_DOCUMENT"), ("a.txt", "/w==", "INVALID_FILE"),
        ("a.txt", base64.b64encode(b"a" * 100001).decode(), "TEXT_TOO_LARGE"),
        ("a.pdf", "YQ==", "INVALID_PDF"),
    ]:
        with pytest.raises(FeatureError) as exc:
            read_document(name, encoded)
        assert exc.value.code == code
    writer = PdfWriter(); writer.add_blank_page(width=200, height=200)
    output = BytesIO(); writer.write(output)
    with pytest.raises(FeatureError) as exc:
        read_document("scan.pdf", base64.b64encode(output.getvalue()).decode())
    assert exc.value.code == "SCANNED_PDF"
    writer.encrypt("password"); output = BytesIO(); writer.write(output)
    with pytest.raises(FeatureError) as exc:
        read_document("locked.pdf", base64.b64encode(output.getvalue()).decode())
    assert exc.value.code == "ENCRYPTED_PDF"

def test_real_text_pdf():
    from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
    writer = PdfWriter(); page = writer.add_blank_page(width=300, height=300)
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"),
                             NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
    stream = DecodedStreamObject(); stream.set_data(b"BT /F1 12 Tf 10 200 Td (Send the payroll checklist.) Tj ET")
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = BytesIO(); writer.write(output)
    assert "Send the payroll checklist." in read_document("text.pdf", base64.b64encode(output.getvalue()).decode())

class FakeSlack:
    def history(self, channel, oldest, latest):
        return [{"ts": "1791028800.000001", "user": "U123", "text": "I will send the checklist."},
                {"ts": "1791028801.000001", "user": "U123", "text": "There is a risk of delay."}]
    def user_name(self, user):
        return "Alex"

def test_slack_retry_checkpoint_and_binding(store):
    req = SlackSyncRequest(accountId="contoso", channelId="C123456")
    calls = 0
    def failing(backend, body, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise StorageUnavailable("failed second import")
        return ingest(backend, body, model, **kwargs)
    with pytest.raises(StorageUnavailable):
        sync(store, req, FakeSlack(), failing)
    assert not any(s.recordType == "slack_checkpoint" for s in store.list_sources(account_partition("contoso")))
    result = sync(store, req, FakeSlack(), lambda backend, body, **kwargs: ingest(backend, body, model, **kwargs))
    assert result["importedMessages"] == 2
    assert len(store.list_seeds(account_partition("contoso"))) == 2
    again = sync(store, req, FakeSlack())
    assert again["importedMessages"] == 0
    with pytest.raises(FeatureError) as exc:
        sync(store, SlackSyncRequest(accountId="fabrikam", channelId="C123456"), FakeSlack())
    assert exc.value.status == 409

def test_slack_pagination_rate_limit_and_redaction():
    client = SlackClient("secret", opener=Mock(side_effect=HTTPError("https://slack.com", 429, "limit", {"Retry-After": "5"}, None)))
    with pytest.raises(FeatureError) as exc:
        client.call("conversations.history")
    assert exc.value.status == 429 and exc.value.retry_after == 5 and "secret" not in str(exc.value)
    client.call = Mock(side_effect=[
        {"messages": [{"ts": "2.000001"}], "response_metadata": {"next_cursor": "next"}},
        {"messages": [{"ts": "1.000001"}], "response_metadata": {"next_cursor": ""}}])
    assert len(client.history("C123456", "0", "3.000001")) == 2
    assert client.call.call_args_list[1].kwargs["cursor"] == "next"
    client.call = Mock(return_value={"messages": [], "has_more": True})
    with pytest.raises(FeatureError):
        client.history("C123456", "0", "3.000001")

def test_followup_uses_account_context_and_shared_helper(store):
    ingest(store, request(), model)
    ingest(store, request("fabrikam", "Confidential Fabrikam task"), model)
    complete = Mock(return_value="Subject: Follow-up\n\nHello Alex, please review the checklist.")
    result = draft_followup(store, "contoso", complete)
    assert result["subject"] == "Follow-up"
    assert complete.call_args.kwargs == {"reasoning_effort": "low"}
    context = complete.call_args.args[0][1]["content"]
    assert "checklist" in context and "Confidential Fabrikam task" not in context
    from shared.openai_client import ModelFailed
    with pytest.raises(ModelFailed):
        draft_followup(store, "contoso", lambda *args, **kwargs: "Malformed output")

def test_registered_ingest_endpoint_and_service_errors(store, monkeypatch):
    import azure.functions as func
    import ingest as routes
    from conftest import indexed_functions
    from shared.store import use_store
    from shared.openai_client import ModelFailed
    handlers = {f.get_function_name(): f.get_user_function() for f in indexed_functions()}
    def http(body):
        return func.HttpRequest(method="POST", url="http://localhost/api/ingest", params={},
            headers={"Content-Type": "application/json"}, body=json.dumps(body).encode())
    use_store(store)
    try:
        monkeypatch.setattr(routes, "ingest", lambda backend, body: ingest(backend, body, model))
        response = handlers["ingest_source"](http(request().model_dump()))
        assert response.status_code == 200
        payload = json.loads(response.get_body())
        # Fresh store reads restore saved seed/source; not just an optimistic UI result.
        saved = store.get_seed(payload["source"]["meetingId"], payload["seeds"][0]["id"])
        assert saved.sourceId == payload["source"]["id"] and saved.accountId == "contoso"
        assert handlers["ingest_source"](http({"accountId": "contoso"})).status_code == 400
        def fail(*args):
            raise ModelFailed("sensitive text must not escape")
        monkeypatch.setattr(routes, "ingest", fail)
        response = handlers["ingest_source"](http(request().model_dump()))
        assert response.status_code == 502 and b"sensitive" not in response.get_body()
    finally:
        use_store(None)

def test_slack_display_name_change_does_not_duplicate_replayed_messages(store):
    from ingest.contracts import Message
    request = IngestRequest(accountId="contoso", sourceType="slack", title="Channel message",
        messages=[Message(author="Alex", text="I will send the checklist.", externalId="C123456:1.000001")])
    first = ingest(store, request, model)
    request.messages[0].author = "Alex Smith"
    second = ingest(store, request, model)
    assert second["seeds"][0]["id"] == first["seeds"][0]["id"]
    assert len(store.list_seeds(account_partition("contoso"))) == 1

def test_source_plan_survives_concurrent_create_conflict(store, monkeypatch):
    original = store.create_source
    def racing(source):
        original(source)
        return None
    monkeypatch.setattr(store, "create_source", racing)
    assert len(ingest(store, request(), model)["seeds"]) == 1

def test_empty_extraction_is_saved_and_not_retried(store):
    empty = Mock(return_value=[])
    result = ingest(store, request(), empty)
    assert result["seeds"] == []
    ingest(store, request(), empty)
    assert empty.call_count == 1
