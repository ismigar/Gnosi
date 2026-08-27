// Example UI plugin. Runs inside a sandboxed iframe; only has access to
// the global `gnosi` object (see frontend/src/plugins/host.js). Registers a
// command that appears in the palette (Cmd/Ctrl+Shift+P) under the "Plugins" section.

gnosi.registerCommand({
  id: 'hello',
  title: 'Hello from the example plugin',
  run: async () => {
    gnosi.log('Hello! The example plugin ran successfully.');
    // Example of data access (only works if the user has granted
    // vault:read; otherwise, the call is rejected with "permission denied").
    try {
      const page = await gnosi.vault.readPage('daily');
      gnosi.log('page read, size:', String((page && page.content || '').length));
    } catch (e) {
      gnosi.warn('could not read the page:', String(e));
    }
  },
});

gnosi.registerSettingsPanel({
  id: 'preferences',
  title: 'Hello plugin',
  height: 240,
  render: async () => {
    const result = await gnosi.settings.get();
    const current = result.settings || {};
    document.body.innerHTML = `
      <style>
        body { margin: 0; padding: 20px; color: #334155; font: 14px system-ui, sans-serif; }
        label { display: grid; gap: 8px; font-weight: 600; }
        input { border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 12px; }
      </style>
      <label>
        Greeting
        <input id="greeting" value="${String(current.greeting || 'Hello').replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" />
      </label>`;
    document.getElementById('greeting').addEventListener('change', async (event) => {
      await gnosi.settings.set({ ...current, greeting: event.target.value });
    });
  },
});

gnosi.log('hello-command plugin loaded');
