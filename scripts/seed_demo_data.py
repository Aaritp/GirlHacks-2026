"""Loads the Grovekeeper 2.0 demo data into real storage through the local API.

Creates three client accounts (Contoso, Fabrikam, Northwind) and ingests 2 emails, 1 chat and
1 document for each through POST /api/ingest, so real Azure OpenAI extraction plants their seeds
(commitments, decisions, risks, customer needs) with quotes back to the source. The content is
written so Ask the Grove's demo questions have clear answers:

  - "What did we discuss with Contoso last month?"  -> several Contoso sources dated last month
  - "Show me all customers interested in payroll integration."  -> Contoso and Fabrikam, not Northwind
  - "What are the open commitments for Fabrikam?"  -> owned, dated commitments (one overdue)

Dates are relative to the day you run it. Start the API first (`cd api && func start`), then:

    python3 scripts/seed_demo_data.py [--base-url http://localhost:7071/api]

Safe to re-run: existing accounts are kept and re-sending a source reuses its first extraction.
Makes one Azure OpenAI call per new source (12 on a fresh database). Reads no keys.
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, time, timedelta, timezone
from email.utils import format_datetime

ACCOUNTS = [
    {"id": "acct-contoso", "name": "Contoso Ltd", "aliases": ["Contoso"], "industry": "Manufacturing",
     "contacts": [{"name": "Maria Lopez", "role": "HR director", "email": "maria.lopez@contoso.example"}]},
    {"id": "acct-fabrikam", "name": "Fabrikam Inc", "aliases": ["Fabrikam"], "industry": "Retail",
     "contacts": [{"name": "Jordan Reyes", "role": "VP of operations", "email": "jordan.reyes@fabrikam.example"}]},
    {"id": "acct-northwind", "name": "Northwind Logistics", "aliases": ["Northwind", "NWL"], "industry": "Transportation",
     "contacts": [{"name": "Dana Whitfield", "role": "Payroll director"}]},
]


def anchors(today: date):
    """Day helpers: last_month(n) is day n of last month; this_month(n) is day n of this month, never after today."""
    first_this = today.replace(day=1)
    first_last = (first_this - timedelta(days=1)).replace(day=1)
    last_of_last = first_this - timedelta(days=1)

    def last_month(day):
        return min(first_last + timedelta(days=day - 1), last_of_last)

    def this_month(day):
        return min(first_this + timedelta(days=day - 1), today)
    return last_month, this_month


def at(day: date, hour=10, minute=0):
    return datetime.combine(day, time(hour, minute), tzinfo=timezone.utc)


def long(day: date):
    return f"{day:%B} {day.day}"


def email(sender, to, when: datetime, body):
    return f"From: {sender}\nTo: {to}\nDate: {format_datetime(when)}\n\n{body.strip()}\n"


def chat(lines):
    return "\n".join(f"[{when:%Y-%m-%d %H:%M}] {who}: {text}" for when, who, text in lines)


def sources(today: date):
    last_month, this_month = anchors(today)
    soon, later, overdue = today + timedelta(days=5), today + timedelta(days=12), today - timedelta(days=2)
    c1, c2, c3, c4 = last_month(9), last_month(16), last_month(24), this_month(2)
    f1, f2, f3, f4 = last_month(5), last_month(19), last_month(27), this_month(1)
    n1, n2, n3, n4 = last_month(11), last_month(26), last_month(3), this_month(2)
    alex = "Alex Kim <alex.kim@grovekeeper.example>"
    priya = "Priya Nair <priya.nair@grovekeeper.example>"
    maria = "Maria Lopez <maria.lopez@contoso.example>"
    jordan = "Jordan Reyes <jordan.reyes@fabrikam.example>"
    dana = "Dana Whitfield <dana.whitfield@northwind.example>"
    return [
        # ---- Contoso: payroll integration interest, a blocking risk, last-month history ----
        ("acct-contoso", "email", "Kickoff recap: Contoso onboarding", at(c1), email(maria, alex, at(c1), f"""
Hi Alex,

Thanks for the kickoff. Our main ask is payroll integration: we need your platform to sync
employee hours straight into our Workday payroll so HR stops re-keying them every pay period.

Maria
""") + email(alex, maria, at(c1, 15), f"""
Hi Maria,

Understood. I'll send you the payroll integration checklist by {long(c1 + timedelta(days=3))}.
We agreed the first pilot site will be the Columbus plant.

Alex
""")),
        ("acct-contoso", "document", "Contoso statement of work v2", at(c2), f"""
Statement of work: Contoso Ltd

Section 3. The customer requires payroll integration with Workday, including overtime and shift
differentials, before go-live.
Section 5. Go-live is contingent on a successful two-week parallel run at the Columbus plant.
Section 6. Grovekeeper will deliver administrator training for the Contoso HR team.
"""),
        ("acct-contoso", "email", "Re: sandbox credentials", at(c3), email(maria, alex, at(c3), f"""
Hi Alex,

The sandbox credentials still have not arrived and our payroll testers are blocked. If this slips
past {long(c3 + timedelta(days=14))} we will miss the pilot window, and leadership will question the rollout.

Maria
""") + email(alex, maria, at(c3, 16), f"""
Maria, apologies. I'll get the sandbox credentials to your testers by {long(c3 + timedelta(days=2))}.

Alex
""")),
        ("acct-contoso", "chat", "Support chat with Maria", at(c4), chat([
            (at(c4, 9, 5), "Maria Lopez", "Can your team confirm the overtime rules map correctly into Workday payroll?"),
            (at(c4, 9, 7), "Sam Patel", f"Yes. I will confirm the overtime mapping by {long(soon)}."),
            (at(c4, 9, 9), "Maria Lopez", "Great. We also need pay statements in Spanish for the Columbus plant."),
        ])),
        # ---- Fabrikam: payroll interest for next quarter, renewal, an overdue commitment ----
        ("acct-fabrikam", "document", "Fabrikam quarterly business review notes", at(f1), f"""
Quarterly business review: Fabrikam Inc

Decision: Fabrikam will standardize scheduling on Grovekeeper across all 40 stores.
Priya Nair will deliver the store manager training plan by {long(later)}.
Fabrikam wants to add payroll integration next quarter so store hours flow into payroll automatically.
"""),
        ("acct-fabrikam", "email", "Payroll integration pricing", at(f2), email(jordan, priya, at(f2), f"""
Hi Priya,

Following the QBR, we are interested in payroll integration for next quarter. Can you send pricing
for the payroll add-on?

Jordan
""") + email(priya, jordan, at(f2, 14), f"""
Hi Jordan,

Happy to. I'll send the payroll add-on pricing by {long(overdue)}.

Priya
""")),
        ("acct-fabrikam", "chat", "Support chat with Jordan", at(f3), chat([
            (at(f3, 11, 0), "Jordan Reyes", "The nightly schedule export is failing for three of our stores again."),
            (at(f3, 11, 4), "Lee Chen", f"Sorry about that. I will ship a fix for the export by {long(soon)}."),
            (at(f3, 11, 6), "Jordan Reyes", "If it keeps failing, our district managers will escalate before renewal."),
        ])),
        ("acct-fabrikam", "email", "Renewal decision", at(f4), email(jordan, priya, at(f4), f"""
Hi Priya,

Good news: we decided to renew for another 12 months. Please set up an executive review with our
COO before the end of the month.

Jordan
""") + email(priya, jordan, at(f4, 13), f"""
Wonderful, thank you. I'll schedule the executive review with your COO by {long(soon)}.

Priya
""")),
        # ---- Northwind: no payroll-integration interest; driver onboarding and a risk ----
        ("acct-northwind", "document", "Northwind rollout plan", at(n3), f"""
Rollout plan: Northwind Logistics

Decision: Phase one covers driver scheduling for the Memphis and Dallas depots only.
Northwind needs mobile shift swaps for drivers before phase two.
"""),
        ("acct-northwind", "email", "Driver onboarding timeline", at(n1), email(dana, alex, at(n1), f"""
Hi Alex,

Our new driver cohort starts soon. We need their accounts created before their first shift.

Dana
""") + email(alex, dana, at(n1, 15), f"""
Dana, I'll have all new driver accounts created by {long(n1 + timedelta(days=4))}.

Alex
""")),
        ("acct-northwind", "email", "Concern about depot coverage", at(n2), email(dana, alex, at(n2), f"""
Hi Alex,

Dallas depot supervisors say shift reminders are arriving late. If drivers keep missing shifts we
will have to pause the rollout at that depot.

Dana
""")),
        ("acct-northwind", "chat", "Support chat with Dana", at(n4), chat([
            (at(n4, 8, 30), "Dana Whitfield", "Any update on the late shift reminders in Dallas?"),
            (at(n4, 8, 34), "Lee Chen", f"We found the cause. I will roll out the reminder fix by {long(later)}."),
        ])),
    ]


def call(method, url, body=None, timeout=180):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read() or b"null")
        except ValueError:
            return exc.code, None


def describe_error(status, payload):
    error = (payload or {}).get("error", {}) if isinstance(payload, dict) else {}
    return f"HTTP {status} {error.get('code', '')} {error.get('message', '')}".rstrip()


def main():
    parser = argparse.ArgumentParser(description="Load the Grovekeeper demo accounts and sources.")
    parser.add_argument("--base-url", default="http://localhost:7071/api")
    base = parser.parse_args().base_url.rstrip("/")
    try:
        for account in ACCOUNTS:
            status, payload = call("POST", f"{base}/accounts", account)
            if status not in (201, 409):
                print(f"✗ Account {account['name']}: {describe_error(status, payload)}")
                sys.exit(1)
            print(f"{'✓ Created' if status == 201 else '• Exists '} {account['name']}")
        print("\nIngesting sources (one AI extraction per new source; this takes a minute)…")
        failed = 0
        now = datetime.now(timezone.utc)
        for account_id, kind, title, occurred, text in sources(now.date()):
            # A source dated today must not be stamped later than now.
            occurred = min(occurred, now - timedelta(minutes=1))
            status, payload = call("POST", f"{base}/ingest", {
                "accountId": account_id, "sourceType": kind, "title": title, "text": text,
                "occurredAt": occurred.isoformat()})
            if status == 200:
                seeds = payload.get("seeds", [])
                kinds = ", ".join(sorted({seed["kind"] for seed in seeds})) or "no seeds"
                print(f"  ✓ {account_id:15} {kind:8} {title} — {len(seeds)} seed(s): {kinds}")
            else:
                failed += 1
                print(f"  ✗ {account_id:15} {kind:8} {title} — {describe_error(status, payload)}")
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"✗ Could not reach {base}: {getattr(exc, 'reason', exc)}. Is `func start` running in api/?")
        sys.exit(1)
    if failed:
        print(f"\n{failed} source(s) failed; fix the error above and re-run (finished sources are reused).")
        sys.exit(1)
    print("\nDone. Open the app → Client accounts → Contoso, Fabrikam or Northwind.")


if __name__ == "__main__":
    main()
