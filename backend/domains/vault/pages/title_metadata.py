"""Keep an explicitly renamed page and its registered title column consistent."""
from __future__ import annotations

from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.registry.records import is_record
from backend.utils.open_values import iterable_values


def apply_explicit_title(metadata: PageMetadata, table: PageMetadata | None, title: str | None) -> None:
    """The explicit request title wins over a stale editor metadata snapshot.

    Run after field-name normalization so immutable IDs and historical aliases
    have already resolved to the current registered name. Metadata-only updates
    keep their existing semantics and unrelated properties remain untouched.
    Pages without a registered title column retain their open metadata contract.
    """
    if title is None:
        return
    if table is None:
        return
    for field in iterable_values(table.get("properties", [])):
        if is_record(field) and field.get("type") == "title":
            name = field.get("name")
            if isinstance(name, str) and name:
                metadata["title"] = title
                metadata[name] = title
            break
