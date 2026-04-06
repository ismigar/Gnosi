/**
 * slashMenuUtils.js
 * Utilitats per construir catàlegs de comandes del menú Slash de BlockNote.
 * IMPORTANT: Aquest fitxer NO pot contenir JSX (extensió .js pura).
 */

/**
 * Construeix el catàleg d'elements del menú Slash personalitzats.
 * @param {Object} params
 * @param {Array}  params.allTables   - Llista de taules disponibles al Vault
 * @param {Function} params.editor    - Instància de l'editor BlockNote
 * @returns {Array} - Llista de grups del menú Slash
 */
export function buildSlashCommandCatalog({ allTables = [], editor } = {}) {
    if (!allTables.length) return [];

    return allTables.map(table => ({
        title: table.name || table.id,
        description: 'Inserir taula del Vault',
        aliases: ['vault', 'taula', table.name].filter(Boolean),
        group: 'Vault',
        onItemClick: () => {
            if (!editor) return;
            try {
                editor.insertBlocks(
                    [{ type: 'database', props: { database_table_id: table.id } }],
                    editor.getTextCursorPosition().block,
                    'after'
                );
            } catch (e) {
                console.warn('SlashMenu: no s\'ha pogut inserir el bloc database', e);
            }
        },
    }));
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
