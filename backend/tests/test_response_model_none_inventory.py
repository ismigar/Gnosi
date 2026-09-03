"""Lock every intentional FastAPI response-model exemption."""

from __future__ import annotations

import ast
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

Exemption = tuple[str, str, str, str, str]

EXPECTED_EXEMPTIONS: Counter[Exemption] = Counter(
    {
        (
            "backend/domains/mail/routes/views.py",
            "DELETE",
            "/views/{view_id}",
            "delete_view",
            "None",
        ): 1,
        (
            "backend/domains/mail/routes/messages.py",
            "GET",
            "/events",
            "mail_events",
            "StreamingResponse",
        ): 1,
        (
            "backend/domains/mail/routes/attachments.py",
            "GET",
            "/messages/{message_id}/attachments/{att_id:path}",
            "get_attachment",
            "Response",
        ): 1,
        (
            "backend/domains/mail/routes/attachments.py",
            "GET",
            "/messages/{message_id}/cid/{cid:path}",
            "get_cid_image",
            "Response",
        ): 1,
        (
            "backend/domains/mail/routes/remote_images.py",
            "POST",
            "/remote-images/fetch",
            "fetch_remote_image",
            "Response",
        ): 1,
        (
            "backend/domains/mail/routes/tags.py",
            "DELETE",
            "/tags/{tag_id}",
            "delete_tag",
            "None",
        ): 1,
        (
            "backend/domains/vault/pages/sync_routes.py",
            "GET",
            "/synced-events",
            "synced_events",
            "StreamingResponse",
        ): 1,
        (
            "backend/domains/vault/assets/api.py",
            "GET",
            "/assets/{asset_path:path}",
            "get_asset",
            "FileResponse",
        ): 1,
        (
            "backend/domains/vault/assets/api.py",
            "GET",
            "/images/{image_path:path}",
            "serve_vault_image",
            "FileResponse",
        ): 1,
        ("backend/api/calendar_routes.py", "GET", "/feed.ics", "get_ics_feed", "Response"): 1,
        (
            "backend/api/literature_routes.py",
            "GET",
            "/searches/{search_id}/events",
            "stream_search_events",
            "StreamingResponse",
        ): 1,
        (
            "backend/api/literature_routes.py",
            "GET",
            "/reviews/{review_id}/exports/{export_format}",
            "export_review",
            "Response",
        ): 1,
        ("backend/api/notion_oauth_routes.py", "GET", "/login", "login", "RedirectResponse"): 1,
        (
            "backend/api/notion_oauth_routes.py",
            "GET",
            "/callback",
            "callback",
            "RedirectResponse",
        ): 1,
        (
            "backend/domains/vault/citations/export_routes.py",
            "GET",
            "/export/{page_id}",
            "export_page",
            "Response",
        ): 1,
        (
            "backend/domains/vault/citations/io_api.py",
            "GET",
            "/export-references",
            "export_references",
            "Response",
        ): 1,
        (
            "backend/api/vault_templates_routes.py",
            "POST",
            "/{vault_id}/template-export",
            "export_vault_template",
            "Response",
        ): 1,
        (
            "backend/domains/vault/files/api.py",
            "GET",
            "/library/{rel_path:path}",
            "serve_library_file",
            "FileResponse",
        ): 1,
        (
            "backend/domains/vault/files/api.py",
            "GET",
            "/raw/{rel_path:path}",
            "serve_vault_raw_file",
            "FileResponse",
        ): 1,
        (
            "backend/domains/vault/files/api.py",
            "GET",
            "/thumb/{rel_url:path}",
            "serve_thumb",
            "Response",
        ): 1,
        (
            "backend/domains/vault/files/api.py",
            "GET",
            "/local-file/{token}/{filename:path}",
            "serve_local_file",
            "FileResponse",
        ): 1,
        (
            "backend/domains/vault/files/api.py",
            "GET",
            "/local-file/{token}",
            "serve_local_file",
            "FileResponse",
        ): 1,
        (
            "backend/domains/agent/routes/misc.py",
            "GET",
            "/chat/streams/{stream_id}",
            "resume_agent_stream",
            "StreamingResponse",
        ): 1,
        (
            "backend/domains/agent/routes/chat_route.py",
            "POST",
            "/chat",
            "chat_endpoint",
            "StreamingResponse",
        ): 1,
    }
)


def _has_none_response_model(call: ast.Call) -> bool:
    return any(
        keyword.arg == "response_model"
        and isinstance(keyword.value, ast.Constant)
        and keyword.value.value is None
        for keyword in call.keywords
    )


def _literal_path(call: ast.Call) -> str:
    if not call.args or not isinstance(call.args[0], ast.Constant):
        raise AssertionError("response-model exemption must use a literal route path")
    value = call.args[0].value
    if not isinstance(value, str):
        raise AssertionError("response-model exemption route path must be text")
    return value


def _method_list(call: ast.Call) -> list[str]:
    keyword = next((item for item in call.keywords if item.arg == "methods"), None)
    if keyword is None or not isinstance(keyword.value, (ast.List, ast.Tuple)):
        raise AssertionError("add_api_route exemption must declare literal methods")
    methods: list[str] = []
    for item in keyword.value.elts:
        if not isinstance(item, ast.Constant) or not isinstance(item.value, str):
            raise AssertionError("add_api_route exemption methods must be text literals")
        methods.append(item.value.upper())
    return methods


def _return_annotation(function: ast.AsyncFunctionDef | ast.FunctionDef) -> str:
    if function.returns is None:
        return "<missing>"
    return ast.unparse(function.returns)


def _inventory() -> Counter[Exemption]:
    found: Counter[Exemption] = Counter()
    for source_path in sorted((ROOT / "backend").rglob("*.py")):
        relative = source_path.relative_to(ROOT).as_posix()
        tree = ast.parse(source_path.read_text(encoding="utf-8"), filename=relative)
        functions = {
            node.name: node
            for node in ast.walk(tree)
            if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef))
        }
        for function in functions.values():
            for decorator in function.decorator_list:
                if not isinstance(decorator, ast.Call) or not _has_none_response_model(decorator):
                    continue
                if not isinstance(decorator.func, ast.Attribute):
                    raise AssertionError(f"unsupported route decorator in {relative}")
                found[
                    (
                        relative,
                        decorator.func.attr.upper(),
                        _literal_path(decorator),
                        function.name,
                        _return_annotation(function),
                    )
                ] += 1
        for call in (node for node in ast.walk(tree) if isinstance(node, ast.Call)):
            if (
                not isinstance(call.func, ast.Attribute)
                or call.func.attr != "add_api_route"
                or not _has_none_response_model(call)
            ):
                continue
            if len(call.args) < 2 or not isinstance(call.args[1], ast.Name):
                raise AssertionError(f"unsupported add_api_route exemption in {relative}")
            handler = call.args[1].id
            endpoint_function = functions.get(handler)
            if endpoint_function is None:
                raise AssertionError(f"untyped route handler {handler} in {relative}")
            for method in _method_list(call):
                found[
                    (
                        relative,
                        method,
                        _literal_path(call),
                        handler,
                        _return_annotation(endpoint_function),
                    )
                ] += 1
    return found


def test_only_specialized_transports_disable_response_models() -> None:
    assert _inventory() == EXPECTED_EXEMPTIONS
