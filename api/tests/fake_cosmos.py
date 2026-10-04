"""In-process stand-in for azure.cosmos DatabaseProxy/ContainerProxy.

Raises the real SDK exceptions and enforces (partition key, id) uniqueness the way Cosmos
does. It is not a substitute for testing against a real account.
"""
import copy

from azure.cosmos.exceptions import CosmosHttpResponseError, CosmosResourceExistsError, CosmosResourceNotFoundError


class FakeContainer:
    def __init__(self, name, partition_path):
        self.name = name
        self.field = partition_path.lstrip("/")
        self.items: dict[tuple[str, str], dict] = {}
        self.fail_with: Exception | None = None
        self.queries: list[dict] = []

    def _check(self):
        if self.fail_with:
            raise self.fail_with

    def _stored(self, body):
        return {**copy.deepcopy(body), "_rid": "rid", "_etag": "etag", "_ts": 1}

    def create_item(self, body):
        self._check()
        key = (body[self.field], body["id"])
        if key in self.items:
            raise CosmosResourceExistsError(status_code=409, message="Conflict")
        self.items[key] = self._stored(body)
        return copy.deepcopy(self.items[key])

    def upsert_item(self, body):
        self._check()
        self.items[(body[self.field], body["id"])] = self._stored(body)
        return copy.deepcopy(self.items[(body[self.field], body["id"])])

    def read_item(self, item, partition_key):
        self._check()
        if (partition_key, item) not in self.items:
            raise CosmosResourceNotFoundError(status_code=404, message="Not found")
        return copy.deepcopy(self.items[(partition_key, item)])

    def delete_item(self, item, partition_key):
        self._check()
        if (partition_key, item) not in self.items:
            raise CosmosResourceNotFoundError(status_code=404, message="Not found")
        del self.items[(partition_key, item)]

    def patch_item(self, item, partition_key, patch_operations):
        self._check()
        document = self.read_item(item, partition_key)
        for operation in patch_operations:
            assert operation["op"] == "set"
            document[operation["path"].lstrip("/")] = operation["value"]
        self.items[(partition_key, item)] = document
        return copy.deepcopy(document)

    def query_items(self, query, parameters=None, partition_key=None, enable_cross_partition_query=False,
                    max_item_count=None):
        self._check()
        self.queries.append({"query": query, "parameters": parameters, "partition_key": partition_key,
                             "cross_partition": enable_cross_partition_query, "max_item_count": max_item_count})
        if partition_key is None:
            # Real Cosmos rejects an unscoped query unless cross-partition is explicitly enabled.
            assert enable_cross_partition_query
            if query == "SELECT * FROM c":
                return iter([copy.deepcopy(doc) for doc in self.items.values()])
            assert query == "SELECT * FROM c WHERE c.accountId = @accountId"
            account_id = parameters[0]["value"]
            return iter([copy.deepcopy(doc) for doc in self.items.values() if doc.get("accountId") == account_id])
        assert parameters == [{"name": "@meetingId", "value": partition_key}]
        return iter([copy.deepcopy(doc) for (pk, _), doc in self.items.items() if pk == partition_key])


class FakeDatabase:
    def __init__(self, throughput=None):
        self.containers: dict[str, FakeContainer] = {}
        self.throughput = throughput
        self.container_options: dict[str, dict] = {}

    def create_container_if_not_exists(self, id, partition_key, **options):
        self.container_options[id] = options
        self.containers.setdefault(id, FakeContainer(id, partition_key["paths"][0]))
        return self.containers[id]

    def get_throughput(self):
        if self.throughput is None:
            raise CosmosResourceNotFoundError(status_code=404, message="Could not find ThroughputProperties")
        return self.throughput


def service_error():
    return CosmosHttpResponseError(status_code=503, message="Service unavailable")
