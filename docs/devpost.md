# Grovekeeper — Devpost write-up (draft)

## Inspiration

Client-facing teams make promises everywhere: on calls, in email threads, in Slack, in a
statement of work. Those promises scatter, and a rep walking into a renewal call often can't
answer the simplest question: *what did we promise this client?* We wanted every client
conversation to turn into something you can see, track and ask about, with proof of where it
came from.

## What it does

Grovekeeper turns client conversations into a living grove, one per client account. Every
commitment, decision, risk and customer need becomes a **seed** that grows while work
progresses, blooms when it's done, and wilts when it's overdue.

- **Online meetings, live.** Share a Zoom, Google Meet or Teams browser tab. Grovekeeper
  transcribes the other participants with speaker labels and the user's own microphone under
  their name, and extracts commitments with owners and deadlines every ~30 seconds. Speakers can
  be renamed (Guest-1 → Sam), and a "Mute my mic" button covers the fact that a call app's mute
  can't reach another browser tab.
- **Every other source.** Paste an email thread or chat, or upload a document (.txt, .md,
  text-based PDF). Slack is connected live: link a channel to an account and press Sync.
- **Self-updating commitments.** When someone says or writes that something is done ("the
  checklist is done"), Grovekeeper finds the matching open commitment and asks "Mark it as
  done?" with the exact quote. Nothing closes without a human Yes.
- **Ask the Grove.** Plain-language questions such as "Show me all customers interested in
  payroll integration" or "What are the open commitments for Fabrikam?" return answers with
  citation chips that open the exact email, chat, Slack message or meeting moment. If the answer
  isn't in the data, it says "I don't have that in the grove."
- **Live in-meeting assistant.** During a call, ask by voice (push-to-talk, kept out of the
  transcript) or by typing, about this meeting and past ones. Saying a client's name pops up a
  context card with their open commitments and risks.
- **Account dashboard and next best action.** One page per client: a timeline across every
  source, the grove of seeds with filters, and a one-click follow-up email draft built from real
  commitments (never sent automatically).

## How we built it

- **Frontend:** React, Vite and TypeScript. Tab capture with `getDisplayMedia`, the user's mic
  with `getUserMedia`, Web Audio and an AudioWorklet to produce 16 kHz PCM for each channel.
- **Backend:** Azure Functions (Python) with Pydantic contracts mirrored in TypeScript.
- **Azure AI Speech:** real-time diarized transcription (`ConversationTranscriber`) for the
  meeting tab, plain recognition for the user's mic, fed through push streams. The browser only
  ever receives short-lived tokens from our backend; keys stay server-side.
- **Azure OpenAI (gpt-5-mini):** structured-output extraction, completion detection,
  question-to-filter planning, grounded answers and follow-up drafts, through one shared helper
  built for reasoning models.
- **Azure Cosmos DB:** seeds, roots, utterances, sources and accounts, partitioned by meeting,
  on shared database throughput so it fits a 1,000 RU/s account.
- **Slack Web API:** a read-only bot (`channels:history`, `channels:read`, `users:read`) with
  manual sync and checkpoints, so re-syncing never duplicates messages.

## How we use AI responsibly

- **Provenance first.** Every seed cites the exact source words it came from. Text-source quotes
  must appear verbatim in the source, or the item is dropped.
- **No invented facts.** Owners are kept only if they are a speaker or named in the cited text;
  deadlines only if their wording appears in the source. Otherwise they stay empty.
- **Grounded answers.** Ask the Grove answers only from retrieved evidence. Citations are built
  from stored records, never from model-written text, and uncited answers are refused.
- **Humans decide.** Completions are suggestions until confirmed; drafts are never sent.

## Challenges we ran into

- Capturing an online call from the browser: the meeting tab and the user's mic arrive as
  separate streams, and naming the user reliably meant transcribing them separately.
- Keeping overlapping 30-second extraction windows from creating duplicate seeds.
- Fitting four, then five, Cosmos containers under a 1,000 RU/s limit with shared throughput.
- Making a reasoning model (gpt-5-mini) behave with strict JSON schemas and no sampling knobs.

## Accomplishments we're proud of

- The full flow works end to end on real Azure: a live Meet call becomes named transcript lines,
  cited seeds on the right client account, and answers you can trace back to the moment
  something was said.
- More than 350 automated tests across the backend and frontend, run on every merge.

## What we learned

Trust is the product. A summary nobody can verify is noise; a commitment with an owner, a date
and a quote is something a team can act on.

## What's next

- More connectors (Gmail, Outlook, Teams chat) through the same ingestion pipeline.
- Vector search for fuzzier questions across large account histories.
- Self-updating commitments from email and Slack, not just meetings.
- Real-time Slack events instead of manual sync, and sign-in with per-account access control.

## Built with

Azure AI Speech · Azure OpenAI (gpt-5-mini) · Azure Cosmos DB · Azure Functions · Python ·
Pydantic · React · TypeScript · Vite · Web Audio · Slack API
