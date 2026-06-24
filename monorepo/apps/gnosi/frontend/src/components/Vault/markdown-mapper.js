/**
 * markdown-mapper.js
 * Utilitat per a la conversió bi-direccional entre BlockNote JSON i Markdown Enriquit.
 */

// Sentinella per als enllaços file:// dins l'editor.
//
// BlockNote/Tiptap (extension-link) blanqueja qualsevol href el protocol del
// qual no és a la seva allowlist (http/https/ftp/mailto/tel/...). `file:` no
// hi és, així que un anchor amb href="file:///..." es rendireitza com
// <a href=""> i, en clicar, window.open("") obre una pestanya nova a l'origin
// de Gnosi. Per evitar-ho, el href intern dels enllaços a fitxer queda com
// "https://gnosi-file-protocol.local/..." (passa la validació de Tiptap
// perquè és https) i es converteix de tornada a "file://" només (a) quan se
// serialitza a markdown per guardar al disc, i (b) quan l'interceptor de
// clicks crida el backend per obrir la ruta amb el shell del sistema.
// Sentinel sense slash final perquè la conversió sigui un swap directe del
// prefix: "file://" (7 chars) ↔ "https://gnosi-file-protocol.local" (33 chars).
// Així mantenim la barra inicial del path local en totes dues direccions.
//
// IMPORTANT: el sentinel NO pot contenir "__" perquè el parser markdown de
// BlockNote (markdown-it) interpreta `__...__` com a bold i trenca la URL
// dins de `](...)`. Per això usem guions normals i un TLD ".local" reservat.
export const FILE_PROTOCOL_SENTINEL = "https://gnosi-file-protocol.local";
// Sentinel legacy (versions anteriors). Mantenim el reconeixement per
// compatibilitat amb notes ja desades a l'editor abans del canvi.
const LEGACY_FILE_PROTOCOL_SENTINEL = "https://__gnosi_file_protocol__";
// Variant corrompuda: si una nota legacy va passar per un re-serialitzador
// que va aplicar èmfasi (markdown-it interpreta `__...__` com a strong) i
// va escriure el resultat a disc literal, queda `**gnosi_file_protocol**`.
// La detectem per recuperar enllaços ja danyats al markdown.
const CORRUPTED_FILE_PROTOCOL_SENTINEL = "https://**gnosi_file_protocol**";

/**
 * Sentinella → file:// (per a serialització a markdown o per al backend).
 */
export const sentinelToFileUrl = (href) => {
    if (typeof href !== "string") return href;
    if (href.startsWith(FILE_PROTOCOL_SENTINEL)) {
        return "file://" + href.slice(FILE_PROTOCOL_SENTINEL.length);
    }
    if (href.startsWith(LEGACY_FILE_PROTOCOL_SENTINEL)) {
        return "file://" + href.slice(LEGACY_FILE_PROTOCOL_SENTINEL.length);
    }
    if (href.startsWith(CORRUPTED_FILE_PROTOCOL_SENTINEL)) {
        return "file://" + href.slice(CORRUPTED_FILE_PROTOCOL_SENTINEL.length);
    }
    return href;
};

/**
 * file:// → sentinella (per a inserció a l'editor).
 */
export const fileUrlToSentinel = (href) => {
    if (typeof href !== "string") return href;
    if (/^file:\/\//i.test(href)) {
        return FILE_PROTOCOL_SENTINEL + href.slice(7);
    }
    return href;
};

/**
 * Converteix una llista de blocs de BlockNote a Markdown enriquit.
 */
export const blocksToRichMarkdown = (blocks, editor) => {
    if (!blocks || !Array.isArray(blocks)) return "";

    // Separem els blocs top-level amb una línia en blanc (\n\n).
    // Sense això, dos paràgrafs consecutius serien "Linia1\nLinia2" i el
    // parser de BlockNote (tryParseMarkdownToBlocks) els interpreta com un sol
    // paràgraf amb soft-break, perdent els salts en re-parse.
    const parts = blocks.map(
        (block) => blockToMarkdown(block, editor, 0).replace(/\n+$/, "")
    );
    // Els ítems de llista CONSECUTIUS del mateix tipus s'uneixen amb un sol salt
    // de línia (llista "tight"); la resta de blocs amb una línia en blanc (\n\n)
    // perquè el re-parse de BlockNote no fusioni paràgrafs consecutius. Sense
    // això, cada ítem de llista quedava separat per una línia en blanc al .md →
    // llistes "loose" amb espaiat extra (i lletgeses en visors com Obsidian).
    const LIST_ITEM_TYPES = new Set(["bulletListItem", "numberedListItem", "checkListItem"]);
    let result = "";
    blocks.forEach((block, i) => {
        if (i === 0) { result = parts[i]; return; }
        const tight = LIST_ITEM_TYPES.has(block.type) && block.type === blocks[i - 1].type;
        result += (tight ? "\n" : "\n\n") + parts[i];
    });
    result = result.trim();

    // Sentinella defensiva: si trobem "[object Object]" al resultat,
    // alguna part del converter ha rebut un valor mal format. Llançem error
    // en lloc d'escriure brossa al disc (i evitem perdre la nota).
    if (result.includes("[object Object]")) {
        throw new Error(
            "blocksToRichMarkdown: detectat '[object Object]' al resultat — " +
            "el contingut de l'editor té un format inesperat. Save abortat per " +
            "no sobreescriure la nota."
        );
    }
    return result;
};

/**
 * Converteix un bloc individual a Markdown recursivament.
 * ESTRATÈGIA: Cada bloc-nivell s'assegura de tenir el seu propi \n.
 */
const blockToMarkdown = (block, editor, indentLevel = 0) => {
    const indent = "  ".repeat(indentLevel);
    let content = "";

    // Directives Estructurals (Gnosi)
    if (block.type === "columnList") {
        let res = `:::column-list\n`;
        if (block.children) {
            block.children.forEach(col => {
                res += blockToMarkdown(col, editor, indentLevel + 1);
            });
        }
        res += `:::\n`;
        return res;
    }

    if (block.type === "column") {
        const widthAttr = (block.props && block.props.width && block.props.width !== 1) ? ` {width=${block.props.width}}` : "";
        let res = `:::column${widthAttr}\n`;
        if (block.children) {
            block.children.forEach(child => {
                res += blockToMarkdown(child, editor, indentLevel + 1);
            });
        }
        res += `:::\n`;
        return res;
    }

    if (block.type === "toggle") {
        // El label del toggle es recupera amb un slice cru del parser (no markdown-it):
        // escapar-lo hi deixaria backslashes literals → escape:false.
        let res = `:::toggle ${inlineContentToMarkdown(block.content, { escape: false })}\n`;
        if (block.children) {
            block.children.forEach(child => {
                res += blockToMarkdown(child, editor, indentLevel + 1);
            });
        }
        res += `:::\n`;
        return res;
    }

    // Encapçalament desplegable (heading + isToggleable, creat amb /tur). El
    // `#` de Markdown no pot codificar ni el `isToggleable` ni el niat dels
    // fills, així que el serialitzem com a fence pròpia que embolcalla els
    // fills (mirall de :::toggle), preservant el nivell a {level=N}.
    if (block.type === "heading" && block.props?.isToggleable) {
        const lvl = Number(block.props.level) || 1;
        // Label recuperat amb slice cru del parser de directives (no markdown-it).
        let res = `:::toggle-heading{level=${lvl}} ${inlineContentToMarkdown(block.content, { escape: false })}\n`;
        if (block.children) {
            block.children.forEach(child => {
                res += blockToMarkdown(child, editor, indentLevel + 1);
            });
        }
        res += `:::\n`;
        return res;
    }

    if (block.type === "database") {
        return `\`\`\`gnosi-database\n${JSON.stringify(block.props, null, 2)}\n\`\`\`\n`;
    }

    if (block.type === "gnosi_view") {
        // `heading`/`heading_level` són opcionals i no tenen UI per definir-los:
        // només s'inclouen si hi ha un títol real, per no embrutar la definició
        // amb un `"heading":""` sense sentit. Els usuaris posen un `#` de
        // markdown normal (portable) damunt del bloc. En llegir, promoteCustomFences
        // ja els posa per defecte ('' i 1) quan no hi són.
        const h = String(block.props?.heading || '').trim();
        const payload = { view_id: String(block.props?.view_id || '') };
        if (h) {
            payload.heading = h;
            payload.heading_level = Number(block.props?.heading_level) || 1;
        }
        return `\`\`\`gnosi-view\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
    }

    if (block.type === "bibliography") {
        // Serialitza el block bibliografia com a `{{bibliography}}` (style
        // i locale per defecte) o `{{bibliography:apa}}` / `{{bibliography:
        // apa:ca-AD}}` si l'usuari ha sobreescrit els defaults.
        const style = String(block?.props?.style || '').trim();
        const locale = String(block?.props?.locale || '').trim();
        if (!style || (style === 'apa' && (!locale || locale === 'ca-AD'))) {
            return '{{bibliography}}\n';
        }
        if (!locale || locale === 'ca-AD') return `{{bibliography:${style}}}\n`;
        return `{{bibliography:${style}:${locale}}}\n`;
    }

    if (block.type === "transclusion") {
        const target = String(block?.props?.target || "").trim();
        const alias = String(block?.props?.alias || "").trim();
        const section = String(block?.props?.section || "").trim();
        if (!target) return "";

        const targetWithSection = section ? `${target}#${section}` : target;
        return alias ? `![[${targetWithSection}|${alias}]]\n` : `![[${targetWithSection}]]\n`;
    }

    // Tipus estàndard
    switch (block.type) {
        case "heading": {
            const level = "#".repeat(block.props.level || 1);
            content = `${level} ${inlineContentToMarkdown(block.content)}`;
            break;
        }
        case "bulletListItem":
            content = `- ${inlineContentToMarkdown(block.content, { atLineStart: true })}`;
            break;
        case "numberedListItem":
            content = `1. ${inlineContentToMarkdown(block.content, { atLineStart: true })}`;
            break;
        case "checkListItem": {
            const checked = block.props.checked ? "[x]" : "[ ]";
            content = `- ${checked} ${inlineContentToMarkdown(block.content, { atLineStart: true })}`;
            break;
        }
        case "codeBlock":
            // Contingut de codi: RAW, mai escapat (trencaria `a ** b`, `arr[0]`, etc.).
            content = `\`\`\`${block.props.language || ""}\n${inlineContentToMarkdown(block.content, { escape: false })}\n\`\`\``;
            break;
        case "horizontalRule":
            content = `---`;
            break;
        case "image":
        case "video":
        case "audio":
        case "file":
        case "embed": {
            const url = block.props.url || block.props.src || "";
            const caption = block.props.caption ? `|${block.props.caption}` : "";
            content = block.type === "image" ? `![${caption}](${url})` : `[${block.type}: ${url}](${url})`;
            break;
        }
        case "alert": { // BlockNote calls callouts 'alert'
            const alertType = block.props?.type || "info";
            // El cos del callout es re-llegeix cru (parser propi de `> [!type]`), no per
            // markdown-it, així que NO s'escapa (ja és segur del round-trip per disseny).
            const alertContent = inlineContentToMarkdown(block.content, { escape: false });
            return `> [!${alertType}]\n> ${alertContent.replace(/\n/g, "\n> ")}`;
        }
        case "quote": {
            // Cita en bloc → blockquote de Markdown (`> …`). BlockNote suporta el
            // bloc `quote` de sèrie; sense aquest cas queia al `default` i es
            // desava com a paràgraf PLA, perdent el format de cita a cada desat.
            let inner = inlineContentToMarkdown(block.content, { atLineStart: true });
            if (block.children && block.children.length > 0) {
                block.children.forEach(child => {
                    inner += "\n" + blockToMarkdown(child, editor, 0).replace(/\n+$/, "");
                });
            }
            return `> ${inner.replace(/\n/g, "\n> ")}`;
        }
        case "table": {
            // GFM Table serialization
            // Support native BlockNote table format (block.content.rows) or fallback to custom nested children
            let tableRows = [];
            if (block.content && block.content.type === "tableContent" && Array.isArray(block.content.rows)) {
                tableRows = block.content.rows;
            } else if (Array.isArray(block.children) && block.children.length > 0) {
                tableRows = block.children;
            }

            if (tableRows.length === 0) return "";

            const markdownRows = tableRows.map(row => {
                const cellDataRow = row.cells || row.children || [];
                const markdownCells = cellDataRow.map(cell => {
                    const cellContent = cell.content !== undefined ? cell.content : cell; // Custom has .content, native cell IS the inline content array
                    // Les cel·les es re-llegeixen crues (parser GFM propi que talla per `|`),
                    // no per markdown-it → NO s'escapa el text (només el `|` literal).
                    return inlineContentToMarkdown(cellContent, { escape: false }).replace(/\|/g, "\\|");
                });
                return `| ${markdownCells.join(" | ")} |`;
            });

            if (markdownRows.length === 0) return "";

            // Add separator row after header
            let headerCellsCount = 1;
            if (tableRows[0].cells) {
                headerCellsCount = tableRows[0].cells.length;
            } else if (tableRows[0].children) {
                headerCellsCount = tableRows[0].children.length;
            }

            const separator = `| ${Array(headerCellsCount).fill("---").join(" | ")} |`;

            markdownRows.splice(1, 0, separator);
            return markdownRows.join("\n");
        }
        case "paragraph":
        default:
            content = inlineContentToMarkdown(block.content, { atLineStart: true });
            break;
    }

    // Color/Background
    const textColor = block.props?.textColor;
    const bgColor = block.props?.backgroundColor;
    const hasTextColor = textColor && textColor !== "default";
    const hasBgColor = bgColor && bgColor !== "default";
    if (hasTextColor || hasBgColor) {
        let style = "";
        if (hasTextColor) style += `color: ${textColor};`;
        if (hasBgColor) style += `background-color: ${bgColor};`;
        content = `<div style="${style}">${content}</div>`;
    }

    // Fills (standard nesting)
    if (block.children && block.children.length > 0 && !["columnList", "column", "toggle"].includes(block.type)) {
        block.children.forEach(child => {
            // For standard Markdown, a paragraph block inside a list item needs a preceding blank line
            // If the child is not a list item itself and parent is a list, prepend a blank line to force a separate paragraph
            const needsBlankLine = ["bulletListItem", "numberedListItem", "checkListItem"].includes(block.type) 
                                   && !["bulletListItem", "numberedListItem", "checkListItem"].includes(child.type);
            
            const prefix = needsBlankLine ? "\n\n" : "\n";
            let childMd = blockToMarkdown(child, editor, indentLevel + 1);
            
            // if needsBlankLine is true, the child block receives an extra newline, but wait, the childMd already has its own formatting.
            // Let's just adjust the spacing before appending.
            content += prefix + childMd.trimEnd(); 
        });
        content += "\n";
    }

    return indent + content.trimStart() + "\n";
};

const convertToWikilinks = (content) => {
    if (!Array.isArray(content)) return content;
    const next = [];
    content.forEach(item => {
        if (item.type === "text") {
            const text = item.text;
            // Regex for [[Title]] or [[Title#Section]] or [[Title|Alias]].
            // Excloem `[` dels grups de captura: si no, un `[[` no tancat seguit
            // d'un wikilink ben format més endavant a la mateixa línia consumeix
            // tot el text intermedi com a target. Ex.: `[[port. ... [[id|Alias]]`
            // ha de matchar només el wikilink intern; el `[[port. ` queda com a
            // text. Sense aquesta exclusió, el target del wikilink resultant
            // contenia 400+ chars amb `[[` inside, i BlockNote es bloquejava
            // serialitzant/rendering-lo.
            const regex = /\[\[([^\][|#]+)(?:#([^\][|]+))?(?:\|([^\][]+))?\]\]/g;
            let lastIndex = 0;
            let match;
            while ((match = regex.exec(text)) !== null) {
                const start = match.index;
                const fullMatch = match[0];
                const target = match[1];
                const section = match[2];
                const alias = match[3];

                if (start > lastIndex) {
                    next.push({ ...item, text: text.slice(lastIndex, start) });
                }

                next.push({
                    type: "wikilink",
                    props: {
                        title: alias || (section ? `${target}#${section}` : target),
                        target: target + (section ? `#${section}` : "")
                    }
                });
                lastIndex = start + fullMatch.length;
            }
            if (lastIndex < text.length) {
                next.push({ ...item, text: text.slice(lastIndex) });
            }
        } else if (item.type === "link") {
            next.push({
                ...item,
                content: convertToWikilinks(item.content)
            });
        } else {
            next.push(item);
        }
    });
    return next;
};

// Aplica `convertToWikilinks` a totes les cel·les d'una taula nativa de
// BlockNote. El contingut d'una taula no és un array inline sinó un objecte
// `tableContent` amb `rows[].cells[]`, on cada cel·la pot ser directament
// l'array inline (format natiu) o un objecte `{ content: [...] }`.
const convertTableContentWikilinks = (tableContent) => ({
    ...tableContent,
    rows: (tableContent.rows || []).map(row => ({
        ...row,
        cells: Array.isArray(row.cells)
            ? row.cells.map(cell => (
                Array.isArray(cell)
                    ? convertToWikilinks(cell)
                    : (cell && Array.isArray(cell.content)
                        ? { ...cell, content: convertToWikilinks(cell.content) }
                        : cell)
            ))
            : row.cells,
    })),
});

const processBlocksForWikilinks = (blocks) => {
    if (!blocks || !Array.isArray(blocks)) return blocks;
    return blocks.map(block => {
        const newBlock = { ...block };
        if (newBlock.content) {
            // Les taules natives porten el contingut a `content.rows[].cells`;
            // `convertToWikilinks` només sap tractar arrays inline, així que
            // sense aquest cas els `[[…]]` dins de cel·les quedaven en cru.
            if (newBlock.content.type === 'tableContent' && Array.isArray(newBlock.content.rows)) {
                newBlock.content = convertTableContentWikilinks(newBlock.content);
            } else {
                newBlock.content = convertToWikilinks(newBlock.content);
            }
        }
        if (newBlock.children) {
            newBlock.children = processBlocksForWikilinks(newBlock.children);
        }
        return newBlock;
    });
};

// --- Citations Pandoc-style: `[@key]` o `[@key1; @key2]` ---
// Detecta cada token `@<citationkey>` dins de `[ ]` i el converteix en
// inline content de tipus `cite`. Sintaxi acceptada (subset Pandoc):
//   [@smith2020]                      → 1 cite
//   [@smith2020; @jones2019]          → 2 cites
//   @smith2020                        → 1 cite "naked" (sense brackets)
// La meva regex és intencionalment restrictiva per evitar falsos positius:
// el key ha de començar per lletra ASCII low + permet [a-z0-9_:-]. Si vols
// keys amb capitals o accents al teu Citation Key, amplia el charset.
const CITATION_KEY_RE = /[a-z][a-z0-9_:-]*/i;
const CITATION_BRACKET_RE = /\[@([a-z][a-z0-9_:-]*(?:\s*;\s*@[a-z][a-z0-9_:-]*)*)\]/gi;
const CITATION_NAKED_RE = /(^|[\s(])@([a-z][a-z0-9_:-]*)\b/g;

const convertToCitations = (content) => {
    if (!Array.isArray(content)) return content;
    const next = [];
    content.forEach(item => {
        // Sols els nodes de text es processen. Wikilinks ja convertits no
        // s'han de tocar; els altres tipus es passen tal qual.
        if (item.type !== "text") {
            if (item.type === "link" && Array.isArray(item.content)) {
                next.push({ ...item, content: convertToCitations(item.content) });
            } else {
                next.push(item);
            }
            return;
        }
        const text = item.text;
        if (!text) { next.push(item); return; }
        // Estratègia: dos passes. Primer trobem tots els tokens
        // (bracketed o naked) amb la seva posició, després tallem el text
        // i intercalem els nodes `cite`. Així evitem regex globals
        // competint per la mateixa posició.
        const tokens = [];
        CITATION_BRACKET_RE.lastIndex = 0;
        let m;
        while ((m = CITATION_BRACKET_RE.exec(text)) !== null) {
            const inner = m[1];
            const keys = inner.split(';').map(s => s.replace(/^\s*@?/, '').trim()).filter(Boolean);
            tokens.push({ start: m.index, end: m.index + m[0].length, keys });
        }
        CITATION_NAKED_RE.lastIndex = 0;
        while ((m = CITATION_NAKED_RE.exec(text)) !== null) {
            // L'offset és el del key, no del prefix (capture group 2)
            const keyStart = m.index + (m[1]?.length || 0);
            const key = m[2];
            // Evitar superposició amb tokens bracketed ja agafats.
            if (tokens.some(t => keyStart >= t.start && keyStart < t.end)) continue;
            tokens.push({ start: keyStart, end: keyStart + 1 + key.length, keys: [key] });
        }
        if (tokens.length === 0) { next.push(item); return; }
        tokens.sort((a, b) => a.start - b.start);
        let last = 0;
        for (const t of tokens) {
            if (t.start > last) next.push({ ...item, text: text.slice(last, t.start) });
            for (let i = 0; i < t.keys.length; i++) {
                if (i > 0) next.push({ ...item, text: '; ' });
                next.push({ type: 'cite', props: { citationKey: t.keys[i] } });
            }
            last = t.end;
        }
        if (last < text.length) next.push({ ...item, text: text.slice(last) });
    });
    return next;
};

const processBlocksForCitations = (blocks) => {
    if (!blocks || !Array.isArray(blocks)) return blocks;
    return blocks.map(block => {
        const newBlock = { ...block };
        if (newBlock.content) {
            newBlock.content = convertToCitations(newBlock.content);
        }
        if (newBlock.children) {
            newBlock.children = processBlocksForCitations(newBlock.children);
        }
        return newBlock;
    });
};

const codeBlockText = (block) => {
    if (!block?.content) return '';
    if (typeof block.content === 'string') return block.content;
    if (!Array.isArray(block.content)) return '';
    return block.content
        .map(it => (it && typeof it === 'object' && typeof it.text === 'string') ? it.text : '')
        .join('');
};

// Converteix paràgrafs que només contenen un link `[embed: URL](URL)` en
// blocs nadius `embed`. La sintaxi és simètrica a la de `[file: URL](URL)`
// però aquí volem un bloc dedicat perquè es renderitzi com a iframe/viewer
// en lloc d'enllaç plain. BlockNote no reconeix la sintaxi per defecte; per
// això fem aquest post-procés després del parser.
const promoteEmbedBlocks = (blocks) => {
    if (!blocks || !Array.isArray(blocks)) return blocks;
    return blocks.map(block => {
        let newBlock = block;
        if (newBlock?.children && Array.isArray(newBlock.children)) {
            newBlock = { ...newBlock, children: promoteEmbedBlocks(newBlock.children) };
        }
        if (newBlock?.type !== 'paragraph') return newBlock;
        const content = Array.isArray(newBlock.content) ? newBlock.content : null;
        if (!content || content.length !== 1) return newBlock;
        const item = content[0];
        if (!item || item.type !== 'link' || !Array.isArray(item.content)) return newBlock;
        const text = item.content.map(c => (c && typeof c.text === 'string' ? c.text : '')).join('');
        const match = text.match(/^embed:\s*(.+)$/i);
        if (!match || !item.href) return newBlock;
        return {
            ...newBlock,
            type: 'embed',
            props: { url: String(item.href), caption: '' },
            content: undefined,
        };
    });
};

// Detecta paràgrafs que només contenen `{{bibliography}}` (opcionalment
// `{{bibliography:apa}}` o `{{bibliography:chicago-author-date:ca-AD}}`)
// i els converteix en un block `bibliography`. Patró simètric al
// `promoteEmbedBlocks`. Sense aquest, el text literal apareixeria a la
// pàgina i el block real no es renderitzaria.
const promoteBibliographyBlocks = (blocks) => {
    if (!blocks || !Array.isArray(blocks)) return blocks;
    return blocks.map(block => {
        let newBlock = block;
        if (newBlock?.children && Array.isArray(newBlock.children)) {
            newBlock = { ...newBlock, children: promoteBibliographyBlocks(newBlock.children) };
        }
        if (newBlock?.type !== 'paragraph') return newBlock;
        const content = Array.isArray(newBlock.content) ? newBlock.content : null;
        if (!content) return newBlock;
        const text = content.map(c => (c && typeof c.text === 'string' ? c.text : '')).join('').trim();
        const m = text.match(/^\{\{bibliography(?::([a-z][a-z0-9-]*))?(?::([a-zA-Z-]+))?\}\}$/);
        if (!m) return newBlock;
        return {
            ...newBlock,
            type: 'bibliography',
            props: {
                style: m[1] || 'apa',
                locale: m[2] || 'ca-AD',
            },
            content: undefined,
        };
    });
};

const promoteCustomFences = (blocks) => {
    if (!blocks || !Array.isArray(blocks)) return blocks;
    return blocks.map(block => {
        if (block?.children && Array.isArray(block.children)) {
            block = { ...block, children: promoteCustomFences(block.children) };
        }
        if (block?.type !== 'codeBlock') return block;
        const lang = String(block.props?.language || '').toLowerCase();
        if (lang !== 'gnosi-view') return block;
        let payload = null;
        try { payload = JSON.parse(codeBlockText(block)); } catch { return block; }
        if (!payload || typeof payload !== 'object') return block;
        return {
            type: 'gnosi_view',
            props: {
                view_id: String(payload.view_id || ''),
                heading: String(payload.heading || ''),
                heading_level: String(Number(payload.heading_level) || 1),
            },
        };
    });
};

// --- Escapat contextual de Markdown en text SENSE estil ---
// Vegeu docs/dev_memory/directives/markdown_roundtrip_escaping.md
//
// `inlineContentToMarkdown` serialitzava el text sense estil literal, així que el text
// pla amb significat Markdown es corrompia en el round-trip (blocs → md → blocs) perquè
// markdown-it (tryParseMarkdownToBlocks) el reinterpretava: `the __init__ method` → bold
// "init", backticks → codi, `*word*` → cursiva, `# foo` a inici de línia → heading.
// Escapem NOMÉS allò que CommonMark reinterpretaria de debò, per no embrutar el .md.
// CRÍTIC: només s'aplica al contingut que torna a passar per markdown-it (paràgrafs,
// headings normals, list items, text d'enllaç). Els blocs amb parser propi (toggle,
// toggle-heading, callout, cel·les de taula) guarden el text CRU i s'han de serialitzar
// amb `escape:false` (re-escapar-los hi deixaria backslashes literals).

// Puntuació ASCII — les classes que fa servir CommonMark per a la regla de flanking.
// eslint-disable-next-line no-useless-escape
const _isMdPunct = (c) => c !== undefined && /[!-\/:-@\[-`{-~]/.test(c);
// El límit del node de text es tracta com a espai (límit de paraula): segur a la
// pràctica perquè BlockNote fusiona els nodes de text pla adjacents en un de sol.
const _isMdSpace = (c) => c === undefined || /\s/.test(c);

// Escapa el marcador de bloc inicial d'UNA línia (heading/quote/llista/hr/setext).
const escapeLeadingBlockMarker = (line) => {
    const m = line.match(/^(\s*)([\s\S]*)$/);
    const ws = m ? m[1] : "";
    let rest = m ? m[2] : line;
    if (!rest) return line;
    if (/^#{1,6}(\s|$)/.test(rest)) {                       // ATX heading
        rest = "\\" + rest;
    } else if (rest[0] === ">") {                            // blockquote / callout
        rest = "\\" + rest;
    } else if (/^[-+*]\s/.test(rest)) {                      // bullet list
        rest = "\\" + rest;
    } else if (/^\d{1,9}[.)]\s/.test(rest)) {                // ordered list
        rest = rest.replace(/^(\d{1,9})([.)])/, "$1\\$2");
    } else if (/^([-*_])\1{2,}\s*$/.test(rest)) {            // thematic break --- *** ___
        rest = "\\" + rest;
    } else if (/^=+\s*$/.test(rest) || /^-+\s*$/.test(rest)) { // setext underline
        rest = "\\" + rest;
    }
    return ws + rest;
};

// Escapa un node de text SENSE marques. `atLineStart` activa també l'escapat dels
// marcadors de bloc a l'inici de cada línia (només per a paràgrafs i list items).
const escapeUnstyledMarkdown = (text, atLineStart) => {
    if (!text) return text;
    let out = "";
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "\\") { out += "\\\\"; continue; }        // backslash PRIMER (idempotència)
        if (c === "`") { out += "\\`"; continue; }           // backtick → codi inline
        const prev = i > 0 ? text[i - 1] : undefined;
        const next = i < text.length - 1 ? text[i + 1] : undefined;
        if (c === "~") {                                      // strikethrough ~~ (GFM)
            out += (next === "~" || prev === "~") ? "\\~" : "~";
            continue;
        }
        if (c === "*" || c === "_") {
            const prevSpace = _isMdSpace(prev), nextSpace = _isMdSpace(next);
            const prevPunct = _isMdPunct(prev), nextPunct = _isMdPunct(next);
            const leftFlank = !nextSpace && (!nextPunct || prevSpace || prevPunct);
            const rightFlank = !prevSpace && (!prevPunct || nextSpace || nextPunct);
            let dangerous;
            if (c === "*") {
                dangerous = leftFlank || rightFlank;          // asterisc: intraword permès
            } else {                                           // underscore: NO intraword
                const canOpen = leftFlank && (!rightFlank || prevPunct);
                const canClose = rightFlank && (!leftFlank || nextPunct);
                dangerous = canOpen || canClose;               // `my_var_name` queda net
            }
            out += dangerous ? "\\" + c : c;
            continue;
        }
        out += c;
    }
    // Links/imatges inline `[...](` o `![...](`: escapa el `[` perquè no es torni enllaç.
    // Els `[ref]` solts NO es toquen (markdown-it ja els deixa literals) → mínima pol·lució.
    out = out.replace(/(!?)\[([^[\]\n]*)]\(/g, (mm, bang, label) => `${bang}\\[${label}](`);
    // Marcadors de bloc a inici de cada línia.
    if (atLineStart) {
        out = out.split("\n").map(escapeLeadingBlockMarker).join("\n");
    }
    return out;
};

/**
 * Converteix contingut inline.
 * @param {object} [opts]
 * @param {boolean} [opts.escape=true] Escapa els caràcters Markdown del text sense estil.
 *   Posar `false` per a contingut que NO torna per markdown-it (toggle/callout/cel·les).
 * @param {boolean} [opts.atLineStart=false] El contingut comença a inici de línia
 *   (paràgrafs i list items) → escapa també els marcadors de bloc inicials.
 */
const inlineContentToMarkdown = (content, { escape = true, atLineStart = false } = {}) => {
    if (!content) return "";
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";

    let lineStart = atLineStart;
    return content.map(item => {
        const nodeAtLineStart = lineStart;
        lineStart = false; // els nodes inline no acaben (per defecte) en línia nova
        if (!item || typeof item !== "object") return "";
        if (item.type === "text") {
            // Defensiva: si item.text no és string, NO el toString-egem
            // (tornaria "[object Object]" i sobreescriuria la nota al disc).
            if (typeof item.text !== "string") {
                console.warn("inlineContentToMarkdown: item.text no és string", item);
                return "";
            }
            let text = item.text;
            // El node següent està a inici de línia si AQUEST text acaba en salt.
            lineStart = text.endsWith("\n");

            // Escapat contextual NOMÉS en text sense cap marca (ni dins de code spans):
            // dins de bold/italic/underline/strike/code el text es deixa cru.
            const s = item.styles || {};
            const hasMark = !!(s.bold || s.italic || s.underline || s.strike || s.code);
            if (escape && !hasMark) {
                text = escapeUnstyledMarkdown(text, nodeAtLineStart);
            }

            // Handle soft line breaks inside text nodes. Standard Markdown requires two spaces or <br>.
            // (Després d'escapar, per no escapar el `<br>` que injectem.)
            if (text.includes('\n')) {
                text = text.replace(/\n/g, '<br>\n');
            }

            if (item.styles) {
                // CommonMark no reconeix delimitadors d'èmfasi quan tenen
                // espais immediatament adjacents (p.ex. "** text **" no és bold).
                // Movem els espais d'inici/final fora dels marcadors.
                const wrap = (str, open, close = open) => {
                    if (!str) return str;
                    const m = String(str).match(/^(\s*)([\s\S]*?)(\s*)$/);
                    const lead = m ? m[1] : "";
                    const core = m ? m[2] : str;
                    const trail = m ? m[3] : "";
                    if (!core) return str; // tot espais; no aplicar marca
                    return `${lead}${open}${core}${close}${trail}`;
                };
                if (item.styles.bold) text = wrap(text, "**");
                if (item.styles.italic) text = wrap(text, "*");
                if (item.styles.underline) text = wrap(text, "<u>", "</u>");
                if (item.styles.strike) text = wrap(text, "~~");
                if (item.styles.code) text = wrap(text, "`");
            }
            return text;
        }
        if (item.type === "link") {
            // Robustesa: el content d'un link pot ser array (esperat),
            // string (legacy) o un sol objecte (insertion bug). Normalitzem.
            let linkContent = item.content;
            if (linkContent && !Array.isArray(linkContent) && typeof linkContent !== "string") {
                linkContent = [linkContent];
            }
            const innerText = inlineContentToMarkdown(linkContent);
            const rawHref = typeof item.href === "string" ? item.href : "";
            // El sentinel intern es desserialitza a file:// abans d'escriure
            // al disc, perquè els lectors externs (Obsidian, etc.) entenguin
            // l'enllaç local original.
            const safeHref = sentinelToFileUrl(rawHref);
            // CommonMark: si la URL té espais o parèntesis no balancejats, cal
            // envoltar-la amb <...>. Sense això, [text](file:///foo bar.docx)
            // es trenca al primer espai i el link queda inservible.
            const needsAngleBrackets = /[\s<>]/.test(safeHref);
            const finalHref = needsAngleBrackets ? `<${safeHref}>` : safeHref;
            return `[${innerText}](${finalHref})`;
        }
        if (item.type === "wikilink") {
            const target = item.props?.target || "";
            const section = item.props?.section || "";
            const title = item.props?.title || "";
            const link = section ? `${target}#${section}` : target;

            // Si el títol és representatiu però diferent del link pur, usem alias [[Link|Title]]
            if (title && title !== link && title !== target) {
                return `[[${link}|${title}]]`;
            }
            return `[[${link}]]`;
        }
        if (item.type === "cite") {
            // Serialitzem com a Pandoc citation `[@key]`. Compatible amb
            // pandoc-citeproc, Quarto, Obsidian Citations Plugin, etc.
            const ck = item.props?.citationKey || "";
            return ck ? `[@${ck}]` : "";
        }
        return "";
    }).join("");
};

// Els enllaços file:// dins el markdown se substitueixen pel sentinel abans
// del parse perquè BlockNote/Tiptap no els accepta com a href vàlid (no és
// als seus protocols permesos). Mantenim el sentinel als blocs durant tota
// la vida útil al editor; només es reverteix a file:// al moment de
// serialitzar a markdown (vegeu inlineContentToMarkdown). El sentinel passa
// la validació de Tiptap perquè comença amb https://, així que l'<a> al DOM
// té un href clicable que el nostre useFileLinkInterceptor pot capturar.
const parsePlainMarkdownBlock = async (text, editor) => {
    if (!text) return [];

    // Reemplaça file:// pel sentinel abans de delegar al parser.
    // També reemplaça el sentinel legacy (`__gnosi_file_protocol__`) i la
    // seva variant corrompuda (`**gnosi_file_protocol**`, escrita per un
    // re-serialitzador que va interpretar els `__` com a bold) pel sentinel
    // actual. Sense aquesta normalització, el parser veu un href trencat
    // i renderitza `[text](url)` com a markdown literal.
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Captura tant `](file://` com `](<file://` (URL envoltada amb angle
    // brackets per CommonMark quan té espais o non-ASCII). Sense capturar el
    // `<` opcional, file:// arriba intacte al parser de Tiptap, que el rebutja
    // per esquema no permès i descarta el link silenciosament; el round-trip
    // següent escriu el text sense href, perdent l'enllaç.
    let protectedText = text
        .replace(/\]\((<?)file:\/\//g, `]($1${FILE_PROTOCOL_SENTINEL}`)
        .replace(
            new RegExp(`\\]\\((<?)${escapeRe(LEGACY_FILE_PROTOCOL_SENTINEL)}`, 'g'),
            `]($1${FILE_PROTOCOL_SENTINEL}`,
        )
        .replace(
            new RegExp(`\\]\\((<?)${escapeRe(CORRUPTED_FILE_PROTOCOL_SENTINEL)}`, 'g'),
            `]($1${FILE_PROTOCOL_SENTINEL}`,
        );

    // Sanititza URLs en markdown links `[text](url)`. Markdown-it només
    // accepta URLs amb espais si estan envoltades de `<...>`. A més, l'extensió
    // Link de Tiptap rebutja URLs amb UTF-8 al path (Administració, Pla, etc.)
    // i descarta el link silenciosament. Solució més robusta: envoltar SEMPRE
    // amb `<...>` quan la URL té caràcters problemàtics (espais o non-ASCII).
    // CommonMark accepta qualsevol caràcter dins de `<...>` excepte `<`, `>` i
    // line breaks; així el parser respecta la URL literal i no la valida.
    protectedText = protectedText.replace(
        /\]\(([^)]*)\)/g,
        (m, url) => {
            // Si la URL ja està entre angle brackets, no fem res.
            if (url.startsWith('<') && url.endsWith('>')) return m;
            // Backslashes Windows-style → slashes (paths Unix).
            const normalized = url.replace(/\\/g, '/');
            // Si conté espais o caràcters non-ASCII, envolta amb <...>.
            // eslint-disable-next-line no-control-regex
            if (/[\s<>]|[^\x00-\x7F]/.test(normalized)) {
                return `](<${normalized}>)`;
            }
            return `](${normalized})`;
        },
    );

    // Sanitització de `[[` no aparellats: si la pàgina té un `[[xxx` que
    // no troba el seu `]]`, el regex de wikilinks pot capturar centenars de
    // chars de text (incloent un wikilink ben format intern), creant un
    // wikilink amb target malformat que penja BlockNote al render. Aquí
    // escapem els `[[` orfes a `\[\[` perquè markdown-it els tracti com a
    // text literal i només els `[[...]]` ben aparellats arribin a
    // `convertToWikilinks`.
    const balancedText = (() => {
        const opens = [];
        for (let i = 0; i < protectedText.length - 1; i++) {
            if (protectedText[i] === '[' && protectedText[i + 1] === '[') {
                opens.push(i);
                i++;
            } else if (protectedText[i] === ']' && protectedText[i + 1] === ']') {
                if (opens.length > 0) {
                    opens.pop();
                }
                i++;
            }
        }
        if (opens.length === 0) return protectedText;
        // opens conté índexs de `[[` SENSE tancament — els escapem.
        const openSet = new Set(opens);
        let result = '';
        for (let i = 0; i < protectedText.length; i++) {
            if (openSet.has(i)) {
                result += '\\[\\[';
                i++; // Saltem el segon `[`
            } else {
                result += protectedText[i];
            }
        }
        return result;
    })();

    let blocks = [];
    if (editor?.tryParseMarkdownToBlocks) {
        try {
            // Race amb timeout: si el parser de BlockNote/markdown-it entra en
            // un estat patològic (URLs amb backslash escapats, brackets no
            // aparellats, etc.), no volem que bloquegi el thread principal
            // per sempre i pengi el "Carregant editor...". 5s és més que
            // suficient per qualsevol pàgina raonable.
            blocks = await Promise.race([
                editor.tryParseMarkdownToBlocks(balancedText),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('parse-timeout')), 5000),
                ),
            ]);
        } catch (e) {
            console.warn('parsePlainMarkdownBlock fallback:', e?.message);
            blocks = [{ type: "paragraph", content: text }];
        }
    } else {
        blocks = [{ type: "paragraph", content: text }];
    }

    return processBlocksForCitations(processBlocksForWikilinks(blocks));
};

/**
 * Converteix Markdown enriquit a blocs.
 */
export const richMarkdownToBlocks = async (markdown, editor) => {
    if (!markdown || typeof markdown !== 'string') return [];
    
    const trimmed = markdown.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try { return JSON.parse(markdown); } catch (e) { console.error(e); }
    }

    const lines = markdown.split("\n");

    const parseRecursive = async (inputLines) => {
        let blocks = [];
        let i = 0;

        while (i < inputLines.length) {
            const line = inputLines[i];
            const trimmed = line.trim();

            // REGLA ESTRICTA: La directiva ha de ser l'únic que hi ha a la línia trimada
            const startMatch = trimmed.match(/^(:{3,})(column-list|column|toggle-heading|toggle|gnosi-ignore)(.*)$/);
            
            if (startMatch) {
                const typeRaw = startMatch[2];
                const label = startMatch[3].trim();

                // Cas especial: gnosi-ignore (saltem tot el bloc)
                if (typeRaw === "gnosi-ignore") {
                    let depth = 1;
                    let j = i + 1;
                    while (j < inputLines.length && depth > 0) {
                        const currentTrimmed = inputLines[j].trim();
                        // Suport per a anidament de gnosi-ignore (opcional però recomanat)
                        if (currentTrimmed.match(/^:{3,}gnosi-ignore/)) depth++;
                        else if (currentTrimmed.match(/^:{3,}$/)) depth--;
                        j++;
                    }
                    i = j;
                    continue;
                }

                let type = typeRaw === "column-list" ? "columnList" : typeRaw;
                if (typeRaw === "toggle-heading") type = "heading";

                let innerLines = [];
                let depth = 1;
                let j = i + 1;
                
                while (j < inputLines.length && depth > 0) {
                    const currentTrimmed = inputLines[j].trim();
                    if (currentTrimmed.match(/^:{3,}(column-list|column|toggle-heading|toggle)\b/)) depth++;
                    else if (currentTrimmed.match(/^:{3,}$/)) depth--;
                    
                    if (depth > 0) innerLines.push(inputLines[j]);
                    j++;
                }

                // Dedenta el contingut intern abans de parsejar-lo: el
                // serialitzador indenta els fills de :::column/:::column-list/
                // :::toggle. Sense dedentar, una LLISTA indentada (4 espais) es
                // parseja com a BLOC DE CODI (regla de CommonMark) i es veu com
                // una caixa fosca. Treiem la indentació COMUNA (preserva el niat
                // relatiu intern, p. ex. sub-llistes).
                const _nonEmpty = innerLines.filter(l => l.trim().length > 0);
                const _minIndent = _nonEmpty.length
                    ? Math.min(..._nonEmpty.map(l => (l.match(/^ */)[0] || "").length))
                    : 0;
                const _innerDedented = _minIndent > 0
                    ? innerLines.map(l => l.slice(_minIndent))
                    : innerLines;

                const block = {
                    type,
                    props: { backgroundColor: "default" },
                    children: await parseRecursive(_innerDedented)
                };

                // Per al tipus "column", cal afegir l'amplada segons l'esquema de @blocknote/xl-multi-column
                if (type === "column") {
                    const widthMatch = label.match(/\{width=([0-9.]+)\}/);
                    block.props.width = widthMatch ? parseFloat(widthMatch[1]) : 1;
                    // BlockNote rebutja una columna sense fills ("Invalid content
                    // for node column: <>") i això fa petar el render de TOTA la
                    // pàgina. Una columna buida apareix quan el seu únic fill era
                    // un paràgraf buit (que es serialitza a no-res i no torna a
                    // parsejar com a bloc). Hi posem un paràgraf buit de reserva.
                    if (!block.children || block.children.length === 0) {
                        block.children = [{ type: "paragraph", props: { backgroundColor: "default", textColor: "default", textAlignment: "left" }, content: [] }];
                    }
                }

                // Per als toggles, el contingut és un array d'inlineContent
                if (type === "toggle") {
                    // Netegem possibles atributs del label si fos necessari
                    const cleanLabel = label.replace(/\{.*\}/, "").trim();
                    block.content = [{ type: "text", text: (cleanLabel || "Toggle"), styles: {} }];
                    block.props.textColor = "default";
                }

                // Encapçalament desplegable: recuperem nivell + isToggleable i el
                // títol (label sense l'atribut {level=N}).
                if (typeRaw === "toggle-heading") {
                    const levelMatch = label.match(/\{level=([0-9]+)\}/);
                    block.props.level = levelMatch ? parseInt(levelMatch[1], 10) : 1;
                    block.props.isToggleable = true;
                    block.props.textColor = "default";
                    const cleanLabel = label.replace(/\{[^}]*\}/, "").trim();
                    block.content = cleanLabel ? [{ type: "text", text: cleanLabel, styles: {} }] : [];
                }

                // El contenidor de columnes (germà del guard de columna buida de
                // dalt). BlockNote EXIGEIX que un columnList tingui ≥2 fills i que
                // TOTS siguin "column"; si no, llança "Invalid content for node
                // columnList" i fa petar el render de TOTA la pàgina. Amb markdown
                // extern / generat per IA / editat a mà pot arribar un :::column-list
                // buit, amb una sola columna o amb contingut solt (no encolumnat).
                // Ho normalitzem perquè el contingut no es perdi ni peti la nota.
                if (type === "columnList") {
                    // Tot fill que no sigui columna (text solt dins :::column-list)
                    // l'embolcallem en una columna pròpia per no perdre'l.
                    const columns = (block.children || []).map(child =>
                        child.type === "column"
                            ? child
                            : { type: "column", props: { backgroundColor: "default", width: 1 }, children: [child] }
                    );
                    if (columns.length >= 2) {
                        block.children = columns;
                    } else {
                        // <2 columnes no és un layout vàlid: desempaquetem el
                        // contingut al nivell actual en lloc de fer petar la pàgina.
                        const promoted = columns.flatMap(col => col.children || []);
                        if (promoted.length > 0) blocks.push(...promoted);
                        i = j;
                        continue;
                    }
                }

                blocks.push(block);
                i = j;
                continue;
            }

            // Obsidian Callout check
            if (trimmed.startsWith("> [!")) {
                const match = trimmed.match(/^> \[!([^\]]+)\]/);
                if (match) {
                    const calloutType = match[1].toLowerCase();
                    let calloutLines = [];
                    // Skip the header line for content parsing if it has no extra text
                    const firstLineContent = trimmed.slice(match[0].length).trim();
                    if (firstLineContent) calloutLines.push(firstLineContent);
                    
                    i++;
                    while (i < inputLines.length && inputLines[i].trim().startsWith(">")) {
                        calloutLines.push(inputLines[i].trim().slice(1).trim());
                        i++;
                    }
                    
                    blocks.push({
                        id: Math.random().toString(36).substring(7),
                        type: "alert",
                        props: { type: calloutType },
                        content: [{ type: "text", text: calloutLines.join("\n"), styles: {} }]
                    });
                    continue;
                }
            }

            // GFM Table check
            if (trimmed.startsWith("|") && i + 1 < inputLines.length && inputLines[i+1].trim().match(/^\|?\s*[:\- ]+\s*(\|?\s*[:\- ]+\s*)*\|?$/)) {
                let tableLines = [];
                while (i < inputLines.length && inputLines[i].trim().startsWith("|")) {
                    tableLines.push(inputLines[i].trim());
                    i++;
                }

                const tableRows = tableLines
                    .filter(line => !line.match(/^\|?\s*[:\- ]+\s*(\|?\s*[:\- ]+\s*)*\|?$/)) // filter separator
                    .map(line => {
                        const cells = line.split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
                        return {
                            cells: cells.map(cell => [{ type: "text", text: cell.trim(), styles: {} }])
                        };
                    });

                blocks.push({
                    id: Math.random().toString(36).substring(7),
                    type: "table",
                    content: {
                        type: "tableContent",
                        rows: tableRows
                    }
                });
                continue;
            }

            // Normal text block
            let textBuffer = [];
            while (i < inputLines.length) {
                const nextTrimmed = inputLines[i].trim();
                if (nextTrimmed.match(/^:{3,}(column-list|column|toggle-heading|toggle)\b/)) break;
                textBuffer.push(inputLines[i]);
                i++;
            }

            if (textBuffer.length > 0) {
                let plainBuffer = [];

                const flushPlain = async () => {
                    const text = plainBuffer.join("\n").trim();
                    plainBuffer = [];
                    if (!text) return;
                    const parsed = await parsePlainMarkdownBlock(text, editor);
                    blocks.push(...parsed);
                };

                for (const rawLine of textBuffer) {
                    const trimmedLine = rawLine.trim();
                    const transclusionMatch = trimmedLine.match(/^!\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]$/);
                    if (transclusionMatch) {
                        await flushPlain();
                        blocks.push({
                            type: "transclusion",
                            props: {
                                target: String(transclusionMatch[1] || "").trim(),
                                section: String(transclusionMatch[2] || "").trim(),
                                alias: String(transclusionMatch[3] || "").trim(),
                            },
                        });
                    } else {
                        plainBuffer.push(rawLine);
                    }
                }

                await flushPlain();
            }
        }
        return blocks;
    };

    const parsed = await parseRecursive(lines);
    return promoteCustomFences(promoteBibliographyBlocks(promoteEmbedBlocks(parsed)));
};
