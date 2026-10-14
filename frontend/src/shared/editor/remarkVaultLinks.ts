import { WIKILINK_HREF_SENTINEL } from './vaultMarkdownUtils';
import { TRANSCLUSION_HREF_SENTINEL } from './vault-markdown/transclusionModel';

interface MarkdownNode {
    readonly type?: unknown;
    readonly value?: unknown;
    children?: unknown[];
    data?: unknown;
    readonly position?: { readonly start?: { readonly offset?: number } };
}

interface MarkdownProcessor { data(): Record<string, unknown>; }
interface MarkdownCompileContext { readonly stack: readonly unknown[]; }
interface EscapeProvenance { readonly sourceStart: number | undefined; readonly offsets: Set<number>; }

function isNode(value: unknown): value is MarkdownNode {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapeProvenance(positions: WeakMap<MarkdownNode, EscapeProvenance>) {
    return { exit: {
        characterEscape(this: MarkdownCompileContext): void {
            // The parser has appended the escaped character and closed its
            // text frame. Record the actual decoded offset on that same node.
            const parent = this.stack.at(-1);
            if (!isNode(parent) || !Array.isArray(parent.children)) return;
            const text = parent.children.at(-1);
            if (!isNode(text) || text.type !== 'text' || typeof text.value !== 'string') return;
            const marker = text.value.at(-1);
            if (marker !== '[' && marker !== '!') return;
            const escaped = positions.get(text) ?? { sourceStart: text.position?.start?.offset, offsets: new Set<number>() };
            escaped.offsets.add(text.value.length - 1);
            positions.set(text, escaped);
        },
    } };
}

/** Expand wiki syntax on text nodes, leaving code, HTML and link URLs intact. */
export function remarkVaultLinks(this: MarkdownProcessor) {
    const escapedPositions = new WeakMap<MarkdownNode, EscapeProvenance>();
    const data = this.data();
    const extensions: unknown[] = Array.isArray(data.fromMarkdownExtensions) ? data.fromMarkdownExtensions : [];
    extensions.push(escapeProvenance(escapedPositions));
    data.fromMarkdownExtensions = extensions;
    return (tree: unknown): void => {
        const visit = (value: unknown): void => {
            // Both ordinary link forms own their complete label; wiki-looking
            // text inside it must not introduce a second navigation target.
            if (!isNode(value) || !Array.isArray(value.children) || value.type === 'link'
                || value.type === 'linkReference' || value.type === 'image') return;
            value.children = value.children.flatMap((child: unknown): unknown[] => {
                if (!isNode(child) || child.type !== 'text' || typeof child.value !== 'string') {
                    visit(child);
                    return [child];
                }
                const parts: unknown[] = [];
                const pattern = /(!?)\[\[([^\][|\n]*?)(?:\|([^\][\n]+))?\]\]/gu;
                const escaped = escapedPositions.get(child);
                // GFM can trim initial checkbox whitespace after compilation
                // and advances this text node's source start by that amount.
                const start = child.position?.start?.offset;
                const trimmed = escaped?.sourceStart !== undefined && start !== undefined ? start - escaped.sourceStart : 0;
                let cursor = 0;
                for (const match of child.value.matchAll(pattern)) {
                    const opening = match.index + (match[1] ? 1 : 0);
                    if (escaped?.offsets.has(match.index + trimmed) || escaped?.offsets.has(opening + trimmed)) continue;
                    const target = (match[2] ?? '').trim();
                    if (!target) continue;
                    if (match.index > cursor) parts.push({ type: 'text', value: child.value.slice(cursor, match.index) });
                    const alias = (match[3] ?? '').trim();
                    const sentinel = match[1] ? TRANSCLUSION_HREF_SENTINEL : WIKILINK_HREF_SENTINEL;
                    const url = sentinel + encodeURIComponent(target);
                    parts.push(match[1]
                        ? { type: 'image', url, alt: alias }
                        : { type: 'link', url, children: [{ type: 'text', value: alias || target }] });
                    cursor = match.index + match[0].length;
                }
                if (cursor === 0) return [child];
                if (cursor < child.value.length) parts.push({ type: 'text', value: child.value.slice(cursor) });
                return parts;
            });
            // A transclusion contains block Markdown. Its parent must accept
            // block content instead of producing invalid <p><div> markup.
            if (value.type === 'paragraph' && value.children.some(child => isNode(child)
                && child.type === 'image' && 'url' in child
                && typeof child.url === 'string' && child.url.startsWith(TRANSCLUSION_HREF_SENTINEL))) {
                value.data = { hName: 'div' };
            }
        };
        visit(tree);
    };
}
