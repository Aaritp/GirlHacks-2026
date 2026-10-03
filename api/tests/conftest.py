import sys
from pathlib import Path

# Makes the Azure Functions app layout importable under pytest without installation.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from functools import cache


@cache
def indexed_functions():
    """The Functions SDK allows indexing an app once per process, as the host does."""
    from function_app import app
    return tuple(app.get_functions())


def function_handlers():
    return {function.get_function_name(): function.get_user_function() for function in indexed_functions()}
