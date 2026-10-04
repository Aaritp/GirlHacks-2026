import base64
import io

import pytest
from PIL import Image

from conftest import function_handlers
from fake_cosmos import FakeDatabase
from shared.cosmos import CosmosStore
from shared.store import MemoryStore, use_store
from test_foundation import payload, request
from whiteboard import service


def image_data():
    stream = io.BytesIO()
    Image.new("RGB", (100, 100), "white").save(stream, format="PNG")
    return base64.b64encode(stream.getvalue()).decode()


@pytest.fixture(params=["memory", "cosmos"])
def repository(request):
    store = MemoryStore() if request.param == "memory" else CosmosStore(FakeDatabase())
    use_store(store)
    yield store
    use_store(None)


@pytest.fixture
def services(monkeypatch):
    monkeypatch.setattr(service, "service_settings", lambda: ("https://vision.example", "test", "test"))
    monkeypatch.setattr(service, "model_settings", lambda: ("https://model.example", "test", "test"))
    monkeypatch.setattr(service, "upload_image",
        lambda data, mime, meeting, source, connection: f"https://blob.example/private/{source}.png")
    monkeypatch.setattr(service, "read_ocr", lambda *args: "Alex will send the payroll checklist.")
    calls = []
    def model(window):
        calls.append(window)
        return [{"key": "1", "kind": "commitment", "text": "Send the payroll checklist", "owner": "Alex",
                 "deadline": None, "utteranceIds": [window["utterances"][0]["id"]], "dependsOn": []}]
    monkeypatch.setattr(service, "call_model", model)
    return calls


def test_whiteboard_to_saved_seed_and_retry(repository, services):
    handler = function_handlers()["whiteboard"]
    body = {"meetingId": "a", "imageBase64": image_data()}
    first = handler(request(body))
    second = handler(request(body))
    assert first.status_code == second.status_code == 200
    seeds = payload(first)["seeds"]
    assert seeds == payload(second)["seeds"]
    assert len(seeds) == 1
    seed = repository.get_grove("a").seeds[0]
    assert seed.sourceType == "whiteboard" and seed.timestampSec is None and seed.owner == "Alex"
    source = repository.get_source("a", seed.sourceId)
    assert source.type == "whiteboard" and source.blobUrl.startswith("https://blob.example/private/")
    assert repository.list_utterances("a") == []  # OCR is never spoken credit.
    assert repository.get_grove("b").seeds == []
    assert len(services) == 2  # Real shared pipeline invoked; seed deduplication survives retries.


def test_ocr_failure_keeps_source_for_safe_retry_but_no_seeds(repository, services, monkeypatch):
    def fail(*args):
        raise service.WhiteboardFailed("sensitive Azure error")
    monkeypatch.setattr(service, "read_ocr", fail)
    result = function_handlers()["whiteboard"](request({"meetingId": "a", "imageBase64": image_data()}))
    assert result.status_code == 502 and "sensitive" not in result.get_body().decode()
    assert repository.get_grove("a").seeds == []
    assert repository.list_utterances("a") == []


def test_no_text_no_fabricated_seed(repository, services, monkeypatch):
    monkeypatch.setattr(service, "read_ocr", lambda *args: "")
    result = service.process_whiteboard(repository, "a", image_data())
    assert result.seeds == [] and services == []


def test_same_image_in_different_meetings_has_partitioned_provenance(repository, services):
    first = service.process_whiteboard(repository, "a", image_data()).seeds[0]
    second = service.process_whiteboard(repository, "b", image_data()).seeds[0]
    assert first.id != second.id
    assert repository.get_source("a", first.sourceId).meetingId == "a"
    assert repository.get_source("b", second.sourceId).meetingId == "b"


@pytest.mark.parametrize("encoded", ["not base64!", base64.b64encode(b"not an image").decode(),
                                   "data:image/png;base64,AAAA"])
def test_invalid_image_is_400_before_services_or_storage(encoded):
    result = function_handlers()["whiteboard"](request({"meetingId": "a", "imageBase64": encoded}))
    assert result.status_code == 400


def test_missing_configuration_is_explicit(repository, monkeypatch):
    for name in ("AZURE_VISION_ENDPOINT", "AZURE_VISION_KEY", "AZURE_STORAGE_CONNECTION_STRING"):
        monkeypatch.delenv(name, raising=False)
    result = function_handlers()["whiteboard"](request({"meetingId": "a", "imageBase64": image_data()}))
    assert result.status_code == 503
    assert payload(result)["error"]["code"] == "SERVICE_NOT_CONFIGURED"


def test_vision_wire_request_uses_bytes_and_extracts_lines(monkeypatch):
    seen = []
    class Response(io.BytesIO):
        pass
    def send(req, timeout):
        seen.append(req)
        return Response(b'{"readResult":{"blocks":[{"lines":[{"text":"Payroll"},{"text":"checklist"}]}]}}')
    monkeypatch.setattr(service.urllib.request, "urlopen", send)
    assert service.read_ocr(b"image", "https://vision.example", "server-key") == "Payroll\nchecklist"
    assert seen[0].data == b"image" and "features=read" in seen[0].full_url
