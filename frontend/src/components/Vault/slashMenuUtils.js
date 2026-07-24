/**
 * slashMenuUtils.js
 * Utilities for building BlockNote Slash menu command catalogs.
 * IMPORTANT: This file MUST NOT contain JSX (pure .js extension).
 */
import i18n from '../../i18n';

/**
 * Builds the catalog of custom Slash menu items.
 * @param {Object} params
 * @param {Array}  params.allTables      - List of tables available in the Vault
 * @param {Function} params.onOpenPageView - Callback(tableId?) to open the view modal
 * @returns {Array} - List of Slash menu groups
 */
export function buildSlashCommandCatalog({ allTables = [], onOpenPageView } = {}) {
    if (!onOpenPageView) return [];

    // One entry per table that opens the modal, pre-selecting it
    const tableItems = allTables.map(table => ({
        title: table.name || table.id,
        description: i18n.t('editor.slash_add_table_view', "Add a view of this table to the page"),
        aliases: ['vault', 'vista', 'view', table.name].filter(Boolean),
        group: i18n.t('editor.slash_group_knowledge', "Knowledge"),
        onItemClick: () => onOpenPageView(table.id),
    }));

    // Generic entry with no pre-selection
    const vistaItem = [{
        title: i18n.t('editor.slash_view_title', "View"),
        description: i18n.t('editor.slash_view_desc', "Add a filtered table view to this page"),
        aliases: ['vista', 'view', 'db', 'filtre'],
        group: i18n.t('editor.slash_group_knowledge', "Knowledge"),
        onItemClick: () => onOpenPageView(),
    }];

    return [...tableItems, ...vistaItem];
}

/**
 * Builds the "Turn into" catalog (Notion-style "Turn into").
 * Each entry converts the block where the cursor is to the given type, preserving
 * the inline content (text). All items share the "tur" alias so that
 * typing `/tur` shows the whole list of destinations.
 * @param {Object} params
 * @param {Function} params.editor - BlockNote editor instance
 * @returns {Array}
 */
export function buildTurnIntoCatalog({ editor } = {}) {
    // target type + props, title, icon and alias. The "tur"/"convertir" alias
    // is common to all of them; the specific ones allow filtering within the list.
    const targets = [
        { type: 'paragraph', iconKey: 'paragraph', title: i18n.t('editor.block_type_paragraph', "Paragraph"), aliases: ['paragraf', 'paragraph', 'text', 'p'] },
        { type: 'heading', props: { level: 1 }, iconKey: 'heading1', title: i18n.t('editor.block_type_heading1', "Heading 1"), aliases: ['encapcalament', 'h1', 'titol', 'heading'] },
        { type: 'heading', props: { level: 2 }, iconKey: 'heading2', title: i18n.t('editor.block_type_heading2', "Heading 2"), aliases: ['encapcalament', 'h2', 'subtitol', 'heading'] },
        { type: 'heading', props: { level: 3 }, iconKey: 'heading3', title: i18n.t('editor.block_type_heading3', "Heading 3"), aliases: ['encapcalament', 'h3', 'heading'] },
        { type: 'heading', props: { level: 1, isToggleable: true }, iconKey: 'toggleHeading1', title: i18n.t('editor.block_type_toggle_heading1', "Toggle heading 1"), aliases: ['encapcalament', 'desplegable', 'plegable', 'toggle', 'h1', 'collapsable'] },
        { type: 'heading', props: { level: 2, isToggleable: true }, iconKey: 'toggleHeading2', title: i18n.t('editor.block_type_toggle_heading2', "Toggle heading 2"), aliases: ['encapcalament', 'desplegable', 'plegable', 'toggle', 'h2', 'collapsable'] },
        { type: 'heading', props: { level: 3, isToggleable: true }, iconKey: 'toggleHeading3', title: i18n.t('editor.block_type_toggle_heading3', "Toggle heading 3"), aliases: ['encapcalament', 'desplegable', 'plegable', 'toggle', 'h3', 'collapsable'] },
        { type: 'bulletListItem', iconKey: 'bullet', title: i18n.t('editor.block_type_bullet_list', "Bulleted list"), aliases: ['llista', 'list', 'pics', 'bullet', 'ul'] },
        { type: 'numberedListItem', iconKey: 'numbered', title: i18n.t('editor.block_type_numbered_list', "Numbered list"), aliases: ['llista', 'numerada', 'numbered', 'ol'] },
        { type: 'checkListItem', iconKey: 'check', title: i18n.t('editor.block_type_check_list', "Checklist"), aliases: ['llista', 'verificacio', 'check', 'todo', 'tasca'] },
        { type: 'toggle', iconKey: 'toggle', title: i18n.t('editor.block_type_toggle', "Toggle"), aliases: ['alternanca', 'toggle', 'plegable', 'desplegable'] },
        { type: 'quote', iconKey: 'quote', title: i18n.t('editor.block_type_quote', "Quote"), aliases: ['cita', 'quote', 'citacio'] },
        { type: 'codeBlock', iconKey: 'code', title: i18n.t('editor.block_type_code', "Code"), aliases: ['codi', 'code', 'monospace'] },
    ];

    return targets.map(target => ({
        title: target.title,
        iconKey: target.iconKey,
        // "tur"/"convertir"/"turn" available on all of them so the whole list shows up
        aliases: ['tur', 'convertir', 'turn', 'convert', ...target.aliases],
        group: i18n.t('editor.turn_into_group', "Turn into"),
        subtext: i18n.t('editor.turn_into_subtext', "Convert the current block"),
        onItemClick: () => {
            if (!editor) return;
            try {
                const block = editor.getTextCursorPosition().block;
                if (!block) return;
                editor.updateBlock(block, { type: target.type, props: target.props || {} });
                // Repositions the cursor in the already-converted block
                editor.setTextCursorPosition(block, 'end');
                editor.focus();
            } catch (e) {
                console.warn('SlashMenu: could not convert the block', e);
            }
        },
    }));
}

/**
 * Builds the catalog of Slash menu items for column layouts.
 * @param {Object} params
 * @param {Function} params.editor - BlockNote editor instance
 * @returns {Array}
 */
export function buildColumnLayoutCatalog({ editor } = {}) {
    const layouts = [
        { title: i18n.t('editor.column_layout_2', "2 columns"), columns: 2 },
        { title: i18n.t('editor.column_layout_3', "3 columns"), columns: 3 },
    ];

    return layouts.map(layout => ({
        title: layout.title,
        subtext: i18n.t('editor.column_layout_subtext', "Insert a column layout"),
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
                console.warn('SlashMenu: could not insert the column layout', e);
            }
        },
    }));
}
