"""Azure Cosmos DB implementation of `GroveStore`.

Containers `seeds`, `roots`, `utterances` and `sources` all use `/meetingId` as the
partition key, so every point read, write and query is scoped to one meeting.
"""
import os
from threading import Lock

from azure.core.exceptions import AzureError
from azure.cosmos import CosmosClient, PartitionKey
from azure.cosmos.exceptions import CosmosResourceExistsError, CosmosResourceNotFoundError
from pydantic import ValidationError

from shared.models import Grove, Root, Seed, SeedPatch, Source, Utterance
from shared.store import StorageNotConfigured, StorageUnavailable

CONTAINERS = ("seeds", "roots", "utterances", "sources")
PARTITION_KEY_PATH = "/meetingId"


def _clean(document: dict):
    # Cosmos adds _rid, _self, _etag, _attachments and _ts; wire models forbid extras.
    return {key: value for key, value in document.items() if not key.startswith("_")}


class CosmosStore:
    def __init__(self, database):
        """`database` is an azure.cosmos DatabaseProxy (or a compatible test double)."""
        # No per-container throughput: containers share the database's RU/s.
        try:
            self.containers = {
                name: database.create_container_if_not_exists(
                    id=name, partition_key=PartitionKey(path=PARTITION_KEY_PATH))
                for name in CONTAINERS
            }
        except AzureError as exc:
            raise StorageUnavailable("Cosmos containers could not be opened") from exc

    def _call(self, operation, *args, **kwargs):
        try:
            return operation(*args, **kwargs)
        except (CosmosResourceExistsError, CosmosResourceNotFoundError):
            raise
        except AzureError as exc:
            raise StorageUnavailable("Cosmos request failed") from exc

    @staticmethod
    def _parse(model, document: dict):
        try:
            return model.model_validate(_clean(document))
        except ValidationError as exc:
            # A malformed stored document is a server fault, not a client 400.
            raise StorageUnavailable(f"Stored {model.__name__} failed validation") from exc

    def _create(self, container: str, item):
        try:
            created = self._call(self.containers[container].create_item, body=item.model_dump(mode="json"))
        except CosmosResourceExistsError:
            return None
        return self._parse(type(item), created)

    def _get(self, container: str, model, meeting_id: str, item_id: str):
        try:
            document = self._call(self.containers[container].read_item, item=item_id, partition_key=meeting_id)
        except CosmosResourceNotFoundError:
            return None
        return self._parse(model, document)

    def _list(self, container: str, model, meeting_id: str):
        def run():
            return list(self.containers[container].query_items(
                query="SELECT * FROM c WHERE c.meetingId = @meetingId",
                parameters=[{"name": "@meetingId", "value": meeting_id}],
                partition_key=meeting_id,
            ))
        return [self._parse(model, document) for document in self._call(run)]

    def create_seed(self, seed: Seed):
        return self._create("seeds", seed)

    def get_seed(self, meeting_id: str, seed_id: str):
        return self._get("seeds", Seed, meeting_id, seed_id)

    def list_seeds(self, meeting_id: str):
        return self._list("seeds", Seed, meeting_id)

    def patch_seed(self, meeting_id: str, seed_id: str, patch: SeedPatch):
        # SeedPatch has already validated each field; a partial patch is atomic in Cosmos.
        operations = [{"op": "set", "path": f"/{field}", "value": value}
                      for field, value in patch.model_dump(mode="json", exclude_unset=True).items()]
        try:
            document = self._call(self.containers["seeds"].patch_item,
                                  item=seed_id, partition_key=meeting_id, patch_operations=operations)
        except CosmosResourceNotFoundError:
            return None
        return self._parse(Seed, document)

    def create_root(self, root: Root):
        return self._create("roots", root)

    def list_roots(self, meeting_id: str):
        return self._list("roots", Root, meeting_id)

    def save_utterance(self, utterance: Utterance):
        try:
            document = self._call(self.containers["utterances"].upsert_item, body=utterance.model_dump(mode="json"))
        except CosmosResourceNotFoundError as exc:
            raise StorageUnavailable("Utterance container is missing") from exc
        return self._parse(Utterance, document)

    def list_utterances(self, meeting_id: str):
        return sorted(self._list("utterances", Utterance, meeting_id), key=lambda item: (item.startSec, item.id))

    def create_source(self, source: Source):
        return self._create("sources", source)

    def list_sources(self, meeting_id: str):
        return self._list("sources", Source, meeting_id)

    def get_source(self, meeting_id: str, source_id: str):
        return self._get("sources", Source, meeting_id, source_id)

    def get_grove(self, meeting_id: str):
        return Grove(seeds=self.list_seeds(meeting_id), roots=self.list_roots(meeting_id))


DEFAULT_DATABASE_THROUGHPUT = 1000


def _require_shared_throughput(database, database_name: str):
    # create_database_if_not_exists ignores offer_throughput for an existing database. Without
    # shared throughput, each container would get its own RU/s and can exceed the account limit.
    try:
        database.get_throughput()
    except CosmosResourceNotFoundError:
        raise StorageNotConfigured(
            f"Cosmos database '{database_name}' exists without shared throughput. Delete it so it can be "
            "recreated with shared RU/s, or set AZURE_COSMOS_DATABASE_THROUGHPUT=serverless.") from None


_cache: dict[tuple[str, str], CosmosStore] = {}
_cache_lock = Lock()


def cosmos_settings():
    endpoint = os.getenv("AZURE_COSMOS_ENDPOINT", "").strip()
    key = os.getenv("AZURE_COSMOS_KEY", "").strip()
    database = os.getenv("AZURE_COSMOS_DATABASE", "").strip() or "grovekeeper"
    missing = [name for name, value in (("AZURE_COSMOS_ENDPOINT", endpoint), ("AZURE_COSMOS_KEY", key)) if not value]
    if missing:
        raise StorageNotConfigured(f"Cosmos storage is selected but missing: {', '.join(missing)}.")
    return endpoint, key, database, database_throughput()


def database_throughput():
    """Shared RU/s for the whole database (default 1000). 'serverless' or 0 sets none."""
    raw = os.getenv("AZURE_COSMOS_DATABASE_THROUGHPUT", "").strip().lower() or str(DEFAULT_DATABASE_THROUGHPUT)
    if raw in ("serverless", "none", "0"):
        return None
    if not raw.isdigit() or int(raw) < 400:
        raise StorageNotConfigured("AZURE_COSMOS_DATABASE_THROUGHPUT must be 'serverless' or at least 400.")
    return int(raw)


def cosmos_store_from_env():
    """One client per process and account, reused across invocations. Failures are not cached."""
    endpoint, key, database_name, throughput = cosmos_settings()
    cache_key = (endpoint, database_name)
    with _cache_lock:
        if cache_key not in _cache:
            try:
                client = CosmosClient(endpoint, credential=key)
                if throughput is None:
                    database = client.create_database_if_not_exists(id=database_name)
                else:
                    database = client.create_database_if_not_exists(id=database_name, offer_throughput=throughput)
                    _require_shared_throughput(database, database_name)
            except (AzureError, ValueError) as exc:
                raise StorageUnavailable("Cosmos account could not be reached") from exc
            _cache[cache_key] = CosmosStore(database)
        return _cache[cache_key]
