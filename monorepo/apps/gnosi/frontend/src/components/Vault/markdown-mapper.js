/**
 * markdown-mapper.js
 * Utility for the bidirectional conversion between BlockNote JSON and Enriched Markdown.
 */

import { normalizeManagedBlockSpacing } from './managedMarkdownUtils';

// Sentinel for file:// links inside the editor.
//
// BlockNote/Tiptap (extension-link) blanks out any href whose protocol
// which is not in its allowlist (http/https/ftp/mailto/tel/...). `file:` is not
// there, so an anchor with href="file:///..." gets rendered as
// <a href=""> and, when clicked, window.open("") opens a new tab at the origin
// of Gnosi. To avoid this, the internal href of file links is kept as
// "https://gnosi-file-protocol.local/..." (passes Tiptap's validation
// because it's https) and is converted back to "file://" only (a) when it's
// serialized to markdown to save to disk, and (b) when the
// click interceptor calls the backend to open the path with the system shell.
// Sentinel with no trailing slash so the conversion is a direct swap of the
// prefix: "file://" (7 chars) ↔ "https://gnosi-file-protocol.local" (33 chars).
// This way we keep the leading slash of the local path in both directions.
//
// IMPORTANT: the sentinel must NOT contain "__" because the markdown parser
// BlockNote (markdown-it) interprets `__...__` as bold and breaks the URL
// inside `](...)`. That's why we use regular hyphens and a reserved ".local" TLD.
export const FILE_PROTOCOL_SENTINEL = "https://gnosi-file-protocol.local";
// Legacy sentinel (earlier versions). We keep recognizing it for
// compatibility with notes already saved in the editor before the change.
const LEGACY_FILE_PROTOCOL_SENTINEL = "https://__gnosi_file_protocol__";
// Corrupted variant: if a legacy note went through a re-serializer
// that applied emphasis (markdown-it interprets `__...__` as strong) and
// wrote the result to disk literally, it stays as `**gnosi_file_protocol**`.
// We detect it to recover links already damaged in the markdown.
const CORRUPTED_FILE_PROTOCOL_SENTINEL = "https://**gnosi_file_protocol**";

/**
 * Sentinel → file:// (for serialization to markdown or for the backend).
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
 * file:// → sentinel (for insertion into the editor).
 */
export const fileUrlToSentinel = (href) => {
    if (typeof href !== "string") return href;
    if (/^file:\/\//i.test(href)) {
        return FILE_PROTOCOL_SENTINEL + href.slice(7);
    }
    return href;
};

// --- Footnote serialization state ---
// Inline footnotes (`[^N]`) are numbered sequentially according to the order of the
// document and accumulate their definitions (`[^N]: text`) to append them at the
// end of the Markdown. Since `blocksToRichMarkdown` serializes the blocks (and
// their children) IN ORDER, a module-level state counter is enough, which
// resets on every full serialization.
let _footnoteDefs = [];
let _footnoteOrder = new Map(); // footnote id → assigned number

/**
 * Converts a list of BlockNote blocks into rich Markdown.
 */
export const blocksToRichMarkdown = (blocks, editor) => {
    if (!blocks || !Array.isArray(blocks)) return "";

    // Resets the footnote state for this serialization.
    _footnoteDefs = [];
    _footnoteOrder = new Map();

    // We separate top-level blocks with a blank line (\n\n).
    // Without this, two consecutive paragraphs would be "Line1\nLine2" and the
    // BlockNote's parser (tryParseMarkdownToBlocks) interprets them as a single
    // paragraph with a soft-break, losing the breaks on re-parse.
    const parts = blocks.map(
        (block) => blockToMarkdown(block, editor, 0).replace(/\n+$/, "")
    );
    // CONSECUTIVE list items of the same type are joined with a single
    // line break (a "tight" list); the rest of the blocks with a blank line (\n\n)
    // so that BlockNote's re-parse doesn't merge consecutive paragraphs. Without
    // this, each list item used to end up separated by a blank line in the .md →
    // "loose" lists with extra spacing (and ugliness in viewers like Obsidian).
    const LIST_ITEM_TYPES = new Set(["bulletListItem", "numberedListItem", "checkListItem"]);
    let result = "";
    blocks.forEach((block, i) => {
        if (i === 0) { result = parts[i]; return; }
        const tight = LIST_ITEM_TYPES.has(block.type) && block.type === blocks[i - 1].type;
        result += (tight ? "\n" : "\n\n") + parts[i];
    });
    result = result.trim();

    // Defensive sentinel: if we find "[object Object]" in the result,
    // some part of the converter received a malformed value. We throw an error
    // instead of writing garbage to disk (and we avoid losing the note).
    if (result.includes("[object Object]")) {
        throw new Error(
            "blocksToRichMarkdown: detected '[object Object]' in the result — " +
            "the editor content has an unexpected format. Save aborted to avoid " +
            "overwriting the note."
        );
    }

    // Appends the footnote definitions at the end of the document
    // (`[^1]: text`), collected during block serialization.
    if (_footnoteDefs.length > 0) {
        result = (result ? result + "\n\n" : "") + _footnoteDefs.join("\n");
    }
    return result;
};

/**
 * Converts a single block to Markdown recursively.
 * STRATEGY: Each top-level block ensures it has its own \n.
 */
const blockToMarkdown = (block, editor, indentLevel = 0) => {
    const indent = "  ".repeat(indentLevel);
    let content = "";

    // Structural Directives (Gnosi)
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

    // Serializes a toggle to a `:::toggle` fence, with the children indented
    // inside. The fence maps to BlockNote's built-in `toggleListItem` on
    // re-reading (see promoteCustomFences). Both `toggle` (legacy, removed) and
    // `toggleListItem` are accepted here so any in-memory block keeps round-
    // tripping; on disk it's always the same `:::toggle` fence.
    if (block.type === "toggle" || block.type === "toggleListItem") {
        // The toggle label is recovered with a raw slice from the parser (not markdown-it):
        // escaping it would leave literal backslashes → escape:false.
        let res = `:::toggle ${inlineContentToMarkdown(block.content, { escape: false })}\n`;
        if (block.children) {
            block.children.forEach(child => {
                res += blockToMarkdown(child, editor, indentLevel + 1);
            });
        }
        res += `:::\n`;
        return res;
    }

    // Collapsible heading (heading + isToggleable, created with /tur). The
    // Markdown's `#` cannot encode either `isToggleable` or the nesting of the
    // children, so we serialize it as its own fence that wraps the
    // children (mirroring :::toggle), preserving the level in {level=N}.
    if (block.type === "heading" && block.props?.isToggleable) {
        const lvl = Number(block.props.level) || 1;
        // Label recovered with a raw slice from the directive parser (not markdown-it).
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
        // `heading`/`heading_level` are optional and have no UI to set them:
        // they are only included if there is an actual title, so as not to clutter the definition
        // with a meaningless `"heading":""`. Users put a `#` of
        // regular (portable) markdown on top of the block. When reading, promoteCustomFences
        // already defaults them ('' and 1) when they aren't present.
        const h = String(block.props?.heading || '').trim();
        const payload = { view_id: String(block.props?.view_id || '') };
        if (h) {
            payload.heading = h;
            payload.heading_level = Number(block.props?.heading_level) || 1;
        }
        return `\`\`\`gnosi-view\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
    }

    if (block.type === "bibliography") {
        // Serializes the bibliography block as `{{bibliography}}` (style
        // and default locale) or `{{bibliography:apa}}` / `{{bibliography:
        // apa:ca-AD}}` if the user has overridden the defaults.
        const style = String(block?.props?.style || '').trim();
        const locale = String(block?.props?.locale || '').trim();
        if (!style || (style === 'apa' && (!locale || locale === 'en-US'))) {
            return '{{bibliography}}\n';
        }
        if (!locale || locale === 'en-US') return `{{bibliography:${style}}}\n`;
        return `{{bibliography:${style}:${locale}}}\n`;
    }

    if (block.type === "mermaid") {
        // Mermaid diagram → ```mermaid fence (portable to Obsidian/GitHub).
        const code = String(block?.props?.code || "").replace(/\n+$/, "");
        return "```mermaid\n" + code + "\n```\n";
    }

    if (block.type === "tableOfContents") {
        // Table of contents → `{{toc}}` marker (mirror of `{{bibliography}}`).
        return "{{toc}}\n";
    }

    if (block.type === "linkcard") {
        // Link card → `[bookmark: URL](URL)` (symmetric to the embed).
        const u = String(block?.props?.url || "").trim();
        return u ? `[bookmark: ${u}](${u})\n` : "";
    }

    if (block.type === "synced") {
        // Synced block → ```gnosi-synced fence with the sync_id.
        const sid = String(block?.props?.sync_id || "").trim();
        if (!sid) return "";
        return "```gnosi-synced\n" + JSON.stringify({ sync_id: sid }) + "\n```\n";
    }

    if (block.type === "transclusion") {
        const target = String(block?.props?.target || "").trim();
        const alias = String(block?.props?.alias || "").trim();
        const section = String(block?.props?.section || "").trim();
        if (!target) return "";

        const targetWithSection = section ? `${target}#${section}` : target;
        return alias ? `![[${targetWithSection}|${alias}]]\n` : `![[${targetWithSection}]]\n`;
    }

    // Standard type
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
            // VERBATIM text: `codeBlockText` joins the .text values without going through
            // `inlineContentToMarkdown` (which would escape `a ** b`/`arr[0]` AND
            // converts soft line breaks into `<br>\n` — correct for
            // paragraphs, NOT for code). With the inline serializer, a
            // multiline code block injected a `<br>` at every `\n` and, since on
            // reload it stayed literal inside the code, one more `<br>` ACCUMULATED
            // on every save/reload cycle. `codeBlockText` is RAW and has no `<br>`.
            content = `\`\`\`${block.props.language || ""}\n${codeBlockText(block)}\n\`\`\``;
            break;
        case "horizontalRule": // legacy name of the horizontal line block
        case "divider":        // current name in BlockNote (defaultBlockSpecs.divider)
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
            // The callout body is re-read raw (its own `> [!type]` parser), not via
            // markdown-it, so it is NOT escaped (it is already round-trip safe by design).
            const alertContent = inlineContentToMarkdown(block.content, { escape: false });
            return `> [!${alertType}]\n> ${alertContent.replace(/\n/g, "\n> ")}`;
        }
        case "quote": {
            // Block quote → Markdown blockquote (`> …`). BlockNote supports the
            // series `quote` block; without this case it fell through to `default` and was
            // saved as a PLAIN paragraph, losing the quote formatting on every save.
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
                    // Cells are re-read raw (own GFM parser that splits on `|`),
                    // not via markdown-it → the text is NOT escaped (only the literal `|`).
                    // Also, a GFM row must be a SINGLE line: `inlineContentToMarkdown`
                    // renders in-cell breaks as `<br>` (GFM form for a break inside a
                    // cell). Any stray literal `\n` (legacy content, block joins) would
                    // split the row in two and corrupt the ENTIRE table on re-parse, so
                    // we collapse it to a space. The `<br>\n` cleanup stays as a
                    // defensive no-op for markdown produced by older serializers.
                    return inlineContentToMarkdown(cellContent, { escape: false })
                        .replace(/\|/g, "\\|")
                        .replace(/<br>\n/g, "<br>")
                        .replace(/\n/g, " ");
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
            // We exclude `[` from the capture groups: otherwise, an unclosed `[[` followed
            // by a well-formed wikilink later on the same line consumes
            // all the text in between as the target. E.g.: `[[port. ... [[id|Alias]]`
            // must match only the inner wikilink; the `[[port. ` is left as
            // text. Without this exclusion, the resulting wikilink's target
            // contained 400+ chars with `[[` inside, and BlockNote would freeze
            // serializing/rendering it.
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

// Applies `convertToWikilinks` to every cell of a native
// BlockNote table. A table's content is not an inline array but a
// `tableContent` object with `rows[].cells[]`, where each cell can be directly
// the inline array (native format) or an object `{ content: [...] }`.
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
            // Native tables carry their content in `content.rows[].cells`;
            // `convertToWikilinks` only knows how to handle inline arrays, so
            // without this case the `[[…]]` inside cells were left raw.
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

// --- Pandoc-style citations: `[@key]` or `[@key1; @key2]` ---
// Detects each `@<citationkey>` token inside `[ ]` and converts it into
// inline content of type `cite`. Accepted syntax (Pandoc subset):
//   [@smith2020]                      → 1 cite
//   [@smith2020; @jones2019]          → 2 cites
//   @smith2020                        → 1 cite "naked" (no brackets)
// My regex is intentionally restrictive to avoid false positives:
// the key must start with a lowercase ASCII letter + allows [a-z0-9_:-]. If you want
// keys with capitals or accents in your Citation Key, expand the charset.
const CITATION_KEY_RE = /[a-z][a-z0-9_:-]*/i;
const CITATION_BRACKET_RE = /\[@([a-z][a-z0-9_:-]*(?:\s*;\s*@[a-z][a-z0-9_:-]*)*)\]/gi;
const CITATION_NAKED_RE = /(^|[\s(])@([a-z][a-z0-9_:-]*)\b/g;

const convertToCitations = (content) => {
    if (!Array.isArray(content)) return content;
    const next = [];
    content.forEach(item => {
        // Only text nodes are processed. Already-converted wikilinks do not
        // need to be touched; the other types are passed through as-is.
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
        // Strategy: two passes. First we find all the tokens
        // (bracketed or naked) with their position, then we split the text
        // and interleave the `cite` nodes. This way we avoid global regexes
        // competing for the same position.
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
            // The offset is that of the key, not the prefix (capture group 2)
            const keyStart = m.index + (m[1]?.length || 0);
            const key = m[2];
            // Avoid overlap with bracketed tokens already captured.
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

// --- Person mentions (`@[Name|id]`) and dates (`@2026-06-25[T09:00]`) ---
// Safe tokens: `@[` doesn't collide with citations (`@key` requires a letter) nor with
// wikilinks; `@digit` isn't a citation either. They are processed AFTER citations/wikilinks.
const MENTION_RE = /@\[([^\]|]*)\|([^\]]*)\]/g;
const DATEREF_RE = /@(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/g;

const convertTextTokens = (content, regex, build) => {
    if (!Array.isArray(content)) return content;
    const next = [];
    content.forEach(item => {
        if (item?.type === 'link' && Array.isArray(item.content)) {
            next.push({ ...item, content: convertTextTokens(item.content, regex, build) });
            return;
        }
        if (item?.type !== 'text' || typeof item.text !== 'string') { next.push(item); return; }
        const text = item.text;
        let lastIndex = 0;
        let match;
        regex.lastIndex = 0;
        let found = false;
        while ((match = regex.exec(text)) !== null) {
            found = true;
            if (match.index > lastIndex) next.push({ ...item, text: text.slice(lastIndex, match.index) });
            next.push(build(match));
            lastIndex = match.index + match[0].length;
        }
        if (!found) { next.push(item); return; }
        if (lastIndex < text.length) next.push({ ...item, text: text.slice(lastIndex) });
    });
    return next;
};

const convertToMentions = (content) => convertTextTokens(content, MENTION_RE, (m) => ({
    type: 'mention', props: { name: String(m[1] || '').trim(), id: String(m[2] || '').trim() },
}));
const convertToDates = (content) => convertTextTokens(content, DATEREF_RE, (m) => ({
    type: 'dateref', props: { date: String(m[1] || ''), time: String(m[2] || '') },
}));

const makeBlockProcessor = (convert) => {
    const proc = (blocks) => {
        if (!blocks || !Array.isArray(blocks)) return blocks;
        return blocks.map(block => {
            const nb = { ...block };
            if (nb.content) nb.content = convert(nb.content);
            if (nb.children) nb.children = proc(nb.children);
            return nb;
        });
    };
    return proc;
};
const processBlocksForMentions = makeBlockProcessor(convertToMentions);
const processBlocksForDates = makeBlockProcessor(convertToDates);

const codeBlockText = (block) => {
    if (!block?.content) return '';
    if (typeof block.content === 'string') return block.content;
    if (!Array.isArray(block.content)) return '';
    return block.content
        .map(it => (it && typeof it === 'object' && typeof it.text === 'string') ? it.text : '')
        .join('');
};

// Converts paragraphs that contain only an `[embed: URL](URL)` link into
// native `embed` blocks. The syntax is symmetric to `[file: URL](URL)`
// but here we want a dedicated block so it renders as an iframe/viewer
// instead of a plain link. BlockNote doesn't recognize the syntax by default; that's
// why we do this post-processing after the parser.
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

// Converts paragraphs that contain only `[bookmark: URL](URL)` into
// `linkcard` blocks (preview card). Mirror of `promoteEmbedBlocks`.
const promoteLinkCards = (blocks) => {
    if (!blocks || !Array.isArray(blocks)) return blocks;
    return blocks.map(block => {
        let newBlock = block;
        if (newBlock?.children && Array.isArray(newBlock.children)) {
            newBlock = { ...newBlock, children: promoteLinkCards(newBlock.children) };
        }
        if (newBlock?.type !== 'paragraph') return newBlock;
        const content = Array.isArray(newBlock.content) ? newBlock.content : null;
        if (!content || content.length !== 1) return newBlock;
        const item = content[0];
        if (!item || item.type !== 'link' || !Array.isArray(item.content)) return newBlock;
        const text = item.content.map(c => (c && typeof c.text === 'string' ? c.text : '')).join('');
        const match = text.match(/^bookmark:\s*(.+)$/i);
        if (!match || !item.href) return newBlock;
        return { ...newBlock, type: 'linkcard', props: { url: String(item.href) }, content: undefined };
    });
};

// Restores an image's caption from the `|` sentinel in the alt text.
// The serializer saves `props.caption` into the Markdown alt slot with a
// `|` prefix (`![|caption](url)`). When parsing, BlockNote puts the alt-text in
// `props.name` (NOT in `props.caption`), so without this restoration
// the caption the user writes under an image was LOST on every reload
// (it stayed as `name="|caption"`, invisible, and `caption=""`). We only handle
// `name` values that start with `|` (the sentinel the serializer writes);
// a real `name`/alt never starts with it. `slice(1)` removes ONLY the sentinel,
// so a caption with internal `|` characters (e.g. "before | after") is preserved in full.
const restoreImageCaptions = (blocks) => {
    if (!blocks || !Array.isArray(blocks)) return blocks;
    return blocks.map(block => {
        let newBlock = block;
        if (newBlock?.children && Array.isArray(newBlock.children)) {
            newBlock = { ...newBlock, children: restoreImageCaptions(newBlock.children) };
        }
        if (newBlock?.type === 'image' && typeof newBlock.props?.name === 'string'
            && newBlock.props.name.startsWith('|')) {
            newBlock = {
                ...newBlock,
                props: { ...newBlock.props, caption: newBlock.props.name.slice(1), name: '' },
            };
        }
        return newBlock;
    });
};

// Detects paragraphs that contain only `{{bibliography}}` (optionally
// `{{bibliography:apa}}` or `{{bibliography:chicago-author-date:ca-AD}}`)
// and converts them into a `bibliography` block. Pattern symmetric to
// `promoteEmbedBlocks`. Without this, the literal text would appear in the
// page and the actual block would not render.
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
                locale: m[2] || 'en-US',
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
        if (lang === 'mermaid') {
            // Fence ```mermaid → `mermaid` block (renders the diagram).
            return { type: 'mermaid', props: { code: codeBlockText(block) } };
        }
        if (lang === 'gnosi-synced') {
            // Fence ```gnosi-synced → `synced` block (content from a shared source).
            let sid = '';
            try { sid = String(JSON.parse(codeBlockText(block))?.sync_id || ''); } catch { sid = codeBlockText(block).trim(); }
            return { type: 'synced', props: { sync_id: sid } };
        }
        if (lang !== 'gnosi-view' && lang !== 'gnosi-database') return block;
        let payload = null;
        try { payload = JSON.parse(codeBlockText(block)); } catch { return block; }
        if (!payload || typeof payload !== 'object') return block;
        if (lang === 'gnosi-database') {
            // Mirrors the `gnosi-database` serializer: restores the block
            // `database` (InlineDatabase). Without this, an embedded
            // database was saved as a `gnosi-database` fence but was read back
            // as a CODE block with raw JSON.
            return {
                type: 'database',
                props: {
                    database_table_id: String(payload.database_table_id || ''),
                    viewId: String(payload.viewId || ''),
                    filters: String(payload.filters || ''),
                    sort: String(payload.sort || ''),
                    search: String(payload.search || ''),
                    visibleProperties: String(payload.visibleProperties || ''),
                    viewType: String(payload.viewType || 'table'),
                },
            };
        }
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

// Converts a paragraph that contains only `{{toc}}` into a `tableOfContents` block.
// Pattern symmetric to `promoteBibliographyBlocks`.
const promoteToc = (blocks) => {
    if (!blocks || !Array.isArray(blocks)) return blocks;
    return blocks.map(block => {
        let newBlock = block;
        if (newBlock?.children && Array.isArray(newBlock.children)) {
            newBlock = { ...newBlock, children: promoteToc(newBlock.children) };
        }
        if (newBlock?.type !== 'paragraph') return newBlock;
        const content = Array.isArray(newBlock.content) ? newBlock.content : null;
        if (!content) return newBlock;
        const text = content.map(c => (c && typeof c.text === 'string' ? c.text : '')).join('').trim();
        if (!/^\{\{toc\}\}$/i.test(text)) return newBlock;
        return { ...newBlock, type: 'tableOfContents', props: {}, content: undefined };
    });
};

// Replaces footnote markers (`[^id]`) inside text nodes with
// inline `footnote` content, recovering the definition text from `defs`
// (id→text map extracted before the parser, see richMarkdownToBlocks). The
// the marker itself is NOT a wikilink or a link (BlockNote leaves it as literal
// text), so this post-processing is safe.
const FOOTNOTE_MARK_RE = /\[\^([^\]\s]+)\]/g;
const splitTextForFootnotes = (item, defs) => {
    const text = item.text;
    if (typeof text !== 'string' || text.indexOf('[^') === -1) return [item];
    const out = [];
    let lastIndex = 0;
    let match;
    FOOTNOTE_MARK_RE.lastIndex = 0;
    while ((match = FOOTNOTE_MARK_RE.exec(text)) !== null) {
        const start = match.index;
        const label = match[1];
        if (start > lastIndex) out.push({ ...item, text: text.slice(lastIndex, start) });
        const fid = (typeof crypto !== 'undefined' && crypto?.randomUUID) ? crypto.randomUUID() : `fn-${label}-${start}`;
        out.push({ type: 'footnote', props: { id: fid, content: String(defs[label] || '') } });
        lastIndex = start + match[0].length;
    }
    if (lastIndex < text.length) out.push({ ...item, text: text.slice(lastIndex) });
    return out;
};
const promoteFootnotes = (blocks, defs) => {
    if (!defs || !blocks || !Array.isArray(blocks)) return blocks;
    if (Object.keys(defs).length === 0) return blocks;
    return blocks.map(block => {
        const newBlock = { ...block };
        if (Array.isArray(newBlock.content)) {
            newBlock.content = newBlock.content.flatMap(it =>
                (it && it.type === 'text') ? splitTextForFootnotes(it, defs) : [it]
            );
        }
        if (Array.isArray(newBlock.children)) {
            newBlock.children = promoteFootnotes(newBlock.children, defs);
        }
        return newBlock;
    });
};

// --- Contextual Markdown escaping in UNSTYLED text ---
// See docs/dev_memory/directives/markdown_roundtrip_escaping.md
//
// `inlineContentToMarkdown` serialized unstyled text literally, so the text
// plain text with Markdown meaning got corrupted in the round-trip (blocks → md → blocks) because
// markdown-it (tryParseMarkdownToBlocks) reinterpreted it: `the __init__ method` → bold
// "init", backticks → code, `*word*` → italics, `# foo` at the start of a line → heading.
// We escape ONLY what CommonMark would actually reinterpret, so as not to clutter the .md.
// CRITICAL: only applies to content that goes back through markdown-it (paragraphs,
// normal headings, list items, link text). Blocks with their own parser (toggle,
// toggle-heading, callout, table cells) store the RAW text and need to be serialized
// with `escape:false` (re-escaping them would leave literal backslashes).

// ASCII punctuation — the classes CommonMark uses for the flanking rule.
// eslint-disable-next-line no-useless-escape
const _isMdPunct = (c) => c !== undefined && /[!-\/:-@\[-`{-~]/.test(c);
// The text node boundary is treated as a space (word boundary): safe in
// practice because BlockNote merges adjacent plain text nodes into one.
const _isMdSpace = (c) => c === undefined || /\s/.test(c);

// Escapes the leading block marker of a SINGLE line (heading/quote/list/hr/setext).
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

// Escapes a text node with NO styling marks. `atLineStart` also activates escaping of
// block markers at the start of each line (only for paragraphs and list items).
const escapeUnstyledMarkdown = (text, atLineStart) => {
    if (!text) return text;
    let out = "";
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "\\") { out += "\\\\"; continue; }        // backslash FIRST (idempotence)
        if (c === "`") { out += "\\`"; continue; }           // backtick → inline code
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
                dangerous = leftFlank || rightFlank;          // asterisk: intraword allowed
            } else {                                           // underscore: NO intraword
                const canOpen = leftFlank && (!rightFlank || prevPunct);
                const canClose = rightFlank && (!leftFlank || nextPunct);
                dangerous = canOpen || canClose;               // `my_var_name` stays clean
            }
            out += dangerous ? "\\" + c : c;
            continue;
        }
        out += c;
    }
    // Inline links/images `[...](` or `![...](`: escape the `[` so it doesn't become a link.
    // Loose `[ref]` are NOT touched (markdown-it already leaves them literal) → minimal pollution.
    out = out.replace(/(!?)\[([^[\]\n]*)]\(/g, (mm, bang, label) => `${bang}\\[${label}](`);
    // Inline HTML tags (`<b>tag</b>`) and autolinks (`<http://…>`): markdown-it
    // (with HTML enabled) would reinterpret them, so PLAIN text with
    // this syntax (often pasted HTML or a URL) was lost/transformed
    // in the round-trip. We escape ONLY the `<` that starts a COMPLETE tag or autolink
    // (with its matching `>`), so as not to touch `a < b` or `a<b` (which CommonMark leaves
    // literals). The `<br>`/`<u>`/`<span>` that the serializer injects are added
    // AFTERWARDS, so it doesn't affect them.
    out = out.replace(/<(\/?[A-Za-z][^<>]*>|[A-Za-z][A-Za-z0-9+.-]*:[^<>\s]*>)/g, "\\<$1");
    // Block markers at the start of each line.
    if (atLineStart) {
        out = out.split("\n").map(escapeLeadingBlockMarker).join("\n");
    }
    return out;
};

/**
 * Converts inline content.
 * @param {object} [opts]
 * @param {boolean} [opts.escape=true] Escapes Markdown characters in unstyled text.
 *   Set to `false` for content that does NOT go back through markdown-it (toggle/callout/cells).
 * @param {boolean} [opts.atLineStart=false] The content starts at the beginning of a line
 *   (paragraphs and list items) → also escapes leading block markers.
 */
const inlineContentToMarkdown = (content, { escape = true, atLineStart = false } = {}) => {
    if (!content) return "";
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";

    let lineStart = atLineStart;
    return content.map(item => {
        const nodeAtLineStart = lineStart;
        lineStart = false; // inline nodes do not (by default) end on a new line
        if (!item || typeof item !== "object") return "";
        if (item.type === "text") {
            // Defensive: if item.text is not a string, we do NOT toString it
            // (it would return "[object Object]" and overwrite the note on disk).
            if (typeof item.text !== "string") {
                console.warn("inlineContentToMarkdown: item.text is not a string", item);
                return "";
            }
            let text = item.text;
            // The next node is at the start of a line if THIS text ends in a line break.
            lineStart = text.endsWith("\n");

            // Contextual escaping ONLY in unmarked text (not even inside code spans):
            // inside bold/italic/underline/strike/code the text is left raw.
            const s = item.styles || {};
            const hasMark = !!(s.bold || s.italic || s.underline || s.strike || s.code);
            if (escape && !hasMark) {
                text = escapeUnstyledMarkdown(text, nodeAtLineStart);
            }

            // Handle soft line breaks inside text nodes. Standard Markdown requires two spaces or <br>.
            // (After escaping, so as not to escape the `<br>` we inject.)
            // We emit `<br>` WITHOUT a trailing literal newline. If we appended a
            // real `\n`, BlockNote's parser would count BOTH the `<br>` (hard break)
            // AND the following newline (soft break) as separate breaks, so a single
            // in-paragraph break re-parsed as two — and every save/reload cycle
            // DOUBLED the breaks (`.\n` → `<br>\n` → `.\n\n` → `<br>\n<br>\n` → …),
            // making blank lines "reappear and grow" and defeating the user's deletes.
            // `<br>` alone round-trips 1:1 (verified against the live parser).
            if (text.includes('\n')) {
                text = text.replace(/\n/g, '<br>');
            }

            if (item.styles) {
                // CommonMark does not recognize emphasis delimiters when they have
                // immediately adjacent spaces (e.g. "** text **" is not bold).
                // We move leading/trailing spaces outside the markers.
                const wrap = (str, open, close = open) => {
                    if (!str) return str;
                    const m = String(str).match(/^(\s*)([\s\S]*?)(\s*)$/);
                    const lead = m ? m[1] : "";
                    const core = m ? m[2] : str;
                    const trail = m ? m[3] : "";
                    if (!core) return str; // all spaces; do not apply the mark
                    return `${lead}${open}${core}${close}${trail}`;
                };
                if (item.styles.bold) text = wrap(text, "**");
                if (item.styles.italic) text = wrap(text, "*");
                if (item.styles.underline) text = wrap(text, "<u>", "</u>");
                if (item.styles.strike) text = wrap(text, "~~");
                if (item.styles.code) text = wrap(text, "`");
                // INLINE text/background color → <span style> (mirroring the color of
                // BLOCK, which is saved with <div style>). Without this, a piece of text
                // colored from the toolbar was saved without any marker and the color
                // was silently lost on every save.
                const tc = item.styles.textColor;
                const bgc = item.styles.backgroundColor;
                if ((tc && tc !== "default") || (bgc && bgc !== "default")) {
                    let st = "";
                    if (tc && tc !== "default") st += `color: ${tc};`;
                    if (bgc && bgc !== "default") st += `background-color: ${bgc};`;
                    text = `<span style="${st}">${text}</span>`;
                }
            }
            return text;
        }
        if (item.type === "link") {
            // Robustness: a link's content can be an array (expected),
            // a string (legacy), or a single object (insertion bug). We normalize it.
            let linkContent = item.content;
            if (linkContent && !Array.isArray(linkContent) && typeof linkContent !== "string") {
                linkContent = [linkContent];
            }
            const innerText = inlineContentToMarkdown(linkContent);
            const rawHref = typeof item.href === "string" ? item.href : "";
            // The internal sentinel is deserialized to file:// before writing
            // on disk, so external readers (Obsidian, etc.) understand
            // the original local link.
            const safeHref = sentinelToFileUrl(rawHref);
            // CommonMark: if the URL has spaces or unbalanced parentheses, it must
            // be wrapped with <...>. Without this, [text](file:///foo bar.docx)
            // breaks at the first space and the link becomes unusable.
            const needsAngleBrackets = /[\s<>]/.test(safeHref);
            const finalHref = needsAngleBrackets ? `<${safeHref}>` : safeHref;
            return `[${innerText}](${finalHref})`;
        }
        if (item.type === "wikilink") {
            const target = item.props?.target || "";
            const section = item.props?.section || "";
            const title = item.props?.title || "";
            const link = section ? `${target}#${section}` : target;

            // If the title is meaningful but different from the plain link, we use the [[Link|Title]] alias
            if (title && title !== link && title !== target) {
                return `[[${link}|${title}]]`;
            }
            return `[[${link}]]`;
        }
        if (item.type === "cite") {
            // We serialize it as a Pandoc citation `[@key]`. Compatible with
            // pandoc-citeproc, Quarto, Obsidian Citations Plugin, etc.
            const ck = item.props?.citationKey || "";
            return ck ? `[@${ck}]` : "";
        }
        if (item.type === "footnote") {
            // Inline footnote: assigns a sequential number (in document
            // order) and accumulates the `[^N]: text` definition for the end.
            const fid = String(item.props?.id || "");
            const key = fid || `auto-${_footnoteOrder.size + 1}`;
            let num = _footnoteOrder.get(key);
            if (!num) {
                num = _footnoteOrder.size + 1;
                _footnoteOrder.set(key, num);
                const body = String(item.props?.content || "").replace(/\s*\n\s*/g, " ").trim();
                _footnoteDefs.push(`[^${num}]: ${body}`);
            }
            return `[^${num}]`;
        }
        if (item.type === "mention") {
            // Person mention → `@[Name|id]` (safe token: `@[` is neither a citation nor a
            // wikilink). `|` and `]` are stripped from the name so as not to break the token.
            const name = String(item.props?.name || "").replace(/[|\]]/g, " ").trim();
            const id = String(item.props?.id || "").trim();
            if (!name && !id) return "";
            return `@[${name}|${id}]`;
        }
        if (item.type === "dateref") {
            // Date mention → `@2026-06-25` or `@2026-06-25T09:00` (with reminder).
            const date = String(item.props?.date || "").trim();
            const time = String(item.props?.time || "").trim();
            if (!date) return "";
            return time ? `@${date}T${time}` : `@${date}`;
        }
        return "";
    }).join("");
};

// Sanitizes the destinations of `[text](dest)` links in a markdown document:
// normalizes backslashes to slashes and wraps destinations
// with spaces or non-ASCII characters in `<...>` (markdown-it/Tiptap would otherwise reject them).
// Scans each destination respecting balanced parentheses and
// escaped characters, just like CommonMark does, so that a URL with
// internal parentheses (attachments like `Article (2020).pdf`, Wikipedia
// disambiguations) isn't truncated at the first `)`. Destinations already wrapped in `<...>`
// are left intact; a `](` without a `)` to close it is treated as text.
const sanitizeLinkDestinations = (text) => {
    let out = "";
    let i = 0;
    while (i < text.length) {
        const idx = text.indexOf("](", i);
        if (idx === -1) { out += text.slice(i); break; }
        out += text.slice(i, idx + 2);              // includes `](`
        let j = idx + 2;
        if (text[j] === "<") {                        // destination already wrapped in <...>
            const close = text.indexOf(">", j + 1);
            if (close === -1) { out += text.slice(j); break; }
            out += text.slice(j, close + 1);
            i = close + 1;
            continue;
        }
        let depth = 0, k = j, closed = false;
        for (; k < text.length; k++) {
            const ch = text[k];
            if (ch === "\\") { k++; continue; }       // escaped character: doesn't count
            if (ch === "(") depth++;
            else if (ch === ")") {
                if (depth === 0) { closed = true; break; }
                depth--;
            }
        }
        if (!closed) { i = j; continue; }             // `](` left unclosed → literal text
        const normalized = text.slice(j, k).replace(/\\/g, "/");
        // eslint-disable-next-line no-control-regex
        out += /[\s<>]|[^\x00-\x7F]/.test(normalized) ? `<${normalized}>)` : `${normalized})`;
        i = k + 1;
    }
    return out;
};

// HTML tag names the editor round-trips WITHOUT destroying content (verified against the
// live parser, 2026-07-19): video/audio/img → native blocks; u/span/div → marks and block
// colors; details/summary → BlockNote's toggleListItem (which our serializer normalizes to
// `:::toggle`); tables → native tables; sub/sup/mark lose the tag but KEEP the inner text.
// Anything OUTSIDE this list is dropped by BlockNote leaving empty paragraphs (`<iframe>`,
// `<file>`, `<mention-page>`, `<meeting-notes>`, …) and the content is destroyed on the
// next save. Those tags get wrapped in a code span instead (see wrapUnknownHtmlTags).
const KNOWN_HTML_TAGS = new Set([
    "a", "b", "strong", "i", "em", "u", "s", "del", "strike", "code", "pre", "kbd",
    "br", "hr", "p", "div", "span", "img", "figure", "figcaption",
    "table", "thead", "tbody", "tfoot", "tr", "td", "th", "colgroup", "col", "caption",
    "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
    "sub", "sup", "mark", "video", "audio", "source", "input", "label",
    "details", "summary",
]);
// Complete tag: `<name …>`, `</name>` or `<name/>`. Autolinks (`<https://…>`), emails
// (`<a@b.c>`) and comments (`<!-- … -->`) do NOT match (no attr whitespace after the
// scheme/name), so they keep their CommonMark meaning.
const HTML_TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:\s[^<>]*)?)(\/?)>/g;

const _codeWrap = (raw) => (raw.includes("`") ? "`` " + raw + " ``" : "`" + raw + "`");

// Wraps every run of unknown tags in ONE code span. Runs (consecutive tags with only
// whitespace between, e.g. `<file …></file>`) must share a span: two adjacent spans
// would put backtick delimiters back to back (`…>``</file>`) and the backtick runs
// merge into garbage.
const _wrapUnknownInSegment = (seg) => {
    let out = "", last = 0, runStart = -1, runEnd = -1;
    for (const m of seg.matchAll(HTML_TAG_RE)) {
        if (KNOWN_HTML_TAGS.has(m[2].toLowerCase())) continue;
        const start = m.index, end = start + m[0].length;
        if (runStart >= 0 && /^\s*$/.test(seg.slice(runEnd, start))) {
            runEnd = end;
            continue;
        }
        if (runStart >= 0) {
            out += seg.slice(last, runStart) + _codeWrap(seg.slice(runStart, runEnd));
            last = runEnd;
        }
        runStart = start; runEnd = end;
    }
    if (runStart >= 0) {
        out += seg.slice(last, runStart) + _codeWrap(seg.slice(runStart, runEnd));
        last = runEnd;
    }
    return out + seg.slice(last);
};

const wrapUnknownHtmlTags = (text) => {
    if (!text || !text.includes("<")) return text;
    let inFence = false;
    return text.split("\n").map((line) => {
        if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return line; }
        if (inFence || !line.includes("<")) return line;
        // Existing inline code spans already protect their raw content — skip them.
        return line.split(/(`+[^`\n]*`+)/).map((seg) =>
            seg.startsWith("`") ? seg : _wrapUnknownInSegment(seg)
        ).join("");
    }).join("\n");
};

// file:// links inside the markdown are replaced with the sentinel before
// parsing because BlockNote/Tiptap doesn't accept them as a valid href (it's not
// in its allowed protocols). We keep the sentinel in the blocks throughout the whole
// the lifetime in the editor; it is only reverted back to file:// at the moment of
// serialize to markdown (see inlineContentToMarkdown). The sentinel passes
// Tiptap's validation because it starts with https://, so the <a> in the DOM
// has a clickable href that our useFileLinkInterceptor can capture.
const parsePlainMarkdownBlock = async (text, editor) => {
    if (!text) return [];

    // Replaces file:// with the sentinel before delegating to the parser.
    // Also replaces the legacy sentinel (`__gnosi_file_protocol__`) and the
    // its corrupted variant (`**gnosi_file_protocol**`, written by an
    // re-serializer that interpreted the `__` as bold) with the sentinel
    // currently in use. Without this normalization, the parser sees a broken href
    // and renders `[text](url)` as literal markdown.
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Captures both `](file://` and `](<file://` (URL wrapped in angle
    // brackets under CommonMark when it has spaces or non-ASCII characters). Without capturing the
    // optional `<`, file:// arrives intact at the Tiptap parser, which rejects it
    // as a disallowed scheme and silently discards the link; the round-trip
    // that follows writes the text without an href, losing the link.
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

    // Sanitizes URLs in markdown links `[text](url)`. Markdown-it only
    // accepts URLs with spaces if they are wrapped in `<...>`. Moreover, the extension
    // Tiptap Link rejects URLs with UTF-8 in the path (Administració, Pla, etc.)
    // and silently discards the link. More robust solution: ALWAYS wrap
    // with `<...>` when the URL has problematic characters (spaces or non-ASCII).
    // CommonMark accepts any character inside `<...>` except `<`, `>` and
    // line breaks; this way the parser respects the literal URL and doesn't validate it.
    // The destination CANNOT be delimited with `[^)]*`: a link to an attachment with
    // parentheses in the name (`Article (2020).pdf`, very common) or a URL from
    // Wikipedia with disambiguation (`…_(desambiguación)`) would get truncated at the first
    // `)`, leaving half the URL as text and breaking the link in the
    // round-trip. `sanitizeLinkDestinations` scans the destination while respecting
    // balanced parentheses and escaped characters, as CommonMark does.
    protectedText = sanitizeLinkDestinations(protectedText);

    // UNKNOWN HTML tags (`<file …>`, `<mention-page …>`, `<iframe>`, …) are silently
    // DROPPED by BlockNote's parser: no Tiptap node for them, so the content vanishes
    // on the first save leaving empty paragraphs (171 Notion attachments lost on
    // «Curs de narrativa i conte I, II», 2026-07-19). Wrapping each unknown complete
    // tag in a code span preserves it verbatim (code content is never reinterpreted,
    // and the code mark round-trips 1:1 — verified live; `\<` escaping does NOT work:
    // the parser still eats the tag and leaves stray backslashes). Known tags (colors,
    // tables, underline, media, details/summary…) are left for the parser.
    protectedText = wrapUnknownHtmlTags(protectedText);

    // A CommonMark type-6 HTML block only ends at a BLANK line. Cloned/legacy
    // content often has `</table>` immediately followed by more markdown
    // (headings, list items with links); without a blank line the parser
    // swallows everything after `</table>` into the HTML block and that
    // markdown renders as raw text (`[PDF](http://…)` literal). Ensuring a
    // blank line after `</table>` closes the HTML block where the author
    // visibly intended it to end. Inline `<table>…</table>` on ONE line never
    // opens a type-6 block mid-paragraph, so requiring the tag alone on its
    // line avoids touching inline HTML.
    protectedText = protectedText.replace(
        /(^[ \t]*<\/table>[ \t]*)\n(?![ \t]*\n)/gm,
        '$1\n\n',
    );

    // Sanitization of unpaired `[[`: if the page has a `[[xxx` that
    // doesn't find its `]]`, the wikilink regex can capture hundreds of
    // characters of text (including a well-formed wikilink inside), creating a
    // wikilink with a malformed target that causes BlockNote to hang when rendering. Here
    // we escape orphan `[[` to `\[\[` so that markdown-it treats them as
    // literal text and only properly paired `[[...]]` reach
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
        // opens contains indexes of unclosed `[[` — we escape them.
        const openSet = new Set(opens);
        let result = '';
        for (let i = 0; i < protectedText.length; i++) {
            if (openSet.has(i)) {
                result += '\\[\\[';
                i++; // We skip the second `[`
            } else {
                result += protectedText[i];
            }
        }
        return result;
    })();

    let blocks = [];
    if (editor?.tryParseMarkdownToBlocks) {
        try {
            // Race with timeout: if the BlockNote/markdown-it parser enters
            // a pathological state (URLs with escaped backslashes, unpaired
            // brackets, etc.), we don't want it to block the main thread
            // forever and hang on "Loading editor...". 5s is more than
            // enough for any reasonable page.
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

    return processBlocksForDates(
        processBlocksForMentions(
            processBlocksForCitations(processBlocksForWikilinks(blocks))
        )
    );
};

/**
 * Parses a markdown string into BlockNote INLINE content (bold,
 * italics, code, links, [[wikilinks]]…) reusing parsePlainMarkdownBlock.
 * Returns the inline content of the first block, or a single plain-text node as a
 * fallback. Used for titles/labels that used to be saved as plain text and
 * lost inline formatting in the round-trip (toggle, collapsible heading).
 */
const parseInlineFromMarkdown = async (text, editor) => {
    const fallback = [{ type: "text", text: String(text ?? ""), styles: {} }];
    if (!text) return fallback;
    try {
        const parsed = await parsePlainMarkdownBlock(text, editor);
        const inline = parsed?.[0]?.content;
        return (Array.isArray(inline) && inline.length > 0) ? inline : fallback;
    } catch {
        return fallback;
    }
};

/**
 * Converts rich Markdown to blocks.
 */
export const richMarkdownToBlocks = async (markdown, editor) => {
    if (!markdown || typeof markdown !== 'string') return [];

    markdown = normalizeManagedBlockSpacing(markdown);

    const trimmed = markdown.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try { return JSON.parse(markdown); } catch (e) { console.error(e); }
    }

    // Extracts footnote definitions (`[^id]: text`) BEFORE the parser.
    // markdown-it (tryParseMarkdownToBlocks) would interpret `[^id]: text` as a
    // "link reference definition" and would silently remove it; that's why we
    // capture and strip them out here, and afterward `promoteFootnotes` reconstructs the
    // inline `[^id]` markers with their text. Markers within the body DO
    // pass through the parser as literal text (they are not valid links).
    const footnoteDefs = {};
    const _rawLines = markdown.split("\n");
    const _keptLines = [];
    // Track fenced code blocks: a line like `[^id]: text` INSIDE a ``` fence is
    // code content (e.g. documenting footnote syntax), not a footnote definition,
    // and must not be stripped — doing so silently deleted code lines on load and
    // persisted the deletion on the next autosave.
    let _inFence = false;
    for (const _ln of _rawLines) {
        if (/^\s*(```|~~~)/.test(_ln)) { _inFence = !_inFence; _keptLines.push(_ln); continue; }
        const _m = !_inFence && _ln.match(/^\[\^([^\]\s]+)\]:\s?(.*)$/);
        if (_m) { footnoteDefs[_m[1]] = _m[2]; }
        else { _keptLines.push(_ln); }
    }
    markdown = _keptLines.join("\n");

    const lines = markdown.split("\n");

    const parseRecursive = async (inputLines) => {
        let blocks = [];
        let i = 0;

        while (i < inputLines.length) {
            const line = inputLines[i];
            const trimmed = line.trim();

            // STRICT RULE: The directive must be the only thing on the trimmed line
            const startMatch = trimmed.match(/^(:{3,})(column-list|column|toggle-heading|toggle|gnosi-ignore)(.*)$/);
            
            if (startMatch) {
                const typeRaw = startMatch[2];
                const label = startMatch[3].trim();

                // Special case: gnosi-ignore (skip the entire block)
                if (typeRaw === "gnosi-ignore") {
                    let depth = 1;
                    let j = i + 1;
                    while (j < inputLines.length && depth > 0) {
                        const currentTrimmed = inputLines[j].trim();
                        // Support for nesting gnosi-ignore (optional but recommended)
                        if (currentTrimmed.match(/^:{3,}gnosi-ignore/)) depth++;
                        else if (currentTrimmed.match(/^:{3,}$/)) depth--;
                        j++;
                    }
                    i = j;
                    continue;
                }

                let type = typeRaw === "column-list" ? "columnList" : typeRaw;
                if (typeRaw === "toggle-heading") type = "heading";
                // `:::toggle` maps to BlockNote's built-in `toggleListItem`, which
                // uses `createToggleWrapper` (vanilla, working) to render the
                // indented children as an editable container. The legacy custom
                // `toggle` block had no child container, so you couldn't write
                // inside the toggle. The serializer (blockToMarkdown) already
                // normalizes both types back to the same `:::toggle` fence.
                if (typeRaw === "toggle") type = "toggleListItem";

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

                // Dedents the inner content before parsing it: the
                // serializer indents the children of :::column/:::column-list/
                // :::toggle. Without dedenting, an indented LIST (4 spaces) gets
                // parsed as a CODE BLOCK (CommonMark rule) and looks like
                // a dark box. We strip the COMMON indentation (preserves the nesting
                // internal relative, e.g. sub-lists).
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

                // For the "column" type, the width must be added according to the @blocknote/xl-multi-column schema
                if (type === "column") {
                    const widthMatch = label.match(/\{width=([0-9.]+)\}/);
                    block.props.width = widthMatch ? parseFloat(widthMatch[1]) : 1;
                    // BlockNote rejects a column without children ("Invalid content
                    // for node column: <>") and this crashes the render of the ENTIRE
                    // page. An empty column appears when its only child was
                    // an empty paragraph (which serializes to nothing and doesn't get
                    // parsed back as a block). We put a placeholder empty paragraph there.
                    if (!block.children || block.children.length === 0) {
                        block.children = [{ type: "paragraph", props: { backgroundColor: "default", textColor: "default", textAlignment: "left" }, content: [] }];
                    }
                }

                // For toggles, the content is an array of inlineContent
                if (type === "toggleListItem") {
                    // We clean up possible label attributes if necessary
                    const cleanLabel = label.replace(/\{.*\}/, "").trim();
                    // The toggle title is inline content: we parse it as
                    // markdown so that **bold**, `code`, [[wikilinks]]… don't
                    // get lost (previously it was saved as literal plain text).
                    block.content = await parseInlineFromMarkdown(cleanLabel || "Toggle", editor);
                    block.props.textColor = "default";
                }

                // Collapsible heading: we recover level + isToggleable and the
                // title (label without the {level=N} attribute).
                if (typeRaw === "toggle-heading") {
                    const levelMatch = label.match(/\{level=([0-9]+)\}/);
                    block.props.level = levelMatch ? parseInt(levelMatch[1], 10) : 1;
                    block.props.isToggleable = true;
                    block.props.textColor = "default";
                    const cleanLabel = label.replace(/\{[^}]*\}/, "").trim();
                    // Inline title: we parse the markdown (bold/code/wikilinks…).
                    block.content = cleanLabel ? await parseInlineFromMarkdown(cleanLabel, editor) : [];
                }

                // The column container (sibling of the empty-column guard from
                // above). BlockNote REQUIRES a columnList to have ≥2 children and that
                // ALL of them be "column"; otherwise it throws "Invalid content for node
                // columnList" and crashes the render of the ENTIRE page. With markdown
                // from external sources / AI-generated / hand-edited, a :::column-list can arrive
                // empty, with a single column, or with loose content (not placed in columns).
                // We normalize it so the content isn't lost and the note doesn't crash.
                if (type === "columnList") {
                    // Any child that isn't a column (loose text inside :::column-list)
                    // we wrap it in its own column so it isn't lost.
                    const columns = (block.children || []).map(child =>
                        child.type === "column"
                            ? child
                            : { type: "column", props: { backgroundColor: "default", width: 1 }, children: [child] }
                    );
                    if (columns.length >= 2) {
                        block.children = columns;
                    } else {
                        // <2 columns is not a valid layout: we unwrap the
                        // content at the current level instead of crashing the page.
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
                    
                    // We parse the callout content as INLINE markdown
                    // (same path as normal text) so that **bold**, _italics_,
                    // `code`, [links](url) and [[wikilinks]] survive the
                    // round-trip. It used to be saved as PLAIN text → on reload it
                    // saw the literal markdown ("**bold**") instead of the formatting.
                    const innerText = calloutLines.join("\n");
                    let alertContent = [{ type: "text", text: innerText, styles: {} }];
                    try {
                        const innerParsed = await parsePlainMarkdownBlock(innerText, editor);
                        const inline = innerParsed?.[0]?.content;
                        if (Array.isArray(inline) && inline.length > 0) alertContent = inline;
                    } catch { /* we keep the plain text as a fallback */ }

                    blocks.push({
                        id: Math.random().toString(36).substring(7),
                        type: "alert",
                        props: { type: calloutType },
                        content: alertContent
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

                const dataLines = tableLines
                    .filter(line => !line.match(/^\|?\s*[:\- ]+\s*(\|?\s*[:\- ]+\s*)*\|?$/)); // filter separator
                // Split a table row on UNESCAPED pipes only, and unescape `\|`→`|`
                // in each cell. A plain `line.split("|")` broke on cells that
                // contain a literal pipe (serialized as `\|`), splitting one cell
                // into two and persisting a stray backslash (compounding
                // corruption on every save/reload).
                const splitRowCells = (row) => {
                    const out = [];
                    let cur = "";
                    for (let k = 0; k < row.length; k++) {
                        const ch = row[k];
                        if (ch === "\\" && row[k + 1] === "|") { cur += "|"; k++; continue; }
                        if (ch === "|") { out.push(cur); cur = ""; continue; }
                        cur += ch;
                    }
                    out.push(cur);
                    return out.slice(1, -1); // drop the segments from the outer pipes
                };
                const tableRows = [];
                for (const line of dataLines) {
                    const cells = splitRowCells(line);
                    const richCells = [];
                    for (const cell of cells) {
                        const text = cell.trim();
                        // We parse the cell content as INLINE markdown
                        // (bold/italics/code/links/[[wikilinks]]) instead of
                        // saving it as PLAIN text, which lost all inline formatting
                        // in the round-trip (literal "**bold**" would show up).
                        let inline = [{ type: "text", text, styles: {} }];
                        if (text) {
                            try {
                                const parsed = await parsePlainMarkdownBlock(text, editor);
                                const c = parsed?.[0]?.content;
                                if (Array.isArray(c) && c.length > 0) inline = c;
                            } catch { /* we keep the plain text as a fallback */ }
                        }
                        richCells.push(inline);
                    }
                    tableRows.push({ cells: richCells });
                }

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
    return promoteFootnotes(
        promoteToc(
            restoreImageCaptions(promoteCustomFences(promoteBibliographyBlocks(promoteLinkCards(promoteEmbedBlocks(parsed)))))
        ),
        footnoteDefs,
    );
};
