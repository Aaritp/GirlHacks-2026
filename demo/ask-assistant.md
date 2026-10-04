# Ask assistant demo and preflight

Use the existing mock preview at `/` to try the new meeting assistant without
Azure. The account-page Ask slot remains Aarit's integration point; the reusable
component and embedding example are in `web/src/ask/README.md`.

1. Choose Play fixture transcript, type `checklist` under Ask the Grove, then Ask.
   The answer must say it is a keyword mock, not AI.
2. Open a citation chip. Verify its quote and highlighted transcript timestamp;
   close the source and confirm focus returns to the chip.
3. Ask an unrelated question. When `answered` is false, show the returned answer
   text and no citation chips.
4. In the real meeting flow, say a configured client name/alias such as Contoso.
   After the phrase is finalized, inspect the saved context card and its evidence.
   Dismiss it, then mention the client again in a new phrase to bring it back.
5. With `VITE_USE_MOCKS=false` and configured Speech/Ask services, hold the voice
   button (or Space while focused), say a question, and release. Check the editable
   question before choosing Ask. Verify that this recognizer itself does not create
   an utterance or seed. The ongoing meeting microphone is independent and may
   still hear the question; typed questions avoid that.
6. Try release-before-permission, permission denial, Escape, and switching views
   while recording. The question microphone must stop, with no automatic submission.

Never present mock answers, injected test recognition, or automated test results as
live Azure evidence. Ask responses are text only and never trigger speech output.
