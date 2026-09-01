"""Static source catalog responsibility: api catalog."""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path

from pipeline.skills.technical_documentation.scripts.catalog_common import (
    constant_string,
    expression_name,
    first_doc_line,
    generated_header,
    join_url_paths,
    keyword,
    markdown_cell,
    python_files,
    read_text,
    relative_posix,
    safe_unparse,
    source_link,
    string_list,
)

HTTP_METHODS = {
    "delete",
    "get",
    "head",
    "options",
    "patch",
    "post",
    "put",
    "trace",
    "websocket",
}


@dataclass(frozen=True)
class RouterRegistration:
    """Describe one router attached to the FastAPI application."""

    module: str
    prefix: str
    tags: tuple[str, ...]
    line: int
    source: str = "backend/server.py"


@dataclass(frozen=True)
class RouteOperation:
    """Describe one statically discovered FastAPI route operation."""

    method: str
    path: str
    handler: str
    module: str
    line: int
    tags: tuple[str, ...]
    guards: str
    summary: str


@dataclass(frozen=True)
class RouterConfiguration:
    """Describe static prefix, tags, and guards owned by an APIRouter."""

    prefix: str = ""
    tags: tuple[str, ...] = ()
    guard: str = ""


def parse_router_registration(
    composition_path: Path,
    app_root: Path,
) -> list[RouterRegistration]:
    """Read statically declared `app.include_router` registrations."""
    tree = ast.parse(read_text(composition_path), filename=str(composition_path))
    registrations: list[RouterRegistration] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if expression_name(node.func) != "app.include_router" or not node.args:
            continue
        router_name = expression_name(node.args[0])
        module = router_name.removesuffix(".router")
        registrations.append(
            RouterRegistration(
                module=module,
                prefix=constant_string(keyword(node, "prefix")),
                tags=string_list(keyword(node, "tags")),
                line=node.lineno,
                source=relative_posix(composition_path, app_root),
            )
        )
    return sorted(registrations, key=lambda item: item.line)


def _python_module_path(app_root: Path, dotted_module: str) -> Path | None:
    """Resolve an owned dotted Python module without importing it."""
    candidate = app_root / f"{dotted_module.replace('.', '/')}.py"
    if candidate.is_file():
        return candidate
    package = app_root / dotted_module.replace(".", "/") / "__init__.py"
    return package if package.is_file() else None


def _import_target(path: Path, imported_name: str, app_root: Path) -> Path | None:
    """Resolve one statically imported name to an owned source module."""
    tree = ast.parse(read_text(path), filename=str(path))
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                local_name = alias.asname or alias.name
                if local_name != imported_name:
                    continue
                direct = _python_module_path(app_root, f"{node.module}.{alias.name}")
                return direct or _python_module_path(app_root, node.module)
        if isinstance(node, ast.Import):
            for alias in node.names:
                local_name = alias.asname or alias.name.rsplit(".", 1)[-1]
                if local_name == imported_name:
                    return _python_module_path(app_root, alias.name)
    return None


def resolve_registered_router(
    registration: RouterRegistration,
    composition_path: Path,
    app_root: Path,
) -> Path | None:
    """Follow a registered router alias through a compatibility facade."""
    path = _import_target(composition_path, registration.module, app_root)
    visited: set[Path] = set()
    while path is not None and path not in visited:
        visited.add(path)
        if declares_router(path):
            return path
        path = _import_target(path, "router", app_root)
    return None


def route_decorator_details(call: ast.Call) -> tuple[tuple[str, ...], str] | None:
    """Return methods and path from a FastAPI route decorator."""
    dotted = expression_name(call.func)
    owner, _, method = dotted.rpartition(".")
    if owner not in {"router", "app"}:
        return None
    if method not in HTTP_METHODS and method != "api_route":
        return None
    path_node = call.args[0] if call.args else keyword(call, "path")
    path = constant_string(path_node, "<dynamic-path>")
    if method == "api_route":
        methods = string_list(keyword(call, "methods")) or ("ANY",)
    else:
        methods = ("WEBSOCKET",) if method == "websocket" else (method.upper(),)
    return tuple(item.upper() for item in methods), path


def dependency_summary(function: ast.FunctionDef | ast.AsyncFunctionDef, call: ast.Call) -> str:
    """Summarize explicit FastAPI dependency guards without evaluating them."""
    guards: list[str] = []
    decorator_dependencies = keyword(call, "dependencies")
    if decorator_dependencies is not None:
        guards.append(safe_unparse(decorator_dependencies, limit=120))

    defaults = [*function.args.defaults, *function.args.kw_defaults]
    for default in defaults:
        if not isinstance(default, ast.Call):
            continue
        call_name = expression_name(default.func)
        if call_name not in {"Depends", "Security"}:
            continue
        target = safe_unparse(default.args[0] if default.args else None, limit=60)
        guards.append(f"{call_name}({target})")
    return ", ".join(dict.fromkeys(guards)) or "—"


def router_configuration(tree: ast.Module) -> RouterConfiguration:
    """Return configuration declared by the module's canonical router."""
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if not any(
            isinstance(target, ast.Name) and target.id == "router" for target in node.targets
        ):
            continue
        if not isinstance(node.value, ast.Call) or expression_name(node.value.func) != "APIRouter":
            continue
        dependency_node = keyword(node.value, "dependencies")
        return RouterConfiguration(
            prefix=constant_string(keyword(node.value, "prefix")),
            tags=string_list(keyword(node.value, "tags")),
            guard=(safe_unparse(dependency_node, limit=120) if dependency_node else ""),
        )
    return RouterConfiguration()


def _top_level_call(node: ast.stmt) -> ast.Call | None:
    """Return a call directly executed by one module-level statement."""
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
        return node.value
    if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
        return node.value
    if isinstance(node, ast.AnnAssign) and isinstance(node.value, ast.Call):
        return node.value
    return None


def _accepts_canonical_router(call: ast.Call) -> bool:
    """Return whether a composition call receives the canonical router."""
    if call.args and expression_name(call.args[0]) == "router":
        return True
    router_arg = keyword(call, "router")
    return router_arg is not None and expression_name(router_arg) == "router"


def _declares_added_router_routes(path: Path) -> bool:
    """Return whether a module registers endpoints on an injected router."""
    tree = ast.parse(read_text(path), filename=str(path))
    return any(
        isinstance(node, ast.Call) and expression_name(node.func) == "router.add_api_route"
        for node in ast.walk(tree)
    )


def imported_router_registrars(path: Path, app_root: Path) -> list[Path]:
    """Resolve imported modules that register routes on this module's router."""
    tree = ast.parse(read_text(path), filename=str(path))
    registrars: set[Path] = set()
    for node in tree.body:
        call = _top_level_call(node)
        if call is None or not _accepts_canonical_router(call):
            continue
        owner = expression_name(call.func).partition(".")[0]
        if not owner or owner in {"app", "router"}:
            continue
        target = _import_target(path, owner, app_root)
        if target is not None and _declares_added_router_routes(target):
            registrars.add(target)
    return sorted(registrars)


def parse_added_router_routes(
    path: Path,
    app_root: Path,
    registration: RouterRegistration | None,
    owner: RouterConfiguration,
) -> list[RouteOperation]:
    """Extract routes registered by a module onto an injected APIRouter."""
    tree = ast.parse(read_text(path), filename=str(path))
    functions = {
        node.name: node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    operations: list[RouteOperation] = []
    for call in (node for node in ast.walk(tree) if isinstance(node, ast.Call)):
        if expression_name(call.func) != "router.add_api_route" or len(call.args) < 2:
            continue
        route_path = constant_string(call.args[0], "<dynamic-path>")
        handler_name = expression_name(call.args[1]) or "<dynamic-handler>"
        methods = string_list(keyword(call, "methods")) or ("ANY",)
        handler = functions.get(handler_name)
        dependencies = keyword(call, "dependencies")
        guards = (
            dependency_summary(handler, call)
            if handler is not None
            else safe_unparse(dependencies, limit=120)
            if dependencies
            else "—"
        )
        if owner.guard:
            guards = owner.guard if guards == "—" else f"{owner.guard}, {guards}"
        tags = tuple(
            dict.fromkeys(
                [
                    *(registration.tags if registration else ()),
                    *owner.tags,
                    *string_list(keyword(call, "tags")),
                ]
            )
        )
        for method in methods:
            operations.append(
                RouteOperation(
                    method=method.upper(),
                    path=join_url_paths(
                        registration.prefix if registration else "",
                        owner.prefix,
                        route_path,
                    ),
                    handler=handler_name,
                    module=relative_posix(path, app_root),
                    line=call.lineno,
                    tags=tags,
                    guards=guards,
                    summary=(
                        first_doc_line(handler, handler_name)
                        if handler is not None
                        else handler_name.replace("_", " ").capitalize()
                    ),
                )
            )
    return operations


def parse_route_module(
    path: Path,
    app_root: Path,
    registration: RouterRegistration | None,
) -> list[RouteOperation]:
    """Extract route operations from one Python module."""
    text = read_text(path)
    tree = ast.parse(text, filename=str(path))
    configuration = router_configuration(tree)

    operations: list[RouteOperation] = []
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call):
                continue
            details = route_decorator_details(decorator)
            if details is None:
                continue
            methods, route_path = details
            registration_prefix = registration.prefix if registration else ""
            tags = tuple(
                dict.fromkeys(
                    [
                        *(registration.tags if registration else ()),
                        *configuration.tags,
                        *string_list(keyword(decorator, "tags")),
                    ]
                )
            )
            guards = dependency_summary(node, decorator)
            if configuration.guard:
                guards = (
                    configuration.guard if guards == "—" else f"{configuration.guard}, {guards}"
                )
            source = relative_posix(path, app_root)
            for method in methods:
                operations.append(
                    RouteOperation(
                        method=method,
                        path=join_url_paths(
                            registration_prefix,
                            configuration.prefix,
                            route_path,
                        ),
                        handler=node.name,
                        module=source,
                        line=node.lineno,
                        tags=tags,
                        guards=guards,
                        summary=first_doc_line(node, node.name),
                    )
                )
    for registrar_path in imported_router_registrars(path, app_root):
        operations.extend(
            parse_added_router_routes(
                registrar_path,
                app_root,
                registration,
                configuration,
            )
        )
    return operations


def declares_router(path: Path) -> bool:
    """Return whether a Python module constructs a FastAPI `APIRouter`."""
    tree = ast.parse(read_text(path), filename=str(path))
    return any(
        isinstance(node, ast.Call) and expression_name(node.func) == "APIRouter"
        for node in ast.walk(tree)
    )


def parse_direct_app_routes(source_path: Path, app_root: Path) -> list[RouteOperation]:
    """Extract routes declared directly on the FastAPI application."""
    tree = ast.parse(read_text(source_path), filename=str(source_path))
    operations: list[RouteOperation] = []
    functions = {
        node.name: node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call):
                continue
            details = route_decorator_details(decorator)
            if details is None or not expression_name(decorator.func).startswith("app."):
                continue
            methods, route_path = details
            for method in methods:
                operations.append(
                    RouteOperation(
                        method=method,
                        path=route_path,
                        handler=node.name,
                        module=relative_posix(source_path, app_root),
                        line=node.lineno,
                        tags=string_list(keyword(decorator, "tags")),
                        guards=dependency_summary(node, decorator),
                        summary=first_doc_line(node, node.name),
                    )
                )
    for call in (node for node in ast.walk(tree) if isinstance(node, ast.Call)):
        if expression_name(call.func) != "app.add_api_route" or len(call.args) < 2:
            continue
        route_path = constant_string(call.args[0], "<dynamic-path>")
        handler_name = expression_name(call.args[1]) or "<dynamic-handler>"
        methods = string_list(keyword(call, "methods")) or ("ANY",)
        handler = functions.get(handler_name)
        dependencies = keyword(call, "dependencies")
        guards = safe_unparse(dependencies, limit=120) if dependencies else "—"
        for method in methods:
            operations.append(
                RouteOperation(
                    method=method.upper(),
                    path=route_path,
                    handler=handler_name,
                    module=relative_posix(source_path, app_root),
                    line=call.lineno,
                    tags=string_list(keyword(call, "tags")),
                    guards=guards,
                    summary=first_doc_line(handler, handler_name)
                    if handler is not None
                    else handler_name.replace("_", " ").capitalize(),
                )
            )
    return operations


def build_api_catalog(app_root: Path) -> str:
    """Generate a source-traceable FastAPI route catalog."""
    server_path = app_root / "backend" / "server.py"
    composition_path = app_root / "backend" / "app" / "routes.py"
    if not composition_path.is_file():
        composition_path = server_path
    registrations = parse_router_registration(composition_path, app_root)
    mounted: list[tuple[RouterRegistration, Path]] = []
    for registration in registrations:
        path = resolve_registered_router(registration, composition_path, app_root)
        if path is not None:
            mounted.append((registration, path))

    discovered_paths = {
        path
        for root in (app_root / "backend" / "api", app_root / "backend" / "domains")
        for path in python_files(root, include_tests=False)
        if path.name != "__init__.py" and declares_router(path)
    }
    mounted_paths = {path for _, path in mounted}
    unregistered = sorted(discovered_paths - mounted_paths)

    operations: list[RouteOperation] = []
    for source_path in (server_path, app_root / "backend" / "app" / "factory.py"):
        if source_path.is_file():
            operations.extend(parse_direct_app_routes(source_path, app_root))
    for registration, path in mounted:
        operations.extend(parse_route_module(path, app_root, registration))
    for path in unregistered:
        operations.extend(parse_route_module(path, app_root, None))
    operations.sort(key=lambda item: (item.path, item.method, item.module, item.line))

    lines = generated_header(
        "API catalog",
        "Static inventory of FastAPI route decorators and router registrations. "
        "Use the runtime OpenAPI schema for authoritative request and response bodies.",
    )
    lines.extend(
        [
            "## Summary",
            "",
            f"- Registered routers: **{len(registrations)}**",
            f"- Discovered operations: **{len(operations)}**",
            f"- Unregistered route modules: **{len(unregistered)}**",
            "",
            "## Router registrations",
            "",
            "| Order | Router | Mount prefix | Tags | Registration |",
            "| ---: | --- | --- | --- | --- |",
        ]
    )
    for order, registration in enumerate(registrations, start=1):
        lines.append(
            "| "
            + " | ".join(
                [
                    str(order),
                    f"`{registration.module}.router`",
                    f"`{registration.prefix or '/'}`",
                    markdown_cell(", ".join(registration.tags)),
                    source_link(registration.source, registration.line),
                ]
            )
            + " |"
        )

    lines.extend(
        [
            "",
            "## Operations",
            "",
            "| Method | Effective path | Handler | Tags | Dependency guards | Summary | Source |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    for item in operations:
        lines.append(
            "| "
            + " | ".join(
                [
                    f"`{item.method}`",
                    f"`{markdown_cell(item.path)}`",
                    f"`{item.handler}`",
                    markdown_cell(", ".join(item.tags)),
                    markdown_cell(item.guards),
                    markdown_cell(item.summary),
                    source_link(item.module, item.line),
                ]
            )
            + " |"
        )

    lines.extend(["", "## Unregistered modules", ""])
    if unregistered:
        lines.append(
            "These files contain an `APIRouter` or route-oriented module name but are not "
            "mounted by the FastAPI composition registry. They may be obsolete, "
            "imported indirectly, or "
            "under development and require human review."
        )
        lines.append("")
        for path in unregistered:
            lines.append(f"- {source_link(relative_posix(path, app_root))}")
    else:
        lines.append("Every route module is registered.")
    lines.append("")
    return "\n".join(lines)
