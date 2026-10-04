import azure.functions as func

from accounts_timeline import bp as accounts_timeline
from ask import bp as ask
from maintenance import bp as maintenance
from extract import bp as extract
from seeds import bp as seeds
from shared.http import json_response
from speech_token import bp as speech_token
from whiteboard import bp as whiteboard
from ingest import bp as ingest
from slack_sync import bp as slack_sync
from followup import bp as followup

# Function keys are required when deployed. Core Tools allows local requests.
# A production browser must use a trusted gateway / application auth, not a bundled key.
app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)
for blueprint in (accounts_timeline, ask, maintenance, extract, seeds, speech_token, whiteboard, ingest, slack_sync, followup):
    app.register_functions(blueprint)


@app.route(route="health", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def health(req: func.HttpRequest):
    return json_response({"status": "ok", "service": "grovekeeper-api", "stage": "foundation"})
