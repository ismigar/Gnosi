import { logError } from '../../notifications/notifyError';
import { normalizeManagedBlockSpacing } from '../managedMarkdownUtils';
import {
    isRecord,
    isUnknownArray,
    type MarkdownBlock,
    type MarkdownRecord,
} from './model';
import { parseInlineFromMarkdown, extractStyledBlockWrapper, parsePlainMarkdownBlock } from './parse-plain';
import { promoteParsedBlocks } from './parse-promotions';
import { isTableStart, parseTable } from './parse-table';
import { normalizeCalloutType } from './protocol';

const DIRECTIVE_START_RE = /^(:{3,})(column-list|column|callout|toggle-heading|toggle|gnosi-ignore)(.*)$/;
const NESTED_DIRECTIVE_RE = /^:{3,}(column-list|column|callout|toggle-heading|toggle|gnosi-ignore)\b/;
const DIRECTIVE_END_RE = /^:{3,}$/;

interface ParsedDirective {
    readonly blocks: MarkdownBlock[];
    readonly nextIndex: number;
}

function emptyParagraph(): MarkdownBlock {
    return {
        type: 'paragraph',
        props: {
            backgroundColor: 'default',
            textColor: 'default',
            textAlignment: 'left',
        },
        content: [],
    };
}

function dedent(lines: readonly string[]): string[] {
    const nonEmpty = lines.filter((line) => line.trim().length > 0);
    const minimum = nonEmpty.length > 0
        ? Math.min(...nonEmpty.map((line) => line.match(/^ */)?.[0].length ?? 0))
        : 0;
    return minimum > 0 ? lines.map((line) => line.slice(minimum)) : [...lines];
}

function directiveBlockType(type: string): string {
    if (type === 'column-list') return 'columnList';
    if (type === 'callout') return 'alert';
    if (type === 'toggle-heading') return 'heading';
    if (type === 'toggle') return 'toggleListItem';
    return type;
}

function normalizeColumns(block: MarkdownBlock): MarkdownBlock[] {
    if (block.type !== 'columnList') return [block];
    const columns = (block.children ?? []).map((child): MarkdownBlock =>
        child.type === 'column'
            ? child
            : {
                type: 'column',
                props: { backgroundColor: 'default', width: 1 },
                children: [child],
            }
    );
    if (columns.length >= 2) return [{ ...block, children: columns }];
    return columns.flatMap((column) => column.children ?? []);
}

async function configureDirectiveBlock(
    block: MarkdownBlock,
    rawType: string,
    label: string,
    editor: unknown,
): Promise<MarkdownBlock[]> {
    const props = isRecord(block.props) ? block.props : {};
    if (block.type === 'alert') {
        const type = label.match(/\{[^}]*\btype\s*=\s*([^\s}]+)[^}]*\}/i)?.[1];
        props.type = normalizeCalloutType(type);
        if (!block.children || block.children.length === 0) block.children = [emptyParagraph()];
    }
    if (block.type === 'column') {
        const width = label.match(/\{width=([0-9.]+)\}/)?.[1];
        props.width = width === undefined ? 1 : Number.parseFloat(width);
        if (!block.children || block.children.length === 0) block.children = [emptyParagraph()];
    }
    if (block.type === 'toggleListItem') {
        const cleanLabel = label.replace(/\{.*\}/, '').trim();
        block.content = await parseInlineFromMarkdown(cleanLabel || 'Toggle', editor);
        props.textColor = 'default';
    }
    if (rawType === 'toggle-heading') {
        const level = label.match(/\{level=([0-9]+)\}/)?.[1];
        props.level = level === undefined ? 1 : Number.parseInt(level, 10);
        props.isToggleable = true;
        props.textColor = 'default';
        const cleanLabel = label.replace(/\{[^}]*\}/, '').trim();
        block.content = cleanLabel ? await parseInlineFromMarkdown(cleanLabel, editor) : [];
    }
    block.props = props;
    return normalizeColumns(block);
}

async function parseDirective(
    lines: readonly string[],
    index: number,
    editor: unknown,
    parseRecursive: (input: readonly string[]) => Promise<MarkdownBlock[]>,
): Promise<ParsedDirective | null> {
    const start = (lines[index] ?? '').trim().match(DIRECTIVE_START_RE);
    if (!start) return null;
    const rawType = start[2];
    if (rawType === undefined) return null;
    const label = (start[3] ?? '').trim();
    if (rawType === 'gnosi-ignore') {
        let depth = 1;
        let cursor = index + 1;
        while (cursor < lines.length && depth > 0) {
            const current = (lines[cursor] ?? '').trim();
            if (/^:{3,}gnosi-ignore/.test(current)) depth += 1;
            else if (DIRECTIVE_END_RE.test(current)) depth -= 1;
            cursor += 1;
        }
        return { blocks: [], nextIndex: cursor };
    }

    const innerLines: string[] = [];
    let depth = 1;
    let cursor = index + 1;
    while (cursor < lines.length && depth > 0) {
        const current = (lines[cursor] ?? '').trim();
        if (NESTED_DIRECTIVE_RE.test(current)) depth += 1;
        else if (DIRECTIVE_END_RE.test(current)) depth -= 1;
        if (depth > 0) innerLines.push(lines[cursor] ?? '');
        cursor += 1;
    }
    const block: MarkdownBlock = {
        type: directiveBlockType(rawType),
        props: { backgroundColor: 'default' },
        children: await parseRecursive(dedent(innerLines)),
    };
    return {
        blocks: await configureDirectiveBlock(block, rawType, label, editor),
        nextIndex: cursor,
    };
}

async function parseObsidianCallout(
    lines: readonly string[],
    index: number,
    parseRecursive: (input: readonly string[]) => Promise<MarkdownBlock[]>,
): Promise<ParsedDirective | null> {
    const trimmed = (lines[index] ?? '').trim();
    if (!trimmed.startsWith('> [!')) return null;
    const match = trimmed.match(/^> \[!([^\]]+)\]/);
    if (!match) return null;
    const calloutType = match[1];
    if (calloutType === undefined) return null;
    const calloutLines: string[] = [];
    const firstLine = trimmed.slice(match[0].length).trim();
    if (firstLine) calloutLines.push(firstLine);
    let cursor = index + 1;
    while (cursor < lines.length && (lines[cursor] ?? '').trim().startsWith('>')) {
        calloutLines.push((lines[cursor] ?? '').trim().slice(1).trim());
        cursor += 1;
    }
    const parsedChildren = await parseRecursive(calloutLines);
    return {
        nextIndex: cursor,
        blocks: [{
            id: Math.random().toString(36).substring(7),
            type: 'alert',
            props: { type: normalizeCalloutType(calloutType.toLowerCase()) },
            children: parsedChildren.length > 0 ? parsedChildren : [emptyParagraph()],
        }],
    };
}

async function flushPlain(
    lines: string[],
    blocks: MarkdownBlock[],
    editor: unknown,
): Promise<void> {
    const text = lines.join('\n').trim();
    lines.length = 0;
    if (!text) return;
    blocks.push(...await parsePlainMarkdownBlock(text, editor));
}

async function parseTextBuffer(
    lines: readonly string[],
    editor: unknown,
): Promise<MarkdownBlock[]> {
    const blocks: MarkdownBlock[] = [];
    const plain: string[] = [];
    let inFence = false;
    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (/^\s*(```|~~~)/.test(rawLine)) {
            inFence = !inFence;
            plain.push(rawLine);
            continue;
        }
        const transclusion = trimmed.match(/^!\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]$/);
        if (transclusion) {
            await flushPlain(plain, blocks, editor);
            blocks.push({
                type: 'transclusion',
                props: {
                    target: (transclusion[1] ?? '').trim(),
                    section: (transclusion[2] ?? '').trim(),
                    alias: (transclusion[3] ?? '').trim(),
                },
            });
        } else if (!inFence
            && Object.keys(extractStyledBlockWrapper(rawLine).props).length > 0) {
            await flushPlain(plain, blocks, editor);
            blocks.push(...await parsePlainMarkdownBlock(rawLine, editor));
        } else {
            plain.push(rawLine);
        }
    }
    await flushPlain(plain, blocks, editor);
    return blocks;
}

function extractFootnotes(markdown: string): {
    readonly definitions: MarkdownRecord;
    readonly markdown: string;
} {
    const definitions: MarkdownRecord = {};
    const kept: string[] = [];
    let inFence = false;
    for (const line of markdown.split('\n')) {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            kept.push(line);
            continue;
        }
        const match = !inFence ? line.match(/^\[\^([^\]\s]+)\]:\s?(.*)$/) : null;
        const label = match?.[1];
        if (label !== undefined) definitions[label] = match?.[2] ?? '';
        else kept.push(line);
    }
    return { definitions, markdown: kept.join('\n') };
}

async function parseLines(lines: readonly string[], editor: unknown): Promise<MarkdownBlock[]> {
    const blocks: MarkdownBlock[] = [];
    let index = 0;
    const parseRecursive = (input: readonly string[]) => parseLines(input, editor);
    while (index < lines.length) {
        const directive = await parseDirective(lines, index, editor, parseRecursive);
        if (directive) {
            blocks.push(...directive.blocks);
            index = directive.nextIndex;
            continue;
        }
        const callout = await parseObsidianCallout(lines, index, parseRecursive);
        if (callout) {
            blocks.push(...callout.blocks);
            index = callout.nextIndex;
            continue;
        }
        if (isTableStart(lines, index)) {
            const table = await parseTable(lines, index, editor);
            blocks.push(table.block);
            index = table.nextIndex;
            continue;
        }
        const textBuffer: string[] = [];
        while (index < lines.length
            && !NESTED_DIRECTIVE_RE.test((lines[index] ?? '').trim())) {
            textBuffer.push(lines[index] ?? '');
            index += 1;
        }
        if (textBuffer.length > 0) blocks.push(...await parseTextBuffer(textBuffer, editor));
    }
    return blocks;
}

function legacyJsonBlocks(markdown: string): unknown[] | null {
    const trimmed = markdown.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
    try {
        const parsed: unknown = JSON.parse(markdown);
        return isUnknownArray(parsed) ? parsed : null;
    } catch (error) {
        logError('markdown-mapper:legacy-json', error);
        return null;
    }
}

export async function richMarkdownToBlocks(
    markdownInput: unknown,
    editor?: unknown,
): Promise<unknown[]> {
    if (!markdownInput || typeof markdownInput !== 'string') return [];
    const markdown = normalizeManagedBlockSpacing(markdownInput);
    const legacyBlocks = legacyJsonBlocks(markdown);
    if (legacyBlocks) return legacyBlocks;
    const footnotes = extractFootnotes(markdown);
    const parsed = await parseLines(footnotes.markdown.split('\n'), editor);
    return promoteParsedBlocks(parsed, footnotes.definitions);
}
