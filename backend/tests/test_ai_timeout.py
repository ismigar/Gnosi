"""Timeout REAL de les crides one-shot d'IA (`factory.get_llm`/`generate_text`).

Regressió del bug: `llm.invoke(msgs, config={"timeout": N})` NO aplicava cap límit
(`"timeout"` no és clau de RunnableConfig → langchain l'ignorava) i una crida a un
proveïdor penjat bloquejava el fil per sempre. El límit ara s'aplica en CONSTRUIR el
client. cf. directiva `ai_error_handling.md`.

Pur (sense backend). El test de "proveïdor lent" munta un socket local que accepta i
no respon MAI: com que el fix viu a la capa HTTP del client, un mock amb `time.sleep`
NO seria interromput per `request_timeout` i no provaria res — cal un socket real.
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

# Proveïdors que resolen a un wrapper OpenAI-compatible (request_timeout + max_retries).
_OPENAI_FAMILY = ["openai", "deepseek", "mistral", "openrouter", "groq",
                  "generic", "local", "lmstudio"]


@pytest.mark.parametrize("provider", _OPENAI_FAMILY)
def test_openai_family_applies_real_timeout_and_disables_retries(provider):
    llm = get_llm(provider, model="x", api_key="sk-test", timeout=7)
    assert llm is not None, f"{provider} no s'ha instanciat"
    # `timeout` és àlies de request_timeout → arriba al client httpx de l'SDK openai.
    assert getattr(llm, "request_timeout", None) == 7
    # max_retries=0 → el timeout és un sostre REAL (l'SDK reintenta 2x per defecte,
    # i el timeout és per-intent → sense això el sostre efectiu seria ~3x).
    assert getattr(llm, "max_retries", None) == 0


def test_openai_family_without_timeout_keeps_defaults():
    llm = get_llm("openai", model="x", api_key="sk-test")
    assert llm is not None
    # Sense timeout explícit no toquem res: ni request_timeout ni els reintents.
    assert getattr(llm, "request_timeout", None) is None
    assert getattr(llm, "max_retries", None) is None


def test_ollama_uses_client_kwargs_timeout():
    # ChatOllama IGNORA `timeout=` directe (extra="ignore"); ha d'anar per client_kwargs.
    llm = get_llm("ollama", model="llama3.2", timeout=7)
    assert llm is not None
    assert getattr(llm, "client_kwargs", None) == {"timeout": 7}


def test_ollama_without_timeout_defaults_to_60():
    llm = get_llm("ollama", model="llama3.2")
    assert llm is not None
    assert getattr(llm, "client_kwargs", None) == {"timeout": 60}


def test_generate_text_forwards_timeout_and_drops_ignored_config(monkeypatch):
    """`generate_text(timeout=N)` ha de propagar N al constructor (get_default_llm)
    i cridar `.invoke()` SENSE `config` (la clau ignorada ja no hi és)."""
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
    # Cap `config` (ni cap altre kwarg) a .invoke(): abans era config={"timeout":...}.
    assert captured["invoke_args"] == ()
    assert captured["invoke_kwargs"] == {}


def test_slow_provider_invoke_is_bounded():
    """Proveïdor lent → `.invoke()` s'ha d'acotar (no penjar) gràcies al timeout del
    client. Socket local que accepta i NO respon mai."""
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
                held.append(conn)  # es manté obert, sense resposta
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
    # Sostre generós per evitar flakiness: el punt és que és ACOTAT (~2s), no infinit.
    assert elapsed < 6, f".invoke() no acotat pel timeout: {elapsed:.1f}s"
