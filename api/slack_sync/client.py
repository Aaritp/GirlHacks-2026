import json
import os
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError
from ingest.contracts import FeatureError

class SlackClient:
    def __init__(self, token=None, opener=urlopen):
        self.token = token or os.getenv("SLACK_BOT_TOKEN", "").strip()
        self.opener = opener
        if not self.token:
            raise FeatureError(503, "SLACK_NOT_CONFIGURED", "Set SLACK_BOT_TOKEN on the server.")

    def call(self, method, **params):
        req = Request("https://slack.com/api/" + method, data=urlencode(params).encode(),
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/x-www-form-urlencoded"})
        try:
            with self.opener(req, timeout=20) as response:
                body = response.read(2000001)
                if len(body) > 2000000:
                    raise FeatureError(502, "SLACK_ERROR", "Slack returned too much data.")
                result = json.loads(body)
        except HTTPError as exc:
            if exc.code == 429:
                raw = exc.headers.get("Retry-After", "60")
                delay = min(3600, max(1, int(raw))) if raw.isdigit() else 60
                raise FeatureError(429, "SLACK_RATE_LIMITED", "Slack is rate limiting requests. Try again later.", delay) from None
            raise FeatureError(502, "SLACK_ERROR", "Slack could not complete this request.") from None
        except (URLError, TimeoutError, ValueError):
            raise FeatureError(502, "SLACK_ERROR", "Slack could not be reached or returned invalid data.") from None
        if not isinstance(result, dict) or not result.get("ok"):
            code = result.get("error") if isinstance(result, dict) else None
            message = {"not_in_channel": "Invite the Slack bot to this channel first.",
                       "channel_not_found": "This channel was not found or is not accessible to the bot.",
                       "missing_scope": "The Slack bot needs channels:history, channels:read and users:read.",
                       "invalid_auth": "The server's Slack token is invalid."}.get(code, "Slack could not complete this request.")
            raise FeatureError(502, "SLACK_ERROR", message)
        return result

    def history(self, channel, oldest, latest):
        cursor = ""
        messages = []
        seen = set()
        for _ in range(20):
            result = self.call("conversations.history", channel=channel, oldest=oldest,
                               latest=latest, inclusive="false", limit=100, cursor=cursor)
            page = result.get("messages")
            if not isinstance(page, list):
                raise FeatureError(502, "SLACK_ERROR", "Slack returned invalid message history.")
            messages.extend(page)
            if len(messages) > 1000 or result.get("is_limited"):
                raise FeatureError(413, "SLACK_HISTORY_LIMIT", "Slack history exceeds this demo's supported sync size. No checkpoint was advanced.")
            cursor = result.get("response_metadata", {}).get("next_cursor", "")
            if not cursor:
                if result.get("has_more"):
                    raise FeatureError(502, "SLACK_PAGINATION", "Slack history was incomplete. Retry without advancing the checkpoint.")
                return messages
            if cursor in seen:
                break
            seen.add(cursor)
        raise FeatureError(502, "SLACK_PAGINATION", "Slack history pagination did not finish. Retry later.")

    def user_name(self, user_id):
        user = self.call("users.info", user=user_id).get("user", {})
        profile = user.get("profile", {})
        return profile.get("real_name") or user.get("real_name") or profile.get("display_name") or user.get("name") or user_id
