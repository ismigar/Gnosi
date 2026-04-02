/**
 * markdown-mapper.js
 * Utilitat per a la conversió bi-direccional entre BlockNote JSON i Markdown Enriquit.
 * 
 * Dissenyat per a:
 * 1. Portabilitat (Obsidian compatible)
 * 2. Llegibilitat per LLMs
 * 3. Fidelitat visual (Notion-like)
 */

/**
 * Converteix una llista de blocs de BlockNote a Markdown enriquit.
 * @param {Array} blocks - Llista de blocs de BlockNote
 * @param {Object} editor - Instància de l'editor (opcional, per a mètodes auxiliars)
 * @returns {string} - Markdown resultant
 */
export const blocksToRichMarkdown = (blocks, editor) => {
    if (!blocks || !Array.isArray(blocks)) return "";

    let markdown = "";

    blocks.forEach((block) => {
        markdown += blockToMarkdown(block, editor, 0) + "\n";
    });

    return markdown.trim();
};

/**
 * Converteix un bloc individual a Markdown recursivament.
 */
const blockToMarkdown = (block, editor, indentLevel = 0) => {
    const indent = "  ".repeat(indentLevel);
    let content = "";

    // Gestió de tipus especials de Gnosi (Directives)
    if (block.type === "columnList") {
        let res = `:::column-list\n`;
        if (block.children) {
            block.children.forEach(col => {
                res += blockToMarkdown(col, editor, indentLevel + 1);
            });
        }
        res += `:::`;
        return res;
    }

    if (block.type === "column") {
        let res = `:::column\n`;
        if (block.children) {
            block.children.forEach(child => {
                res += blockToMarkdown(child, editor, indentLevel + 1);
            });
        }
        res += `:::`;
        return res;
    }

    if (block.type === "toggle") {
        let res = `:::toggle ${inlineContentToMarkdown(block.content)}\n`;
        if (block.children) {
            block.children.forEach(child => {
                res += blockToMarkdown(child, editor, indentLevel + 1);
            });
        }
        res += `:::`;
        return res;
    }

    if (block.type === "database") {
        return `\`\`\`gnosi-database\n${JSON.stringify(block.props, null, 2)}\n\`\`\``;
    }

    // Tipus estàndard de BlockNote
    switch (block.type) {
        case "heading":
            const level = "#".repeat(block.props.level || 1);
            content = `${level} ${inlineContentToMarkdown(block.content)}`;
            break;
        case "bulletListItem":
            content = `- ${inlineContentToMarkdown(block.content)}`;
            break;
        case "numberedListItem":
            content = `1. ${inlineContentToMarkdown(block.content)}`; // BlockNote auto-numera
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

    // Gestionar color de text/background (Només si no és default)
    if (block.props && (block.props.textColor !== "default" || block.props.backgroundColor !== "default")) {
        let style = "";
        if (block.props.textColor !== "default") style += `color: ${block.props.textColor};`;
        if (block.props.backgroundColor !== "default") style += `background-color: ${block.props.backgroundColor};`;
        content = `<div style="${style}">${content}</div>`;
    }

    // Gestionar fills recursivament (si no són columnes que ja hem gestionat)
    if (block.children && block.children.length > 0 && !["columnList", "column", "toggle"].includes(block.type)) {
        block.children.forEach(child => {
            content += "\n" + blockToMarkdown(child, editor, indentLevel + 1);
        });
    }

    return indent + content;
};

/**
 * Converteix contingut inline (text amb estils) a Markdown amb HTML per a colors.
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
                
                // Color inline (Obsidian compatible)
                if (item.styles.textColor && item.styles.textColor !== "default") {
                    text = `<span style="color:${item.styles.textColor}">${text}</span>`;
                }
                if (item.styles.backgroundColor && item.styles.backgroundColor !== "default") {
                    text = `<span style="background-color:${item.styles.backgroundColor}">${text}</span>`;
                }
            }
            return text;
        }
        if (item.type === "link") {
            return `[${inlineContentToMarkdown(item.content)}](${item.href})`;
        }
        return "";
    }).join("");
};

/**
 * Converteix Markdown enriquit de tornada a blocs de BlockNote.
 * @param {string} markdown - Contingut del fitxer .md
 * @param {Object} editor - Instància de l'editor per fer el parsing inicial
 * @returns {Array|null} - Llista de blocs o null si és JSONLegacy
 */
export const richMarkdownToBlocks = async (markdown, editor) => {
    if (!markdown) return [];

    // Si detectem que és un JSON stringificat (per retrocompatibilitat)
    if (markdown.trim().startsWith("[") && markdown.trim().endsWith("]")) {
        try {
            return JSON.parse(markdown);
        } catch (e) {
            console.error("MarkdownMapper: Error parsing legacy JSON content", e);
        }
    }

    // Utilitzem el parser natiu de BlockNote per al Markdown estàndard
    // Nota: El parser natiu no entén les directives :::, així que les hem de pre-processar 
    // o utilitzar una estratègia de parsing manual per a les branques estructurals.
    
    // Per simplicitat en aquesta iteració, farem un parsing "lossy" però funcional
    // de l'estructura de blocs natius de BlockNote si és possible.
    if (editor && editor.tryParseMarkdownToBlocks) {
        try {
            return await editor.tryParseMarkdownToBlocks(markdown);
        } catch (e) {
            console.warn("MarkdownMapper: Native parser failed, falling back to manual line-by-line", e);
        }
    }

    // Implementació de fallback senzilla (per a Markdown que ja és net)
    return [{ type: "paragraph", content: markdown }];
};
