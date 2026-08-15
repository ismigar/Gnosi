#!/usr/bin/env python3
"""Scope which source files carry non-English *documentation* (comments/docstrings).

Distinguishes comments/docstrings from ordinary string literals so we do NOT flag
user-facing UI text, i18n content, or test data (which must stay untranslated).

Outputs a JSON inventory to stdout and a human summary to stderr.
"""
import ast
import io
import json
import os
import sys
import tokenize

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")

EXCLUDE_DIR_PARTS = {
    "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache",
    "dist", "build", ".vite", "test-results", "vendor", "coverage",
    ".git", "pdfjs", ".mypy_cache", "playwright-report", "htmlcov",
}
EXCLUDE_SUFFIX = (".min.js", ".bundle.js", ".map")

NONASCII = lambda s: any(ord(c) > 127 for c in s)


def iter_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIR_PARTS]
        for fn in filenames:
            if fn.endswith(EXCLUDE_SUFFIX):
                continue
            ext = os.path.splitext(fn)[1]
            if ext in (".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"):
                yield os.path.join(dirpath, fn)


def scan_python(path, src):
    """Return (comment_hits, docstring_hits, string_hits) line counts with non-ASCII."""
    comment = docstring = other = 0
    # Comments via tokenize
    try:
        toks = list(tokenize.generate_tokens(io.StringIO(src).readline))
    except Exception:
        toks = []
    docstring_positions = set()
    try:
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                ds = ast.get_docstring(node, clean=False)
                if ds is not None:
                    body0 = node.body[0] if getattr(node, "body", None) else None
                    if isinstance(body0, ast.Expr) and isinstance(getattr(body0, "value", None), ast.Constant):
                        docstring_positions.add((body0.value.lineno, body0.value.col_offset))
                        if NONASCII(ds):
                            docstring += 1
    except Exception:
        pass
    for tok in toks:
        if tok.type == tokenize.COMMENT and NONASCII(tok.string):
            comment += 1
        elif tok.type == tokenize.STRING and NONASCII(tok.string):
            if tok.start not in docstring_positions:
                other += 1
    return comment, docstring, other


def scan_cstyle(src):
    """Char-scanner for JS/TS: separate // and /* */ (and /** */) comments from strings.

    Returns (comment_hits, string_hits) — approximate line counts with non-ASCII.
    """
    i, n = 0, len(src)
    comment_nonascii_lines = set()
    string_has = 0
    line = 1
    STRING = None  # current quote char or None
    template_expr_depth = 0
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if c == "\n":
            line += 1
            i += 1
            continue
        if STRING:
            if c == "\\":
                i += 2
                continue
            if c == STRING:
                STRING = None
            elif ord(c) > 127:
                string_has += 1
            i += 1
            continue
        # not in string
        if c == "/" and nxt == "/":
            j = i + 2
            has = False
            while j < n and src[j] != "\n":
                if ord(src[j]) > 127:
                    has = True
                j += 1
            if has:
                comment_nonascii_lines.add(line)
            i = j
            continue
        if c == "/" and nxt == "*":
            j = i + 2
            while j < n and not (src[j] == "*" and j + 1 < n and src[j + 1] == "/"):
                if src[j] == "\n":
                    line += 1
                elif ord(src[j]) > 127:
                    comment_nonascii_lines.add(line)
                j += 1
            i = j + 2
            continue
        if c in ("'", '"', "`"):
            STRING = c
            i += 1
            continue
        i += 1
    return len(comment_nonascii_lines), string_has


def main():
    inventory = []
    for path in iter_files():
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                src = f.read()
        except Exception:
            continue
        rel = os.path.relpath(path, ROOT)
        ext = os.path.splitext(path)[1]
        if ext == ".py":
            c, d, o = scan_python(path, src)
            doc_hits = c + d
            str_hits = o
        else:
            c, s = scan_cstyle(src)
            doc_hits = c
            d = 0
            str_hits = s
        if doc_hits > 0:
            inventory.append({
                "path": rel,
                "ext": ext,
                "comment_hits": c,
                "docstring_hits": d,
                "doc_hits": doc_hits,
                "string_hits": str_hits,
            })
    inventory.sort(key=lambda x: (-x["doc_hits"], x["path"]))
    print(json.dumps(inventory, ensure_ascii=False, indent=None))
    # summary
    by_top = {}
    total_hits = 0
    for it in inventory:
        top = "/".join(it["path"].split("/")[:2])
        by_top.setdefault(top, {"files": 0, "hits": 0})
        by_top[top]["files"] += 1
        by_top[top]["hits"] += it["doc_hits"]
        total_hits += it["doc_hits"]
    print(f"\n=== FILES NEEDING DOC TRANSLATION: {len(inventory)} (total doc-hit lines: {total_hits}) ===", file=sys.stderr)
    for top, agg in sorted(by_top.items(), key=lambda kv: -kv[1]["files"]):
        print(f"{agg['files']:4d} files, {agg['hits']:5d} hits  {top}", file=sys.stderr)


if __name__ == "__main__":
    main()
