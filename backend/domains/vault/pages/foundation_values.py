"""Native page-document operations on values without a declared schema."""

from __future__ import annotations

from operator import methodcaller

from backend.domains.vault.registry.state import RegistryData

PageMetadata = RegistryData


def metadata_value(value: object, key: object) -> object:
    """Call the original one-argument ``get`` without asserting a record shape.

    JSON documents and historic property containers can be malformed. Python
    must perform the original attribute lookup and call, including its exact
    exceptions and any custom method behavior. The result remains opaque.
    """
    result: object = methodcaller("get", key)(value)
    return result


def copy_metadata(value: object) -> RegistryData:
    """Build a real dictionary through its native initializer, not a shape cast.

    The initializer accepts mappings and iterable pairs and owns their native
    validation/errors. This also preserves a custom dashboard getter's second
    result when it differs from the first result used by the historical guard.
    """
    result: RegistryData = {}
    methodcaller("__init__", value)(result)
    return result
