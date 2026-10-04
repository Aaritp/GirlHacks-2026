import base64
import binascii
from io import BytesIO
from pathlib import PurePath
from ingest.contracts import FeatureError, MAX_FILE_BYTES, MAX_TEXT

def read_document(filename, encoded):
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise FeatureError(400, "INVALID_FILE", "The uploaded file is not valid base64.") from None
    if len(data) > MAX_FILE_BYTES:
        raise FeatureError(413, "FILE_TOO_LARGE", "Choose a file no larger than 5 MB.")
    suffix = PurePath(filename.lower()).suffix
    if suffix in (".txt", ".md"):
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise FeatureError(400, "INVALID_FILE", "Text and Markdown files must use UTF-8.") from None
    elif suffix == ".pdf":
        from pypdf import PdfReader
        try:
            reader = PdfReader(BytesIO(data))
            if reader.is_encrypted:
                raise FeatureError(400, "ENCRYPTED_PDF", "Upload an unencrypted text-based PDF.")
            if len(reader.pages) > 50:
                raise FeatureError(413, "FILE_TOO_LARGE", "PDFs may contain at most 50 pages.")
            pages = []
            for page in reader.pages:
                content = page.get_contents()
                if content and len(content.get_data()) > 10 * 1024 * 1024:
                    raise FeatureError(413, "FILE_TOO_LARGE", "A PDF page is too complex to read.")
                pages.append(page.extract_text() or "")
                if sum(map(len, pages)) > MAX_TEXT:
                    raise FeatureError(413, "TEXT_TOO_LARGE", "Use a document with at most 100,000 characters.")
            text = "\n\n".join(pages)
        except FeatureError:
            raise
        except Exception:
            raise FeatureError(400, "INVALID_PDF", "This PDF could not be read. Try a text-based PDF or paste its text.") from None
        if not text.strip():
            raise FeatureError(400, "SCANNED_PDF", "This PDF has no extractable text. Scanned PDFs are not supported.")
    else:
        raise FeatureError(415, "UNSUPPORTED_FILE", "Choose a .txt, .md or text-based .pdf file.")
    if not text.strip():
        raise FeatureError(400, "EMPTY_DOCUMENT", "The document contains no text.")
    if len(text) > MAX_TEXT:
        raise FeatureError(413, "TEXT_TOO_LARGE", "Use at most 100,000 characters.")
    return text
