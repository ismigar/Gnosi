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

    return markdown.trim();
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
        case "heading":
            const level = "#".repeat(block.props.level || 1);
            content = `${level} ${inlineContentToMarkdown(block.content)}`;
            break;
        case "bulletListItem":
            content = `- ${inlineContentToMarkdown(block.content)}`;
            break;
        case "numberedListItem":
            content = `1. ${inlineContentToMarkdown(block.content)}`;
            break;
        case "checkListItem":
            const checked = block.props.checked ? "[x]" : "[ ]";
            content = `- ${checked} ${inlineContentToMarkdown(block.content)}`;
            break;
        case "codeBlock":
            content = `\`\`\`${block.props.language || ""}\n${inlineContentToMarkdown(block.content)}\n\`\`\``;
            break;
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
            content += "\n" + blockToMarkdown(child, editor, indentLevel + 1);
        });
    }

    return indent + content + "\n";
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
        return "";
    }).join("");
};

const parsePlainMarkdownBlock = async (text, editor) => {
    if (!text) return [];
    if (editor?.tryParseMarkdownToBlocks) {
        try {
            return await editor.tryParseMarkdownToBlocks(text);
        } catch (e) {
            return [{ type: "paragraph", content: text }];
        }
    }
    return [{ type: "paragraph", content: text }];
};

/**
 * Converteix Markdown enriquit a blocs.
 */
export const richMarkdownToBlocks = async (markdown, editor) => {
    if (!markdown) return [];
    if (markdown.trim().startsWith("[") && markdown.trim().endsWith("]")) {
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
