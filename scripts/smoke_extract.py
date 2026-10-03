"""Smoke test: one real /api/extract call through the local Functions host.

Checks Azure OpenAI extraction and storage (Cosmos when configured) end to end.
Start the API first (`cd api && func start`), then from the repository root:

    python3 scripts/smoke_extract.py [--base-url http://localhost:7071/api]

It never reads or prints keys: the Functions host holds them. Only the storage mode
is read from api/local.settings.json so the output says where seeds were saved.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SETTINGS = Path(__file__).resolve().parents[1] / "api" / "local.settings.json"


def storage_mode():
    try:
        values = json.loads(SETTINGS.read_text()).get("Values", {})
    except (OSError, ValueError):
        return "unknown (api/local.settings.json not readable)"
    mode = (values.get("GROVEKEEPER_STORAGE_MODE") or "").strip()
    if not mode:
        mode = "cosmos (endpoint set)" if (values.get("AZURE_COSMOS_ENDPOINT") or "").strip() else "not configured"
    return mode


def call(method, url, body=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read() or b"null")
        except ValueError:
            payload = None
        return exc.code, payload


def fail(step, status, payload):
    error = (payload or {}).get("error", {}) if isinstance(payload, dict) else {}
    print(f"\n✗ {step} failed: HTTP {status} {error.get('code', '')}")
    if error.get("message"):
        print(f"  {error['message']}")
    hints = {
        "SERVICE_NOT_CONFIGURED": "Fill in the AZURE_OPENAI_* values in api/local.settings.json and restart func.",
        "STORAGE_NOT_CONFIGURED": "Set GROVEKEEPER_STORAGE_MODE and Cosmos values, then restart func.",
        "STORAGE_UNAVAILABLE": "Cosmos rejected the request: check endpoint, key, firewall/network access.",
        "UPSTREAM_ERROR": "Azure OpenAI failed: check endpoint, key, deployment name, quota. See func logs.",
    }
    if error.get("code") in hints:
        print(f"  Hint: {hints[error['code']]}")
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-url", default="http://localhost:7071/api")
    base = parser.parse_args().base_url.rstrip("/")

    meeting = f"smoke-{int(time.time())}"
    lines = [
        ("Alex", 3, "Thanks everyone. Let's go over the onboarding plan for Contoso."),
        ("Alex", 11, "I'll send the payroll integration checklist by October 10."),
        ("Sam", 22, "Once that's ready I'll schedule the onboarding review with their HR team."),
        ("Jordan", 34, "We decided to start with the pilot group of fifty employees."),
        ("Sam", 47, "Someone should probably look at the billing export at some point."),
    ]
    utterances = [{"id": f"{meeting}-u{i}", "meetingId": meeting, "speaker": speaker, "text": text,
                   "startSec": start, "via": "voice"} for i, (speaker, start, text) in enumerate(lines, 1)]

    print(f"API:          {base}")
    print(f"Storage mode: {storage_mode()}")
    print(f"Meeting:      {meeting}")
    print("Calling /extract (reasoning models can take 10-60 s)…")

    started = time.time()
    try:
        status, result = call("POST", f"{base}/extract", {"meetingId": meeting, "utterances": utterances})
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"\n✗ Could not reach {base}: {getattr(exc, 'reason', exc)}. Is `func start` running in api/?")
        sys.exit(1)
    if status != 200:
        fail("Extraction", status, result)

    seeds, roots = result["seeds"], result["roots"]
    print(f"✓ Extracted {len(seeds)} seed(s), {len(roots)} root(s) in {time.time() - started:.1f} s\n")
    for seed in seeds:
        print(f"- [{seed['kind']}] {seed['text']}")
        print(f"    owner={seed['owner']!r}  deadline={seed['deadline']!r}  at={seed['timestampSec']}s  id={seed['id']}")
    for root in roots:
        print(f"- root: {root['fromSeedId']} {root['type']} {root['toSeedId']}")

    # Read back through storage to confirm the seeds were persisted, not just returned.
    status, grove = call("GET", f"{base}/meetings/{meeting}/grove")
    if status != 200:
        fail("Reading the grove back", status, grove)
    saved = {seed["id"] for seed in grove["seeds"]}
    missing = [seed["id"] for seed in seeds if seed["id"] not in saved]
    if missing:
        print(f"\n✗ {len(missing)} extracted seed(s) were not found in storage: {missing}")
        sys.exit(1)
    print(f"\n✓ All {len(seeds)} seed(s) read back from storage ({storage_mode()}).")
    if not seeds:
        print("  Note: zero seeds means the call worked but the model found nothing; expected 3–4.")


if __name__ == "__main__":
    main()
