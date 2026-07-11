// Example UI plugin. Runs inside a sandboxed iframe; only has access to
// the global `gnosi` object (see frontend/src/plugins/host.js). Registers a
// command that appears in the palette (Cmd/Ctrl+Shift+P) under the "Plugins" section.

gnosi.registerCommand({
  id: 'saluta',
  title: "Hola des del plugin d'exemple",
  run: async () => {
    gnosi.log("Hola! El plugin d'exemple s'ha executat correctament.");
    // Example of data access (only works if the user has granted
    // vault:read; otherwise, the call is rejected with "permission denied").
    try {
      const page = await gnosi.vault.readPage('daily');
      gnosi.log('pàgina llegida, mida:', String((page && page.content || '').length));
    } catch (e) {
      gnosi.warn('no s\'ha pogut llegir la pàgina:', String(e));
    }
  },
});

gnosi.log('plugin hello-command carregat');
