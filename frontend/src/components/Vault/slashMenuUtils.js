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
 * Construeix el catàleg "Convertir en…" (estil Notion "Turn into").
 * Cada entrada converteix el bloc on és el cursor al tipus indicat, preservant
 * el contingut inline (text). Tots els ítems comparteixen l'àlies "tur" perquè
 * escrivint `/tur` aparegui tota la llista de destinacions.
 * @param {Object} params
 * @param {Function} params.editor - Instància de l'editor BlockNote
 * @returns {Array}
 */
export function buildTurnIntoCatalog({ editor } = {}) {
    // type + props de destí, títol, icona i àlies. L'àlies "tur"/"convertir"
    // és comú a tots; els específics permeten filtrar dins de la llista.
    const targets = [
        { type: 'paragraph', iconKey: 'paragraph', title: 'Paràgraf', aliases: ['paragraf', 'paragraph', 'text', 'p'] },
        { type: 'heading', props: { level: 1 }, iconKey: 'heading1', title: 'Encapçalament 1', aliases: ['encapcalament', 'h1', 'titol', 'heading'] },
        { type: 'heading', props: { level: 2 }, iconKey: 'heading2', title: 'Encapçalament 2', aliases: ['encapcalament', 'h2', 'subtitol', 'heading'] },
        { type: 'heading', props: { level: 3 }, iconKey: 'heading3', title: 'Encapçalament 3', aliases: ['encapcalament', 'h3', 'heading'] },
        { type: 'bulletListItem', iconKey: 'bullet', title: 'Llista amb pics', aliases: ['llista', 'list', 'pics', 'bullet', 'ul'] },
        { type: 'numberedListItem', iconKey: 'numbered', title: 'Llista numerada', aliases: ['llista', 'numerada', 'numbered', 'ol'] },
        { type: 'checkListItem', iconKey: 'check', title: 'Llista de verificació', aliases: ['llista', 'verificacio', 'check', 'todo', 'tasca'] },
        { type: 'toggle', iconKey: 'toggle', title: 'Alternança', aliases: ['alternanca', 'toggle', 'plegable', 'desplegable'] },
        { type: 'quote', iconKey: 'quote', title: 'Cita', aliases: ['cita', 'quote', 'citacio'] },
        { type: 'codeBlock', iconKey: 'code', title: 'Codi', aliases: ['codi', 'code', 'monospace'] },
    ];

    return targets.map(target => ({
        title: target.title,
        iconKey: target.iconKey,
        // "tur"/"convertir"/"turn" disponibles a tots per fer aparèixer la llista sencera
        aliases: ['tur', 'convertir', 'turn', 'convert', ...target.aliases],
        group: 'Convertir en',
        subtext: 'Converteix el bloc actual',
        onItemClick: () => {
            if (!editor) return;
            try {
                const block = editor.getTextCursorPosition().block;
                if (!block) return;
                editor.updateBlock(block, { type: target.type, props: target.props || {} });
                // Recol·loca el cursor al bloc ja convertit
                editor.setTextCursorPosition(block, 'end');
                editor.focus();
            } catch (e) {
                console.warn('SlashMenu: no s\'ha pogut convertir el bloc', e);
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
