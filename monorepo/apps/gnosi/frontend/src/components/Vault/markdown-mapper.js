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
    const result = parts.join("\n\n").trim();

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
        let res = `:::toggle ${inlineContentToMarkdown(block.content)}\n`;
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
            content = `- ${inlineContentToMarkdown(block.content)}`;
            break;
        case "numberedListItem":
            content = `1. ${inlineContentToMarkdown(block.content)}`;
            break;
        case "checkListItem": {
            const checked = block.props.checked ? "[x]" : "[ ]";
            content = `- ${checked} ${inlineContentToMarkdown(block.content)}`;
            break;
        }
        case "codeBlock":
            content = `\`\`\`${block.props.language || ""}\n${inlineContentToMarkdown(block.content)}\n\`\`\``;
            break;
        case "horizontalRule":
            content = `---`;
            break;
        case "image":
        case "video":
        case "audio":
        case "file": {
            const url = block.props.url || block.props.src || "";
            const caption = block.props.caption ? `|${block.props.caption}` : "";
            content = block.type === "image" ? `![${caption}](${url})` : `[${block.type}: ${url}](${url})`;
            break;
        }
        case "alert": // BlockNote calls callouts 'alert'
            const alertType = block.props?.type || "info";
            const alertContent = inlineContentToMarkdown(block.content);
            return `> [!${alertType}]\n> ${alertContent.replace(/\n/g, "\n> ")}`;
        case "table":
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
                    return inlineContentToMarkdown(cellContent).replace(/\|/g, "\\|");
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
        case "paragraph":
        default:
            content = inlineContentToMarkdown(block.content);
            break;
    }

    // Color/Background
    if (block.props && (block.props.textColor !== "default" || block.props.backgroundColor !== "default")) {
        let style = "";
        if (block.props.textColor !== "default") style += `color: ${block.props.textColor};`;
        if (block.props.backgroundColor !== "default") style += `background-color: ${block.props.backgroundColor};`;
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

const processBlocksForWikilinks = (blocks) => {
    if (!blocks || !Array.isArray(blocks)) return blocks;
    return blocks.map(block => {
        const newBlock = { ...block };
        if (newBlock.content) {
            newBlock.content = convertToWikilinks(newBlock.content);
        }
        if (newBlock.children) {
            newBlock.children = processBlocksForWikilinks(newBlock.children);
        }
        return newBlock;
    });
};

/**
 * Converteix contingut inline
 */
const inlineContentToMarkdown = (content) => {
    if (!content) return "";
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";

    return content.map(item => {
        if (!item || typeof item !== "object") return "";
        if (item.type === "text") {
            // Defensiva: si item.text no és string, NO el toString-egem
            // (tornaria "[object Object]" i sobreescriuria la nota al disc).
            if (typeof item.text !== "string") {
                console.warn("inlineContentToMarkdown: item.text no és string", item);
                return "";
            }
            let text = item.text;

            // Handle soft line breaks inside text nodes. Standard Markdown requires two spaces or <br>.
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
            return `[${innerText}](${safeHref})`;
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
    let protectedText = text
        .replace(/\]\(file:\/\//g, `](${FILE_PROTOCOL_SENTINEL}`)
        .replace(
            new RegExp(`\\]\\(${escapeRe(LEGACY_FILE_PROTOCOL_SENTINEL)}`, 'g'),
            `](${FILE_PROTOCOL_SENTINEL}`,
        )
        .replace(
            new RegExp(`\\]\\(${escapeRe(CORRUPTED_FILE_PROTOCOL_SENTINEL)}`, 'g'),
            `](${FILE_PROTOCOL_SENTINEL}`,
        );

    // Codifica espais (i altres caràcters problemàtics) dins de URLs en
    // markdown links `[text](url)`. Markdown-it només accepta URLs amb espais
    // si estan envoltades de `<...>`; sense això, `[Doc](https://host/Pla de
    // futur/Finances/foo.docx)` es renderitza com a text literal en lloc de
    // link clicable. Codifiquem només dins el grup `(...)` per no afectar la
    // resta del text. També tractem `\` (escape paths Unix) i altres ASCII
    // control chars que markdown-it rebutja.
    protectedText = protectedText.replace(
        /\]\(([^)]*)\)/g,
        (m, url) => {
            // Si la URL ja està entre angle brackets, no la tornem a codificar
            if (url.startsWith('<') && url.endsWith('>')) return m;
            // Codifiquem espais com a %20. Mantenim els altres caràcters per
            // no trencar paths que ja són percent-encoded.
            const safe = url.replace(/ /g, '%20').replace(/\\/g, '/');
            return `](${safe})`;
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

    return processBlocksForWikilinks(blocks);
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
            const startMatch = trimmed.match(/^(:{3,})(column-list|column|toggle|gnosi-ignore)(.*)$/);
            
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

                const type = typeRaw === "column-list" ? "columnList" : typeRaw;

                let innerLines = [];
                let depth = 1;
                let j = i + 1;
                
                while (j < inputLines.length && depth > 0) {
                    const currentTrimmed = inputLines[j].trim();
                    if (currentTrimmed.match(/^:{3,}(column-list|column|toggle)$/)) depth++;
                    else if (currentTrimmed.match(/^:{3,}$/)) depth--;
                    
                    if (depth > 0) innerLines.push(inputLines[j]);
                    j++;
                }

                const block = {
                    type,
                    props: { backgroundColor: "default" },
                    children: await parseRecursive(innerLines)
                };

                // Per al tipus "column", cal afegir l'amplada segons l'esquema de @blocknote/xl-multi-column
                if (type === "column") {
                    const widthMatch = label.match(/\{width=([0-9.]+)\}/);
                    block.props.width = widthMatch ? parseFloat(widthMatch[1]) : 1;
                }

                // Per als toggles, el contingut és un array d'inlineContent
                if (type === "toggle") {
                    // Netegem possibles atributs del label si fos necessari
                    const cleanLabel = label.replace(/\{.*\}/, "").trim();
                    block.content = [{ type: "text", text: (cleanLabel || "Toggle"), styles: {} }];
                    block.props.textColor = "default";
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
                if (nextTrimmed.match(/^:{3,}(column-list|column|toggle)$/)) break;
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

    return await parseRecursive(lines);
};
