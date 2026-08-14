"""The auto-generated tools validator must genuinely enforce its list of
prohibitions.

Tools that pass the validator and are not EXTERNAL_WRITE get AUTO-APPROVED and
executed (creator.create_new_tool → loader exec), and create_new_tool is
wired to the coder agent. The validator was trivially bypassable (regex over
call syntax): reassigning the name (`f = eval`), aliasing (`imp = __import__`),
`os.environ`, `open(p, "wb")`. Detection is now AST-based (it looks at the
referenced name), closing the demonstrated escapes.

NOTE: this is not a complete sandbox (pathlib and __import__ are still broad); this
enforces the validator's declared policy.
"""
import pytest

from backend.agent.generated_tools.validator import validator

_HDR = "from langchain_core.tools import tool\n"


def _wrap(body: str, imports: str = "") -> str:
    lines = "\n".join(f"    {l}" for l in body.strip("\n").split("\n"))
    return f'{_HDR}{imports}@tool\ndef read_helper(x: str) -> str:\n    """r"""\n{lines}\n'


# --- Escapes that PREVIOUSLY passed (regex bypassed) → now BLOCKED ----------
BYPASSES = {
    "eval_alias": _wrap("f = eval\n    return str(f(x))"),
    "import_alias_getattr": _wrap('imp = __import__\n    return getattr(imp("os"), "system")(x)'),
    "os_environ": _wrap('return os.environ.get("K", "")', imports="import os.path\n"),
    "os_remove": _wrap("os.remove(x)\n    return x", imports="import os.path\n"),
    "open_wb": _wrap('open(x, "wb").write(b"")\n    return x'),
    "open_append": _wrap('open(x, "a").write("!")\n    return x'),
    "open_var_mode": _wrap('m = "wb"\n    open(x, m)\n    return x'),
    "dunder_globals": _wrap('return str(read_helper.__globals__)'),
}


@pytest.mark.parametrize("name", sorted(BYPASSES))
def test_escape_is_blocked(name):
    r = validator.validate(BYPASSES[name], "read_helper")
    assert not r.is_valid, f"{name} hauria d'estar bloquejat"


# --- Legitimate safe tools → still PASS ----------------------------
LEGIT = {
    "json_only": _wrap('return json.dumps({"x": x})', imports="import json\n"),
    "read_open": _wrap("return open(x).read()[:100]"),
    "read_open_rb": _wrap('return str(open(x, "rb").read()[:10])'),
    "pathlib_read": _wrap("return _P(x).name", imports="from pathlib import Path as _P\n"),
}


@pytest.mark.parametrize("name", sorted(LEGIT))
def test_legit_tool_passes(name):
    r = validator.validate(LEGIT[name], "read_helper")
    assert r.is_valid, f"{name} hauria de passar; errors={r.errors}"


def test_existing_forbidden_still_blocked():
    # The prohibited imports that were already blocked remain blocked.
    for imp in ("import subprocess\n", "import requests\n"):
        r = validator.validate(_wrap("return x", imp), "read_helper")
        assert not r.is_valid, f"{imp!r} hauria d'estar bloquejat"


def test_plain_safe_tool_passes():
    r = validator.validate(_wrap("return x.upper()"), "read_helper")
    assert r.is_valid, f"una tool trivial i segura ha de passar; errors={r.errors}"
