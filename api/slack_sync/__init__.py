import re
import time
from decimal import Decimal, InvalidOperation
from datetime import datetime, timezone
import azure.functions as func

from ingest import feature_errors
from ingest.contracts import SlackSyncRequest, IngestRequest, Message, FeatureError, require_account
from ingest.service import ingest, account_partition, digest
from shared.models import Source
from shared.store import get_store, StorageUnavailable
from shared.http import json_response
from slack_sync.client import SlackClient

bp = func.Blueprint()

def sync(store, request, client, ingest_fn=ingest):
    require_account(store, request.accountId)
    binding_partition = "slack-bindings"
    binding = store.get_source(binding_partition, request.channelId)
    now = datetime.now(timezone.utc)
    if binding is None:
        candidate = Source(id=request.channelId, meetingId=binding_partition, accountId=request.accountId,
            type="slack", title="Slack channel binding", recordType="slack_binding",
            channelId=request.channelId, createdAt=now)
        binding = store.create_source(candidate) or store.get_source(binding_partition, request.channelId)
    if binding is None:
        raise StorageUnavailable("Slack binding unavailable")
    if binding.accountId != request.accountId:
        raise FeatureError(409, "CHANNEL_ALREADY_LINKED", "This Slack channel is already linked to another account.")
    partition = account_partition(request.accountId)
    checkpoints = [s.syncTs for s in store.list_sources(partition)
                   if s.recordType == "slack_checkpoint" and s.channelId == request.channelId and s.syncTs]
    oldest = max(checkpoints, key=Decimal, default="0")
    latest = f"{time.time():.6f}"
    raw = client.history(request.channelId, oldest, latest)
    try:
        # Validate timestamps before doing any ingestion.
        for item in raw:
            if not isinstance(item, dict) or not re.fullmatch(r"\d+\.\d{1,6}", str(item.get("ts", ""))):
                raise ValueError()
        ordered = sorted(raw, key=lambda m: Decimal(m["ts"]))
    except (ValueError, InvalidOperation):
        raise FeatureError(502, "SLACK_ERROR", "Slack returned invalid message timestamps.") from None
    names, seeds, sources = {}, {}, {}
    imported = 0
    for item in ordered:
        if Decimal(item["ts"]) <= Decimal(oldest):
            continue
        # Channel history only: edits, deletions, bot output, files and thread replies are not imported.
        if item.get("subtype") or item.get("bot_id") or not item.get("user") or not str(item.get("text", "")).strip():
            continue
        if item.get("thread_ts") and item["thread_ts"] != item["ts"]:
            continue
        uid = item["user"]
        if uid not in names:
            names[uid] = client.user_name(uid)
        text = item["text"]
        for mention in set(re.findall(r"<@(U[A-Z0-9]+)>", text)):
            if mention not in names:
                names[mention] = client.user_name(mention)
            text = text.replace("<@" + mention + ">", names[mention])
        timestamp = datetime.fromtimestamp(float(item["ts"]), timezone.utc).isoformat()
        result = ingest_fn(store, IngestRequest(accountId=request.accountId, sourceType="slack",
            title=f"Slack {request.channelId} · {item['ts']}",
            messages=[Message(author=names[uid], timestamp=timestamp, text=text, rawText=item["text"],
                              externalId=request.channelId + ":" + item["ts"])]), check_account=False)
        imported += 1
        for seed in result["seeds"]:
            seeds[seed["id"]] = seed
        sources[result["source"]["id"]] = result["source"]
    # Advance only after the COMPLETE snapshot was fetched AND every import succeeded.
    through = max([oldest] + [item["ts"] for item in ordered], key=Decimal)
    if Decimal(through) > Decimal(oldest):
        store.create_source(Source(id="slack-checkpoint-" + digest(request.channelId + ":" + through),
            meetingId=partition, accountId=request.accountId, type="slack", title="Slack sync checkpoint",
            recordType="slack_checkpoint", channelId=request.channelId, syncTs=through, createdAt=now))
    return {"importedMessages": imported, "lastSyncedTs": through,
            "seeds": list(seeds.values()), "sources": list(sources.values())}

@bp.route(route="slack/sync", methods=["POST"])
@feature_errors
def sync_slack(req):
    request = SlackSyncRequest.model_validate(req.get_json())
    return json_response(sync(get_store(), request, SlackClient()))
