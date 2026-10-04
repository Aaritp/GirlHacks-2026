"""Validates model output against the transcript, deduplicates windows, and persists results.

Every saved seed cites an utterance from the request. Owners and deadlines are kept only
when the cited text supports them; anything unsupported becomes null.
"""
import hashlib
import re
from collections.abc import Callable
from datetime import date, datetime, timezone
from typing import get_args

from shared.models import MAX_QUOTE, Grove, Root, Seed, SeedKind, Source, Utterance
from shared.store import GroveStore, StorageUnavailable

MAX_TEXT = 500
KINDS = get_args(SeedKind)
UNKNOWN_SPEAKERS = {"unknown", "unknown speaker", "unidentified", "guest"}
STOPWORDS = {"a", "an", "the", "to", "of", "and", "or", "for", "by", "on", "in", "at", "with",
             "will", "i", "i'll", "we", "we'll", "be", "is", "are", "it", "this", "that"}
SAME_ANCHOR_SIMILARITY = 0.5
RESTATEMENT_SIMILARITY = 0.8


def _normalize(text: str):
    return re.sub(r"\s+", " ", text).strip().lower()


def _tokens(text: str):
    return {word for word in re.findall(r"[a-z0-9']+", text.lower()) if word not in STOPWORDS}


def similarity(left: str, right: str):
    a, b = _tokens(left), _tokens(right)
    if not a or not b:
        return 1.0 if _normalize(left) == _normalize(right) else 0.0
    return len(a & b) / len(a | b)


def _digest(*parts):
    return hashlib.sha256("\x1f".join(str(part) for part in parts).encode()).hexdigest()[:24]


def _supported_owner(owner, speakers: list[str], texts: list[str]):
    """Kept only if it is a known speaker label or a name that appears in the cited text."""
    if not isinstance(owner, str) or not owner.strip():
        return None
    candidate = owner.strip()
    if candidate.lower() in UNKNOWN_SPEAKERS:
        return None
    for speaker in speakers:
        if speaker.strip().lower() == candidate.lower() and speaker.lower() not in UNKNOWN_SPEAKERS:
            return speaker.strip()
    for text in texts:
        if re.search(rf"(?<!\w){re.escape(candidate)}(?!\w)", text, re.IGNORECASE):
            return candidate
    return None


def _supported_deadline(deadline, evidence, texts: list[str]):
    """Kept only if it is a real date and its quoted evidence appears in the cited text."""
    if not isinstance(deadline, str) or not isinstance(evidence, str) or not evidence.strip():
        return None
    try:
        parsed = date.fromisoformat(deadline)
    except ValueError:
        return None
    quote = _normalize(evidence)
    return parsed if any(quote in _normalize(text) for text in texts) else None


def validate_items(raw_items: list, utterances: list[Utterance]):
    """Drops items without real provenance and nulls unsupported owners/deadlines."""
    by_id = {item.id: item for item in utterances}
    valid = []
    for raw in raw_items:
        if not isinstance(raw, dict) or raw.get("kind") not in KINDS:
            continue
        text = raw.get("text").strip()[:MAX_TEXT] if isinstance(raw.get("text"), str) else ""
        cited = [by_id[uid] for uid in dict.fromkeys(raw.get("utteranceIds") or []) if isinstance(uid, str) and uid in by_id]
        if not text or not cited:
            continue
        cited.sort(key=lambda item: (item.startSec, item.id))
        anchor = cited[0]
        texts = [item.text for item in cited]
        valid.append({
            "key": str(raw.get("key") or len(valid)),
            "kind": raw["kind"], "text": text,
            "owner": _supported_owner(raw.get("owner"), [item.speaker for item in cited], texts),
            "deadline": _supported_deadline(raw.get("deadline"), raw.get("deadlineEvidence"), texts),
            # The cited transcript words themselves, so the quote is always real.
            "quote": " ".join(texts)[:MAX_QUOTE],
            "anchor": anchor,
            "dependsOn": [key for key in raw.get("dependsOn") or [] if isinstance(key, str)],
        })
    return valid


def find_duplicate(item: dict, seeds: list[Seed]):
    """Same item seen in an overlapping window: same kind and anchor time with similar text,
    or a near-identical restatement later in the meeting with a compatible owner."""
    for seed in seeds:
        if seed.kind != item["kind"] or seed.sourceType == "whiteboard":
            continue
        score = similarity(seed.text, item["text"])
        same_anchor = seed.timestampSec is not None and abs(seed.timestampSec - item["anchor"].startSec) < 1e-6
        if same_anchor and score >= SAME_ANCHOR_SIMILARITY:
            return seed
        owners_compatible = not seed.owner or not item["owner"] or seed.owner.lower() == item["owner"].lower()
        if score >= RESTATEMENT_SIMILARITY and owners_compatible:
            return seed
    return None


class SourceConflict(Exception):
    """The request disagrees with a stored Source (different account or content). Maps to 409."""


def _meeting_account(store: GroveStore, meeting_id: str, account_id: str | None, now: datetime):
    """Creates the meeting Source on first use; returns the account its seeds belong to."""
    source = store.get_source(meeting_id, meeting_id)
    if source is None:
        candidate = Source(id=meeting_id, meetingId=meeting_id, type="meeting", title="Meeting transcript",
                           createdAt=now, accountId=account_id)
        source = store.create_source(candidate) or store.get_source(meeting_id, meeting_id)
        if source is None:
            raise StorageUnavailable("Meeting source conflicted but could not be read back")
    if account_id is not None and source.accountId != account_id:
        raise SourceConflict("This meeting is linked to a different account, or to none.")
    return source.accountId


def extract_and_save(store: GroveStore, meeting_id: str, utterances: list[Utterance],
                     model: Callable[[dict], list[dict]], now: datetime | None = None,
                     account_id: str | None = None, source: Source | None = None) -> Grove:
    now = now or datetime.now(timezone.utc)
    # Persist the transcript and its Source first so every seed can be traced back.
    if source is None:
        _meeting_account(store, meeting_id, account_id, now)
        source = store.get_source(meeting_id, meeting_id)
    else:
        store.create_source(source)
    # Import chunks are extraction evidence, not a recorded meeting transcript.
    # Their original text/metadata is already retained on the Source.
    if source.type == "meeting":
        for utterance in utterances:
            store.save_utterance(utterance)

    ordered = sorted(utterances, key=lambda item: (item.startSec, item.id))
    window = {
        "referenceDate": now.date().isoformat(),
        "utterances": [{"id": u.id, "speaker": u.speaker, "startSec": u.startSec, "text": u.text} for u in ordered],
    }
    items = validate_items(model(window), ordered)

    known = [seed for seed in store.list_seeds(meeting_id) if seed.sourceId == source.id]
    found: dict[str, Seed] = {}
    keys: dict[str, str] = {}
    for item in items:
        seed = find_duplicate(item, known)
        if seed is None:
            anchor = item["anchor"]
            candidate = Seed(
                id=f"seed-{_digest(meeting_id, item['kind'], anchor.id, _normalize(item['text']))}",
                meetingId=meeting_id, text=item["text"], owner=item["owner"], deadline=item["deadline"],
                kind=item["kind"], status="seed", health=1,
                sourceType="leaves" if anchor.via == "leaves" else source.type, sourceId=source.id,
                timestampSec=anchor.startSec if source.type == "meeting" else None, lastActivity=now, size=1,
                accountId=source.accountId, quote=item["quote"],
            )
            # Deterministic IDs make a concurrent duplicate create resolve to the same seed.
            seed = store.create_seed(candidate) or store.get_seed(meeting_id, candidate.id)
            if seed is None:
                raise StorageUnavailable("Seed conflicted but could not be read back")
            known.append(seed)
        found.setdefault(seed.id, seed)
        keys[item["key"]] = seed.id

    return Grove(seeds=list(found.values()), roots=_save_roots(store, meeting_id, items, keys))


def _save_roots(store: GroveStore, meeting_id: str, items: list[dict], keys: dict[str, str]) -> list[Root]:
    roots: dict[str, Root] = {}
    for item in items:
        from_id = keys[item["key"]]
        for dependency in item["dependsOn"]:
            to_id = keys.get(dependency)
            if not to_id or to_id == from_id:
                continue
            root = Root(id=f"root-{_digest(meeting_id, from_id, to_id, 'depends_on')}", meetingId=meeting_id,
                        fromSeedId=from_id, toSeedId=to_id, type="depends_on")
            store.create_root(root)
            roots[root.id] = root
    return list(roots.values())


def _find_in(text: str, quote) -> bool:
    return isinstance(quote, str) and bool(quote.strip()) and _normalize(quote) in _normalize(text)


def validate_source_items(raw_items: list, source: Source):
    """Drops items whose quote is not verbatim in the source, and nulls unsupported owners/deadlines."""
    valid = []
    body = source.text or ""
    for raw in raw_items:
        if not isinstance(raw, dict) or raw.get("kind") not in KINDS:
            continue
        text = raw.get("text").strip()[:MAX_TEXT] if isinstance(raw.get("text"), str) else ""
        quote = raw.get("quote")
        if not text or not _find_in(body, quote):
            continue
        valid.append({
            "key": str(raw.get("key") or len(valid)),
            "kind": raw["kind"], "text": text, "quote": re.sub(r"\s+", " ", quote).strip()[:MAX_QUOTE],
            "owner": _supported_owner(raw.get("owner"), [], [body]),
            "deadline": _supported_deadline(raw.get("deadline"), raw.get("deadlineEvidence"), [body]),
            "dependsOn": [key for key in raw.get("dependsOn") or [] if isinstance(key, str)],
        })
    return valid


def _source_duplicate(item: dict, seeds: list[Seed], source: Source):
    for seed in seeds:
        if seed.sourceId != source.id or seed.kind != item["kind"]:
            continue
        if (seed.quote and _normalize(seed.quote) == _normalize(item["quote"])) \
                or similarity(seed.text, item["text"]) >= RESTATEMENT_SIMILARITY:
            return seed
    return None


def extract_source_and_save(store: GroveStore, source: Source, model: Callable[[dict], list[dict]],
                            now: datetime | None = None) -> Grove:
    """Saves an email/chat/document/Slack Source and the seeds extracted from its text.
    Re-sending the same source returns the same seeds instead of duplicating them."""
    now = now or datetime.now(timezone.utc)
    stored = store.create_source(source) or store.get_source(source.meetingId, source.id)
    if stored is None:
        raise StorageUnavailable("Source conflicted but could not be read back")
    if (stored.text, stored.accountId, stored.type) != (source.text, source.accountId, source.type):
        raise SourceConflict("A source with this id already exists with different content.")

    payload = {"referenceDate": source.createdAt.date().isoformat(), "type": source.type,
               "title": source.title, "text": source.text}
    items = validate_source_items(model(payload), source)

    known = store.list_seeds(source.meetingId)
    found: dict[str, Seed] = {}
    keys: dict[str, str] = {}
    # Inactivity is measured from when the source was written, never from the future.
    activity = min(source.createdAt, now)
    for item in items:
        seed = _source_duplicate(item, known, source)
        if seed is None:
            candidate = Seed(
                id=f"seed-{_digest(source.meetingId, source.id, item['kind'], _normalize(item['quote']))}",
                meetingId=source.meetingId, text=item["text"], owner=item["owner"], deadline=item["deadline"],
                kind=item["kind"], status="seed", health=1, sourceType=source.type, sourceId=source.id,
                timestampSec=None, lastActivity=activity, size=1, accountId=source.accountId, quote=item["quote"],
            )
            seed = store.create_seed(candidate) or store.get_seed(source.meetingId, candidate.id)
            if seed is None:
                raise StorageUnavailable("Seed conflicted but could not be read back")
            known.append(seed)
        found.setdefault(seed.id, seed)
        keys[item["key"]] = seed.id
    return Grove(seeds=list(found.values()), roots=_save_roots(store, source.meetingId, items, keys))
