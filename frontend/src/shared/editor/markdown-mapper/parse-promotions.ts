import {
    isRecord,
    type InlineNode,
    legacyStringOrEmpty,
    type MarkdownBlock,
    type MarkdownRecord,
    propsOf,
    toBlockArray,
    toInlineArray,
} from './model';
import { codeBlockText } from './serialize-inline';

type BlockPromotion = (block: MarkdownBlock) => MarkdownBlock;

function promoteRecursively(blocks: unknown, promote: BlockPromotion): MarkdownBlock[] {
    const parsed = toBlockArray(blocks) ?? [];
    return parsed.map((block) => {
        const children = toBlockArray(block.children);
        const withChildren = children
            ? { ...block, children: promoteRecursively(children, promote) }
            : block;
        return promote(withChildren);
    });
}

function inlineText(content: unknown): string {
    const nodes = toInlineArray(content);
    if (!nodes) return '';
    return nodes.map((node) => typeof node.text === 'string' ? node.text : '').join('');
}

function singleParagraphLink(block: MarkdownBlock): InlineNode | null {
    if (block.type !== 'paragraph') return null;
    const content = toInlineArray(block.content);
    if (!content || content.length !== 1) return null;
    const item = content[0];
    return item?.type === 'link' && toInlineArray(item.content) ? item : null;
}

function promoteEmbed(block: MarkdownBlock): MarkdownBlock {
    const item = singleParagraphLink(block);
    if (!item || typeof item.href !== 'string') return block;
    const match = inlineText(item.content).match(/^embed:\s*(.+)$/i);
    if (!match) return block;
    return {
        ...block,
        type: 'embed',
        props: { url: item.href, caption: '' },
        content: undefined,
    };
}

function mediaType(value: string | undefined): 'audio' | 'file' | 'video' | null {
    const normalized = value?.toLowerCase();
    return normalized === 'audio' || normalized === 'file' || normalized === 'video'
        ? normalized
        : null;
}

function promoteLinkedMedia(block: MarkdownBlock): MarkdownBlock {
    const item = singleParagraphLink(block);
    if (!item || typeof item.href !== 'string') return block;
    const match = inlineText(item.content).match(/^(file|audio|video):\s*(.+)$/i);
    const type = mediaType(match?.[1]);
    const label = match?.[2]?.trim();
    if (!type || label === undefined) return block;
    return {
        ...block,
        type,
        props: {
            url: item.href,
            name: label === item.href ? '' : label,
            caption: '',
            ...(type === 'file' ? {} : { showPreview: true }),
        },
        content: undefined,
    };
}

function promoteLinkCard(block: MarkdownBlock): MarkdownBlock {
    const item = singleParagraphLink(block);
    if (!item || typeof item.href !== 'string') return block;
    const match = inlineText(item.content).match(/^bookmark:\s*(.+)$/i);
    return match
        ? { ...block, type: 'linkcard', props: { url: item.href }, content: undefined }
        : block;
}

function restoreImageCaption(block: MarkdownBlock): MarkdownBlock {
    const props = propsOf(block);
    if (block.type !== 'image'
        || typeof props.name !== 'string'
        || !props.name.startsWith('|')) {
        return block;
    }
    return {
        ...block,
        props: { ...props, caption: props.name.slice(1), name: '' },
    };
}

function promoteBibliography(block: MarkdownBlock): MarkdownBlock {
    if (block.type !== 'paragraph') return block;
    const content = toInlineArray(block.content);
    if (!content) return block;
    const match = inlineText(content).trim().match(
        /^\{\{bibliography(?::([a-z][a-z0-9-]*))?(?::([a-zA-Z-]+))?\}\}$/,
    );
    if (!match) return block;
    return {
        ...block,
        type: 'bibliography',
        props: { style: match[1] || 'apa', locale: match[2] || 'en-US' },
        content: undefined,
    };
}

function parseJsonRecord(value: string): MarkdownRecord | null {
    try {
        const parsed: unknown = JSON.parse(value);
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function syncedBlockId(value: string): string {
    try {
        const parsed: unknown = JSON.parse(value);
        return isRecord(parsed) ? legacyStringOrEmpty(parsed.sync_id) : '';
    } catch {
        return value.trim();
    }
}

function databaseBlock(payload: MarkdownRecord): MarkdownBlock {
    return {
        type: 'database',
        props: {
            database_table_id: legacyStringOrEmpty(payload.database_table_id),
            viewId: legacyStringOrEmpty(payload.viewId),
            filters: legacyStringOrEmpty(payload.filters),
            sort: legacyStringOrEmpty(payload.sort),
            search: legacyStringOrEmpty(payload.search),
            visibleProperties: legacyStringOrEmpty(payload.visibleProperties),
            viewType: legacyStringOrEmpty(payload.viewType) || 'table',
        },
    };
}

function viewBlock(payload: MarkdownRecord): MarkdownBlock {
    const viewId = legacyStringOrEmpty(payload.view_id);
    return {
        type: 'gnosi_view',
        props: {
            view_id: viewId,
            heading: legacyStringOrEmpty(payload.heading),
            heading_level: String(Number(payload.heading_level) || 1),
            section: viewId ? '' : JSON.stringify(payload),
        },
    };
}

function promoteCustomFence(block: MarkdownBlock): MarkdownBlock {
    if (block.type !== 'codeBlock') return block;
    const language = legacyStringOrEmpty(propsOf(block).language).toLowerCase();
    if (language === 'mermaid') {
        return { type: 'mermaid', props: { code: codeBlockText(block) } };
    }
    if (language === 'gnosi-synced') {
        const raw = codeBlockText(block);
        return { type: 'synced', props: { sync_id: syncedBlockId(raw) } };
    }
    if (language !== 'gnosi-view' && language !== 'gnosi-database') return block;
    const payload = parseJsonRecord(codeBlockText(block));
    if (!payload) return block;
    return language === 'gnosi-database' ? databaseBlock(payload) : viewBlock(payload);
}

function promoteTableOfContents(block: MarkdownBlock): MarkdownBlock {
    if (block.type !== 'paragraph') return block;
    const content = toInlineArray(block.content);
    if (!content || !/^\{\{toc\}\}$/i.test(inlineText(content).trim())) return block;
    return { ...block, type: 'tableOfContents', props: {}, content: undefined };
}

function promoteHeading(block: MarkdownBlock): MarkdownBlock {
    if (block.type !== 'paragraph') return block;
    const content = toInlineArray(block.content);
    const first = content?.[0];
    if (!first || first.type !== 'text' || typeof first.text !== 'string') return block;
    const match = first.text.match(/^(\s*)(?:\\)?(#{1,6})\s+(.*)$/s);
    const marks = match?.[2];
    const text = match?.[3];
    if (marks === undefined || text === undefined) return block;
    return {
        ...block,
        type: 'heading',
        props: { ...propsOf(block), level: marks.length },
        content: [{ ...first, text }, ...content.slice(1)],
    };
}

const FOOTNOTE_MARK_RE = /\[\^([^\]\s]+)\]/g;

function randomFootnoteId(label: string, start: number): string {
    const runtimeCrypto: { readonly randomUUID?: () => string } | undefined =
        typeof crypto === 'undefined' ? undefined : crypto;
    return runtimeCrypto?.randomUUID
        ? runtimeCrypto.randomUUID()
        : `fn-${label}-${String(start)}`;
}

function splitFootnoteText(item: InlineNode, definitions: MarkdownRecord): InlineNode[] {
    if (typeof item.text !== 'string' || !item.text.includes('[^')) return [item];
    const output: InlineNode[] = [];
    let lastIndex = 0;
    FOOTNOTE_MARK_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FOOTNOTE_MARK_RE.exec(item.text)) !== null) {
        const label = match[1];
        if (label === undefined) continue;
        if (match.index > lastIndex) {
            output.push({ ...item, text: item.text.slice(lastIndex, match.index) });
        }
        output.push({
            type: 'footnote',
            props: {
                id: randomFootnoteId(label, match.index),
                content: legacyStringOrEmpty(definitions[label]),
            },
        });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < item.text.length) output.push({ ...item, text: item.text.slice(lastIndex) });
    return output;
}

function promoteFootnotes(blocks: MarkdownBlock[], definitions: MarkdownRecord): MarkdownBlock[] {
    if (Object.keys(definitions).length === 0) return blocks;
    return blocks.map((block) => {
        const next = { ...block };
        const content = toInlineArray(next.content);
        if (content) {
            next.content = content.flatMap((item) => item.type === 'text'
                ? splitFootnoteText(item, definitions)
                : [item]);
        }
        const children = toBlockArray(next.children);
        if (children) next.children = promoteFootnotes(children, definitions);
        return next;
    });
}

export function promoteParsedBlocks(
    blocks: unknown,
    footnoteDefinitions: MarkdownRecord,
): MarkdownBlock[] {
    const embeds = promoteRecursively(blocks, promoteEmbed);
    const media = promoteRecursively(embeds, promoteLinkedMedia);
    const cards = promoteRecursively(media, promoteLinkCard);
    const bibliographies = promoteRecursively(cards, promoteBibliography);
    const fences = promoteRecursively(bibliographies, promoteCustomFence);
    const captions = promoteRecursively(fences, restoreImageCaption);
    const tableOfContents = promoteRecursively(captions, promoteTableOfContents);
    const headings = promoteRecursively(tableOfContents, promoteHeading);
    return promoteFootnotes(headings, footnoteDefinitions);
}
