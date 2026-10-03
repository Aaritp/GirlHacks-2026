"""Explicitly opt-in, process-local storage. Replace with Cosmos before deployment."""
import os
from threading import RLock

from shared.models import Grove, Seed, SeedPatch, Utterance


class MemoryStore:
    def __init__(self):
        self.seeds: dict[tuple[str, str], Seed] = {}
        self.utterances: dict[tuple[str, str], Utterance] = {}
        self.lock = RLock()

    def create_seed(self, seed: Seed):
        with self.lock:
            key = (seed.meetingId, seed.id)
            if key in self.seeds:
                return None
            self.seeds[key] = seed.model_copy(deep=True)
            return seed.model_copy(deep=True)

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

    def save_utterance(self, utterance: Utterance):
        with self.lock:
            self.utterances[(utterance.meetingId, utterance.id)] = utterance.model_copy(deep=True)
            return utterance.model_copy(deep=True)

    def get_grove(self, meeting_id: str):
        with self.lock:
            return Grove(seeds=[seed.model_copy(deep=True) for (meeting, _), seed in self.seeds.items()
                                if meeting == meeting_id], roots=[])


store = MemoryStore()


def memory_enabled():
    return os.getenv("GROVEKEEPER_STORAGE_MODE") == "memory"
