"""Technical tool identities, independent of translated display labels."""
from typing import Any


def runtime_tool_name(handler: Any) -> str:
    """Use the same callable name that is bound to the model and its policy."""
    return str(getattr(handler, "name", "") or getattr(handler, "__name__", "") or "")
