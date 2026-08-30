import {
    createSerializationContext,
    isRecord,
    isUnknownArray,
    legacyStringOrEmpty,
    type MarkdownBlock,
    type MarkdownRecord,
    type MarkdownSerializationContext,
    propsOf,
    toBlockArray,
} from './model';
import { normalizeCalloutType } from './protocol';
import { codeBlockText, inlineContentToMarkdown } from './serialize-inline';

const LIST_ITEM_TYPES = new Set([
    'bulletListItem',
    'numberedListItem',
    'checkListItem',
]);

function serializeChildren(
    block: MarkdownBlock,
    indentLevel: number,
    context: MarkdownSerializationContext,
): string {
    const children = toBlockArray(block.children);
    if (!children) return '';
    return children.map((child) => blockToMarkdown(child, indentLevel + 1, context)).join('');
}

function serializeStructuralBlock(
    block: MarkdownBlock,
    indent: string,
    indentLevel: number,
    context: MarkdownSerializationContext,
): string | null {
    const props = propsOf(block);
    if (block.type === 'columnList') {
        return `:::column-list\n${serializeChildren(block, indentLevel, context)}:::\n`;
    }
    if (block.type === 'column') {
        const width = props.width;
        const widthAttribute = width && width !== 1 ? ` {width=${legacyStringOrEmpty(width)}}` : '';
        return `:::column${widthAttribute}\n${serializeChildren(block, indentLevel, context)}:::\n`;
    }
    if (block.type === 'alert') {
        const type = normalizeCalloutType(props.type);
        return `${indent}:::callout{type=${type}}\n${serializeChildren(block, indentLevel, context)}${indent}:::\n`;
    }
    if (block.type === 'toggle' || block.type === 'toggleListItem') {
        const label = inlineContentToMarkdown(block.content, { escape: false }, context);
        return `:::toggle ${label}\n${serializeChildren(block, indentLevel, context)}:::\n`;
    }
    if (block.type === 'heading' && props.isToggleable) {
        const rawLevel = Number(props.level) || 1;
        const label = inlineContentToMarkdown(block.content, { escape: false }, context);
        return `:::toggle-heading{level=${String(rawLevel)}} ${label}\n${serializeChildren(block, indentLevel, context)}:::\n`;
    }
    return null;
}

function parseObjectJson(value: unknown): MarkdownRecord | null {
    if (typeof value !== 'string') return null;
    try {
        const parsed: unknown = JSON.parse(value);
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function serializeGnosiBlock(block: MarkdownBlock): string | null {
    const props = propsOf(block);
    if (block.type === 'database') {
        return `\`\`\`gnosi-database\n${JSON.stringify(props, null, 2)}\n\`\`\`\n`;
    }
    if (block.type === 'gnosi_view') {
        const heading = legacyStringOrEmpty(props.heading).trim();
        const payload: MarkdownRecord = { view_id: legacyStringOrEmpty(props.view_id) };
        if (heading) {
            payload.heading = heading;
            payload.heading_level = Number(props.heading_level) || 1;
        }
        if (!payload.view_id && props.section) {
            const parsed = parseObjectJson(props.section);
            if (parsed) Object.assign(payload, parsed);
            else payload.section = props.section;
        }
        return `\`\`\`gnosi-view\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
    }
    if (block.type === 'bibliography') {
        const style = legacyStringOrEmpty(props.style).trim();
        const locale = legacyStringOrEmpty(props.locale).trim();
        if (!style || (style === 'apa' && (!locale || locale === 'en-US'))) {
            return '{{bibliography}}\n';
        }
        return !locale || locale === 'en-US'
            ? `{{bibliography:${style}}}\n`
            : `{{bibliography:${style}:${locale}}}\n`;
    }
    if (block.type === 'mermaid') {
        const code = legacyStringOrEmpty(props.code).replace(/\n+$/, '');
        return `\`\`\`mermaid\n${code}\n\`\`\`\n`;
    }
    if (block.type === 'tableOfContents') return '{{toc}}\n';
    if (block.type === 'linkcard') {
        const url = legacyStringOrEmpty(props.url).trim();
        return url ? `[bookmark: ${url}](${url})\n` : '';
    }
    if (block.type === 'synced') {
        const syncId = legacyStringOrEmpty(props.sync_id).trim();
        return syncId
            ? `\`\`\`gnosi-synced\n${JSON.stringify({ sync_id: syncId })}\n\`\`\`\n`
            : '';
    }
    if (block.type === 'transclusion') {
        const target = legacyStringOrEmpty(props.target).trim();
        const alias = legacyStringOrEmpty(props.alias).trim();
        const section = legacyStringOrEmpty(props.section).trim();
        if (!target) return '';
        const targetWithSection = section ? `${target}#${section}` : target;
        return alias
            ? `![[${targetWithSection}|${alias}]]\n`
            : `![[${targetWithSection}]]\n`;
    }
    return null;
}

function serializeMediaBlock(block: MarkdownBlock): string | null {
    if (!['image', 'video', 'audio', 'file', 'embed'].includes(block.type ?? '')) return null;
    const props = propsOf(block);
    const url = props.url || props.src || '';
    const renderedUrl = legacyStringOrEmpty(url);
    const caption = props.caption ? `|${legacyStringOrEmpty(props.caption)}` : '';
    return block.type === 'image'
        ? `![${caption}](${renderedUrl})`
        : `[${block.type ?? ''}: ${renderedUrl}](${renderedUrl})`;
}

function cellContent(cell: unknown): unknown {
    return isRecord(cell) && cell.content !== undefined ? cell.content : cell;
}

function serializeTable(
    block: MarkdownBlock,
    context: MarkdownSerializationContext,
): string | null {
    if (block.type !== 'table') return null;
    let rows: unknown[] = [];
    if (isRecord(block.content)
        && block.content.type === 'tableContent'
        && isUnknownArray(block.content.rows)) {
        rows = block.content.rows;
    } else if (isUnknownArray(block.children)) {
        rows = block.children;
    }
    if (rows.length === 0) return '';

    const markdownRows = rows.map((row) => {
        const rowRecord = isRecord(row) ? row : {};
        const cells = isUnknownArray(rowRecord.cells)
            ? rowRecord.cells
            : isUnknownArray(rowRecord.children) ? rowRecord.children : [];
        const markdownCells = cells.map((cell) => inlineContentToMarkdown(
            cellContent(cell),
            { escape: false },
            context,
        ).replace(/\|/g, '\\|').replace(/<br>\n/g, '<br>').replace(/\n/g, ' '));
        return `| ${markdownCells.join(' | ')} |`;
    });

    const header = isRecord(rows[0]) ? rows[0] : {};
    const headerCount = isUnknownArray(header.cells)
        ? header.cells.length
        : isUnknownArray(header.children) ? header.children.length : 1;
    const separator = `| ${Array<string>(headerCount).fill('---').join(' | ')} |`;
    markdownRows.splice(1, 0, separator);
    return markdownRows.join('\n');
}

function serializeStandardBlock(
    block: MarkdownBlock,
    context: MarkdownSerializationContext,
): string {
    const props = propsOf(block);
    switch (block.type) {
        case 'heading':
        case 'heading1':
        case 'heading2':
        case 'heading3': {
            const rawLevel = block.type === 'heading1'
                ? 1
                : block.type === 'heading2'
                    ? 2
                    : block.type === 'heading3' ? 3 : Number(props.level) || 1;
            return `${'#'.repeat(rawLevel)} ${inlineContentToMarkdown(block.content, {}, context)}`;
        }
        case 'bulletListItem':
            return `- ${inlineContentToMarkdown(block.content, { atLineStart: true }, context)}`;
        case 'numberedListItem':
            return `1. ${inlineContentToMarkdown(block.content, { atLineStart: true }, context)}`;
        case 'checkListItem': {
            const checked = props.checked ? '[x]' : '[ ]';
            return `- ${checked} ${inlineContentToMarkdown(block.content, { atLineStart: true }, context)}`;
        }
        case 'codeBlock':
            return `\`\`\`${legacyStringOrEmpty(props.language)}\n${codeBlockText(block)}\n\`\`\``;
        case 'horizontalRule':
        case 'divider':
            return '---';
        case 'quote':
            return '';
        default:
            return inlineContentToMarkdown(block.content, { atLineStart: true }, context);
    }
}

function serializeQuote(
    block: MarkdownBlock,
    context: MarkdownSerializationContext,
): string | null {
    if (block.type !== 'quote') return null;
    let inner = inlineContentToMarkdown(block.content, { atLineStart: true }, context);
    const children = toBlockArray(block.children);
    if (children) {
        for (const child of children) {
            inner += `\n${blockToMarkdown(child, 0, context).replace(/\n+$/, '')}`;
        }
    }
    return `> ${inner.replace(/\n/g, '\n> ')}`;
}

function applyBlockColors(block: MarkdownBlock, content: string): string {
    const props = propsOf(block);
    const textColor = props.textColor;
    const backgroundColor = props.backgroundColor;
    const hasTextColor = Boolean(textColor && textColor !== 'default');
    const hasBackgroundColor = Boolean(backgroundColor && backgroundColor !== 'default');
    if (!hasTextColor && !hasBackgroundColor) return content;
    let style = '';
    if (hasTextColor) style += `color: ${legacyStringOrEmpty(textColor)};`;
    if (hasBackgroundColor) {
        style += `background-color: ${legacyStringOrEmpty(backgroundColor)};`;
    }
    return `<div style="${style}">${content}</div>`;
}

function appendStandardChildren(
    block: MarkdownBlock,
    content: string,
    indentLevel: number,
    context: MarkdownSerializationContext,
): string {
    const children = toBlockArray(block.children);
    if (!children || ['columnList', 'column', 'toggle'].includes(block.type ?? '')) {
        return content;
    }
    let result = content;
    for (const child of children) {
        const parentIsList = LIST_ITEM_TYPES.has(block.type ?? '');
        const childIsList = LIST_ITEM_TYPES.has(child.type ?? '');
        const prefix = parentIsList && !childIsList ? '\n\n' : '\n';
        result += prefix + blockToMarkdown(child, indentLevel + 1, context).trimEnd();
    }
    return `${result}\n`;
}

function blockToMarkdown(
    block: MarkdownBlock,
    indentLevel: number,
    context: MarkdownSerializationContext,
): string {
    const heading = ['heading', 'heading1', 'heading2', 'heading3'].includes(block.type ?? '');
    const effectiveIndent = heading ? Math.min(indentLevel, 1) : indentLevel;
    const indent = '  '.repeat(effectiveIndent);
    const structural = serializeStructuralBlock(block, indent, indentLevel, context);
    if (structural !== null) return structural;
    const gnosi = serializeGnosiBlock(block);
    if (gnosi !== null) return gnosi;
    const quote = serializeQuote(block, context);
    if (quote !== null) return quote;
    const table = serializeTable(block, context);
    if (table !== null) return table;
    const media = serializeMediaBlock(block);
    const initial = media ?? serializeStandardBlock(block, context);
    const colored = applyBlockColors(block, initial);
    const withChildren = appendStandardChildren(block, colored, indentLevel, context);
    return `${indent}${withChildren.trimStart()}\n`;
}

export function blocksToRichMarkdown(blocks: unknown, _editor?: unknown): string {
    const parsedBlocks = toBlockArray(blocks);
    if (!parsedBlocks) return '';
    const context = createSerializationContext();
    const parts = parsedBlocks.map((block) => blockToMarkdown(block, 0, context).replace(/\n+$/, ''));
    let result = '';
    parsedBlocks.forEach((block, index) => {
        const part = parts[index] ?? '';
        if (index === 0) {
            result = part;
            return;
        }
        const previous = parsedBlocks[index - 1];
        const tight = LIST_ITEM_TYPES.has(block.type ?? '')
            && block.type === previous?.type;
        result += (tight ? '\n' : '\n\n') + part;
    });
    result = result.trim();
    if (result.includes('[object Object]')) {
        throw new Error(
            "blocksToRichMarkdown: detected '[object Object]' in the result — "
            + 'the editor content has an unexpected format. Save aborted to avoid '
            + 'overwriting the note.',
        );
    }
    if (context.footnoteDefinitions.length > 0) {
        result = (result ? `${result}\n\n` : '') + context.footnoteDefinitions.join('\n');
    }
    return result;
}
