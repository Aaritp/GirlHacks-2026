from typing import Literal, Annotated
from pydantic import Field, model_validator
from shared.models import Identifier, WireModel

MAX_TEXT = 100000
MAX_FILE_BYTES = 5 * 1024 * 1024

class FeatureError(Exception):
    def __init__(self, status, code, message, retry_after=None):
        super().__init__(message)
        self.status, self.code, self.message, self.retry_after = status, code, message, retry_after

class Message(WireModel):
    author: str = Field(default="Unknown", min_length=1, max_length=300)
    recipients: list[Annotated[str, Field(max_length=300)]] = Field(default_factory=list, max_length=100)
    timestamp: str | None = Field(default=None, max_length=100)
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    rawText: str | None = Field(default=None, max_length=MAX_TEXT)
    externalId: str | None = Field(default=None, max_length=100)

class IngestRequest(WireModel):
    accountId: Identifier
    sourceType: Literal["email", "chat", "document", "slack"]
    title: str = Field(min_length=1, max_length=300)
    text: str | None = Field(default=None, max_length=MAX_TEXT)
    messages: list[Message] | None = Field(default=None, min_length=1, max_length=200)
    filename: str | None = Field(default=None, max_length=255)
    fileBase64: str | None = Field(default=None, max_length=6990508)

    @model_validator(mode="after")
    def content(self):
        if sum(value is not None for value in (self.text, self.messages, self.fileBase64)) != 1:
            raise ValueError("Supply exactly one of text, messages, or fileBase64")
        if not self.title.strip() or (self.text is not None and not self.text.strip()):
            raise ValueError("Content cannot be blank")
        if self.fileBase64 is not None and (self.sourceType != "document" or not self.filename):
            raise ValueError("Uploads require document type and filename")
        if self.messages and sum(len(m.text) for m in self.messages) > MAX_TEXT:
            raise ValueError("Messages exceed text limit")
        if self.messages and len(self.model_dump_json()) > 500000:
            raise ValueError("Message metadata exceeds import limit")
        if self.sourceType == "slack" and (not self.messages or any(not m.externalId for m in self.messages)):
            raise ValueError("Slack messages require stable external IDs")
        return self

class SlackSyncRequest(WireModel):
    accountId: Identifier
    channelId: str = Field(pattern=r"^C[A-Z0-9]{5,30}$")

def require_account(store, account_id):
    # Prisha owns account persistence. Fail explicitly until the 2.0 interface lands.
    lookup = getattr(store, "get_account", None)
    if lookup is None:
        raise FeatureError(503, "ACCOUNT_FOUNDATION_PENDING", "Account storage is not connected yet.")
    account = lookup(account_id)
    if account is None:
        raise FeatureError(404, "NOT_FOUND", "Account not found.")
    return account
