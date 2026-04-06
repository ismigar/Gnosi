/**
 * markdown-mapper.js
 * Utilitat per a la conversió bi-direccional entre BlockNote JSON i Markdown Enriquit.
 */

/**
 * Converteix una llista de blocs de BlockNote a Markdown enriquit.
 */
export const blocksToRichMarkdown = (blocks, editor) => {
    if (!blocks || !Array.isArray(blocks)) return "";

    let markdown = "";
    blocks.forEach((block) => {
        markdown += blockToMarkdown(block, editor, 0);
    });

    return (markdown || "").trim();
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
            // Regex for [[Title]] or [[Title#Section]] or [[Title|Alias]]
            const regex = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
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
        if (item.type === "text") {
            let text = item.text;
            
            // Handle soft line breaks inside text nodes. Standard Markdown requires two spaces or <br>.
            if (text.includes('\n')) {
                text = text.replace(/\n/g, '<br>\n');
            }
            
            if (item.styles) {
                if (item.styles.bold) text = `**${text}**`;
                if (item.styles.italic) text = `*${text}*`;
                if (item.styles.underline) text = `<u>${text}</u>`;
                if (item.styles.strike) text = `~~${text}~~`;
                if (item.styles.code) text = `\`${text}\``;
            }
            return text;
        }
        if (item.type === "link") return `[${inlineContentToMarkdown(item.content)}](${item.href})`;
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

const parsePlainMarkdownBlock = async (text, editor) => {
    if (!text) return [];
    let blocks = [];
    if (editor?.tryParseMarkdownToBlocks) {
        try {
            blocks = await editor.tryParseMarkdownToBlocks(text);
        } catch (e) {
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
