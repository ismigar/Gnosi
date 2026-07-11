// Example DATA plugin. Runs inside a sandboxed Node subprocess
// (`node --permission`, without fs-write or child_process). Receives events from the
// backend bus and can only touch the vault via `api.vault.*` (gated by permission
// on the host). See backend/services/plugin_sandbox.py + runner.mjs.

export default {
  async onEvent(event, api) {
    api.log(`esdeveniment rebut: ${event.name}`);
    if (event.name === 'clone:finished') {
      const p = event.payload || {};
      api.log(`clon acabat — pàgines=${p.pages || 0}, taules=${p.tables || 0}`);
    }
    // Example of vault access (requires the vault:read permission to be granted):
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
