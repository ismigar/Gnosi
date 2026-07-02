"""Tests del sandbox de dades (subprocés Node capat) + enforcement de permisos.

E2E amb Node real (skip si no hi ha node). Verifica que:
  * un plugin rep l'esdeveniment i pot cridar handlers del host que TÉ permès;
  * una crida a un mètode SENSE permís concedit es rebutja al host;
  * els logs del plugin arriben de tornada.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services import plugin_sandbox as sb  # noqa: E402
from backend.services import plugin_system as ps  # noqa: E402

pytestmark = pytest.mark.skipif(not sb.node_available(), reason="node no disponible")


def _install_backend_plugin(base: Path, pid: str, code: str, permissions, events):
    d = base / "plugins" / pid
    d.mkdir(parents=True, exist_ok=True)
    (d / "manifest.json").write_text("{}", encoding="utf-8")  # no s'usa aquí
    (d / "backend.mjs").write_text(code, encoding="utf-8")
    manifest = ps.validate_manifest({
        "id": pid, "version": "1.0.0", "backend": "backend.mjs",
        "permissions": permissions, "events": events,
    })
    return manifest


def test_sandbox_runs_and_logs(tmp_path):
    code = """
    export default { async onEvent(event, api) {
      api.log('rebut', event.name);
    } };
    """
    manifest = _install_backend_plugin(tmp_path, "logger", code, [], ["clone:finished"])
    res = sb.run_event(tmp_path, manifest, [], "clone:finished", {"pages": 3})
    assert res["ok"] is True
    assert any("rebut" in l["message"] for l in res["logs"])


def test_sandbox_permission_granted_calls_host(tmp_path):
    called = {}

    def read_page(args):
        called["pageId"] = args.get("pageId")
        return {"content": "hola mon"}

    sb.set_host_handlers({"vault.readPage": read_page})

    code = """
    export default { async onEvent(event, api) {
      const p = await api.vault.readPage('page-1');
      api.log('llegit', String(p.content.length));
    } };
    """
    manifest = _install_backend_plugin(tmp_path, "reader", code, ["vault:read"], ["page:updated"])
    res = sb.run_event(tmp_path, manifest, ["vault:read"], "page:updated", {})
    assert res["ok"] is True
    assert called.get("pageId") == "page-1"
    assert any("llegit 8" in l["message"] for l in res["logs"])


def test_sandbox_query_db_gated(tmp_path):
    rows = {"rows": [{"id": "p1", "title": "Fila 1", "metadata": {}}], "total": 1}

    def query_db(args):
        assert args.get("tableId") == "t1"
        return rows

    sb.set_host_handlers({"vault.queryDB": query_db})

    code = """
    export default { async onEvent(event, api) {
      const res = await api.vault.queryDB('t1');
      api.log('files', String(res.rows.length));
    } };
    """
    manifest = _install_backend_plugin(tmp_path, "querier", code, ["vault:read"], ["page:updated"])
    res = sb.run_event(tmp_path, manifest, ["vault:read"], "page:updated", {})
    assert res["ok"] is True
    assert any("files 1" in l["message"] for l in res["logs"])


def test_sandbox_network_hard_block(tmp_path):
    # Sense permís `network`: importar node:net ha de PETAR (bloqueig dur).
    code = """
    export default { async onEvent(event, api) {
      try { await import('node:net'); api.log('NET_OK'); }
      catch (e) { api.warn('net-bloquejat', e.message); }
      api.log('fetch-type', typeof fetch === 'function' && fetch.toString().includes('not granted') ? 'denied' : String(typeof fetch));
    } };
    """
    manifest = _install_backend_plugin(tmp_path, "netter", code, ["network"], ["page:updated"])
    # granted buit → net NO concedit
    res = sb.run_event(tmp_path, manifest, [], "page:updated", {})
    assert res["ok"] is True
    assert any("net-bloquejat" in l["message"] for l in res["logs"])
    assert not any("NET_OK" in l["message"] for l in res["logs"])


def test_sandbox_permission_denied(tmp_path):
    def read_page(args):
        raise AssertionError("no s'hauria de cridar sense permís")

    sb.set_host_handlers({"vault.readPage": read_page})

    code = """
    export default { async onEvent(event, api) {
      try { await api.vault.readPage('x'); api.log('CAP_ERROR'); }
      catch (e) { api.warn('denegat', e.message); }
    } };
    """
    # granted buit → readPage s'ha de denegar al host.
    manifest = _install_backend_plugin(tmp_path, "sneaky", code, ["vault:read"], ["page:updated"])
    res = sb.run_event(tmp_path, manifest, [], "page:updated", {})
    assert res["ok"] is True
    assert any("denegat" in l["message"] for l in res["logs"])
    assert not any("CAP_ERROR" in l["message"] for l in res["logs"])
