"""Static source catalog responsibility: model catalog."""

from __future__ import annotations

import ast
from pathlib import Path

from pipeline.skills.technical_documentation.scripts.catalog_common import (
    SECRET_NAME_RE,
    constant_string,
    expression_name,
    generated_header,
    keyword,
    markdown_cell,
    read_text,
    relative_posix,
    safe_unparse,
    source_link,
)


def boolean_keyword(call: ast.Call, name: str) -> str:
    """Render a boolean SQLAlchemy column keyword as yes, no, or source expression."""
    node = keyword(call, name)
    if isinstance(node, ast.Constant) and isinstance(node.value, bool):
        return "yes" if node.value else "no"
    return safe_unparse(node, limit=40) if node is not None else "—"


def column_foreign_key(call: ast.Call) -> str:
    """Return the first literal SQLAlchemy ForeignKey target in a column call."""
    for node in ast.walk(call):
        if (
            not isinstance(node, ast.Call)
            or expression_name(node.func).split(".")[-1] != "ForeignKey"
        ):
            continue
        if node.args:
            return constant_string(node.args[0], safe_unparse(node.args[0], limit=60))
    return "—"


def column_declaration(
    statement: ast.stmt,
) -> tuple[ast.Name, ast.Call, ast.AST | None, int] | None:
    """Return one legacy or SQLAlchemy 2 declarative column assignment."""
    target: ast.expr
    value: ast.expr | None
    annotation: ast.AST | None = None
    if isinstance(statement, ast.Assign) and len(statement.targets) == 1:
        target = statement.targets[0]
        value = statement.value
    elif isinstance(statement, ast.AnnAssign):
        target = statement.target
        value = statement.value
        annotation = statement.annotation
    else:
        return None
    if not isinstance(target, ast.Name) or not isinstance(value, ast.Call):
        return None
    if expression_name(value.func).split(".")[-1] not in {"Column", "mapped_column"}:
        return None
    return target, value, annotation, statement.lineno


def mapped_annotation_type(annotation: ast.AST | None) -> ast.AST | None:
    """Extract ``T`` from a SQLAlchemy ``Mapped[T]`` annotation."""
    if not isinstance(annotation, ast.Subscript):
        return None
    if expression_name(annotation.value).split(".")[-1] != "Mapped":
        return None
    return annotation.slice


def annotation_contains_none(annotation: ast.AST) -> bool:
    """Return whether a type expression explicitly includes ``None``."""
    if isinstance(annotation, ast.Constant):
        return annotation.value is None
    if isinstance(annotation, ast.Name):
        return annotation.id in {"None", "NoneType"}
    if isinstance(annotation, ast.BinOp) and isinstance(annotation.op, ast.BitOr):
        return annotation_contains_none(annotation.left) or annotation_contains_none(
            annotation.right
        )
    if isinstance(annotation, ast.Subscript):
        if expression_name(annotation.value).split(".")[-1] == "Optional":
            return True
        return annotation_contains_none(annotation.slice)
    if isinstance(annotation, (ast.Tuple, ast.List)):
        return any(annotation_contains_none(item) for item in annotation.elts)
    return False


def column_nullable(call: ast.Call, annotation: ast.AST | None) -> str:
    """Render explicit or SQLAlchemy-2-inferred column nullability."""
    if keyword(call, "nullable") is not None:
        return boolean_keyword(call, "nullable")
    mapped_type = mapped_annotation_type(annotation)
    if mapped_type is None:
        return "—"
    return "yes" if annotation_contains_none(mapped_type) else "no"


def build_data_model_catalog(app_root: Path) -> str:
    """Generate SQLAlchemy table and column reference without importing models."""
    model_root = app_root / "backend" / "models"
    tables: list[tuple[str, str, str, int, list[tuple[str, ...]]]] = []
    for path in sorted(model_root.glob("*.py")):
        tree = ast.parse(read_text(path), filename=str(path))
        source = relative_posix(path, app_root)
        for node in tree.body:
            if not isinstance(node, ast.ClassDef):
                continue
            table_name = ""
            for statement in node.body:
                if not isinstance(statement, ast.Assign):
                    continue
                if any(
                    isinstance(target, ast.Name) and target.id == "__tablename__"
                    for target in statement.targets
                ):
                    table_name = constant_string(statement.value)
                    break
            if not table_name:
                continue

            columns: list[tuple[str, ...]] = []
            for statement in node.body:
                declaration = column_declaration(statement)
                if declaration is None:
                    continue
                target, call, annotation, line = declaration
                type_node = call.args[0] if call.args else mapped_annotation_type(annotation)
                type_name = safe_unparse(type_node, limit=60)
                if (
                    isinstance(type_node, ast.Call)
                    and expression_name(type_node.func).split(".")[-1] == "ForeignKey"
                ):
                    type_name = "inferred"
                default_node = keyword(call, "default")
                default = (
                    "redacted"
                    if SECRET_NAME_RE.search(target.id)
                    else safe_unparse(default_node, limit=60)
                )
                columns.append(
                    (
                        target.id,
                        type_name,
                        boolean_keyword(call, "primary_key"),
                        column_nullable(call, annotation),
                        boolean_keyword(call, "unique"),
                        boolean_keyword(call, "index"),
                        column_foreign_key(call),
                        default,
                        str(line),
                    )
                )
            tables.append((table_name, node.name, source, node.lineno, columns))
    tables.sort(key=lambda item: (item[0], item[2], item[3]))

    lines = generated_header(
        "Relational data model",
        "Static SQLAlchemy table and column catalog. Runtime SQLite inspection remains "
        "authoritative for an installed instance, especially after lightweight migrations.",
    )
    lines.extend(
        [
            f"Discovered **{len(tables)} mapped tables** and "
            f"**{sum(len(item[4]) for item in tables)} mapped columns**.",
            "",
            "## Table summary",
            "",
            "| Table | Model | Columns | Source |",
            "| --- | --- | ---: | --- |",
        ]
    )
    for table_name, model_name, source, line, columns in tables:
        lines.append(
            f"| `{table_name}` | `{model_name}` | {len(columns)} | {source_link(source, line)} |"
        )

    for table_name, model_name, source, _, columns in tables:
        lines.extend(
            [
                "",
                f"## `{table_name}` — `{model_name}`",
                "",
                "| Column | Type | Primary key | Nullable | Unique | Index | "
                "Foreign key | Source default | Source |",
                "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
            ]
        )
        for (
            name,
            type_name,
            primary,
            nullable,
            unique,
            index,
            foreign_key,
            default,
            column_line,
        ) in columns:
            lines.append(
                "| "
                + " | ".join(
                    [
                        f"`{name}`",
                        f"`{markdown_cell(type_name)}`",
                        primary,
                        nullable,
                        unique,
                        index,
                        f"`{markdown_cell(foreign_key)}`" if foreign_key != "—" else "—",
                        markdown_cell(default),
                        source_link(source, int(column_line)),
                    ]
                )
                + " |"
            )
    lines.append("")
    return "\n".join(lines)
