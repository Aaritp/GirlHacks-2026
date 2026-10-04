"""Ask the Grove: filter, retrieve, answer only from evidence, cite stored records."""
import json
from datetime import datetime, timezone

import azure.functions as func
import pytest

from ask import service
from conftest import function_handlers
from fake_cosmos import FakeDatabase
from shared.cosmos import CosmosStore
from shared.models import Account, AskRequest, Seed, Source, Utterance
from shared.openai_client import ModelFailed
from shared.store import MemoryStore, use_store

HANDLERS = function_handlers()
NOW = datetime(2026, 10, 4, 15, tzinfo=timezone.utc)


def source(sid, account, kind, title, day, text=None, partition=None, **extra):
    return Source.model_validate({"id": sid, "meetingId": partition or f"account-{account}", "type": kind, "title": title,
                                  "createdAt": f"2026-{day}T10:00:00Z", "accountId": account, "text": text, **extra})


def seed(sid, src, kind, text, quote, owner=None, status="sprout", deadline=None, ts=None):
    return Seed.model_validate({
        "id": sid, "meetingId": src.meetingId, "text": text, "owner": owner, "deadline": deadline, "kind": kind,
        "status": status, "health": 1, "sourceType": src.type, "sourceId": src.id, "timestampSec": ts,
        "lastActivity": src.createdAt, "size": 1, "accountId": src.accountId, "quote": quote})


@pytest.fixture(params=["memory", "cosmos"])
def store(request):
    instance = MemoryStore() if request.param == "memory" else CosmosStore(FakeDatabase())
    for account in [Account(id="acct-contoso", name="Contoso Ltd", aliases=["Contoso"]),
                    Account(id="acct-fabrikam", name="Fabrikam Inc", aliases=["Fabrikam"]),
                    Account(id="acct-northwind", name="Northwind Logistics", aliases=["Northwind"])]:
        instance.create_account(account)
    c_email = source("c-email", "acct-contoso", "email", "Kickoff recap", "09-09",
                     "Our main ask is payroll integration with Workday payroll.")
    c_doc = source("c-doc", "acct-contoso", "document", "Statement of work", "09-16", "Go-live needs a parallel run.")
    c_chat = source("c-chat", "acct-contoso", "chat", "Support chat", "10-02", "Can you confirm overtime mapping?")
    c_meet = source("meet-1", "acct-contoso", "meeting", "Renewal call", "10-03", partition="meet-1")
    f_email = source("f-email", "acct-fabrikam", "email", "Payroll pricing", "09-19",
                     "We are interested in payroll integration for next quarter.")
    n_email = source("n-email", "acct-northwind", "email", "Driver onboarding", "09-11", "New driver accounts needed.")
    binding = source("C123", "acct-contoso", "slack", "Slack channel binding", "09-01", recordType="slack_binding")
    for item in (c_email, c_doc, c_chat, c_meet, f_email, n_email, binding):
        instance.create_source(item)
    for item in (
        seed("s-c-need", c_email, "customer_need", "Payroll integration with Workday", "payroll integration with Workday payroll"),
        seed("s-c-checklist", c_email, "commitment", "Send the payroll checklist", "I'll send the checklist", "Alex Kim"),
        seed("s-c-risk", c_doc, "risk", "Go-live depends on parallel run", "Go-live needs a parallel run"),
        seed("s-c-overtime", c_chat, "commitment", "Confirm overtime mapping", "I will confirm the overtime mapping", "Sam Patel"),
        seed("s-f-need", f_email, "customer_need", "Payroll integration next quarter", "interested in payroll integration"),
        seed("s-f-pricing", f_email, "commitment", "Send payroll add-on pricing", "I'll send the pricing", "Priya Nair",
             deadline="2026-10-02"),
        seed("s-f-training", f_email, "commitment", "Deliver training plan", "training plan", "Priya Nair", status="bloom"),
        seed("s-n-need", n_email, "customer_need", "Mobile shift swaps for drivers", "mobile shift swaps"),
        seed("s-n-accounts", n_email, "commitment", "Create driver accounts", "I'll create the accounts", "Alex Kim"),
    ):
        instance.create_seed(item)
    instance.save_utterance(Utterance(id="u1", meetingId="meet-1", speaker="Maria Lopez", startSec=42, via="voice",
                                      text="Payroll integration is still our top priority for the renewal."))
    use_store(instance)
    yield instance
    use_store(None)


class FakeModel:
    """Plans with the given filters; answers by citing evidence picked by `choose`."""

    def __init__(self, plan, choose=lambda evidence: [e["ref"] for e in evidence], answered=True, answer="Answer."):
        self.plan, self.choose, self.answered, self.answer = plan, choose, answered, answer
        self.calls, self.evidence = [], None

    def __call__(self, messages, *, schema_name, schema, reasoning_effort, **_):
        self.calls.append((schema_name, reasoning_effort, json.loads(messages[1]["content"])))
        if schema_name == "ask_filters":
            return self.plan
        self.evidence = self.calls[-1][2]["evidence"]
        return {"answered": self.answered, "answer": self.answer, "citedRefs": self.choose(self.evidence)}


def plan(**changes):
    return {"accountIds": [], "kinds": [], "status": "any", "dateFrom": None, "dateTo": None, "keywords": [], **changes}


def ask(store, question, fake, **request):
    return service.ask(store, AskRequest(question=question, **request), complete=fake, now=NOW)


def test_contoso_last_month_uses_only_contoso_september_evidence(store):
    fake = FakeModel(plan(accountIds=["acct-contoso"], dateFrom="2026-09-01", dateTo="2026-09-30"))
    result = ask(store, "What did we discuss with Contoso last month?", fake)
    accounts = {e.get("account") for e in fake.evidence}
    dates = {e["date"] for e in fake.evidence if "date" in e}
    assert accounts == {"Contoso Ltd"}
    assert dates and all(d.startswith("2026-09") for d in dates)
    assert all(e.get("title") != "Slack channel binding" for e in fake.evidence)
    assert result.answered and {c.sourceId for c in result.citations} == {"c-email", "c-doc"}
    # The planner saw today's date and the account list, so "last month" and "Contoso" resolve.
    assert fake.calls[0][2]["referenceDate"] == "2026-10-04"
    assert {a["id"] for a in fake.calls[0][2]["accounts"]} == {"acct-contoso", "acct-fabrikam", "acct-northwind"}
    assert {call[1] for call in fake.calls} == {"low"}


def test_payroll_interest_across_accounts_finds_contoso_and_fabrikam_not_northwind(store):
    fake = FakeModel(plan(kinds=["customer_need"], keywords=["payroll integration"]),
                     choose=lambda ev: [e["ref"] for e in ev if e["type"] == "seed"])
    result = ask(store, "Show me all customers interested in payroll integration.", fake)
    seeds = [e for e in fake.evidence if e["type"] == "seed"]
    assert {e["account"] for e in seeds} == {"Contoso Ltd", "Fabrikam Inc"}
    assert all(e["kind"] == "customer_need" for e in seeds)
    assert {c.seedId for c in result.citations} == {"s-c-need", "s-f-need"}
    assert all(c.quote for c in result.citations)


def test_open_commitments_for_fabrikam_excludes_done_ones_and_carries_owners_and_dates(store):
    fake = FakeModel(plan(accountIds=["acct-fabrikam"], kinds=["commitment"], status="open"),
                     choose=lambda ev: [e["ref"] for e in ev if e["type"] == "seed"])
    result = ask(store, "What are the open commitments for Fabrikam?", fake)
    seeds = [e for e in fake.evidence if e["type"] == "seed"]
    assert [(e["text"], e["owner"], e["deadline"]) for e in seeds] == [
        ("Send payroll add-on pricing", "Priya Nair", "2026-10-02")]
    assert [c.seedId for c in result.citations] == ["s-f-pricing"]


def test_scoped_page_wins_over_the_planner_and_unknown_ids_or_dates_are_dropped(store):
    fake = FakeModel(plan(accountIds=["acct-northwind", "acct-invented"], dateFrom="soon", status="bogus"))
    ask(store, "Anything open?", fake, accountId="acct-fabrikam")
    assert {e.get("account") for e in fake.evidence} - {None} == {"Fabrikam Inc"}
    loose = FakeModel(plan(accountIds=["acct-invented"], dateFrom="soon"))
    result = ask(store, "Anything?", loose)
    assert result.filters.accountIds == [] and result.filters.dateFrom is None


def test_unknown_refs_are_ignored_and_uncited_or_unanswered_replies_say_so(store):
    invented = FakeModel(plan(accountIds=["acct-contoso"]), choose=lambda ev: ["E999"])
    assert ask(store, "What did Contoso say?", invented).model_dump()["answered"] is False
    declined = FakeModel(plan(accountIds=["acct-contoso"]), answered=False, answer="Not in the evidence.")
    result = ask(store, "What is Contoso's revenue?", declined)
    assert (result.answered, result.answer, result.citations) == (False, service.NO_ANSWER, [])


def test_no_evidence_means_no_answer_call(store):
    fake = FakeModel(plan(accountIds=["acct-contoso"], dateFrom="2025-01-01", dateTo="2025-01-31"))
    result = ask(store, "What did Contoso say in January 2025?", fake)
    assert result.answer == service.NO_ANSWER and [c[0] for c in fake.calls] == ["ask_filters"]


def test_live_assistant_can_cite_this_meetings_lines_with_timestamps(store):
    live = [Utterance(id="live-1", meetingId="meet-2", speaker="Prisha", startSec=95, via="voice",
                      text="We promised Contoso the payroll checklist by Friday.")]
    fake = FakeModel(plan(accountIds=["acct-contoso"], keywords=["promise"]),
                     choose=lambda ev: [e["ref"] for e in ev if e["type"] == "transcript"])
    result = ask(store, "What did we promise Contoso?", fake, accountId="acct-contoso", meetingId="meet-2",
                 recentUtterances=live)
    by_quote = {c.quote: c for c in result.citations}
    assert by_quote["We promised Contoso the payroll checklist by Friday."].timestampSec == 95
    # Earlier meetings of the account are searched too.
    assert by_quote["Payroll integration is still our top priority for the renewal."].meetingId == "meet-1"


def test_route_validation_configuration_and_failures(store, monkeypatch):
    def call(body):
        return HANDLERS["ask"](func.HttpRequest(method="POST", url="/api/ask", body=json.dumps(body).encode()))
    assert call({"question": "   "}).status_code == 400
    assert call({"question": "x", "extra": 1}).status_code == 400
    for name in ("AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_DEPLOYMENT"):
        monkeypatch.delenv(name, raising=False)
    assert json.loads(call({"question": "Hi"}).get_body())["error"]["code"] == "SERVICE_NOT_CONFIGURED"
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.openai.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "secret")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-5-mini")
    monkeypatch.setattr(service, "complete_json", FakeModel(plan(accountIds=["acct-fabrikam"], kinds=["commitment"], status="open")))
    ok = call({"question": "What are the open commitments for Fabrikam?"})
    assert ok.status_code == 200 and json.loads(ok.get_body())["citations"][0]["seedId"] == "s-f-pricing"

    def broken(*args, **kwargs):
        raise ModelFailed("timeout")
    monkeypatch.setattr(service, "complete_json", broken)
    failed = call({"question": "Hi"})
    assert (failed.status_code, json.loads(failed.get_body())["error"]["code"]) == (502, "UPSTREAM_ERROR")


def test_answer_text_never_shows_evidence_ids():
    assert service._strip_refs("Fabrikam wants payroll integration — see E1, E4 and E7.") == \
        "Fabrikam wants payroll integration."
    assert service._strip_refs("Priya owns pricing (E2) and the review [E3, E5].") == "Priya owns pricing and the review."
    assert service._strip_refs("Keep E2E tests and Section 5.") == "Keep E2E tests and Section 5."


def test_one_chip_per_source_preferring_the_seed_quote_and_no_email_headers(store):
    store.create_source(source("c-thread", "acct-contoso", "email", "Thread", "09-20",
                               "From: Maria Lopez <maria@contoso.example>\nTo: Alex\nDate: Sat, 20 Sep 2026\n\nHi Alex, payroll first please."))
    store.create_seed(seed("s-thread", store.get_source("account-acct-contoso", "c-thread"), "customer_need",
                           "Payroll first", "From: Maria Lopez <maria@contoso.example>\nHi Alex, payroll first please."))
    fake = FakeModel(plan(accountIds=["acct-contoso"], keywords=["payroll"]))  # cites every evidence item
    result = ask(store, "What does Contoso want about payroll?", fake)
    keys = [(c.sourceId, c.timestampSec) for c in result.citations]
    assert len(keys) == len(set(keys))
    thread = [c for c in result.citations if c.sourceId == "c-thread"]
    assert len(thread) == 1 and thread[0].seedId == "s-thread"
    assert "From:" not in thread[0].quote and thread[0].quote == "Hi Alex, payroll first please."
    excerpt = next(e for e in fake.evidence if e.get("title") == "Thread")
    assert not excerpt["excerpt"].startswith("From:")


def test_overdue_open_commitments_are_marked_for_the_answer(store):
    fake = FakeModel(plan(accountIds=["acct-fabrikam"], kinds=["commitment"], status="open"),
                     answer="Priya's pricing (E1) is overdue.")
    result = ask(store, "What are the open commitments for Fabrikam?", fake)
    pricing = next(e for e in fake.evidence if e.get("text") == "Send payroll add-on pricing")
    assert pricing["overdue"] is True  # due 2026-10-02, asked on 2026-10-04
    assert result.answer == "Priya's pricing is overdue."
    assert "overdue" in service.ANSWER_PROMPT and "never write refs" in service.ANSWER_PROMPT
