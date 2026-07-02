/**
 * vault-stats — exemple de plugin de UI que exercita bona part de l'API:
 * registerCommand + vault.listTables + vault.queryDB + settings.
 *
 * Registra una comanda a la paleta (Cmd/Ctrl+Shift+P → "Estadístiques del
 * vault") que compta les taules i les files de cadascuna, ho escriu a la consola
 * i desa l'últim recompte a la configuració pròpia del plugin.
 *
 * Permisos: ui:command, vault:read, settings.
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
