"""Creates the demo client accounts in real storage (Cosmos or memory) through the local API.

The account dashboard (`/?accounts`) lists accounts from storage; with VITE_USE_MOCKS=false it
is empty until accounts exist. These match the sample accounts in web/src/accounts/fixtures.ts.
Start the API first (`cd api && func start`), then from the repository root:

    python3 scripts/seed_demo_accounts.py [--base-url http://localhost:7071/api]

Safe to run repeatedly: existing accounts are reported and left unchanged. Reads no keys.
"""
import argparse
import json
import sys
import urllib.error
import urllib.request

ACCOUNTS = [
    {"id": "acct-northwind", "name": "Northwind Logistics", "aliases": ["Northwind", "NWL"],
     "industry": "Transportation", "contacts": [{"name": "Dana Whitfield", "role": "Payroll director"}]},
    {"id": "acct-harbor", "name": "Harbor Health Partners", "aliases": ["Harbor Health"],
     "industry": "Healthcare", "contacts": [{"name": "Priya Raman", "role": "HR operations lead"}]},
    {"id": "acct-juniper", "name": "Juniper Retail Group", "aliases": [], "industry": "Retail", "contacts": []},
]


def post(url, body):
    request = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read() or b"null")
        except ValueError:
            return exc.code, None


def main():
    parser = argparse.ArgumentParser(description="Create the demo client accounts.")
    parser.add_argument("--base-url", default="http://localhost:7071/api")
    base = parser.parse_args().base_url.rstrip("/")
    failed = False
    for account in ACCOUNTS:
        try:
            status, payload = post(f"{base}/accounts", account)
        except (urllib.error.URLError, TimeoutError) as exc:
            print(f"✗ Could not reach {base}: {getattr(exc, 'reason', exc)}. Is `func start` running in api/?")
            sys.exit(1)
        if status == 201:
            print(f"✓ Created  {account['name']} ({account['id']})")
        elif status == 409:
            print(f"• Exists   {account['name']} ({account['id']})")
        else:
            error = (payload or {}).get("error", {}) if isinstance(payload, dict) else {}
            print(f"✗ {account['name']}: HTTP {status} {error.get('code', '')} {error.get('message', '')}".rstrip())
            failed = True
    if failed:
        sys.exit(1)
    print("\nOpen the app and click 'Client accounts' in the sidebar (or go to /?accounts).")


if __name__ == "__main__":
    main()
