import pytest

from fake_cosmos import FakeDatabase, service_error
from shared import cosmos, store as store_module
from shared.cosmos import CosmosStore
from shared.models import Root, Seed, SeedPatch, Source, Utterance
from shared.store import MemoryStore, StorageNotConfigured, StorageUnavailable, get_store


@pytest.fixture(params=["memory", "cosmos"])
def backend(request):
    return MemoryStore() if request.param == "memory" else CosmosStore(FakeDatabase())


def make_seed(meeting="meeting-a", seed_id="seed-1", **changes):
    return Seed.model_validate({
        "id": seed_id, "meetingId": meeting, "text": "Send the checklist", "owner": "Alex",
        "deadline": "2026-10-05", "kind": "commitment", "status": "seed", "health": 1,
        "sourceType": "meeting", "sourceId": meeting, "timestampSec": 12,
        "lastActivity": "2026-10-03T13:00:00Z", "size": 1, **changes,
    })


def make_utterance(meeting="meeting-a", utterance_id="u1", start=0.0, text="Hello"):
    return Utterance(id=utterance_id, meetingId=meeting, speaker="Alex", text=text, startSec=start, via="voice")


def test_seed_round_trip_and_conflict(backend):
    assert backend.create_seed(make_seed()) == make_seed()
    assert backend.create_seed(make_seed(text="Different")) is None
    assert backend.get_seed("meeting-a", "seed-1").text == "Send the checklist"
    assert backend.get_seed("meeting-a", "missing") is None


def test_meetings_are_isolated_even_with_shared_ids(backend):
    backend.create_seed(make_seed("meeting-a"))
    backend.create_seed(make_seed("meeting-b"))
    backend.patch_seed("meeting-b", "seed-1", SeedPatch(status="bloom", owner=None))
    assert backend.get_seed("meeting-a", "seed-1").status == "seed"
    assert backend.get_seed("meeting-a", "seed-1").owner == "Alex"
    assert backend.get_seed("meeting-b", "seed-1").status == "bloom"
    assert backend.patch_seed("meeting-c", "seed-1", SeedPatch(status="bloom")) is None
    backend.create_root(Root(id="r", meetingId="meeting-b", fromSeedId="seed-1", toSeedId="x", type="related"))
    assert backend.get_grove("meeting-a").roots == []
    assert [seed.meetingId for seed in backend.get_grove("meeting-b").seeds] == ["meeting-b"]


def test_patch_preserves_identity_and_provenance(backend):
    backend.create_seed(make_seed())
    updated = backend.patch_seed("meeting-a", "seed-1", SeedPatch(deadline=None, size=2.5))
    assert updated.deadline is None and updated.size == 2.5
    assert (updated.id, updated.meetingId, updated.sourceId, updated.sourceType, updated.timestampSec) == \
        ("seed-1", "meeting-a", "meeting-a", "meeting", 12)
    assert backend.get_seed("meeting-a", "seed-1") == updated


def test_utterances_upsert_and_sort(backend):
    backend.save_utterance(make_utterance(utterance_id="late", start=30))
    backend.save_utterance(make_utterance(utterance_id="early", start=5, text="First"))
    backend.save_utterance(make_utterance(utterance_id="early", start=5, text="First, corrected"))
    backend.save_utterance(make_utterance(meeting="meeting-b", utterance_id="early"))
    saved = backend.list_utterances("meeting-a")
    assert [(item.id, item.text) for item in saved] == [("early", "First, corrected"), ("late", "Hello")]


def test_roots_and_sources(backend):
    root = Root(id="root-1", meetingId="meeting-a", fromSeedId="a", toSeedId="b", type="depends_on")
    assert backend.create_root(root) == root
    assert backend.create_root(root) is None
    assert backend.list_roots("meeting-a") == [root]
    source = Source(id="meeting-a", meetingId="meeting-a", type="meeting", title="Planning",
                    createdAt="2026-10-03T13:00:00Z")
    assert backend.create_source(source) == source
    assert backend.create_source(source.model_copy(update={"title": "Other"})) is None
    assert backend.get_source("meeting-a", "meeting-a").title == "Planning"
    assert backend.get_source("meeting-b", "meeting-a") is None


def test_results_are_copies(backend):
    backend.create_seed(make_seed())
    backend.get_grove("meeting-a").seeds[0].text = "Mutated"
    assert backend.get_seed("meeting-a", "seed-1").text == "Send the checklist"


def test_cosmos_uses_meeting_partition_and_strips_system_fields():
    database = FakeDatabase()
    backend = CosmosStore(database)
    assert set(database.containers) == {"seeds", "roots", "utterances", "sources"}
    assert all(container.field == "meetingId" for container in database.containers.values())
    backend.create_seed(make_seed())
    assert "_etag" in database.containers["seeds"].items[("meeting-a", "seed-1")]
    assert backend.list_seeds("meeting-a") == [make_seed()]
    assert database.containers["seeds"].queries[-1]["partition_key"] == "meeting-a"


def test_cosmos_failures_are_not_reported_as_missing_or_success():
    database = FakeDatabase()
    backend = CosmosStore(database)
    database.containers["seeds"].fail_with = service_error()
    for call in (lambda: backend.create_seed(make_seed()), lambda: backend.get_seed("meeting-a", "seed-1"),
                 lambda: backend.patch_seed("meeting-a", "seed-1", SeedPatch(status="bloom")),
                 lambda: backend.get_grove("meeting-a")):
        with pytest.raises(StorageUnavailable):
            call()


def test_cosmos_corrupt_document_is_a_storage_fault():
    database = FakeDatabase()
    backend = CosmosStore(database)
    database.containers["seeds"].items[("meeting-a", "bad")] = {"id": "bad", "meetingId": "meeting-a"}
    with pytest.raises(StorageUnavailable):
        backend.list_seeds("meeting-a")


@pytest.fixture
def clean_env(monkeypatch):
    for name in ("GROVEKEEPER_STORAGE_MODE", "AZURE_COSMOS_ENDPOINT", "AZURE_COSMOS_KEY", "AZURE_COSMOS_DATABASE",
                 "AZURE_COSMOS_DATABASE_THROUGHPUT"):
        monkeypatch.delenv(name, raising=False)
    cosmos._cache.clear()
    yield monkeypatch
    cosmos._cache.clear()


def test_store_selection_never_falls_back_to_memory(clean_env):
    with pytest.raises(StorageNotConfigured):
        get_store()
    clean_env.setenv("GROVEKEEPER_STORAGE_MODE", "cosmos")
    with pytest.raises(StorageNotConfigured, match="AZURE_COSMOS_ENDPOINT, AZURE_COSMOS_KEY"):
        get_store()
    clean_env.setenv("GROVEKEEPER_STORAGE_MODE", "sqlite")
    with pytest.raises(StorageNotConfigured):
        get_store()
    clean_env.setenv("GROVEKEEPER_STORAGE_MODE", "memory")
    assert get_store() is store_module.store


def test_cosmos_selected_by_endpoint_and_client_reused(clean_env):
    created = []

    class FakeClient:
        def __init__(self, endpoint, credential):
            created.append((endpoint, credential))

        def create_database_if_not_exists(self, id, offer_throughput=None):
            assert id == "grovekeeper"
            return FakeDatabase(throughput=offer_throughput)

    clean_env.setattr(cosmos, "CosmosClient", FakeClient)
    clean_env.setenv("AZURE_COSMOS_ENDPOINT", "https://example.documents.azure.com:443/")
    clean_env.setenv("AZURE_COSMOS_KEY", "secret")
    first = get_store()
    assert isinstance(first, CosmosStore)
    assert get_store() is first
    assert created == [("https://example.documents.azure.com:443/", "secret")]


def test_unreachable_cosmos_is_unavailable_and_not_cached(clean_env):
    class BrokenClient:
        def __init__(self, endpoint, credential):
            pass

        def create_database_if_not_exists(self, id, offer_throughput=None):
            raise service_error()

    clean_env.setattr(cosmos, "CosmosClient", BrokenClient)
    clean_env.setenv("GROVEKEEPER_STORAGE_MODE", "cosmos")
    clean_env.setenv("AZURE_COSMOS_ENDPOINT", "https://example.documents.azure.com:443/")
    clean_env.setenv("AZURE_COSMOS_KEY", "secret")
    with pytest.raises(StorageUnavailable):
        get_store()
    assert cosmos._cache == {}


def cosmos_env(monkeypatch, existing=None, **settings):
    """Points storage at a fake account. `existing` simulates a database that already exists."""
    calls = []

    class FakeClient:
        def __init__(self, endpoint, credential):
            pass

        def create_database_if_not_exists(self, id, **options):
            calls.append(options)
            return existing if existing is not None else FakeDatabase(throughput=options.get("offer_throughput"))

    monkeypatch.setattr(cosmos, "CosmosClient", FakeClient)
    monkeypatch.setenv("GROVEKEEPER_STORAGE_MODE", "cosmos")
    monkeypatch.setenv("AZURE_COSMOS_ENDPOINT", "https://example.documents.azure.com:443/")
    monkeypatch.setenv("AZURE_COSMOS_KEY", "secret")
    for name, value in settings.items():
        monkeypatch.setenv(name, value)
    return calls


def test_database_gets_shared_throughput_and_containers_get_none(clean_env):
    database = FakeDatabase(throughput=1000)
    calls = cosmos_env(clean_env, existing=database)
    get_store()
    assert calls == [{"offer_throughput": 1000}]
    assert set(database.container_options) == {"seeds", "roots", "utterances", "sources"}
    # No per-container throughput, so every container shares the database's RU/s.
    assert all(options == {} for options in database.container_options.values())


def test_existing_database_without_shared_throughput_is_rejected_clearly(clean_env):
    old = FakeDatabase(throughput=None)
    cosmos_env(clean_env, existing=old)
    with pytest.raises(StorageNotConfigured, match="exists without shared throughput. Delete it"):
        get_store()
    assert cosmos._cache == {}
    assert old.containers == {}


def test_serverless_and_custom_throughput(clean_env):
    calls = cosmos_env(clean_env, AZURE_COSMOS_DATABASE_THROUGHPUT="serverless")
    get_store()
    assert calls == [{}]
    cosmos._cache.clear()
    calls = cosmos_env(clean_env, AZURE_COSMOS_DATABASE_THROUGHPUT="400")
    get_store()
    assert calls == [{"offer_throughput": 400}]


@pytest.mark.parametrize("value", ["100", "lots", "-5"])
def test_invalid_throughput_is_a_configuration_error(clean_env, value):
    cosmos_env(clean_env, AZURE_COSMOS_DATABASE_THROUGHPUT=value)
    with pytest.raises(StorageNotConfigured, match="AZURE_COSMOS_DATABASE_THROUGHPUT"):
        get_store()
