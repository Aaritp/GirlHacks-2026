"""Wire models mirrored from web/src/types.ts. Keep both sides in sync."""
from datetime import date
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

Identifier = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[^/\\?#]+$")]
Text = Annotated[str, Field(min_length=1, max_length=20000)]
SeedKind = Literal["commitment", "decision", "risk", "customer_need"]
SourceType = Literal["meeting", "whiteboard", "email", "chat", "document", "slack"]
# Sources whose body is stored on the Source and extracted with POST /extract/source.
TEXT_SOURCE_TYPES = ("email", "chat", "document", "slack")
MAX_SOURCE_TEXT = 100_000
MAX_QUOTE = 500


class WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Seed(WireModel):
    id: Identifier
    meetingId: Identifier
    text: Text
    owner: str | None
    deadline: date | None
    kind: SeedKind
    status: Literal["seed", "sprout", "bloom", "wilted"]
    health: float = Field(ge=0, le=1)
    sourceType: Literal["meeting", "whiteboard", "email", "chat", "document", "slack", "leaves"]
    sourceId: Identifier
    timestampSec: float | None = Field(ge=0)
    lastActivity: AwareDatetime
    size: float = Field(gt=0)
    # Optional so seeds stored before accounts existed still load. Immutable provenance.
    accountId: Identifier | None = None
    # The exact source words the seed was extracted from; null when none was recorded.
    quote: str | None = Field(default=None, max_length=MAX_QUOTE)


class SeedPatch(WireModel):
    text: Text | None = None
    owner: str | None = None
    deadline: date | None = None
    kind: SeedKind | None = None
    status: Literal["seed", "sprout", "bloom", "wilted"] | None = None
    health: float | None = Field(default=None, ge=0, le=1)
    lastActivity: AwareDatetime | None = None
    size: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_patch(self):
        if not self.model_fields_set:
            raise ValueError("At least one mutable field is required")
        for field in self.model_fields_set - {"owner", "deadline"}:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class Root(WireModel):
    id: Identifier
    meetingId: Identifier
    fromSeedId: Identifier
    toSeedId: Identifier
    type: Literal["depends_on", "related"]


class Utterance(WireModel):
    id: Identifier
    meetingId: Identifier
    speaker: Text
    text: Text
    startSec: float = Field(ge=0)
    via: Literal["voice", "leaves"]


class Source(WireModel):
    # meetingId is the storage partition; imports share one partition per account.
    id: Identifier
    meetingId: Identifier
    type: SourceType
    messages: list[dict] = Field(default_factory=list, max_length=200)
    extractionItems: list[dict] | None = Field(default=None, max_length=200)
    recordType: Literal["source", "slack_binding", "slack_checkpoint"] = "source"
    channelId: str | None = None
    syncTs: str | None = None
    title: Text
    blobUrl: str | None = None
    createdAt: AwareDatetime
    accountId: Identifier | None = None
    # Body of an email, chat, document or Slack thread. Null for meetings (stored as utterances).
    text: str | None = Field(default=None, max_length=MAX_SOURCE_TEXT)


class AccountContact(WireModel):
    name: Text
    role: str | None = None
    email: str | None = None


class Account(WireModel):
    id: Identifier
    name: Text
    aliases: list[Text] = Field(default_factory=list, max_length=50)
    industry: str = ""
    contacts: list[AccountContact] = Field(default_factory=list, max_length=200)


class UtteranceList(WireModel):
    utterances: list[Utterance]


class Grove(WireModel):
    seeds: list[Seed]
    roots: list[Root]


class ExtractRequest(WireModel):
    meetingId: Identifier
    utterances: list[Utterance] = Field(min_length=1, max_length=200)
    # Links the meeting to a client account; its seeds then carry accountId.
    accountId: Identifier | None = None

    @model_validator(mode="after")
    def same_meeting(self):
        if any(item.meetingId != self.meetingId for item in self.utterances):
            raise ValueError("All utterances must belong to the requested meeting")
        return self


class ExtractSourceRequest(WireModel):
    """An email, chat, document or Slack thread to save and extract (Person B's ingestion)."""
    source: Source

    @model_validator(mode="after")
    def text_source(self):
        if self.source.type not in TEXT_SOURCE_TYPES:
            raise ValueError("Use /extract for meetings and /whiteboard for whiteboards")
        if not self.source.text or not self.source.text.strip():
            raise ValueError("Source text is required")
        return self


class WhiteboardRequest(WireModel):
    meetingId: Identifier
    imageBase64: str = Field(min_length=1, max_length=14000000)


class WhiteboardResult(WireModel):
    text: str
    seeds: list[Seed]


class SuggestRequest(WireModel):
    meetingId: Identifier
    recentText: str = Field(max_length=20000)


class Suggestions(WireModel):
    words: list[str]
    phrases: list[str]


class ComposeRequest(WireModel):
    meetingId: Identifier
    picked: list[Text] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def nonblank_words(self):
        if any(not word.strip() for word in self.picked):
            raise ValueError("Picked words cannot be blank")
        return self


class ComposeResult(WireModel):
    sentence: str


class SpeechToken(WireModel):
    token: str
    region: str
