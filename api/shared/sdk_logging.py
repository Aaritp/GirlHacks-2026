"""Keeps Azure/OpenAI SDK request logging out of `func start` output.

The Cosmos HTTP logging policy and the OpenAI/httpx clients log every request at INFO.
Only warnings and errors from them are kept. Our own loggers and the Functions worker
(`azure_functions_worker`, not under `azure`) are unaffected.
"""
import logging
import os

SDK_LOGGERS = ("azure", "openai", "httpx", "httpcore", "urllib3")


def quiet_sdk_loggers():
    # GROVEKEEPER_SDK_LOG_LEVEL=DEBUG/INFO turns request logging back on for troubleshooting.
    level = os.getenv("GROVEKEEPER_SDK_LOG_LEVEL", "WARNING").strip().upper()
    for name in SDK_LOGGERS:
        logging.getLogger(name).setLevel(getattr(logging, level, logging.WARNING))
