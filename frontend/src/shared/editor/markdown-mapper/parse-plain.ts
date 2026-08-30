import { protectCitationMarkdownLinks } from '../../resources/citationDeepLink';
import { logError } from '../../notifications/notifyError';
import {
    isMarkdownParserEditor,
    isRecord,
    type MarkdownBlock,
    type MarkdownRecord,
    toBlockArray,
    toInlineArray,
} from './model';
import { processInlineSyntax } from './parse-inline';
import {
    CORRUPTED_FILE_PROTOCOL_SENTINEL,
    FILE_PROTOCOL_SENTINEL,
    LEGACY_FILE_PROTOCOL_SENTINEL,
} from './protocol';

interface StyledBlockWrapper {
    readonly markdown: string;
    readonly props: MarkdownRecord;
}

function destinationNeedsAngleBrackets(value: string): boolean {
    for (const character of value) {
        const codePoint = character.codePointAt(0) ?? 0;
        if (/\s/.test(character) || character === '<' || character === '>' || codePoint > 127) {
            return true;
        }
    }
    return false;
}

function sanitizeLinkDestinations(text: string): string {
    let output = '';
    let index = 0;
    while (index < text.length) {
        const destinationStart = text.indexOf('](', index);
        if (destinationStart === -1) {
            output += text.slice(index);
            break;
        }
        output += text.slice(index, destinationStart + 2);
        const contentStart = destinationStart + 2;
        if (text[contentStart] === '<') {
            const close = text.indexOf('>', contentStart + 1);
            if (close === -1) {
                output += text.slice(contentStart);
                break;
            }
            output += text.slice(contentStart, close + 1);
            index = close + 1;
            continue;
        }
        let depth = 0;
        let cursor = contentStart;
        let closed = false;
        for (; cursor < text.length; cursor += 1) {
            const character = text[cursor];
            if (character === '\\') {
                cursor += 1;
                continue;
            }
            if (character === '(') depth += 1;
            else if (character === ')') {
                if (depth === 0) {
                    closed = true;
                    break;
                }
                depth -= 1;
            }
        }
        if (!closed) {
            index = contentStart;
            continue;
        }
        const normalized = text.slice(contentStart, cursor).replace(/\\/g, '/');
        output += destinationNeedsAngleBrackets(normalized)
            ? `<${normalized}>)`
            : `${normalized})`;
        index = cursor + 1;
    }
    return output;
}

const KNOWN_HTML_TAGS = new Set([
    'a', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'strike', 'code', 'pre', 'kbd',
    'br', 'hr', 'p', 'div', 'span', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'col', 'caption',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
    'sub', 'sup', 'mark', 'video', 'audio', 'source', 'input', 'label',
    'details', 'summary',
]);
const HTML_TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:\s[^<>]*)?)(\/?)>/g;

function codeWrap(raw: string): string {
    return raw.includes('`') ? `\`\` ${raw} \`\`` : `\`${raw}\``;
}

function wrapUnknownTagsInSegment(segment: string): string {
    let output = '';
    let last = 0;
    let runStart = -1;
    let runEnd = -1;
    for (const match of segment.matchAll(HTML_TAG_RE)) {
        const tagName = match[2];
        if (tagName === undefined || KNOWN_HTML_TAGS.has(tagName.toLowerCase())) continue;
        const start = match.index;
        const end = start + match[0].length;
        if (runStart >= 0 && /^\s*$/.test(segment.slice(runEnd, start))) {
            runEnd = end;
            continue;
        }
        if (runStart >= 0) {
            output += segment.slice(last, runStart) + codeWrap(segment.slice(runStart, runEnd));
            last = runEnd;
        }
        runStart = start;
        runEnd = end;
    }
    if (runStart >= 0) {
        output += segment.slice(last, runStart) + codeWrap(segment.slice(runStart, runEnd));
        last = runEnd;
    }
    return output + segment.slice(last);
}

function wrapUnknownHtmlTags(text: string): string {
    if (!text || !text.includes('<')) return text;
    let inFence = false;
    return text.split('\n').map((line) => {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return line;
        }
        if (inFence || !line.includes('<')) return line;
        return line.split(/(`+[^`\n]*`+)/).map((segment) =>
            segment.startsWith('`') ? segment : wrapUnknownTagsInSegment(segment)
        ).join('');
    }).join('\n');
}

export function extractStyledBlockWrapper(text: string): StyledBlockWrapper {
    const wrapper = text.match(/^\s*<div\b([^>]*)>([\s\S]*)<\/div>\s*$/i);
    const attributes = wrapper?.[1];
    const innerMarkdown = wrapper?.[2];
    if (attributes === undefined || innerMarkdown === undefined) {
        return { markdown: text, props: {} };
    }
    const styleAttribute = attributes.match(
        /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
    );
    const style = styleAttribute?.[1] ?? styleAttribute?.[2] ?? styleAttribute?.[3] ?? '';
    if (!style) return { markdown: text, props: {} };
    const props: MarkdownRecord = {};
    for (const [cssProperty, blockProperty] of [
        ['color', 'textColor'],
        ['background-color', 'backgroundColor'],
    ] as const) {
        const value = style.match(
            new RegExp(`(?:^|;)\\s*${cssProperty}\\s*:\\s*([^;]+)`, 'i'),
        )?.[1]?.trim();
        if (value) props[blockProperty] = value;
    }
    return Object.keys(props).length > 0
        ? { markdown: innerMarkdown.trim(), props }
        : { markdown: text, props: {} };
}

function applyBlockProps(blocks: MarkdownBlock[], props: MarkdownRecord): MarkdownBlock[] {
    if (Object.keys(props).length === 0) return blocks;
    return blocks.map((block) => ({
        ...block,
        props: { ...(isRecord(block.props) ? block.props : {}), ...props },
    }));
}

function escapeRegularExpression(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeIndentedHeadings(text: string): string {
    if (!text.includes('#')) return text;
    let inFence = false;
    return text.split('\n').map((line) => {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return line;
        }
        return !inFence && /^\s{4,}#{1,6}\s/.test(line)
            ? line.replace(/^\s{4,}(#{1,6}\s)/, '  $1')
            : line;
    }).join('\n');
}

function normalizeFileProtocols(text: string): string {
    return text
        .replace(/\]\((<?)file:\/\//g, `]($1${FILE_PROTOCOL_SENTINEL}`)
        .replace(
            new RegExp(`\\]\\((<?)${escapeRegularExpression(LEGACY_FILE_PROTOCOL_SENTINEL)}`, 'g'),
            `]($1${FILE_PROTOCOL_SENTINEL}`,
        )
        .replace(
            new RegExp(`\\]\\((<?)${escapeRegularExpression(CORRUPTED_FILE_PROTOCOL_SENTINEL)}`, 'g'),
            `]($1${FILE_PROTOCOL_SENTINEL}`,
        );
}

function escapeUnclosedWikilinks(text: string): string {
    const opens: number[] = [];
    for (let index = 0; index < text.length - 1; index += 1) {
        if (text[index] === '[' && text[index + 1] === '[') {
            opens.push(index);
            index += 1;
        } else if (text[index] === ']' && text[index + 1] === ']') {
            if (opens.length > 0) opens.pop();
            index += 1;
        }
    }
    if (opens.length === 0) return text;
    const openSet = new Set(opens);
    let output = '';
    for (let index = 0; index < text.length; index += 1) {
        if (openSet.has(index)) {
            output += '\\[\\[';
            index += 1;
        } else {
            output += text[index] ?? '';
        }
    }
    return output;
}

function protectMarkdown(text: string): string {
    let protectedText = normalizeIndentedHeadings(text);
    protectedText = normalizeFileProtocols(protectedText);
    protectedText = protectCitationMarkdownLinks(protectedText);
    protectedText = sanitizeLinkDestinations(protectedText);
    protectedText = wrapUnknownHtmlTags(protectedText);
    return protectedText.replace(
        /(^[ \t]*<\/table>[ \t]*)\n(?![ \t]*\n)/gm,
        '$1\n\n',
    );
}

function fallbackBlocks(markdown: string): MarkdownBlock[] {
    return [{ type: 'paragraph', content: markdown }];
}

export async function parsePlainMarkdownBlock(
    text: string,
    editor: unknown,
): Promise<MarkdownBlock[]> {
    if (!text) return [];
    const wrapper = extractStyledBlockWrapper(text);
    const balancedText = escapeUnclosedWikilinks(protectMarkdown(wrapper.markdown));
    let blocks: MarkdownBlock[];
    if (isMarkdownParserEditor(editor)) {
        try {
            const parsed: unknown = await Promise.race([
                Promise.resolve(editor.tryParseMarkdownToBlocks(balancedText)),
                new Promise<never>((_resolve, reject) => {
                    setTimeout(() => { reject(new Error('parse-timeout')); }, 5000);
                }),
            ]);
            blocks = toBlockArray(parsed) ?? fallbackBlocks(wrapper.markdown);
        } catch (error) {
            logError('markdown-mapper:parse-fallback', error);
            blocks = fallbackBlocks(wrapper.markdown);
        }
    } else {
        blocks = fallbackBlocks(wrapper.markdown);
    }
    return applyBlockProps(processInlineSyntax(blocks), wrapper.props);
}

export async function parseInlineFromMarkdown(
    text: string,
    editor: unknown,
): Promise<unknown[]> {
    const fallback: unknown[] = [{ type: 'text', text, styles: {} }];
    if (!text) return fallback;
    try {
        const parsed = await parsePlainMarkdownBlock(text, editor);
        const inline = toInlineArray(parsed[0]?.content);
        return inline && inline.length > 0 ? inline : fallback;
    } catch {
        return fallback;
    }
}
