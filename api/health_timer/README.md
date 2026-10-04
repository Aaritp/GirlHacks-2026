# Seed health — Person C

`health.py` calculates `clamp(1 - daysSinceLastActivity / 7, 0, 1)` with a testable
UTC clock. Future activity clamps to full health. Bloom means completed and stays
healthy. Deadline acceleration is deliberately not enabled until the team agrees
on a rule; deadlines appear separately in the UI. Only intentional progress/check-in
actions refresh lastActivity, never resizing or timer runs.

Below 0.3, the UI displays wilted without overwriting the stored progress state.
This preserves whether an active seed was planted or growing when it recovers.

## Shared-storage handoff

The timer is not registered yet. `HealthRepository` in `health.py` needs two things the
shared `GroveStore` (`api/shared/store.py`, see `docs/storage.md`) does not provide, and
that document asks owners to agree before adding them:

- `iter_health_candidates()` pages through persisted seeds across meeting partitions.
- `update_health_if_unchanged(original, health)` atomically patches only health using
  an ETag or equivalent comparison. Return false on conflict; next run retries it.

Once the storage owner adds them to both backends, register
`create_health_blueprint(repository)` from `timer.py` in `function_app.py`. It runs
hourly, never on startup. Timer monitoring also needs AzureWebJobsStorage configured.
The timer is intentionally not registered against the process-local memory store, which
would give a false impression of persistence.

No second Cosmos client is introduced here. Tests exercise the handoff and conflicts
with a fake repository. Until the timer runs, the forest recomputes health for display
from `lastActivity`, so plants still wilt on screen.
