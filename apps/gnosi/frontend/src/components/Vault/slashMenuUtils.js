/**
 * slashMenuUtils.js
 * Utilitats per construir catàlegs de comandes del menú Slash de BlockNote.
 * IMPORTANT: Aquest fitxer NO pot contenir JSX (extensió .js pura).
 */

/**
 * Construeix el catàleg d'elements del menú Slash personalitzats.
 * @param {Object} params
 * @param {Array}  params.allTables      - Llista de taules disponibles al Vault
 * @param {Function} params.onOpenPageView - Callback(tableId?) per obrir el modal de vista
 * @returns {Array} - Llista de grups del menú Slash
 */
export function buildSlashCommandCatalog({ allTables = [], onOpenPageView } = {}) {
    if (!onOpenPageView) return [];

    // Una entrada per taula que obre el modal pre-seleccionant-la
    const tableItems = allTables.map(table => ({
        title: table.name || table.id,
        description: 'Afegir vista d\'aquesta taula a la pàgina',
        aliases: ['vault', 'vista', 'view', table.name].filter(Boolean),
        group: 'Vault',
        onItemClick: () => onOpenPageView(table.id),
    }));

    // Entrada genèrica sense pre-selecció
    const vistaItem = [{
        title: 'Vista',
        description: 'Afegir una vista filtrada d\'una taula a aquesta pàgina',
        aliases: ['vista', 'view', 'db', 'filtre'],
        group: 'Vault',
        onItemClick: () => onOpenPageView(),
    }];

    return [...tableItems, ...vistaItem];
}

/**
 * Construeix el catàleg d'elements del menú Slash per als layouts de columnes.
 * @param {Object} params
 * @param {Function} params.editor - Instància de l'editor BlockNote
 * @returns {Array}
 */
export function buildColumnLayoutCatalog({ editor } = {}) {
    const layouts = [
        { title: '2 columnes', columns: 2 },
        { title: '3 columnes', columns: 3 },
    ];

    return layouts.map(layout => ({
        title: layout.title,
        subtext: 'Inserir un disseny en columnes',
        aliases: ['columna', 'column', 'layout', `${layout.columns}col`],
        group: 'Layout',
        onItemClick: () => {
            if (!editor) return;
            try {
                const cols = Array.from({ length: layout.columns }, () => ({
                    type: 'column',
                    children: [{ type: 'paragraph' }],
                }));
                editor.insertBlocks(
                    [{ type: 'columnList', children: cols }],
                    editor.getTextCursorPosition().block,
                    'after'
                );
            } catch (e) {
                console.warn('SlashMenu: no s\'ha pogut inserir el layout de columnes', e);
            }
        },
    }));
}
