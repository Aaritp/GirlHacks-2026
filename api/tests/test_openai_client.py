import json
import logging
from types import SimpleNamespace

import openai
import pytest

from shared import openai_client
from shared.openai_client import ModelFailed, ModelNotConfigured, complete_json, complete_text
from shared.sdk_logging import SDK_LOGGERS, quiet_sdk_loggers

MESSAGES = [{"role": "user", "content": "hi"}]


@pytest.fixture
def fake_openai(monkeypatch):
    """Records what would be sent to Azure OpenAI and returns a configurable reply."""
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.openai.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "secret")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-5-mini")
    state = {"sent": None, "client": None, "reply": "hello", "finish": "stop", "error": None}

    class FakeCompletions:
        def create(self, **kwargs):
            state["sent"] = kwargs
            if state["error"]:
                raise state["error"]
            message = SimpleNamespace(content=state["reply"])
            return SimpleNamespace(choices=[SimpleNamespace(finish_reason=state["finish"], message=message)])

    class FakeClient:
        def __init__(self, **kwargs):
            state["client"] = kwargs
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setattr(openai, "OpenAI", FakeClient)
    return state


def test_text_call_sends_only_reasoning_model_parameters(fake_openai):
    assert complete_text(MESSAGES, reasoning_effort="minimal", max_completion_tokens=2000) == "hello"
    assert fake_openai["sent"] == {"model": "gpt-5-mini", "messages": MESSAGES,
                                   "reasoning_effort": "minimal", "max_completion_tokens": 2000}
    assert fake_openai["client"]["base_url"] == "https://example.openai.azure.com/openai/v1/"


def test_json_call_uses_strict_schema_and_omits_unset_cap(fake_openai):
    fake_openai["reply"] = json.dumps({"words": ["yes"]})
    schema = {"type": "object", "additionalProperties": False, "required": ["words"],
              "properties": {"words": {"type": "array", "items": {"type": "string"}}}}
    result = complete_json(MESSAGES, schema_name="suggestions", schema=schema, reasoning_effort="low",
                           deployment="other-deployment")
    assert result == {"words": ["yes"]}
    sent = fake_openai["sent"]
    assert sent["model"] == "other-deployment"
    assert sent["response_format"]["json_schema"] == {"name": "suggestions", "strict": True, "schema": schema}
    assert not {"temperature", "top_p", "max_tokens", "max_completion_tokens"} & set(sent)


def test_truncation_by_reasoning_tokens_is_a_failure(fake_openai):
    fake_openai["finish"] = "length"
    with pytest.raises(ModelFailed, match="reasoning tokens"):
        complete_text(MESSAGES, reasoning_effort="minimal", max_completion_tokens=50)


@pytest.mark.parametrize("reply", ["not json", "[1, 2]"])
def test_unusable_json_is_a_failure(fake_openai, reply):
    fake_openai["reply"] = reply
    with pytest.raises(ModelFailed):
        complete_json(MESSAGES, schema_name="x", schema={}, reasoning_effort="low")


def test_service_errors_and_empty_replies_are_failures(fake_openai):
    fake_openai["error"] = openai.APITimeoutError(request=None)
    with pytest.raises(ModelFailed, match="APITimeoutError"):
        complete_text(MESSAGES, reasoning_effort="low")
    fake_openai["error"] = None
    fake_openai["reply"] = ""
    with pytest.raises(ModelFailed):
        complete_text(MESSAGES, reasoning_effort="low")


@pytest.mark.parametrize("kwargs", [{"reasoning_effort": "extreme"},
                                    {"reasoning_effort": "low", "max_completion_tokens": 0}])
def test_invalid_arguments_are_rejected_before_calling(fake_openai, kwargs):
    with pytest.raises(ValueError):
        complete_text(MESSAGES, **kwargs)
    assert fake_openai["sent"] is None


def test_missing_settings_name_variables_not_values(monkeypatch):
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "secret")
    monkeypatch.delenv("AZURE_OPENAI_ENDPOINT", raising=False)
    monkeypatch.delenv("AZURE_OPENAI_DEPLOYMENT", raising=False)
    with pytest.raises(ModelNotConfigured) as error:
        openai_client.openai_settings()
    assert str(error.value) == "Azure OpenAI is missing: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT."


def test_sdk_loggers_are_quiet_by_default_and_overridable(monkeypatch):
    monkeypatch.delenv("GROVEKEEPER_SDK_LOG_LEVEL", raising=False)
    quiet_sdk_loggers()
    assert all(logging.getLogger(name).level == logging.WARNING for name in SDK_LOGGERS)
    assert logging.getLogger("azure.core.pipeline.policies.http_logging_policy").getEffectiveLevel() == logging.WARNING
    assert logging.getLogger("azure_functions_worker").level == logging.NOTSET
    monkeypatch.setenv("GROVEKEEPER_SDK_LOG_LEVEL", "debug")
    quiet_sdk_loggers()
    assert logging.getLogger("azure").level == logging.DEBUG
    monkeypatch.delenv("GROVEKEEPER_SDK_LOG_LEVEL")
    quiet_sdk_loggers()
