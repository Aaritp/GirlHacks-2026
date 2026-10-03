import sys
from pathlib import Path

# Makes the Azure Functions app layout importable under pytest without installation.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
