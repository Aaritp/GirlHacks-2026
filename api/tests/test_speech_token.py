import io
import json
import urllib.error

import azure.functions as func
import pytest

import speech_token
from conftest import function_handlers

HANDLER = function_handlers()["speech_token"]


def call():
    return HANDLER(func.HttpRequest(method="POST", url="http://localhost/api/speech-token", body=b""))


@pytest.fixture
def speech_env(monkeypatch):
    monkeypatch.setenv("AZURE_SPEECH_KEY", "super-secret-key")
    monkeypatch.setenv("AZURE_SPEECH_REGION", "eastus")
    monkeypatch.delenv("AZURE_SPEECH_ENDPOINT", raising=False)
    return monkeypatch


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def test_missing_configuration_names_settings(monkeypatch):
    monkeypatch.delenv("AZURE_SPEECH_KEY", raising=False)
    monkeypatch.setenv("AZURE_SPEECH_REGION", "eastus")
    response = call()
    assert response.status_code == 503
    error = json.loads(response.get_body())["error"]
    assert error == {"code": "SERVICE_NOT_CONFIGURED", "message": "Azure Speech is missing: AZURE_SPEECH_KEY."}


def test_issues_short_lived_token_without_exposing_key(speech_env):
    seen = {}

    def fake_urlopen(request, timeout):
        seen.update(url=request.full_url, key=request.get_header("Ocp-apim-subscription-key"), timeout=timeout)
        return FakeResponse(b"jwt-token\n")

    speech_env.setattr(speech_token.urllib.request, "urlopen", fake_urlopen)
    response = call()
    assert response.status_code == 200
    assert json.loads(response.get_body()) == {"token": "jwt-token", "region": "eastus"}
    assert response.headers["Cache-Control"] == "no-store"
    assert b"super-secret-key" not in response.get_body()
    assert seen == {"url": "https://eastus.api.cognitive.microsoft.com/sts/v1.0/issueToken",
                    "key": "super-secret-key", "timeout": 10}


def test_custom_endpoint(speech_env):
    speech_env.setenv("AZURE_SPEECH_ENDPOINT", "https://my-speech.cognitiveservices.azure.com/")
    urls = []
    speech_env.setattr(speech_token.urllib.request, "urlopen",
                       lambda request, timeout: urls.append(request.full_url) or FakeResponse(b"t"))
    assert call().status_code == 200
    assert urls == ["https://my-speech.cognitiveservices.azure.com/sts/v1.0/issueToken"]


@pytest.mark.parametrize("failure", [
    urllib.error.HTTPError("u", 401, "Unauthorized", {}, None), urllib.error.URLError("dns"), TimeoutError(),
])
def test_upstream_failures_are_502(speech_env, failure):
    def broken(request, timeout):
        raise failure
    speech_env.setattr(speech_token.urllib.request, "urlopen", broken)
    response = call()
    assert response.status_code == 502
    assert json.loads(response.get_body())["error"]["code"] == "UPSTREAM_ERROR"
    assert b"super-secret-key" not in response.get_body()


def test_empty_token_is_not_success(speech_env):
    speech_env.setattr(speech_token.urllib.request, "urlopen", lambda request, timeout: FakeResponse(b""))
    assert call().status_code == 502
