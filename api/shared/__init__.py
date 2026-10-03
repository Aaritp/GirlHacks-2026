"""Shared API contracts and local development utilities."""
from shared.sdk_logging import quiet_sdk_loggers

# Every blueprint imports `shared`, so this runs once when the Functions host indexes the app.
quiet_sdk_loggers()
