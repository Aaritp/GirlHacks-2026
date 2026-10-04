from datetime import datetime, timedelta, timezone

import pytest

from health_timer.health import calculate_health, refresh_health
from shared.models import Seed

CLOCK = datetime(2026, 10, 3, 16, tzinfo=timezone.utc)


def make_seed(days=0, **overrides):
    values = dict(id="s", meetingId="m", text="Review checklist", owner=None,
                  deadline=None, kind="commitment", status="sprout", health=1,
                  sourceType="meeting", sourceId="m", timestampSec=12,
                  lastActivity=CLOCK - timedelta(days=days), size=1)
    return Seed(**(values | overrides))


@pytest.mark.parametrize("days,expected", [(0, 1), (3.5, .5), (4.9, .3), (7, 0), (30, 0), (-2, 1)])
def test_health_decay_and_clamping(days, expected):
    assert calculate_health(make_seed(days), CLOCK) == expected


def test_completed_seeds_do_not_wilt():
    assert calculate_health(make_seed(30, status="bloom"), CLOCK) == 1


def test_naive_clock_is_rejected():
    with pytest.raises(ValueError):
        calculate_health(make_seed(), datetime(2026, 10, 3))


def test_refresh_persists_only_health_and_handles_conflicts():
    class Repository:
        def __init__(self):
            self.seeds = [make_seed(3.5), make_seed(7, id="conflict"), make_seed(0, id="fresh")]
            self.writes = []

        def iter_health_candidates(self):
            return iter(self.seeds)

        def update_health_if_unchanged(self, original, health):
            self.writes.append((original.id, health))
            return original.id != "conflict"

    repository = Repository()
    assert refresh_health(repository, CLOCK) == {"checked": 3, "updated": 1, "conflicts": 1}
    assert repository.writes == [("s", .5), ("conflict", 0)]
    assert repository.seeds[0].status == "sprout"
    assert repository.seeds[0].lastActivity == CLOCK - timedelta(days=3.5)
