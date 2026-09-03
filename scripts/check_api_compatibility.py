#!/usr/bin/env python3
"""Check Gnosi 3's public API surface against the final Gnosi 2.x release."""

from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal, cast


ROOT: Final = Path(__file__).resolve().parents[1]
BASELINE_PATH: Final = ROOT / "backend/tests/contracts/api-v2.0.6.json"
ALLOWLIST_PATH: Final = ROOT / "backend/tests/contracts/api-compatibility-allowlist.json"
OPENAPI_PATH: Final = ROOT / "openapi/openapi.json"
HTTP_METHODS: Final = frozenset({"delete", "get", "head", "options", "patch", "post", "put"})
SOURCE_ROOT: Final = "apps/gnosi/backend"
Category = Literal["json", "stream", "download", "redirect", "websocket"]


@dataclass(frozen=True, order=True)
class Operation:
    method: str
    path: str
    category: Category

    def to_json(self) -> dict[str, str]:
        return {"method": self.method, "path": self.path, "category": self.category}

    @classmethod
    def from_json(cls, value: object) -> Operation:
        if not isinstance(value, dict):
            raise ValueError("operation must be an object")
        method = value.get("method")
        path = value.get("path")
        category = value.get("category")
        if not isinstance(method, str) or not isinstance(path, str):
            raise ValueError("operation method and path must be strings")
        if category not in {"json", "stream", "download", "redirect", "websocket"}:
            raise ValueError(f"unsupported operation category: {category!r}")
        return cls(method.upper(), normalize_path(path), cast(Category, category))


def git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=ROOT, check=True, capture_output=True, text=True
    )
    return result.stdout.strip()


def normalize_path(path: str) -> str:
    normalized = "/" + path.strip("/")
    # FastAPI strips converters such as ``:path`` from OpenAPI. Parameter names
    # and converter spelling therefore cannot be compared from that contract;
    # static source extraction still proves that a parameterized segment exists.
    return re.sub(r"\{[^}]+\}", "{param}", normalized)


def literal_string(node: ast.AST | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def keyword(call: ast.Call, name: str) -> ast.AST | None:
    return next((item.value for item in call.keywords if item.arg == name), None)


def dotted_name(node: ast.AST) -> str | None:
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def router_prefix(tree: ast.Module) -> str:
    for statement in tree.body:
        if not isinstance(statement, (ast.Assign, ast.AnnAssign)):
            continue
        targets = statement.targets if isinstance(statement, ast.Assign) else [statement.target]
        value = statement.value
        if not any(isinstance(target, ast.Name) and target.id == "router" for target in targets):
            continue
        if isinstance(value, ast.Call) and dotted_name(value.func) in {"APIRouter", "fastapi.APIRouter"}:
            return literal_string(keyword(value, "prefix")) or ""
    return ""


def composition_prefixes(source: str) -> dict[str, str]:
    tree = ast.parse(source)
    prefixes: dict[str, str] = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or dotted_name(node.func) != "app.include_router":
            continue
        if not node.args:
            continue
        router_name = dotted_name(node.args[0])
        if router_name is None or not router_name.endswith(".router"):
            continue
        module_name = router_name.removesuffix(".router")
        prefixes[module_name] = literal_string(keyword(node, "prefix")) or ""
    return prefixes


def response_category(decorator: ast.Call, function: ast.AST) -> Category:
    response_class = keyword(decorator, "response_class")
    response_name = dotted_name(response_class) if response_class is not None else None
    if response_name == "RedirectResponse":
        return "redirect"
    if response_name == "StreamingResponse":
        return "stream"
    if response_name == "FileResponse":
        return "download"
    returns = function.returns if isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)) else None
    return_name = dotted_name(returns) if returns is not None else None
    if return_name == "RedirectResponse":
        return "redirect"
    if return_name == "StreamingResponse":
        return "stream"
    if return_name in {"FileResponse", "Response"}:
        return "download"
    for call in (item for item in ast.walk(function) if isinstance(item, ast.Call)):
        called = dotted_name(call.func)
        leaf = called.rsplit(".", 1)[-1] if called else ""
        if leaf == "RedirectResponse":
            return "redirect"
        if leaf == "StreamingResponse":
            return "stream"
        if leaf == "FileResponse":
            return "download"
        if leaf != "Response":
            continue
        status = keyword(call, "status_code")
        if isinstance(status, ast.Constant) and status.value == 204 and keyword(call, "content") is None:
            continue
        return "download"
    return "json"


def function_categories(tree: ast.Module) -> dict[str, Category]:
    """Infer transport categories, following same-module helper calls."""
    empty_decorator = ast.Call(func=ast.Name(id="route"), args=[], keywords=[])
    functions = {
        node.name: node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    categories = {name: response_category(empty_decorator, node) for name, node in functions.items()}
    changed = True
    while changed:
        changed = False
        for name, node in functions.items():
            if categories[name] != "json":
                continue
            called_names = {
                called.rsplit(".", 1)[-1]
                for call in ast.walk(node)
                if isinstance(call, ast.Call)
                and (called := dotted_name(call.func)) is not None
            }
            inherited = {
                categories[called]
                for called in called_names
                if called in categories and categories[called] != "json"
            }
            if len(inherited) == 1:
                categories[name] = next(iter(inherited))
                changed = True
    return categories


def route_operations(source: str, prefix: str) -> list[Operation]:
    tree = ast.parse(source)
    categories = function_categories(tree)
    operations: list[Operation] = []
    for function in ast.walk(tree):
        if not isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for item in function.decorator_list:
            if not isinstance(item, ast.Call):
                continue
            called = dotted_name(item.func)
            if called is None or "." not in called:
                continue
            owner, method = called.rsplit(".", 1)
            if owner != "router" or method not in HTTP_METHODS | {"websocket"}:
                continue
            path = literal_string(item.args[0] if item.args else keyword(item, "path"))
            if path is None:
                raise ValueError(f"non-literal route path on line {item.lineno}")
            category: Category = "websocket" if method == "websocket" else response_category(item, function)
            if category == "json":
                category = categories[function.name]
            operations.append(Operation(method.upper(), normalize_path(prefix + path), category))
    return operations


def historical_inventory(source_ref: str) -> tuple[str, str, list[Operation]]:
    commit = git("rev-parse", f"{source_ref}^{{commit}}")
    tree_id = git("rev-parse", f"{source_ref}^{{tree}}")
    server_path = f"{SOURCE_ROOT}/server.py"
    prefixes = composition_prefixes(git("show", f"{source_ref}:{server_path}"))
    filenames = git("ls-tree", "-r", "--name-only", source_ref, f"{SOURCE_ROOT}/api").splitlines()
    operations: set[Operation] = set()
    for filename in filenames:
        if not filename.endswith(".py") or "/tests/" in filename:
            continue
        module = Path(filename).stem
        source = git("show", f"{source_ref}:{filename}")
        tree = ast.parse(source)
        full_prefix = prefixes.get(module, "") + router_prefix(tree)
        operations.update(route_operations(source, full_prefix))
    return commit, tree_id, sorted(operations)


def openapi_category(operation: dict[str, object]) -> Category:
    responses = operation.get("responses")
    if not isinstance(responses, dict):
        return "json"
    media_types: set[str] = set()
    statuses: set[int] = set()
    for status, response in responses.items():
        if isinstance(status, str) and status.isdigit():
            statuses.add(int(status))
        if not isinstance(response, dict):
            continue
        content = response.get("content")
        if isinstance(content, dict):
            media_types.update(str(item).lower() for item in content)
        headers = response.get("headers")
        if isinstance(headers, dict) and any(str(item).lower() == "content-disposition" for item in headers):
            return "download"
    if statuses and all(300 <= status < 400 for status in statuses):
        return "redirect"
    if any(item in {"text/event-stream", "application/x-ndjson"} for item in media_types):
        return "stream"
    if any(
        item in {"application/octet-stream", "application/zip", "application/pdf", "text/calendar"}
        or item.startswith("audio/")
        or item.startswith("image/")
        for item in media_types
    ):
        return "download"
    return "json"


def endpoint_source_categories() -> tuple[dict[str, Category], dict[tuple[str, str], Category]]:
    """Return unambiguous endpoint and route-suffix transport evidence."""
    evidence: dict[str, set[Category]] = {}
    route_evidence: dict[tuple[str, str], set[Category]] = {}
    for filename in sorted((ROOT / "backend").rglob("*.py")):
        if "tests" in filename.parts:
            continue
        tree = ast.parse(filename.read_text(encoding="utf-8"), filename=str(filename))
        functions = function_categories(tree)
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            category = functions[node.name]
            evidence.setdefault(node.name, set()).add(category)
            for decorator in node.decorator_list:
                if not isinstance(decorator, ast.Call):
                    continue
                called = dotted_name(decorator.func)
                if called is None or "." not in called:
                    continue
                _, method = called.rsplit(".", 1)
                if method not in HTTP_METHODS:
                    continue
                path = literal_string(decorator.args[0] if decorator.args else keyword(decorator, "path"))
                if path is not None:
                    route_evidence.setdefault((method.upper(), normalize_path(path)), set()).add(
                        response_category(decorator, node)
                    )
        for call in (item for item in ast.walk(tree) if isinstance(item, ast.Call)):
            if dotted_name(call.func) not in {"router.add_api_route", "app.add_api_route"} or len(call.args) < 2:
                continue
            path = literal_string(call.args[0])
            endpoint_name = dotted_name(call.args[1])
            methods_node = keyword(call, "methods")
            if path is None or endpoint_name is None or not isinstance(methods_node, (ast.List, ast.Tuple)):
                continue
            inferred_category = functions.get(endpoint_name.rsplit(".", 1)[-1])
            if inferred_category is None:
                continue
            for method_node in methods_node.elts:
                method_literal = literal_string(method_node)
                if method_literal is not None and method_literal.lower() in HTTP_METHODS:
                    route_evidence.setdefault(
                        (method_literal.upper(), normalize_path(path)), set()
                    ).add(inferred_category)
    by_name = {
        name: next(iter(values))
        for name, values in evidence.items()
        if len(values) == 1 and "json" not in values
    }
    by_route = {
        identity: next(iter(values))
        for identity, values in route_evidence.items()
        if len(values) == 1 and "json" not in values
    }
    return by_name, by_route


def current_inventory(openapi_path: Path = OPENAPI_PATH) -> list[Operation]:
    document = json.loads(openapi_path.read_text(encoding="utf-8"))
    paths = document.get("paths")
    if not isinstance(paths, dict):
        raise ValueError("OpenAPI paths must be an object")
    operations: set[Operation] = set()
    source_categories, source_routes = endpoint_source_categories()
    for path, path_item in paths.items():
        if not isinstance(path, str) or not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method not in HTTP_METHODS or not isinstance(operation, dict):
                continue
            category = openapi_category(operation)
            operation_id = operation.get("operationId")
            if category == "json" and isinstance(operation_id, str):
                candidates = [
                    (name, candidate)
                    for name, candidate in source_categories.items()
                    if operation_id.startswith(f"{name}_")
                ]
                if candidates:
                    _, category = max(candidates, key=lambda item: len(item[0]))
            if category == "json":
                suffix_candidates = [
                    (suffix, candidate)
                    for (candidate_method, suffix), candidate in source_routes.items()
                    if candidate_method == method.upper()
                    and (normalize_path(path) == suffix or normalize_path(path).endswith(suffix))
                ]
                if suffix_candidates:
                    _, category = max(suffix_candidates, key=lambda item: len(item[0]))
            operations.add(Operation(method.upper(), normalize_path(path), category))
    composition = (ROOT / "backend/app/routes.py").read_text(encoding="utf-8")
    prefixes = composition_prefixes(composition)
    for filename in sorted((ROOT / "backend").rglob("*.py")):
        if "tests" in filename.parts or filename.name == "routes.py" and filename.parent.name == "app":
            continue
        source = filename.read_text(encoding="utf-8")
        if ".websocket" not in source:
            continue
        module = filename.stem
        tree = ast.parse(source)
        prefix = prefixes.get(module, "") + router_prefix(tree)
        operations.update(item for item in route_operations(source, prefix) if item.category == "websocket")
    return sorted(operations)


def load_baseline(path: Path = BASELINE_PATH) -> tuple[dict[str, object], list[Operation]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("operations"), list):
        raise ValueError("baseline must contain an operations list")
    for item in payload["operations"]:
        if not isinstance(item, dict) or set(item) != {"method", "path", "category"}:
            raise ValueError("baseline operations must contain only method, path and category")
    return payload, sorted(Operation.from_json(item) for item in payload["operations"])


def load_allowlist(path: Path = ALLOWLIST_PATH) -> dict[Operation, dict[str, object]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or set(payload) != {"exceptions"}:
        raise ValueError("allowlist must contain only an exceptions list")
    exceptions = payload["exceptions"]
    if not isinstance(exceptions, list):
        raise ValueError("allowlist exceptions must be a list")
    result: dict[Operation, dict[str, object]] = {}
    for entry in exceptions:
        if not isinstance(entry, dict):
            raise ValueError("allowlist entry must be an object")
        operation = Operation.from_json(entry)
        reason = entry.get("reason")
        disposition = entry.get("disposition")
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError(f"allowlist reason is required for {operation}")
        if disposition not in {"removed", "replaced"}:
            raise ValueError(f"allowlist disposition is invalid for {operation}")
        allowed_keys = {"method", "path", "category", "reason", "disposition"}
        if disposition == "replaced":
            allowed_keys.add("replacement")
        if set(entry) != allowed_keys:
            raise ValueError(f"allowlist entry has unknown or missing fields for {operation}")
        if any(token in operation.path for token in ("*", "[", "]")):
            raise ValueError(f"allowlist wildcards are forbidden for {operation}")
        if disposition == "replaced" and not isinstance(entry.get("replacement"), dict):
            raise ValueError(f"replacement operation is required for {operation}")
        if disposition == "replaced":
            replacement = entry["replacement"]
            assert isinstance(replacement, dict)
            if set(replacement) != {"method", "path", "category"}:
                raise ValueError(f"replacement must contain only method, path and category for {operation}")
            Operation.from_json(replacement)
        if operation in result:
            raise ValueError(f"duplicate allowlist entry: {operation}")
        result[operation] = entry
    return result


def compatibility_failures(
    baseline: list[Operation], current: list[Operation], allowlist: dict[Operation, dict[str, object]]
) -> list[str]:
    current_set = set(current)
    current_by_identity = {(item.method, item.path): item for item in current}
    failures: list[str] = []
    used: set[Operation] = set()
    for expected in baseline:
        if expected in current_set:
            continue
        exception = allowlist.get(expected)
        if exception is not None:
            used.add(expected)
            if exception["disposition"] == "replaced":
                replacement = Operation.from_json(exception["replacement"])
                if replacement not in current_set:
                    failures.append(f"allowlisted replacement is absent: {replacement}")
            continue
        actual = current_by_identity.get((expected.method, expected.path))
        if actual is None:
            failures.append(f"missing: {expected.method} {expected.path} [{expected.category}]")
        else:
            failures.append(
                f"category changed: {expected.method} {expected.path} "
                f"[{expected.category} -> {actual.category}]"
            )
    for stale in sorted(set(allowlist) - used):
        failures.append(f"stale allowlist entry: {stale.method} {stale.path} [{stale.category}]")
    return failures


def write_baseline(source_ref: str, path: Path = BASELINE_PATH) -> None:
    commit, tree_id, operations = historical_inventory(source_ref)
    payload = {
        "format_version": 1,
        "source": {"ref": source_ref, "commit": commit, "tree": tree_id},
        "operations": [item.to_json() for item in operations],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {path.relative_to(ROOT)} with {len(operations)} operations from {source_ref} ({commit}).")


def verify_baseline_provenance(payload: dict[str, object], operations: list[Operation]) -> None:
    if payload.get("format_version") != 1:
        raise ValueError("unsupported baseline format_version")
    source = payload.get("source")
    if not isinstance(source, dict):
        raise ValueError("baseline source metadata is missing")
    source_ref = source.get("ref")
    commit = source.get("commit")
    tree_id = source.get("tree")
    if not all(isinstance(item, str) and item for item in (source_ref, commit, tree_id)):
        raise ValueError("baseline source ref, commit and tree must be non-empty strings")
    assert isinstance(source_ref, str) and isinstance(commit, str) and isinstance(tree_id, str)
    if git("rev-parse", f"{source_ref}^{{commit}}") != commit:
        raise ValueError(f"baseline ref {source_ref} no longer resolves to recorded commit {commit}")
    if git("rev-parse", f"{source_ref}^{{tree}}") != tree_id:
        raise ValueError(f"baseline ref {source_ref} no longer resolves to recorded tree {tree_id}")
    extracted_commit, extracted_tree, extracted_operations = historical_inventory(source_ref)
    if extracted_commit != commit or extracted_tree != tree_id:
        raise ValueError("historical source identity changed during baseline verification")
    if extracted_operations != operations:
        raise ValueError(
            "historical baseline differs from its recorded Git source; regenerate it "
            "from the reviewed tag and inspect the complete diff"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--regenerate-baseline", action="store_true")
    parser.add_argument("--source-ref", default="v2.0.6")
    args = parser.parse_args()
    if args.regenerate_baseline:
        write_baseline(args.source_ref)
        return 0
    payload, baseline = load_baseline()
    verify_baseline_provenance(payload, baseline)
    current = current_inventory()
    allowlist = load_allowlist()
    failures = compatibility_failures(baseline, current, allowlist)
    if failures:
        print("API compatibility check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    counts = {category: sum(item.category == category for item in baseline) for category in ("json", "stream", "download", "redirect", "websocket")}
    summary = ", ".join(f"{name}={count}" for name, count in counts.items())
    print(f"API compatibility preserved: {len(baseline)} historical operations ({summary}); {len(current)} current operations.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
