import hashlib
import json
import re
from datetime import datetime, timezone
from email.parser import Parser
from email import policy

from extract.model import call_model
from extract.pipeline import extract_and_save
from ingest.contracts import IngestRequest, Message, FeatureError, require_account
from ingest.documents import read_document
from shared.models import Source, Utterance
from shared.openai_client import ModelFailed
from shared.store import StorageUnavailable

def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:32]

def account_partition(account_id):
    # Preserves A's /meetingId partition contract until the team agrees on migration.
    return "account-" + digest(account_id)

def parse_messages(kind, text):
    if kind == "email":
        parts = re.split(r"(?=^From:)", text, flags=re.MULTILINE)
        messages = []
        for part in parts:
            if not part.strip():
                continue
            if part.startswith("From:"):
                email = Parser(policy=policy.default).parsestr(part)
                payload = email.get_payload()
                # Plain pasted threads only; no MIME attachments or HTML rendering.
                body = payload if isinstance(payload, str) else part
                messages.append(Message(author=str(email.get("From", "Unknown")),
                    recipients=[str(v) for v in email.get_all("To", []) + email.get_all("Cc", [])],
                    timestamp=str(email.get("Date")) if email.get("Date") else None, text=body.strip() or part))
            else:
                messages.append(Message(text=part))
        return messages
    if kind == "chat":
        messages = []
        for line in text.splitlines():
            match = re.match(r"^\[([^\]]+)\]\s+([^:]{1,300}):\s*(.+)$", line)
            if match:
                messages.append(Message(timestamp=match[1], author=match[2], text=match[3]))
            elif line.strip():
                if messages:
                    messages[-1].text += "\n" + line
                else:
                    messages.append(Message(text=line))
        return messages
    return [Message(text=text)]

def ingest(store, request: IngestRequest, model=call_model, *, check_account=True):
    if check_account:
        require_account(store, request.accountId)
    text = read_document(request.filename, request.fileBase64) if request.fileBase64 is not None else request.text
    messages = request.messages or parse_messages(request.sourceType, text)
    if len(messages) > 200:
        raise FeatureError(413, "TOO_MANY_MESSAGES", "Import at most 200 messages at a time.")
    partition = account_partition(request.accountId)
    canonical = json.dumps({"account": request.accountId, "kind": request.sourceType, "title": request.title.strip(),
        "messages": [m.model_dump() for m in messages]}, sort_keys=True, ensure_ascii=False)
    source_id = "source-" + digest(canonical)
    if request.sourceType == "slack":
        source_id = "source-" + digest(json.dumps([request.accountId, "slack", [m.externalId for m in messages]]))
    existing = store.get_source(partition, source_id)
    if existing:
        messages = [Message.model_validate(m) for m in existing.messages]
    chunks = []
    for message in messages:
        for offset in range(0, len(message.text), 2000):
            body = message.text[offset:offset + 2000]
            if body.strip():
                chunks.append(Utterance(id="chunk-" + digest(source_id + str(len(chunks))), meetingId=partition,
                    speaker=message.author, text=body, startSec=len(chunks), via="voice"))
    if len(chunks) > 200:
        raise FeatureError(413, "TOO_MANY_CHUNKS", "Split this import into smaller parts.")
    if not chunks:
        raise FeatureError(400, "EMPTY_SOURCE", "There is no text to import.")
    now = datetime.now(timezone.utc)
    if existing is None:
        window = {"referenceDate": now.date().isoformat(), "sourceType": request.sourceType,
            "messages": [m.model_dump() for m in messages],
            "utterances": [{"id": u.id, "speaker": u.speaker, "text": u.text, "startSec": u.startSec} for u in chunks]}
        items = model(window)
        if not isinstance(items, list) or len(items) > 200 or len(json.dumps(items)) > 150000:
            raise ModelFailed("Invalid extraction item count")
        candidate = Source(id=source_id, meetingId=partition, accountId=request.accountId,
            type=request.sourceType, title=request.title.strip(), createdAt=now,
            text=text or "\n\n".join(m.text for m in messages),
            messages=[m.model_dump() for m in messages], extractionItems=items)
        # Immutable source also records the winning extraction plan. A retry or concurrent
        # request reuses it, including after partial seed writes; user edits are never reset.
        existing = store.create_source(candidate) or store.get_source(partition, source_id)
    if existing is None or existing.extractionItems is None:
        raise StorageUnavailable("Ingestion source plan unavailable")
    grove = extract_and_save(store, partition, chunks, lambda _: existing.extractionItems,
                             now=existing.createdAt, source=existing)
    return {"source": existing.model_dump(mode="json", exclude={"extractionItems"}),
            "seeds": [s.model_dump(mode="json") for s in grove.seeds], "roots": [r.model_dump(mode="json") for r in grove.roots]}
