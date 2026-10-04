"""The demo dataset (scripts/seed_demo_data.py) must load cleanly through the real ingest path."""
import importlib.util
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from ingest.contracts import IngestRequest
from ingest.service import ingest, parse_messages
from shared.models import Account
from shared.store import MemoryStore

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "seed_demo_data.py"
spec = importlib.util.spec_from_file_location("seed_demo_data", SCRIPT)
demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo)

TODAY = date(2026, 10, 4)
SOURCES = demo.sources(TODAY)


def cite_every_chunk(window):
    """Stand-in for Azure OpenAI: one commitment per chunk, citing it, owned by its author."""
    return [{"key": u["id"], "kind": "commitment", "text": u["text"][:80], "owner": u["speaker"],
             "deadline": None, "deadlineEvidence": None, "utteranceIds": [u["id"]], "dependsOn": []}
            for u in window["utterances"]]


def request(account_id, kind, title, occurred, text):
    return IngestRequest(accountId=account_id, sourceType=kind, title=title, text=text, occurredAt=occurred)


def test_shape_matches_the_plan():
    assert {a["name"] for a in demo.ACCOUNTS} == {"Contoso Ltd", "Fabrikam Inc", "Northwind Logistics"}
    for account in demo.ACCOUNTS:
        Account.model_validate(account)
        kinds = sorted(kind for account_id, kind, *_ in SOURCES if account_id == account["id"])
        assert kinds == ["chat", "document", "email", "email"]


def test_every_source_is_a_valid_ingest_request_and_parses_into_messages():
    for source in SOURCES:
        parsed = request(*source)
        messages = parse_messages(parsed.sourceType, parsed.text)
        assert messages, source[2]
        if parsed.sourceType in ("email", "chat"):
            # Authors are clean names, so owners can be people rather than raw headers.
            assert all("@" not in m.author and "<" not in m.author for m in messages), source[2]


def test_payroll_interest_is_in_contoso_and_fabrikam_but_not_northwind():
    text = {account["id"]: " ".join(s[4] for s in SOURCES if s[0] == account["id"]).lower() for account in demo.ACCOUNTS}
    assert "payroll integration" in text["acct-contoso"]
    assert "payroll integration" in text["acct-fabrikam"]
    assert "payroll integration" not in text["acct-northwind"]


def test_contoso_has_several_sources_last_month_and_nothing_is_dated_in_the_future():
    last_month = [s for s in SOURCES if s[0] == "acct-contoso" and s[3].month == 9]
    assert len(last_month) >= 3
    end_of_today = datetime.combine(TODAY, datetime.max.time(), tzinfo=timezone.utc)
    assert all(s[3] <= end_of_today for s in SOURCES)


@pytest.mark.parametrize("today", [date(2026, 10, 1), date(2026, 3, 31), date(2027, 1, 15)])
def test_dates_stay_valid_on_any_run_day(today):
    for account_id, kind, title, occurred, text in demo.sources(today):
        first_of_last_month = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
        assert first_of_last_month <= occurred.date() <= today, title


def test_full_dataset_ingests_with_accounts_dates_and_no_duplicates_on_rerun():
    store = MemoryStore()
    for account in demo.ACCOUNTS:
        store.create_account(Account.model_validate(account))
    for source in SOURCES:
        result = ingest(store, request(*source), model=cite_every_chunk)
        assert result["seeds"], source[2]
        assert {seed["accountId"] for seed in result["seeds"]} == {source[0]}
        assert result["source"]["createdAt"].startswith(source[3].date().isoformat())
    totals = {account["id"]: len(store.list_account_seeds(account["id"])) for account in demo.ACCOUNTS}
    for source in SOURCES:
        ingest(store, request(*source), model=lambda window: pytest.fail("re-run must reuse the first extraction"))
    assert {account["id"]: len(store.list_account_seeds(account["id"])) for account in demo.ACCOUNTS} == totals
    assert {s.type for s in store.list_account_sources("acct-contoso")} == {"email", "document", "chat"}


def test_ingest_rejects_a_future_occurred_at():
    account_id, kind, title, _, text = SOURCES[0]
    with pytest.raises(ValueError):
        request(account_id, kind, title, datetime.now(timezone.utc) + timedelta(days=1), text)
