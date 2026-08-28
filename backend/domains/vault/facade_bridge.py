"""Compatibility export registry for the historical Vault API facade."""

from types import ModuleType
from typing import Any

_modules: list[ModuleType] = []


def register(module: ModuleType) -> None:
    """Register one canonical Vault owner exactly once in source order."""
    if module not in _modules:
        _modules.append(module)


def _module_value(module: ModuleType, name: str) -> Any:
    namespace = vars(module)
    if name in namespace:
        return namespace[name]
    resolver = namespace.get("__getattr__")
    if callable(resolver):
        return resolver(name)
    raise AttributeError(name)


def resolve(name: str) -> Any:
    """Resolve the latest canonical export using Python module overwrite order."""
    for module in reversed(_modules):
        try:
            return _module_value(module, name)
        except AttributeError:
            continue
    raise AttributeError(f"module 'backend.api.vault_routes' has no attribute {name!r}")


def exported_names() -> set[str]:
    """Return the complete compatibility inventory for introspection."""
    names: set[str] = set()
    for module in _modules:
        names.update(name for name in vars(module) if not name.startswith("_legacy"))
    return names
