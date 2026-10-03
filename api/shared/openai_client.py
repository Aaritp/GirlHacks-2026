"""Azure OpenAI calls for reasoning-model deployments (e.g. gpt-5-mini), shared by all owners.

Reasoning models reject `temperature`, `top_p` and `max_tokens`; this helper never sends them.
Use `reasoning_effort` to trade quality for latency and `max_completion_tokens` to cap cost.
Note that `max_completion_tokens` counts hidden reasoning tokens too: set it generously or
leave it None, otherwise the model can stop before writing any answer (raised as ModelFailed).

    from shared.openai_client import ModelFailed, ModelNotConfigured, complete_json, complete_text

    words = complete_json(messages, schema_name="suggestions", schema=SCHEMA,
                          reasoning_effort="minimal", max_completion_tokens=2000)

Callers map ModelNotConfigured -> 503 SERVICE_NOT_CONFIGURED and ModelFailed -> 502
UPSTREAM_ERROR. Never substitute canned output when either is raised.
"""
import json
import os
from typing import Literal

ReasoningEffort = Literal["minimal", "low", "medium", "high"]
EFFORTS = ("minimal", "low", "medium", "high")
DEFAULT_TIMEOUT_SEC = 90


class ModelNotConfigured(Exception):
    """Required AZURE_OPENAI_* settings are missing. The message names them, never their values."""


class ModelFailed(Exception):
    """The service errored, timed out, stopped early, or returned unusable output."""


def openai_settings(deployment: str | None = None):
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip().rstrip("/")
    key = os.getenv("AZURE_OPENAI_API_KEY", "").strip()
    deployment = (deployment or os.getenv("AZURE_OPENAI_DEPLOYMENT", "")).strip()
    missing = [name for name, value in (("AZURE_OPENAI_ENDPOINT", endpoint), ("AZURE_OPENAI_API_KEY", key),
                                        ("AZURE_OPENAI_DEPLOYMENT", deployment)) if not value]
    if missing:
        raise ModelNotConfigured(f"Azure OpenAI is missing: {', '.join(missing)}.")
    return endpoint, key, deployment


def _complete(messages: list[dict], *, reasoning_effort: ReasoningEffort, max_completion_tokens: int | None,
              response_format: dict | None, deployment: str | None, timeout: float) -> str:
    if reasoning_effort not in EFFORTS:
        raise ValueError(f"reasoning_effort must be one of {', '.join(EFFORTS)}")
    if max_completion_tokens is not None and max_completion_tokens < 1:
        raise ValueError("max_completion_tokens must be positive")
    endpoint, key, deployment = openai_settings(deployment)
    from openai import OpenAI, OpenAIError
    client = OpenAI(base_url=f"{endpoint}/openai/v1/", api_key=key, timeout=timeout, max_retries=1)
    options = {"model": deployment, "messages": messages, "reasoning_effort": reasoning_effort}
    if max_completion_tokens is not None:
        options["max_completion_tokens"] = max_completion_tokens
    if response_format is not None:
        options["response_format"] = response_format
    try:
        completion = client.chat.completions.create(**options)
        choice = completion.choices[0]
    except OpenAIError as exc:
        raise ModelFailed(type(exc).__name__) from exc
    except (AttributeError, IndexError) as exc:
        raise ModelFailed("Model returned no choices") from exc
    if choice.finish_reason == "length":
        raise ModelFailed("Model hit max_completion_tokens before finishing (reasoning tokens count too)")
    if choice.finish_reason != "stop" or not choice.message.content:
        raise ModelFailed(f"Model did not complete (finish_reason={choice.finish_reason})")
    return choice.message.content


def complete_text(messages: list[dict], *, reasoning_effort: ReasoningEffort,
                  max_completion_tokens: int | None = None, deployment: str | None = None,
                  timeout: float = DEFAULT_TIMEOUT_SEC) -> str:
    """Returns the assistant's text."""
    return _complete(messages, reasoning_effort=reasoning_effort, max_completion_tokens=max_completion_tokens,
                     response_format=None, deployment=deployment, timeout=timeout)


def complete_json(messages: list[dict], *, schema_name: str, schema: dict, reasoning_effort: ReasoningEffort,
                  max_completion_tokens: int | None = None, deployment: str | None = None,
                  timeout: float = DEFAULT_TIMEOUT_SEC) -> dict:
    """Returns the parsed object for a strict JSON schema (structured outputs)."""
    response_format = {"type": "json_schema", "json_schema": {"name": schema_name, "strict": True, "schema": schema}}
    content = _complete(messages, reasoning_effort=reasoning_effort, max_completion_tokens=max_completion_tokens,
                        response_format=response_format, deployment=deployment, timeout=timeout)
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ModelFailed("Model returned malformed JSON") from exc
    if not isinstance(parsed, dict):
        raise ModelFailed("Model returned JSON that is not an object")
    return parsed
