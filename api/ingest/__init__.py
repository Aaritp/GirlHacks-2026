import azure.functions as func
from functools import wraps
from pydantic import ValidationError
from ingest.contracts import IngestRequest, FeatureError
from ingest.service import ingest
from shared.http import error_response, json_response
from shared.store import get_store, storage_errors
from shared.openai_client import ModelNotConfigured, ModelFailed

bp = func.Blueprint()

def feature_errors(handler):
    @wraps(handler)
    @storage_errors
    def wrapped(req):
        try:
            if len(req.get_body()) > 7200000:
                raise FeatureError(413, "REQUEST_TOO_LARGE", "Upload at most 5 MB or paste at most 100,000 characters.")
            return handler(req)
        except FeatureError as exc:
            response = error_response(exc.status, exc.code, exc.message)
            if exc.retry_after:
                response.headers["Retry-After"] = str(exc.retry_after)
            return response
        except (ValidationError, ValueError):
            return error_response(400, "INVALID_REQUEST", "Check the account, source type and content limits.")
        except ModelNotConfigured:
            return error_response(503, "SERVICE_NOT_CONFIGURED", "Azure OpenAI is not configured.")
        except ModelFailed:
            return error_response(502, "UPSTREAM_ERROR", "The AI service could not complete this request. You can retry.")
    return wrapped

@bp.route(route="ingest", methods=["POST"])
@feature_errors
def ingest_source(req):
    request = IngestRequest.model_validate(req.get_json())
    if request.sourceType == "slack":
        raise FeatureError(400, "INVALID_REQUEST", "Use Slack Sync to import Slack messages.")
    return json_response(ingest(get_store(), request))
