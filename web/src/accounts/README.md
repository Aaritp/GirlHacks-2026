# Account dashboard — Person C

Open `/?accounts` for the account list and `/?account=ID` for one account. The meeting
grove at `/` is unchanged and links here from its sidebar.

Status: built against local sample data. The shared `Account` type, `accountId`, the new
seed kinds and source types, and `/api/accounts` are not in main yet, so nothing here has
run against a real service. With `VITE_USE_MOCKS=false` the dashboard calls the real
routes and shows their error; it never falls back to sample data.

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

## For Prisha: proposed timeline contract

`GET /api/accounts/{id}/timeline` → 200

```json
{
  "accountId": "acct-1",
  "items": [
    { "source": { "id": "", "accountId": "", "meetingId": "", "type": "email",
                  "title": "", "createdAt": "2026-10-03T13:00:00Z", "text": "" },
      "seeds": [ { "...Seed": "", "accountId": "", "quote": "" } ] }
  ]
}
```

- `items` holds every source of the account, newest `createdAt` first, including sources
  with no seeds. Unknown account → 404 `NOT_FOUND`. Storage failure → 503.
- Not yet recorded in `docs/api.md`; it goes there once the team agrees to the shape.

Prisha's answers (proposals until the team agrees, since they change shared types):

| Question | Answer | Effect here |
| --- | --- | --- |
| Quote | `quote: string \| null` on `Seed`; extraction fills it, manual seeds get null. | Matches. |
| Source text | `text: string \| null` on `Source`; stored for email, Slack and documents, null for meetings. | Sample meetings now have null text. See the gap below. |
| Contacts | `{ name, role?, email? }`. | Matches. Not displayed yet. |
| PATCH key | `meetingId` stays the storage key; email and Slack sources use their thread or source ID as `meetingId`. | Matches. Mark done works unchanged. |
| Risk flag | An open seed of kind `risk` is flagged; resolving it is `bloom`. | Matches. |
| Counts | One timeline per account is fine for three demo accounts. | Matches. |

She will add `get_account`, `list_account_sources` and `list_account_seeds` to the shared
store once the account types are agreed. The endpoint in `api/accounts_timeline` is written
against those three reads and stays unregistered until then.

Still open:

- **Meeting transcripts.** A meeting source has null text because its words are stored as
  utterances, and there is no route that returns a meeting's utterances. Selecting a meeting
  in the timeline therefore shows its seeds and their quotes, and says the transcript is not
  shown. To show it, either the timeline includes the transcript for meeting sources or a
  `GET /meetings/{id}/utterances` route is added.
- **Ingestion.** Until email, chat, document and Slack ingestion exists, a real account's
  timeline only contains meetings.
- **New kinds.** Extraction does not produce `risk` or `customer_need` yet, so real data
  will show no wilting risks.

## For Person D: Ask the Grove

Pass your component through `renderAsk` on `AccountsApp` in `App.tsx`:

```tsx
<AccountsApp api={accountsApi} demo={usingMocks} renderAsk={(accountId) => <AskTheGrove accountId={accountId} />} />
```

## Live updates

The open account reloads every 15 seconds, when the window regains focus, on Refresh, and
when `refreshSignal` changes. A seed that another feature patches to `bloom` blooms on the
next of those. If a background reload fails, the last loaded data stays with a warning.

## When the shared types land

Delete `types.ts` and import the shared types, replace `fixtures.ts` with the shared demo
accounts, and fix whatever no longer compiles. Roots are not shown in the account grove
because the timeline does not carry them.

## Needs real-service verification

- `GET /api/accounts` and `GET /api/accounts/{id}/timeline` against memory and Cosmos.
- Marking a seed done from an account, and the reload afterwards.
- A self-updating commitment turning to bloom while the dashboard is open.
- Each real source type (Slack, email, chat, document, meeting) appearing with its text.
- Account isolation with real data from two accounts.
