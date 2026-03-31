/**
 * slashMenuUtils.js
 * Utilities for building BlockNote Slash menu command catalogs.
 * IMPORTANT: This file cannot contain JSX (pure .js extension).
 */

/**
 * Builds the custom Slash menu item catalog.
 * @param {Object} params
 * @param {Array}  params.allTables   - List of available tables in the Vault
 * @param {Function} params.editor    - BlockNote editor instance
 * @param {Function} params.t         - Translation function
 * @returns {Array} - List of Slash menu items
 */
export function buildSlashCommandCatalog({ allTables = [], editor, t } = {}) {
    if (!allTables.length || !t) return [];

    return allTables.map(table => ({
        title: table.name || table.id,
        description: t('Insert Vault table'),
        aliases: ['vault', 'table', table.name].filter(Boolean),
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
                console.warn('SlashMenu: failed to insert database block', e);
            }
        },
    }));
}

/**
 * Builds the Slash menu item catalog for column layouts.
 * @param {Object} params
 * @param {Function} params.editor - BlockNote editor instance
 * @param {Function} params.t      - Translation function
 * @returns {Array}
 */
export function buildColumnLayoutCatalog({ editor, t } = {}) {
    if (!t) return [];
    
    const layouts = [
        { title: t('2 columns'), columns: 2 },
        { title: t('3 columns'), columns: 3 },
    ];

    return layouts.map(layout => ({
        title: layout.title,
        subtext: t('Insert column layout'),
        aliases: ['column', 'layout', `${layout.columns}col`],
        group: t('Layout'),
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
                console.warn('SlashMenu: failed to insert column layout', e);
            }
        },
    }));
}
