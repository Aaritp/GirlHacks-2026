"""Shared persistence for seeds, roots, utterances and sources.

Every record is partitioned by meetingId. Route handlers call `get_store()` and use
only the `GroveStore` methods, so the same code runs against memory or Cosmos.
See docs/storage.md for the contract other owners can rely on.
"""
import os
from collections.abc import Callable
from functools import wraps
from threading import RLock
from typing import Protocol

from shared.http import error_response
from shared.models import Account, Grove, Root, Seed, SeedPatch, Source, Utterance


class StorageNotConfigured(Exception):
    """No storage backend is selected, or its required settings are missing (503)."""


class StorageUnavailable(Exception):
    """The configured backend failed or returned unreadable data (503). Never retried silently."""


class GroveStore(Protocol):
    # Creates return None when the (meetingId, id) pair already exists; they never overwrite.
    def create_seed(self, seed: Seed) -> Seed | None: ...
    def get_seed(self, meeting_id: str, seed_id: str) -> Seed | None: ...
    def list_seeds(self, meeting_id: str) -> list[Seed]: ...
    # Returns None when the seed does not exist in that meeting.
    def patch_seed(self, meeting_id: str, seed_id: str, patch: SeedPatch) -> Seed | None: ...
    def create_root(self, root: Root) -> Root | None: ...
    def list_roots(self, meeting_id: str) -> list[Root]: ...
    # Upserts by (meetingId, id) so a Speech retry does not duplicate text.
    def save_utterance(self, utterance: Utterance) -> Utterance: ...
    # Ordered by startSec.
    def list_utterances(self, meeting_id: str) -> list[Utterance]: ...
    def create_source(self, source: Source) -> Source | None: ...
    def get_source(self, meeting_id: str, source_id: str) -> Source | None: ...
    def get_grove(self, meeting_id: str) -> Grove: ...
    # Accounts span meetings. Account reads are cross-partition queries filtered by accountId.
    def create_account(self, account: Account) -> Account | None: ...
    def get_account(self, account_id: str) -> Account | None: ...
    # Sorted by name.
    def list_accounts(self) -> list[Account]: ...
    def list_account_sources(self, account_id: str) -> list[Source]: ...
    def list_account_seeds(self, account_id: str) -> list[Seed]: ...


class MemoryStore:
    """Process-local development storage. Data is lost on restart and not shared across workers."""

    def __init__(self):
        self.seeds: dict[tuple[str, str], Seed] = {}
        self.roots: dict[tuple[str, str], Root] = {}
        self.utterances: dict[tuple[str, str], Utterance] = {}
        self.sources: dict[tuple[str, str], Source] = {}
        self.accounts: dict[str, Account] = {}
        self.lock = RLock()

    def clear(self):
        with self.lock:
            for table in (self.seeds, self.roots, self.utterances, self.sources, self.accounts):
                table.clear()

    def _create(self, table: dict, item):
        with self.lock:
            key = (item.meetingId, item.id)
            if key in table:
                return None
            table[key] = item.model_copy(deep=True)
            return item.model_copy(deep=True)

    def _list(self, table: dict, meeting_id: str):
        with self.lock:
            return [item.model_copy(deep=True) for (meeting, _), item in table.items() if meeting == meeting_id]

    def _get(self, table: dict, meeting_id: str, item_id: str):
        with self.lock:
            item = table.get((meeting_id, item_id))
            return item.model_copy(deep=True) if item else None

    def create_seed(self, seed: Seed):
        return self._create(self.seeds, seed)

    def get_seed(self, meeting_id: str, seed_id: str):
        return self._get(self.seeds, meeting_id, seed_id)

    def list_seeds(self, meeting_id: str):
        return self._list(self.seeds, meeting_id)

    def patch_seed(self, meeting_id: str, seed_id: str, patch: SeedPatch):
        with self.lock:
            key = (meeting_id, seed_id)
            if key not in self.seeds:
                return None
            updated = Seed.model_validate({
                **self.seeds[key].model_dump(), **patch.model_dump(exclude_unset=True),
            })
            self.seeds[key] = updated
            return updated.model_copy(deep=True)

    def create_root(self, root: Root):
        return self._create(self.roots, root)

    def list_roots(self, meeting_id: str):
        return self._list(self.roots, meeting_id)

    def save_utterance(self, utterance: Utterance):
        with self.lock:
            self.utterances[(utterance.meetingId, utterance.id)] = utterance.model_copy(deep=True)
            return utterance.model_copy(deep=True)

    def list_utterances(self, meeting_id: str):
        return sorted(self._list(self.utterances, meeting_id), key=lambda item: (item.startSec, item.id))

    def create_source(self, source: Source):
        return self._create(self.sources, source)

    def get_source(self, meeting_id: str, source_id: str):
        return self._get(self.sources, meeting_id, source_id)

    def get_grove(self, meeting_id: str):
        with self.lock:
            return Grove(seeds=self.list_seeds(meeting_id), roots=self.list_roots(meeting_id))

    def create_account(self, account: Account):
        with self.lock:
            if account.id in self.accounts:
                return None
            self.accounts[account.id] = account.model_copy(deep=True)
            return account.model_copy(deep=True)

    def get_account(self, account_id: str):
        with self.lock:
            account = self.accounts.get(account_id)
            return account.model_copy(deep=True) if account else None

    def list_accounts(self):
        with self.lock:
            return sorted((a.model_copy(deep=True) for a in self.accounts.values()), key=lambda a: (a.name.lower(), a.id))

    def list_account_sources(self, account_id: str):
        with self.lock:
            return [s.model_copy(deep=True) for s in self.sources.values() if s.accountId == account_id]

    def list_account_seeds(self, account_id: str):
        with self.lock:
            return [s.model_copy(deep=True) for s in self.seeds.values() if s.accountId == account_id]


store = MemoryStore()
_override: GroveStore | None = None


def storage_mode():
    """`memory`, `cosmos`, or '' when unset. Cosmos is selected when its endpoint is configured."""
    mode = os.getenv("GROVEKEEPER_STORAGE_MODE", "").strip().lower()
    if mode:
        return mode
    return "cosmos" if os.getenv("AZURE_COSMOS_ENDPOINT", "").strip() else ""


def memory_enabled():
    return storage_mode() == "memory"


def get_store() -> GroveStore:
    """Returns the configured store or raises. Never falls back from Cosmos to memory."""
    if _override is not None:
        return _override
    mode = storage_mode()
    if mode == "memory":
        return store
    if mode == "cosmos":
        from shared.cosmos import cosmos_store_from_env
        return cosmos_store_from_env()
    if not mode:
        raise StorageNotConfigured(
            "Set GROVEKEEPER_STORAGE_MODE=cosmos with Cosmos settings, or memory for local development.")
    raise StorageNotConfigured("GROVEKEEPER_STORAGE_MODE must be 'cosmos' or 'memory'.")


def use_store(instance: GroveStore | None):
    """Test hook: force a store instance (None restores environment selection)."""
    global _override
    _override = instance


def storage_errors(handler: Callable):
    """Maps storage failures to the shared error envelope. Messages never include meeting text."""
    @wraps(handler)
    def wrapped(*args, **kwargs):
        try:
            return handler(*args, **kwargs)
        except StorageNotConfigured as exc:
            return error_response(503, "STORAGE_NOT_CONFIGURED", str(exc))
        except StorageUnavailable:
            return error_response(503, "STORAGE_UNAVAILABLE", "Storage is temporarily unavailable.")
    return wrapped
