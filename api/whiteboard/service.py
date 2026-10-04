"""Private Blob upload -> Vision Read -> shared extraction -> shared Cosmos repository."""
import base64
import binascii
import hashlib
import io
import json
import os
import urllib.error
import urllib.request
import warnings
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

from PIL import Image, UnidentifiedImageError

from extract.model import call_model, model_settings, ModelNotConfigured
from extract.pipeline import extract_and_save
from shared.models import Source, Utterance, WhiteboardResult
from shared.store import GroveStore

MAX_IMAGE_BYTES = 10 * 1024 * 1024


class WhiteboardFailed(Exception):
    pass


def decode_image(encoded: str) -> tuple[bytes, str]:
    # Contract is raw base64, not a data URL. Validate decoded bytes, not a filename.
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64") from exc
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Image must be at most 10 MiB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in ("PNG", "JPEG"):
                    raise ValueError("Only PNG and JPEG are supported")
                if not all(50 <= d <= 16000 for d in image.size) or image.width * image.height > 40_000_000:
                    raise ValueError("Image dimensions out of bounds")
                if getattr(image, "n_frames", 1) != 1:
                    raise ValueError("Animated images are not supported")
                mime = "image/png" if image.format == "PNG" else "image/jpeg"
                image.verify()
            with Image.open(io.BytesIO(data)) as image:
                image.load()  # Reject truncated JPEGs as well as corrupt PNG chunks.
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValueError("Invalid image") from exc
    return data, mime


def service_settings():
    names = ("AZURE_VISION_ENDPOINT", "AZURE_VISION_KEY", "AZURE_STORAGE_CONNECTION_STRING")
    values = {name: os.getenv(name, "").strip() for name in names}
    missing = [name for name in names if not values[name]]
    if missing:
        raise ModelNotConfigured(f"Whiteboard services are missing: {', '.join(missing)}.")
    endpoint = values["AZURE_VISION_ENDPOINT"].rstrip("/")
    parsed = urlsplit(endpoint)
    if parsed.scheme != "https" or not parsed.hostname or parsed.query or parsed.fragment or parsed.username:
        raise ModelNotConfigured("AZURE_VISION_ENDPOINT must be an HTTPS service endpoint.")
    return endpoint, values["AZURE_VISION_KEY"], values["AZURE_STORAGE_CONNECTION_STRING"]


def upload_image(data: bytes, mime: str, meeting_id: str, source_id: str, connection: str) -> str:
    from azure.core.exceptions import AzureError, ResourceExistsError
    from azure.storage.blob import BlobServiceClient, ContentSettings
    container_name = os.getenv("AZURE_WHITEBOARD_CONTAINER", "whiteboards")
    partition = hashlib.sha256(meeting_id.encode()).hexdigest()
    suffix = "png" if mime == "image/png" else "jpg"
    try:
        with BlobServiceClient.from_connection_string(connection, connection_timeout=10, read_timeout=30) as client:
            container = client.get_container_client(container_name)
            try:
                container.create_container()  # Default: private. Never enable public access.
            except ResourceExistsError:
                pass
            if container.get_container_properties().get("public_access"):
                raise WhiteboardFailed("Whiteboard container must be private")
            blob = container.get_blob_client(f"{partition}/{source_id}.{suffix}")
            try:
                blob.upload_blob(data, overwrite=False, content_settings=ContentSettings(content_type=mime))
            except ResourceExistsError:
                pass  # Content-addressed key: a retry refers to identical image bytes.
            url = urlsplit(blob.url)
            return urlunsplit((url.scheme, url.netloc, url.path, "", ""))  # Never persist SAS credentials.
    except (AzureError, ValueError) as exc:
        raise WhiteboardFailed("Blob upload failed") from exc


def read_ocr(data: bytes, endpoint: str, key: str) -> str:
    request = urllib.request.Request(
        f"{endpoint}/computervision/imageanalysis:analyze?api-version=2024-02-01&features=read",
        data=data, method="POST",
        headers={"Ocp-Apim-Subscription-Key": key, "Content-Type": "application/octet-stream"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
        blocks = result["readResult"]["blocks"]
        text = "\n".join(line["text"] for block in blocks for line in block["lines"])
        if len(text) > 20000:
            raise WhiteboardFailed("OCR text exceeds extraction limit")
        return text
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError, TypeError) as exc:
        raise WhiteboardFailed("Vision Read failed") from exc


def process_whiteboard(store: GroveStore, meeting_id: str, encoded: str) -> WhiteboardResult:
    data, mime = decode_image(encoded)
    endpoint, key, connection = service_settings()
    model_settings()  # Fail before uploading when extraction is not configured.
    source_id = "whiteboard-" + hashlib.sha256(data).hexdigest()
    blob_url = upload_image(data, mime, meeting_id, source_id, connection)
    source = Source(id=source_id, meetingId=meeting_id, type="whiteboard", title="Uploaded whiteboard",
                    blobUrl=blob_url, createdAt=datetime.now(timezone.utc))
    source = store.create_source(source) or store.get_source(meeting_id, source_id)
    if source is None:
        from shared.store import StorageUnavailable
        raise StorageUnavailable("Source could not be read after conflict")
    text = read_ocr(data, endpoint, key)
    if not text.strip():
        return WhiteboardResult(text=text, seeds=[])
    # Transient evidence uses the existing extraction schema. It is NOT speech and
    # the source-aware pipeline will never save it in the utterances container.
    evidence = Utterance(id=f"{source_id}-ocr", meetingId=meeting_id, text=text,
                         speaker="Unknown", startSec=0, via="voice")
    grove = extract_and_save(store, meeting_id, [evidence], call_model, source=source)
    return WhiteboardResult(text=text, seeds=grove.seeds)
