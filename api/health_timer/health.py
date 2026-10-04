from datetime import datetime, timezone
from typing import Iterable, Protocol

from shared.models import Seed


def calculate_health(seed: Seed, now: datetime | None = None) -> float:
    """Seven-day inactivity decay. Completed seeds stay healthy; resizing is not activity."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("Health calculations require a timezone-aware clock")
    if seed.status == "bloom":
        return 1.0
    days = max(0.0, (now - seed.lastActivity).total_seconds() / 86400)
    return round(max(0.0, min(1.0, 1 - days / 7)), 4)


class HealthRepository(Protocol):
    def iter_health_candidates(self) -> Iterable[Seed]:
        """Yield stored seeds across meeting partitions, paging rather than loading everything."""
        ...

    def update_health_if_unchanged(self, original: Seed, health: float) -> bool:
        """Persist only health; return False on a concurrent edit/deletion.

        Use an ETag or atomic comparison against the original status/lastActivity.
        Never overwrite a user update, deadline, source, or lastActivity.
        """
        ...


def refresh_health(repository: HealthRepository, now: datetime | None = None) -> dict[str, int]:
    clock = now or datetime.now(timezone.utc)
    counts = {"checked": 0, "updated": 0, "conflicts": 0}
    for seed in repository.iter_health_candidates():
        counts["checked"] += 1
        health = calculate_health(seed, clock)
        if health == seed.health:
            continue
        if repository.update_health_if_unchanged(seed, health):
            counts["updated"] += 1
        else:
            counts["conflicts"] += 1
    return counts
