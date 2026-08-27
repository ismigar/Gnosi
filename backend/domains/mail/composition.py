"""Deterministic composition of the mail router."""

from importlib import import_module

from backend.domains.mail.routing import router as router

_ROUTE_MODULES = (
    "backend.domains.mail.routes.messages",
    "backend.domains.mail.routes.actions",
    "backend.domains.mail.routes.compose",
    "backend.domains.mail.routes.views",
    "backend.domains.mail.routes.attachments",
    "backend.domains.mail.routes.tags",
)

for _module_name in _ROUTE_MODULES:
    import_module(_module_name)
