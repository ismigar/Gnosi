/**
 * vault-stats — example UI plugin that exercises much of the API:
 * registerCommand + vault.listTables + vault.queryDB + settings.
 *
 * Registers a command in the palette (Cmd/Ctrl+Shift+P → "Vault
 * stats") that counts the tables and each one's rows, logs it to the console,
 * and saves the last count in the plugin's own settings.
 *
 * Permissions: ui:command, vault:read, settings.
 */
gnosi.registerCommand({
  id: 'vault-stats',
  title: 'Estadístiques del vault',
  run: async () => {
    try {
      const { tables } = await gnosi.vault.listTables();
      let totalRows = 0;
      const parts = [];
      for (const t of tables) {
        const res = await gnosi.vault.queryDB(t.id, { limit: 1000 });
        totalRows += res.total;
        parts.push(`${t.name}: ${res.total}`);
      }
      gnosi.log(`📊 ${tables.length} taules · ${totalRows} files en total`);
      if (parts.length) gnosi.log('   ' + parts.join(' · '));
      await gnosi.settings.set({ lastRun: { tables: tables.length, rows: totalRows } });
    } catch (e) {
      gnosi.error('vault-stats ha fallat:', String(e && e.message || e));
    }
  },
});
