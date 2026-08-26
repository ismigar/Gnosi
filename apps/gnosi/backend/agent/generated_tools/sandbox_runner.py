"""Run approved generated tools in a short-lived restricted subprocess."""
from __future__ import annotations

import json
import io
import os
import subprocess
import sys
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any, Optional, Type

from pydantic import BaseModel, Field, create_model
from langchain_core.tools import BaseTool

MAX_CODE_CHARS = 100_000
MAX_ARGUMENT_CHARS = 16_000
MAX_OUTPUT_CHARS = 32_000
DEFAULT_TIMEOUT_SECONDS = 30
APP_ROOT = Path(__file__).resolve().parents[3]


def schema_model(input_schema: dict[str, Any], name: str) -> Type[BaseModel]:
    """Create a permissive Pydantic shell from the approved JSON schema."""
    properties = input_schema.get("properties") if isinstance(input_schema, dict) else {}
    properties = properties if isinstance(properties, dict) else {}
    required = set(input_schema.get("required") or []) if isinstance(input_schema, dict) else set()
    fields = {
        str(field_name): (Any, ... if field_name in required else Field(default=None))
        for field_name in list(properties)[:64]
    }
    return create_model(f"{name[:40]}Args", **fields)


class SandboxedGeneratedTool(BaseTool):
    """LangChain-compatible proxy whose execution happens in a child process."""

    name: str
    description: str = ""
    code: str = Field(repr=False)
    timeout_seconds: int = 30
    args_schema: Optional[Type[BaseModel]] = None

    def _run(self, **kwargs: Any) -> Any:
        response = run_process(
            self.code,
            action="invoke",
            arguments=kwargs,
            timeout_seconds=self.timeout_seconds,
        )
        return response.get("result")


def _preexec_limits(timeout_seconds: int):
    try:
        import resource

        def limit_resources() -> None:
            cpu = max(2, min(int(timeout_seconds) + 1, 120))
            limits = (
                (resource.RLIMIT_CPU, (cpu, cpu)),
                (resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024)),
                (resource.RLIMIT_FSIZE, (2 * 1024 * 1024, 2 * 1024 * 1024)),
            )
            for resource_name, value in limits:
                try:
                    resource.setrlimit(resource_name, value)
                except (OSError, ValueError):
                    # macOS and hardened runners may reject one optional limit.
                    # The parent timeout and output cap still protect the call.
                    continue

        return limit_resources
    except (ImportError, AttributeError):
        return None


def run_process(
    code: str,
    *,
    action: str,
    arguments: Optional[dict[str, Any]] = None,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    """Describe or invoke code in a separate process with a clean environment."""
    if len(str(code or "")) > MAX_CODE_CHARS:
        raise ValueError("Generated tool code exceeds the sandbox limit.")
    payload = {"code": str(code or ""), "action": str(action), "arguments": arguments or {}}
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(encoded) > MAX_ARGUMENT_CHARS + MAX_CODE_CHARS:
        raise ValueError("Generated tool sandbox payload exceeds the size limit.")
    env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(APP_ROOT),
        "PYTHONNOUSERSITE": "1",
        "LANG": "C.UTF-8",
    }
    # Keep only dynamic-loader paths needed by the selected interpreter. The
    # CI ARM runner stores libpython outside the default loader search path;
    # dropping this variable makes the child fail before Python can start.
    for loader_var in ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH"):
        value = os.environ.get(loader_var)
        if value:
            env[loader_var] = value
    timeout = max(2, min(int(timeout_seconds), 120))
    try:
        completed = subprocess.run(
            [sys.executable, "-m", "backend.agent.generated_tools.sandbox_runner", "--child"],
            input=encoded,
            text=True,
            capture_output=True,
            cwd=str(APP_ROOT),
            env=env,
            timeout=timeout,
            check=False,
            preexec_fn=_preexec_limits(timeout),
        )
    except subprocess.TimeoutExpired as error:
        raise TimeoutError(f"Generated tool exceeded its {timeout}s sandbox timeout.") from error
    output = (completed.stdout or "")[-MAX_OUTPUT_CHARS:]
    if completed.returncode != 0:
        detail = (completed.stderr or output or "sandbox process failed").strip()[:2_000]
        raise RuntimeError(f"Generated tool sandbox failed: {detail}")
    try:
        result = json.loads(output)
    except (TypeError, ValueError) as error:
        raise RuntimeError("Generated tool sandbox returned malformed output.") from error
    if not isinstance(result, dict) or result.get("ok") is not True:
        raise RuntimeError(str((result or {}).get("error") or "Generated tool failed.")[:2_000])
    return result


def _load_tool(code: str) -> Any:
    import importlib.util

    module_name = "gnosi_generated_tool_child"
    spec = importlib.util.spec_from_loader(module_name, loader=None)
    if spec is None:
        raise RuntimeError("Could not create generated tool module.")
    module = importlib.util.module_from_spec(spec)
    exec(code, module.__dict__)
    from langchain_core.tools import BaseTool

    for attr_name in dir(module):
        attr = getattr(module, attr_name)
        if isinstance(attr, BaseTool) or (
            callable(attr) and getattr(attr, "__tool__", False) is True
        ):
            return attr
    raise RuntimeError("No @tool callable was found in generated code.")


def _child_main() -> int:
    request = json.loads(sys.stdin.read())
    captured_stdout = io.StringIO()
    with redirect_stdout(captured_stdout):
        tool = _load_tool(str(request.get("code") or ""))
        action = str(request.get("action") or "invoke")
        if action == "describe":
            schema = getattr(tool, "args_schema", None)
            input_schema = schema.model_json_schema() if schema and hasattr(schema, "model_json_schema") else {"type": "object", "properties": {}}
            response = {
                "ok": True,
                "name": str(getattr(tool, "name", "generated_tool")),
                "description": str(getattr(tool, "description", ""))[:2_000],
                "input_schema": input_schema,
            }
        else:
            arguments = request.get("arguments") if isinstance(request.get("arguments"), dict) else {}
            result = tool.invoke(arguments) if hasattr(tool, "invoke") else tool(**arguments)
            rendered = result if isinstance(result, (str, int, float, bool, list, dict)) else str(result)
            encoded = json.dumps(rendered, ensure_ascii=False, default=str)
            if len(encoded) > MAX_OUTPUT_CHARS:
                raise RuntimeError("Generated tool output exceeds the sandbox limit.")
            response = {"ok": True, "result": rendered}
    print(json.dumps(response, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    if "--child" not in sys.argv:
        raise SystemExit("sandbox runner is an internal command")
    try:
        raise SystemExit(_child_main())
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(error)[:2_000]}))
        raise SystemExit(1)
