# Account timeline — Person C

`GET /api/accounts/{id}/timeline` returns every source of an account, newest first, each
with the seeds extracted from it. The proposed response and open questions are in
`web/src/accounts/README.md`.

Not registered. `create_timeline_blueprint(get_repository)` needs three reads the shared
store does not have yet: `get_account`, `list_account_sources` and `list_account_seeds`.
Once they exist on both backends, register it in `function_app.py` with
`create_timeline_blueprint(get_store)` and record the route in `docs/api.md`.

No database client is created here. `api/tests/test_accounts_timeline.py` covers ordering,
source types, account isolation, an empty account, 404 and 503 with a fake repository.
