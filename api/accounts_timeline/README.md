# Account timeline — Person C

`GET /api/accounts/{id}/timeline` returns every source of an account, newest first, each
with the seeds extracted from it. The contract is in `docs/api.md`.

Registered in `function_app.py`. It reads through the shared store only
(`get_account`, `list_account_sources`, `list_account_seeds`) and creates no database
client. Records of another account are dropped, and so are bookkeeping records stored as
sources: anything whose `recordType` is not `source`.

`api/tests/test_accounts_timeline.py` covers ordering, source types, account isolation, an
empty account, 404 and 503, against a fake repository and against both shared stores.
