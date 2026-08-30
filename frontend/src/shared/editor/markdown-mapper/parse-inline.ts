import {
    isRecord,
    isUnknownArray,
    type InlineNode,
    type MarkdownBlock,
    type MarkdownRecord,
    toBlockArray,
    toInlineArray,
} from './model';

function convertToWikilinks(content: unknown): unknown {
    const nodes = toInlineArray(content);
    if (!nodes) return content;
    const next: InlineNode[] = [];
    for (const item of nodes) {
        if (item.type === 'text' && typeof item.text === 'string') {
            const regex = /\[\[([^\][|#]+)(?:#([^\][|]+))?(?:\|([^\][]+))?\]\]/g;
            let lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = regex.exec(item.text)) !== null) {
                const target = match[1];
                if (target === undefined) continue;
                const start = match.index;
                const fullMatch = match[0];
                const section = match[2];
                const alias = match[3];
                if (start > lastIndex) {
                    next.push({ ...item, text: item.text.slice(lastIndex, start) });
                }
                next.push({
                    type: 'wikilink',
                    props: {
                        title: alias || (section ? `${target}#${section}` : target),
                        target: target + (section ? `#${section}` : ''),
                    },
                });
                lastIndex = start + fullMatch.length;
            }
            if (lastIndex < item.text.length) {
                next.push({ ...item, text: item.text.slice(lastIndex) });
            }
        } else if (item.type === 'link') {
            next.push({ ...item, content: convertToWikilinks(item.content) });
        } else {
            next.push(item);
        }
    }
    return next;
}

function convertTableWikilinks(tableContent: MarkdownRecord): MarkdownRecord {
    const rows = isUnknownArray(tableContent.rows) ? tableContent.rows : [];
    return {
        ...tableContent,
        rows: rows.map((row) => {
            if (!isRecord(row) || !isUnknownArray(row.cells)) return row;
            return {
                ...row,
                cells: row.cells.map((cell) => {
                    if (isUnknownArray(cell)) return convertToWikilinks(cell);
                    if (isRecord(cell) && isUnknownArray(cell.content)) {
                        return { ...cell, content: convertToWikilinks(cell.content) };
                    }
                    return cell;
                }),
            };
        }),
    };
}

function processBlocksForWikilinks(blocks: unknown): MarkdownBlock[] | null {
    const parsed = toBlockArray(blocks);
    if (!parsed) return null;
    return parsed.map((block): MarkdownBlock => {
        const next = { ...block };
        if (isRecord(next.content)
            && next.content.type === 'tableContent'
            && isUnknownArray(next.content.rows)) {
            next.content = convertTableWikilinks(next.content);
        } else if (next.content) {
            next.content = convertToWikilinks(next.content);
        }
        const children = processBlocksForWikilinks(next.children);
        if (children) next.children = children;
        return next;
    });
}

const CITATION_BRACKET_RE = /\[@([a-z][a-z0-9_:-]*(?:\s*;\s*@[a-z][a-z0-9_:-]*)*)\]/gi;
const CITATION_NAKED_RE = /(^|[\s(])@([a-z][a-z0-9_:-]*)\b/g;

interface CitationToken {
    readonly end: number;
    readonly keys: string[];
    readonly start: number;
}

function citationTokens(text: string): CitationToken[] {
    const tokens: CitationToken[] = [];
    CITATION_BRACKET_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CITATION_BRACKET_RE.exec(text)) !== null) {
        const inner = match[1];
        if (inner === undefined) continue;
        const keys = inner.split(';')
            .map((value) => value.replace(/^\s*@?/, '').trim())
            .filter((value) => value.length > 0);
        tokens.push({ start: match.index, end: match.index + match[0].length, keys });
    }
    CITATION_NAKED_RE.lastIndex = 0;
    while ((match = CITATION_NAKED_RE.exec(text)) !== null) {
        const prefix = match[1] ?? '';
        const key = match[2];
        if (key === undefined) continue;
        const start = match.index + prefix.length;
        if (tokens.some((token) => start >= token.start && start < token.end)) continue;
        tokens.push({ start, end: start + 1 + key.length, keys: [key] });
    }
    return tokens.sort((left, right) => left.start - right.start);
}

function convertToCitations(content: unknown): unknown {
    const nodes = toInlineArray(content);
    if (!nodes) return content;
    const next: InlineNode[] = [];
    for (const item of nodes) {
        if (item.type !== 'text') {
            next.push(item.type === 'link' && isUnknownArray(item.content)
                ? { ...item, content: convertToCitations(item.content) }
                : item);
            continue;
        }
        if (typeof item.text !== 'string' || !item.text) {
            next.push(item);
            continue;
        }
        const tokens = citationTokens(item.text);
        if (tokens.length === 0) {
            next.push(item);
            continue;
        }
        let last = 0;
        for (const token of tokens) {
            if (token.start > last) next.push({ ...item, text: item.text.slice(last, token.start) });
            token.keys.forEach((key, index) => {
                if (index > 0) next.push({ ...item, text: '; ' });
                next.push({ type: 'cite', props: { citationKey: key } });
            });
            last = token.end;
        }
        if (last < item.text.length) next.push({ ...item, text: item.text.slice(last) });
    }
    return next;
}

type InlineConverter = (content: unknown) => unknown;

function processBlocks(blocks: unknown, convert: InlineConverter): MarkdownBlock[] | null {
    const parsed = toBlockArray(blocks);
    if (!parsed) return null;
    return parsed.map((block): MarkdownBlock => {
        const next = { ...block };
        if (next.content) next.content = convert(next.content);
        const children = processBlocks(next.children, convert);
        if (children) next.children = children;
        return next;
    });
}

const MENTION_RE = /@\[([^\]|]*)\|([^\]]*)\]/g;
const DATE_REFERENCE_RE = /@(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/g;
const INLINE_ICON_RE = /\{\{gnosi-icon:([^}\s]+)\}\}/g;

type TokenBuilder = (match: RegExpExecArray) => InlineNode;

function convertTextTokens(content: unknown, regex: RegExp, build: TokenBuilder): unknown {
    const nodes = toInlineArray(content);
    if (!nodes) return content;
    const next: InlineNode[] = [];
    for (const item of nodes) {
        if (item.type === 'link' && isUnknownArray(item.content)) {
            next.push({ ...item, content: convertTextTokens(item.content, regex, build) });
            continue;
        }
        if (item.type !== 'text' || typeof item.text !== 'string') {
            next.push(item);
            continue;
        }
        let lastIndex = 0;
        regex.lastIndex = 0;
        let found = false;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(item.text)) !== null) {
            found = true;
            if (match.index > lastIndex) {
                next.push({ ...item, text: item.text.slice(lastIndex, match.index) });
            }
            next.push(build(match));
            lastIndex = match.index + match[0].length;
        }
        if (!found) {
            next.push(item);
        } else if (lastIndex < item.text.length) {
            next.push({ ...item, text: item.text.slice(lastIndex) });
        }
    }
    return next;
}

function convertMentions(content: unknown): unknown {
    return convertTextTokens(content, MENTION_RE, (match) => ({
        type: 'mention',
        props: { name: (match[1] ?? '').trim(), id: (match[2] ?? '').trim() },
    }));
}

function convertDates(content: unknown): unknown {
    return convertTextTokens(content, DATE_REFERENCE_RE, (match) => ({
        type: 'dateref',
        props: { date: match[1] ?? '', time: match[2] ?? '' },
    }));
}

function decodeInlineIcon(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function convertInlineIcons(content: unknown): unknown {
    return convertTextTokens(content, INLINE_ICON_RE, (match) => ({
        type: 'inlineIcon',
        props: { value: decodeInlineIcon(match[1] ?? '') },
    }));
}

export function processInlineSyntax(blocks: unknown): MarkdownBlock[] {
    const withWikilinks = processBlocksForWikilinks(blocks) ?? [];
    const withCitations = processBlocks(withWikilinks, convertToCitations) ?? [];
    const withMentions = processBlocks(withCitations, convertMentions) ?? [];
    const withDates = processBlocks(withMentions, convertDates) ?? [];
    return processBlocks(withDates, convertInlineIcons) ?? [];
}
