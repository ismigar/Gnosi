// Plugin de UI d'exemple. Corre dins d'un iframe sandbox; només té accés a
// l'objecte global `gnosi` (veure frontend/src/plugins/host.js). Registra una
// comanda que apareix a la paleta (Cmd/Ctrl+Shift+P) sota la secció "Plugins".

gnosi.registerCommand({
  id: 'saluta',
  title: "Hola des del plugin d'exemple",
  run: async () => {
    gnosi.log("Hola! El plugin d'exemple s'ha executat correctament.");
    // Exemple d'accés a dades (només funciona si l'usuari ha concedit
    // vault:read; si no, la crida es rebutja amb "permís denegat").
    try {
      const page = await gnosi.vault.readPage('daily');
      gnosi.log('pàgina llegida, mida:', String((page && page.content || '').length));
    } catch (e) {
      gnosi.warn('no s\'ha pogut llegir la pàgina:', String(e));
    }
  },
});

gnosi.log('plugin hello-command carregat');
