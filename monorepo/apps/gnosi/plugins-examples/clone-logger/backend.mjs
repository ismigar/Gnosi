// Plugin de DADES d'exemple. Corre dins d'un subprocés Node capat
// (`node --permission`, sense fs-write ni child_process). Rep esdeveniments del
// bus del backend i pot tocar el vault només via `api.vault.*` (gated per permís
// al host). Veure backend/services/plugin_sandbox.py + runner.mjs.

export default {
  async onEvent(event, api) {
    api.log(`esdeveniment rebut: ${event.name}`);
    if (event.name === 'clone:finished') {
      const p = event.payload || {};
      api.log(`clon acabat — pàgines=${p.pages || 0}, taules=${p.tables || 0}`);
    }
    // Exemple d'accés al vault (requereix el permís vault:read concedit):
    if (event.payload && event.payload.page_id) {
      try {
        const page = await api.vault.readPage(event.payload.page_id);
        api.log(`pàgina ${event.payload.page_id}: ${String((page && page.content) || '').length} chars`);
      } catch (e) {
        api.warn(`lectura denegada o fallida: ${e.message}`);
      }
    }
  },
};
