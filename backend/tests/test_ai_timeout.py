"""REAL timeout for one-shot AI calls (`factory.get_llm`/`generate_text`).

Bug regression: `llm.invoke(msgs, config={"timeout": N})` applied NO limit at all
(`"timeout"` is not a RunnableConfig key → langchain ignored it) and a call to a
hung provider would block the thread forever. The limit is now applied when the
client is CONSTRUCTED. cf. `ai_error_handling.md` directive.

Pure (no backend). The "slow provider" test sets up a local socket that accepts and
NEVER responds: since the fix lives in the client's HTTP layer, a mock with `time.sleep`
would NOT be interrupted by `request_timeout` and wouldn't prove anything — a real socket is needed.
"""
import socket
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from langchain_core.messages import HumanMessage  # noqa: E402

from agent import factory  # noqa: E402
from agent.factory import generate_text, get_llm  # noqa: E402

# Providers that resolve to an OpenAI-compatible wrapper (request_timeout + max_retries).
_OPENAI_FAMILY = ["openai", "deepseek", "mistral", "openrouter", "groq",
                  "generic", "local", "lmstudio"]


@pytest.mark.parametrize("provider", _OPENAI_FAMILY)
def test_openai_family_applies_real_timeout_and_disables_retries(provider):
    llm = get_llm(provider, model="x", api_key="sk-test", timeout=7)
    assert llm is not None, f"{provider} no s'ha instanciat"
    # `timeout` is an alias for request_timeout → it reaches the openai SDK's httpx client.
    assert getattr(llm, "request_timeout", None) == 7
    # max_retries=0 → the timeout is a REAL ceiling (the SDK retries 2x by default,
    # and the timeout is per-attempt → without this the effective ceiling would be ~3x).
    assert getattr(llm, "max_retries", None) == 0


def test_openai_family_without_timeout_keeps_defaults():
    llm = get_llm("openai", model="x", api_key="sk-test")
    assert llm is not None
    # Without an explicit timeout we touch nothing: neither request_timeout nor the retries.
    assert getattr(llm, "request_timeout", None) is None
    assert getattr(llm, "max_retries", None) is None


def test_ollama_uses_client_kwargs_timeout():
    # ChatOllama IGNORES `timeout=` directly (extra="ignore"); it has to go through client_kwargs.
    llm = get_llm("ollama", model="llama3.2", timeout=7)
    assert llm is not None
    assert getattr(llm, "client_kwargs", None) == {"timeout": 7}


def test_ollama_without_timeout_defaults_to_60():
    llm = get_llm("ollama", model="llama3.2")
    assert llm is not None
    assert getattr(llm, "client_kwargs", None) == {"timeout": 60}


def test_generate_text_forwards_timeout_and_drops_ignored_config(monkeypatch):
    """`generate_text(timeout=N)` must propagate N to the constructor (get_default_llm)
    and call `.invoke()` WITHOUT `config` (the ignored key is no longer there)."""
    captured = {}

    class _FakeLLM:
        model_name = "fake-model"

        def invoke(self, messages, *args, **kwargs):
            captured["invoke_args"] = args
            captured["invoke_kwargs"] = kwargs

            class _Resp:
                content = "hola"

            return _Resp()

    def _fake_get_default_llm(user_message="", timeout=None):
        captured["timeout"] = timeout
        return _FakeLLM()

    monkeypatch.setattr(factory, "get_default_llm", _fake_get_default_llm)

    text, label = generate_text("prompt qualsevol", timeout=33)

    assert text == "hola"
    assert label == "fake-model"
    assert captured["timeout"] == 33, "el timeout no s'ha propagat a get_default_llm"
    # No `config` (nor any other kwarg) in .invoke(): it used to be config={"timeout":...}.
    assert captured["invoke_args"] == ()
    assert captured["invoke_kwargs"] == {}


def test_slow_provider_invoke_is_bounded():
    """Slow provider → `.invoke()` must be bounded (not hang) thanks to the client's
    timeout. Local socket that accepts and NEVER responds."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    port = srv.getsockname()[1]

    stop = threading.Event()
    held: list = []

    def _accept_and_hang():
        srv.settimeout(0.5)
        while not stop.is_set():
            try:
                conn, _ = srv.accept()
                held.append(conn)  # stays open, no response
            except socket.timeout:
                continue
            except OSError:
                break

    t = threading.Thread(target=_accept_and_hang, daemon=True)
    t.start()

    llm = get_llm(
        "openai", model="gpt-4o-mini", api_key="sk-test",
        base_url=f"http://127.0.0.1:{port}/v1", timeout=2,
    )
    assert llm is not None

    start = time.monotonic()
    raised = False
    try:
        llm.invoke([HumanMessage(content="hola")])
    except Exception:
        raised = True
    elapsed = time.monotonic() - start

    stop.set()
    for conn in held:
        try:
            conn.close()
        except OSError:
            pass
    try:
        srv.close()
    except OSError:
        pass

    assert raised, "s'esperava una excepció de timeout del proveïdor"
    # Generous ceiling to avoid flakiness: the point is that it's BOUNDED (~2s), not infinite.
    assert elapsed < 6, f".invoke() no acotat pel timeout: {elapsed:.1f}s"
