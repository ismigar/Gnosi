"""Tests for the data sandbox (capped Node subprocess) + permission enforcement.

E2E with real Node (skipped if node isn't available). Verifies that:
  * a plugin receives the event and can call host handlers it HAS permission for;
  * a call to a method WITHOUT granted permission is rejected by the host;
  * the plugin's logs make it back.
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
    (d / "manifest.json").write_text("{}", encoding="utf-8")  # not used here
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

    def read_page(args, plugin_id):
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

    def query_db(args, plugin_id):
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
    # Without `network` permission: importing node:net must FAIL (hard block).
    code = """
    export default { async onEvent(event, api) {
      try { await import('node:net'); api.log('NET_OK'); }
      catch (e) { api.warn('net-bloquejat', e.message); }
      api.log('fetch-type', typeof fetch === 'function' && fetch.toString().includes('not granted') ? 'denied' : String(typeof fetch));
    } };
    """
    manifest = _install_backend_plugin(tmp_path, "netter", code, ["network"], ["page:updated"])
    # granted empty → net NOT granted
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
    # granted empty → readPage must be denied to the host.
    manifest = _install_backend_plugin(tmp_path, "sneaky", code, ["vault:read"], ["page:updated"])
    res = sb.run_event(tmp_path, manifest, [], "page:updated", {})
    assert res["ok"] is True
    assert any("denegat" in l["message"] for l in res["logs"])
    assert not any("CAP_ERROR" in l["message"] for l in res["logs"])


def test_sandbox_settings_roundtrip(tmp_path):
    # settings.set saves and settings.get reads, per plugin. Real handlers of the
    # dispatcher (they touch `.gnosi/plugins.json` via the state), with the vault in tmp.
    from backend.services.context_vars import active_vault_path
    from backend.services.plugin_dispatcher import _HOST_HANDLERS
    active_vault_path.set(tmp_path)
    (tmp_path / ".gnosi").mkdir(parents=True, exist_ok=True)
    sb.set_host_handlers(_HOST_HANDLERS)

    code = """
    export default { async onEvent(event, api) {
      await api.settings.set({ theme: 'dark', n: 42 });
      const s = await api.settings.get();
      api.log('theme', s.settings.theme, 'n', String(s.settings.n));
    } };
    """
    manifest = _install_backend_plugin(tmp_path, "cfg", code, ["settings"], ["page:updated"])
    res = sb.run_event(tmp_path, manifest, ["settings"], "page:updated", {})
    assert res["ok"] is True
    assert any("theme dark n 42" in l["message"] for l in res["logs"])


def test_sandbox_create_page(tmp_path):
    # vault.createPage creates a new .md in the vault (tmp). Requires vault:write.
    from backend.services.context_vars import active_vault_path
    from backend.services.plugin_dispatcher import _HOST_HANDLERS
    active_vault_path.set(tmp_path)
    (tmp_path / ".gnosi").mkdir(parents=True, exist_ok=True)
    sb.set_host_handlers(_HOST_HANDLERS)

    code = """
    export default { async onEvent(event, api) {
      const r = await api.vault.createPage({ title: 'Nova del plugin', content: 'hola' });
      api.log('creada', r.pageId ? 'si' : 'no');
    } };
    """
    manifest = _install_backend_plugin(tmp_path, "creator", code, ["vault:write"], ["page:updated"])
    res = sb.run_event(tmp_path, manifest, ["vault:write"], "page:updated", {})
    assert res["ok"] is True
    assert any("creada si" in l["message"] for l in res["logs"])
    # The .md file must exist in the tmp vault.
    mds = list(tmp_path.rglob("*.md"))
    assert any("Nova del plugin" in p.name for p in mds)


def test_sandbox_write_page_preserves_frontmatter(tmp_path):
    # writePage must NOT overwrite the frontmatter: a page is created with
    # metadata, the plugin writes a new body, and the metadata must survive.
    from backend.services.context_vars import active_vault_path
    from backend.services.plugin_dispatcher import _HOST_HANDLERS
    from backend.api.vault_routes import save_page_md, parse_frontmatter, register_page_in_index
    active_vault_path.set(tmp_path)
    (tmp_path / ".gnosi").mkdir(parents=True, exist_ok=True)
    sb.set_host_handlers(_HOST_HANDLERS)

    fp = tmp_path / "Nota.md"
    save_page_md(fp, {"id": "pg-1", "title": "Nota", "estat": "actiu"}, "cos vell")
    register_page_in_index(fp)

    code = """
    export default { async onEvent(event, api) {
      const p = await api.vault.readPage('pg-1');
      api.log('meta-estat', p.metadata.estat, 'cos', p.content.trim());
      await api.vault.writePage('pg-1', 'cos NOU');
    } };
    """
    manifest = _install_backend_plugin(tmp_path, "wr", code, ["vault:read", "vault:write"], ["page:updated"])
    res = sb.run_event(tmp_path, manifest, ["vault:read", "vault:write"], "page:updated", {})
    assert res["ok"] is True
    assert any("meta-estat actiu cos cos vell" in l["message"] for l in res["logs"])
    # Re-reads from disk: the body has changed but the frontmatter (state) is preserved.
    meta, body = parse_frontmatter(fp.read_text(encoding="utf-8"), fp)
    assert meta.get("estat") == "actiu"
    assert meta.get("title") == "Nota"
    assert "cos NOU" in body
