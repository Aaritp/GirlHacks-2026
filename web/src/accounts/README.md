# Account dashboard — Person C

Open `/?accounts` for the account list and `/?account=ID` for one account. The meeting
grove at `/` is unchanged and links here from its sidebar.

Status: uses the shared `Account`, `Seed` and `Source` types and the real routes. In
development it shows sample data unless `VITE_USE_MOCKS=false`; against the real API it
shows that API's errors and never falls back to sample data. It has passed automated tests
against the memory store and a fake Cosmos, not yet against a running Functions host or a
real Cosmos account.

## What it does

- **Account list**: name, industry, open commitments, risks. A count that fails to load
  says "Counts unavailable", never zero.
- **Timeline**: every source, newest first, one icon per source type. Selecting an item
  shows its text and the seeds extracted from it.
- **Account grove**: forest and plain list of the same seeds, with kind and owner filters.
- **Seed details**: owner, deadline, the quote it came from, and its source. Mark done or
  reopen. The plant changes only after the save succeeds.
- **Ask the Grove slot**: a marked region scoped to the open account. Empty until Person D's
  component exists.

## Display states

| State | Rule |
| --- | --- |
| Blooming | `status` is `bloom`. |
| Wilting | Open and past its deadline, or an open seed of kind `risk`. |
| Growing | Every other open seed. |

A deadline of today is not overdue. This replaces the seven-day inactivity rule for
display in this view; stored `health` and a stored `status` of `wilted` are ignored here.
The meeting grove still uses the old rule (`../forest/health.ts`).

## Contract

`GET /api/accounts/{id}/timeline` is recorded in `docs/api.md` and served by
`api/accounts_timeline`. Shared-type decisions this view relies on:

- `Seed.quote` and `Seed.accountId` are optional; a missing value is treated as null.
- `Source.text` holds the body of an email, chat, document or Slack thread. It is null for
  a meeting, whose transcript is fetched with `api.getUtterances` only when the meeting is
  opened in the timeline.
- `meetingId` stays the storage key, so marking done uses the shared `api.updateSeed`.
- An open seed of kind `risk` is a flagged risk; resolving it is `bloom`.
- The list fetches one timeline per account to count. Fine for the demo accounts.

Still open:

- **Linking a meeting to an account.** `/extract` links a meeting only when it receives
  `accountId`, and the transcript panel does not know the account yet. Proposed:
  `/?meetingId=ID&accountId=ID`, with `App.tsx` passing `accountId` to the transcript panel.
- **Ingestion.** Person B owns email, chat, document and Slack ingestion. Until it is in
  main, a real account's timeline only contains meetings.
- **Health timer.** Agreed not to register it for now. The account view does not use the
  seven-day decay; the store methods it needs stay on `feat/health-storage`.
- **Sample accounts.** Mock mode uses `fixtures.ts`. The real API starts with no accounts
  until some are created with `POST /api/accounts`.

## For Person D: Ask the Grove

Pass your component through `renderAsk` on `AccountsApp` in `App.tsx`:

```tsx
<AccountsApp api={accountsApi} demo={usingMocks} renderAsk={(accountId) => <AskTheGrove accountId={accountId} />} />
```

## Live updates

The open account reloads every 15 seconds, when the window regains focus, on Refresh, and
when `refreshSignal` changes. A seed that another feature patches to `bloom` blooms on the
next of those. If a background reload fails, the last loaded data stays with a warning.

## Not shown

Roots are not shown in the account grove because the timeline does not carry them.

## Needs real-service verification

- `GET /api/accounts` and `GET /api/accounts/{id}/timeline` against memory and Cosmos.
- Marking a seed done from an account, and the reload afterwards.
- A self-updating commitment turning to bloom while the dashboard is open.
- Each real source type (Slack, email, chat, document) appearing with its text, and a
  meeting appearing with its transcript.
- Account isolation with real data from two accounts.
