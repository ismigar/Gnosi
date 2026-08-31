#!/usr/bin/env python3
"""Report likely Catalan/Spanish Python documentation, logs, strings, and Markdown prose."""
from __future__ import annotations

import argparse
import ast
import io
import json
import re
import subprocess
import sys
import tokenize
from collections.abc import Iterator
from pathlib import Path


EXCLUDED_DIRS = {
    ".git", ".mypy_cache", ".pytest_cache", ".venv", "__pycache__", "build",
    "coverage", "dist", "node_modules", "playwright-report", "test-results",
    "sandbox", "vendor",
}
GENERATED_DATA_FILES = {
    "backend/services/zotero_schema.py",
}
INTENTIONAL_RUNTIME_STRINGS = {
    "Estado de verificación",
    "Estat",
    "Estat de verificació",
    "Fet",
    "Núm. pàgines",
    "Pàgines",
    "Taula",
    "Taula 1",
    "Taula Principal",
    "Base de dades sense títol",
    "Leer artículo completo",
    "Llegeix l'article complet",
    "cal",
    "diseña",
    "español",
    "estado",
    "estat",
    "fitxer",
    "fitxer adjunt",
    "fitxers",
    "Fitxers",
    "note d'index",
    "nova pàgina",
    "quan",
    "sin título",
    "taula_1",
    # Language-detection patterns and multilingual stopwords are input data,
    # not defaults shown to users or prose written for developers.
    "ñ|¿|¡",
    "[ñ]",
    "porque",
    "también",
    "però",
    "aquest",
    "aquesta",
    "això",
}
CATALAN_WORDS = {
    "abans", "això", "aquesta", "aquest", "aquestes", "aquests", "arrel",
    "arrencar", "assegurar", "avís", "cal", "canvi", "canvis", "carrega",
    "causa", "comprovar", "dades", "desar", "després", "directiva", "dins",
    "esborrar", "estat", "executar", "fet", "feta", "fitxer", "fitxers",
    "fora", "idioma", "llegir", "màquina", "mai", "mateix", "mateixa",
    "només", "objectiu", "pàgina", "pàgines", "pendent", "perquè", "però",
    "problema", "qualsevol", "quan", "queda", "queden", "regla", "següent",
    "sempre", "solució", "també", "taula", "taules", "usuari", "usuaris",
    "verificació", "vistes",
}
SPANISH_WORDS = {
    "antes", "archivo", "archivos", "aviso", "cambio", "cambios", "cargar",
    "causa", "comprobar", "datos", "después", "directiva", "dentro",
    "ejecutar", "eliminar", "escribir", "estado", "fuera", "hecho", "idioma",
    "leer", "máquina", "nunca", "objetivo", "página", "páginas", "pendiente",
    "pero", "porque", "problema", "regla", "siguiente", "siempre", "sin",
    "solución", "también", "tabla", "tablas", "usuario", "usuarios",
    "verificación",
}
LOG_METHODS = {"debug", "error", "exception", "info", "warning"}
FENCE_RE = re.compile(r"^\s*(```|~~~)")
PROTECTED_RE = re.compile(
    r"`[^`\n]+`|https?://\S+|<[^>\n]+>|\{\{[^}\n]+\}\}|\[\[[^\]\n]+\]\]"
)
EXAMPLE_RE = re.compile(r"`[^`\n]+`|\"[^\"\n]+\"|«[^»\n]+»")


def language_signal(text: str) -> str | None:
    lower = str(text or "").lower()
    tokens = re.findall(r"[a-zà-ÿ]+", lower)
    ca_hits = sum(token in CATALAN_WORDS for token in tokens)
    es_hits = sum(token in SPANISH_WORDS for token in tokens)
    catalan_elision = bool(
        re.search(r"(?<![a-zà-ÿ])[ldsnm]'[a-zà-ÿ]", lower, flags=re.IGNORECASE)
    )
    catalan_chars = bool(re.search(r"[àèòïüç·]", lower, flags=re.IGNORECASE))
    spanish_chars = bool(re.search(r"[ñ¿¡]", lower))
    if catalan_elision or ca_hits >= 2 or (ca_hits >= 1 and catalan_chars):
        return "ca"
    if spanish_chars or es_hits >= 2:
        return "es"
    if ca_hits >= 1 and es_hits == 0:
        return "ca"
    if es_hits >= 1 and ca_hits == 0:
        return "es"
    return None


def strip_intentional_examples(text: str) -> str:
    """Remove quoted/code data examples before evaluating documentation prose."""
    return EXAMPLE_RE.sub(" ", text)


def is_intentional_runtime_string(text: str) -> bool:
    """Return whether text is compatibility data rather than an English default."""
    stripped = text.strip()
    if stripped in INTENTIONAL_RUNTIME_STRINGS:
        return True
    if stripped.startswith(r"[\w") or stripped.startswith(r"\b("):
        return True
    if stripped.startswith("<?xml") and "xmlns:cal=" in stripped:
        return True
    return False


def iter_files(root: Path, suffixes: set[str]) -> Iterator[Path]:
    if root.is_file():
        if root.suffix.lower() in suffixes:
            yield root
        return
    for path in root.rglob("*"):
        if any(part in EXCLUDED_DIRS for part in path.parts):
            continue
        if path.is_file() and path.suffix.lower() in suffixes:
            yield path


def report(path: Path, line: int, kind: str, text: str, language: str) -> None:
    compact = " ".join(text.split())
    print(f"{path}:{line}:{kind}:{language}:{compact}")


def detected_languages(texts: list[str], language_detector: Path | None) -> list[str | None]:
    """Return Catalan/Spanish detections using an optional batch detector."""
    if not texts:
        return []
    if language_detector is None:
        return [language_signal(text) for text in texts]
    result = subprocess.run(
        [str(language_detector)],
        input=json.dumps(texts, ensure_ascii=False),
        text=True,
        capture_output=True,
        check=True,
    )
    detected = json.loads(result.stdout)
    if len(detected) != len(texts):
        raise RuntimeError("Language detector returned an invalid response")
    return [language if language in {"ca", "es"} else None for language in detected]


def scan_python(
    path: Path,
    *,
    inspect_strings: bool = False,
    language_detector: Path | None = None,
) -> int:
    source = path.read_text(encoding="utf-8", errors="replace")
    candidates: list[tuple[int, str, str, str]] = []
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except (IndentationError, tokenize.TokenError):
        tokens = []
    for token in tokens:
        if token.type != tokenize.COMMENT:
            continue
        if "@language-example" in token.string:
            continue
        candidates.append((token.start[0], "comment", token.string, strip_intentional_examples(token.string)))

    try:
        tree = ast.parse(source)
    except SyntaxError:
        languages = detected_languages([item[3] for item in candidates], language_detector)
        for (line, kind, text, _), language in zip(candidates, languages):
            if language:
                report(path, line, kind, text, language)
        return sum(bool(language) for language in languages)
    skipped_runtime_nodes: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.JoinedStr):
            skipped_runtime_nodes.update(id(child) for child in ast.walk(node) if child is not node)
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", [])
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                skipped_runtime_nodes.add(id(body[0].value))
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            docstring = ast.get_docstring(node, clean=False)
            if docstring:
                if "@language-example" in docstring:
                    continue
                body = getattr(node, "body", [])
                line = body[0].lineno if body else getattr(node, "lineno", 1)
                candidates.append((line, "docstring", docstring, strip_intentional_examples(docstring)))
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        if node.func.attr not in LOG_METHODS:
            continue
        owner = node.func.value.id if isinstance(node.func.value, ast.Name) else ""
        if owner not in {"log", "logger"}:
            continue
        for argument in node.args:
            skipped_runtime_nodes.update(id(child) for child in ast.walk(argument))
            values: list[str] = []
            if isinstance(argument, ast.Constant) and isinstance(argument.value, str):
                values.append(argument.value)
            elif isinstance(argument, ast.JoinedStr):
                values.extend(
                    value.value
                    for value in argument.values
                    if isinstance(value, ast.Constant) and isinstance(value.value, str)
                )
            text = " ".join(values)
            if text:
                candidates.append((argument.lineno, f"{owner}.{node.func.attr}", text, text))
    if inspect_strings:
        for node in ast.walk(tree):
            if id(node) in skipped_runtime_nodes:
                continue
            string_values: list[str] = []
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                string_values.append(node.value)
            elif isinstance(node, ast.JoinedStr):
                string_values.extend(
                    value.value
                    for value in node.values
                    if isinstance(value, ast.Constant) and isinstance(value.value, str)
                )
            if not string_values:
                continue
            text = " ".join(string_values)
            if is_intentional_runtime_string(text):
                continue
            candidates.append((getattr(node, "lineno", 1), "runtime-string", text, text))

    languages = detected_languages([item[3] for item in candidates], language_detector)
    findings = 0
    for (line, kind, text, _), language in zip(candidates, languages):
        if language:
            report(path, line, kind, text, language)
            findings += 1
    return findings


def scan_markdown(path: Path, language_detector: Path | None = None) -> int:
    findings = 0
    in_fence = False
    candidates: list[tuple[int, str, str]] = []
    for line_number, line in enumerate(
        path.read_text(encoding="utf-8", errors="replace").splitlines(),
        start=1,
    ):
        if "@language-example" in line:
            continue
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        prose = PROTECTED_RE.sub(" ", line)
        candidates.append((line_number, line, prose))
    if language_detector is not None and candidates:
        result = subprocess.run(
            [str(language_detector)],
            input=json.dumps([item[2] for item in candidates], ensure_ascii=False),
            text=True,
            capture_output=True,
            check=True,
        )
        languages = json.loads(result.stdout)
        if len(languages) != len(candidates):
            raise RuntimeError("Language detector returned an invalid response")
    else:
        languages = [language_signal(item[2]) for item in candidates]
    for (line_number, line, _prose), language in zip(candidates, languages):
        language = language if language in {"ca", "es"} else None
        if language:
            report(path, line_number, "prose", line, language)
            findings += 1
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("roots", nargs="+", type=Path)
    parser.add_argument("--markdown", action="store_true")
    parser.add_argument("--strings", action="store_true")
    parser.add_argument(
        "--language-detector",
        type=Path,
        help="Optional executable that maps a JSON string array to language-code JSON.",
    )
    args = parser.parse_args()

    findings = 0
    if args.markdown:
        for root in args.roots:
            for path in iter_files(root.resolve(), {".md", ".mdown", ".txt"}):
                findings += scan_markdown(
                    path,
                    args.language_detector.resolve() if args.language_detector else None,
                )
        label = "Markdown prose"
    else:
        for root in args.roots:
            for path in iter_files(root.resolve(), {".py"}):
                if args.strings and (
                    "tests" in path.parts or path.name.startswith("test_")
                ):
                    continue
                try:
                    relative_path = path.relative_to(Path.cwd().resolve()).as_posix()
                except ValueError:
                    relative_path = ""
                if args.strings and (
                    relative_path in GENERATED_DATA_FILES
                    or path.resolve() == Path(__file__).resolve()
                ):
                    continue
                findings += scan_python(
                    path,
                    inspect_strings=args.strings,
                    language_detector=args.language_detector.resolve() if args.language_detector else None,
                )
        label = "Python documentation/log/runtime-string" if args.strings else "Python documentation/log"
    print(f"Likely non-English {label} findings: {findings}", file=sys.stderr)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
