"""Validates model output against the transcript, deduplicates windows, and persists results.

Every saved seed cites an utterance from the request. Owners and deadlines are kept only
when the cited text supports them; anything unsupported becomes null.
"""
import hashlib
import re
from collections.abc import Callable
from datetime import date, datetime, timezone

from shared.models import Grove, Root, Seed, Source, Utterance
from shared.store import GroveStore, StorageUnavailable

MAX_TEXT = 500
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


def _supported_owner(owner, cited: list[Utterance]):
    if not isinstance(owner, str) or not owner.strip():
        return None
    candidate = owner.strip()
    if candidate.lower() in UNKNOWN_SPEAKERS:
        return None
    for utterance in cited:
        if utterance.speaker.strip().lower() == candidate.lower() and utterance.speaker.lower() not in UNKNOWN_SPEAKERS:
            return utterance.speaker.strip()
    for utterance in cited:
        if re.search(rf"(?<!\w){re.escape(candidate)}(?!\w)", utterance.text, re.IGNORECASE):
            return candidate
    return None


def _supported_deadline(deadline, evidence, cited: list[Utterance]):
    if not isinstance(deadline, str) or not isinstance(evidence, str) or not evidence.strip():
        return None
    try:
        parsed = date.fromisoformat(deadline)
    except ValueError:
        return None
    quote = _normalize(evidence)
    return parsed if any(quote in _normalize(item.text) for item in cited) else None


def validate_items(raw_items: list, utterances: list[Utterance]):
    """Drops items without real provenance and nulls unsupported owners/deadlines."""
    by_id = {item.id: item for item in utterances}
    valid = []
    for raw in raw_items:
        if not isinstance(raw, dict) or raw.get("kind") not in ("commitment", "decision"):
            continue
        text = raw.get("text").strip()[:MAX_TEXT] if isinstance(raw.get("text"), str) else ""
        cited = [by_id[uid] for uid in raw.get("utteranceIds") or [] if isinstance(uid, str) and uid in by_id]
        if not text or not cited:
            continue
        anchor = min(cited, key=lambda item: (item.startSec, item.id))
        valid.append({
            "key": str(raw.get("key") or len(valid)),
            "kind": raw["kind"], "text": text,
            "owner": _supported_owner(raw.get("owner"), cited),
            "deadline": _supported_deadline(raw.get("deadline"), raw.get("deadlineEvidence"), cited),
            "anchor": anchor,
            "dependsOn": [key for key in raw.get("dependsOn") or [] if isinstance(key, str)],
        })
    return valid


def find_duplicate(item: dict, seeds: list[Seed], whiteboard_id: str | None = None):
    """Same item seen in an overlapping window: same kind and anchor time with similar text,
    or a near-identical restatement later in the meeting with a compatible owner."""
    for seed in seeds:
        if seed.kind != item["kind"]:
            continue
        if whiteboard_id is not None:
            if seed.sourceType != "whiteboard" or seed.sourceId != whiteboard_id:
                continue
        elif seed.sourceType == "whiteboard":
            continue
        score = similarity(seed.text, item["text"])
        same_anchor = seed.timestampSec is not None and abs(seed.timestampSec - item["anchor"].startSec) < 1e-6
        if same_anchor and score >= SAME_ANCHOR_SIMILARITY:
            return seed
        owners_compatible = not seed.owner or not item["owner"] or seed.owner.lower() == item["owner"].lower()
        if score >= RESTATEMENT_SIMILARITY and owners_compatible:
            return seed
    return None


def extract_and_save(store: GroveStore, meeting_id: str, utterances: list[Utterance],
                     model: Callable[[dict], list[dict]], now: datetime | None = None,
                     *, source: Source | None = None) -> Grove:
    now = now or datetime.now(timezone.utc)
    if source is not None and (source.meetingId != meeting_id or source.type != "whiteboard"):
        raise ValueError("Explicit extraction sources must be whiteboards in this meeting")
    if any(u.meetingId != meeting_id for u in utterances):
        raise ValueError("Extraction evidence must belong to this meeting")
    whiteboard_id = source.id if source else None
    # Persist the transcript and its Source first so every seed can be traced back.
    store.create_source(source or Source(id=meeting_id, meetingId=meeting_id, type="meeting",
                                        title="Meeting transcript", createdAt=now))
    if source is None:
        for utterance in utterances:
            store.save_utterance(utterance)

    ordered = sorted(utterances, key=lambda item: (item.startSec, item.id))
    window = {
        "referenceDate": now.date().isoformat(),
        "utterances": [{"id": u.id, "speaker": u.speaker, "startSec": u.startSec, "text": u.text} for u in ordered],
    }
    items = validate_items(model(window), ordered)

    known = store.list_seeds(meeting_id)
    found: dict[str, Seed] = {}
    keys: dict[str, str] = {}
    for item in items:
        seed = find_duplicate(item, known, whiteboard_id)
        if seed is None:
            anchor = item["anchor"]
            candidate = Seed(
                id=f"seed-{_digest(meeting_id, item['kind'], anchor.id, _normalize(item['text']))}",
                meetingId=meeting_id, text=item["text"], owner=item["owner"], deadline=item["deadline"],
                kind=item["kind"], status="seed", health=1,
                sourceType="whiteboard" if source else ("leaves" if anchor.via == "leaves" else "meeting"),
                sourceId=source.id if source else meeting_id,
                timestampSec=None if source else anchor.startSec, lastActivity=now, size=1,
            )
            # Deterministic IDs make a concurrent duplicate create resolve to the same seed.
            seed = store.create_seed(candidate) or store.get_seed(meeting_id, candidate.id)
            if seed is None:
                raise StorageUnavailable("Seed conflicted but could not be read back")
            known.append(seed)
        found.setdefault(seed.id, seed)
        keys[item["key"]] = seed.id

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
    return Grove(seeds=list(found.values()), roots=list(roots.values()))
