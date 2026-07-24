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

gnosi.log('hello-command plugin loaded');
