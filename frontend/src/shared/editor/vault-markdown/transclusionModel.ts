/** Maximum number of source documents expanded along one embed path. */
export const MAX_TRANSCLUSION_DEPTH = 6;
export const TRANSCLUSION_HREF_SENTINEL = 'gnosi-transclusion:';

export interface TransclusionReference {
    readonly target: string;
    readonly section: string;
    readonly alias: string;
}

export function parseTransclusionReference(raw: string, alias = ''): TransclusionReference {
    const separator = raw.indexOf('#');
    return {
        target: (separator < 0 ? raw : raw.slice(0, separator)).trim().replace(/\.md$/iu, ''),
        section: separator < 0 ? '' : raw.slice(separator + 1).trim(),
        alias: alias.trim(),
    };
}

export function transclusionKey(pageId: string, section = ''): string {
    return JSON.stringify([pageId, section.trim().toLocaleLowerCase()]);
}

export function transclusionGuard(
    ancestry: readonly string[],
    pageId: string,
    section: string,
): 'cycle' | 'depth' | null {
    if (ancestry.includes(transclusionKey(pageId, section))) return 'cycle';
    return ancestry.length >= MAX_TRANSCLUSION_DEPTH ? 'depth' : null;
}

export function resolveTransclusionLocally(
    target: string,
    idToTitle: Readonly<Record<string, string>>,
    sourcePageId?: string | null,
): string | null {
    if (!target) return sourcePageId || null;
    if (Object.hasOwn(idToTitle, target) || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(target)) return target;
    const normalized = target.trim().toLocaleLowerCase();
    return Object.entries(idToTitle).find(([, title]) => title.trim().toLocaleLowerCase() === normalized)?.[0] ?? null;
}

export function embeddedMediaKind(target: string): 'image' | 'audio' | 'video' | 'file' | null {
    const path = target.split(/[?#]/u, 1)[0] ?? '';
    if (/\.(?:jpe?g|png|gif|webp|avif|svg|bmp|tiff?)$/iu.test(path)) return 'image';
    if (/\.(?:mp3|wav|ogg|m4a|flac|aac)$/iu.test(path)) return 'audio';
    if (/\.(?:mp4|webm|ogv|mov|m4v|mkv)$/iu.test(path)) return 'video';
    if (/\.(?:pdf|epub|docx?|xlsx?|pptx?|zip)$/iu.test(path)) return 'file';
    return null;
}

interface MarkdownHeading {
    readonly level: number;
    readonly title: string;
    readonly end: number;
}

function headingTitle(value: string): string {
    return value.replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
        .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu, (_match, target: string, alias?: string) => alias ?? target)
        .replace(/[*_`~]/gu, '').trim().toLocaleLowerCase();
}

/** Records fenced/indented code without discarding any of the source content. */
function protectedLines(lines: readonly string[]): boolean[] {
    let fence: { marker: string; length: number } | null = null;
    return lines.map(line => {
        const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
        if (fence) {
            if (delimiter?.[1]?.[0] === fence.marker && delimiter[1].length >= fence.length && !delimiter[2]?.trim()) fence = null;
            return true;
        }
        if (delimiter?.[1] && !(delimiter[1][0] === '`' && delimiter[2]?.includes('`'))) {
            fence = { marker: delimiter[1][0] ?? '`', length: delimiter[1].length };
            return true;
        }
        return /^(?: {4}|\t)/u.test(line);
    });
}

function headingAt(lines: readonly string[], protectedCode: readonly boolean[], index: number): MarkdownHeading | null {
    if (protectedCode[index]) return null;
    const line = lines[index] ?? '';
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/u.exec(line);
    if (atx?.[1]) return { level: atx[1].length, title: headingTitle((atx[2] ?? '').replace(/[ \t]+#+[ \t]*$/u, '')), end: index };
    if (protectedCode[index + 1] || !line.trim() || /^\s*(?:>|[-+*]\s|\d+[.)]\s)/u.test(line)) return null;
    const setext = /^ {0,3}(=+|-+)[ \t]*$/u.exec(lines[index + 1] ?? '');
    return setext ? { level: setext[1]?.[0] === '=' ? 1 : 2, title: headingTitle(line), end: index + 1 } : null;
}

function blockStart(lines: readonly string[], protectedCode: readonly boolean[], end: number, standalone = false): number {
    let start = end;
    // A marker on its own line can identify a complete fenced code block.
    if (protectedCode[end]) {
        while (start > 0 && protectedCode[start - 1]) start -= 1;
        return start;
    }
    const listItem = /^(\s*)(?:[-+*]|\d+[.)])[ \t]+/u;
    const endItem = listItem.exec(lines[end] ?? '');
    if (endItem && !standalone) return end;
    while (start > 0) {
        const previous = lines[start - 1] ?? '';
        if (!previous.trim() || protectedCode[start - 1] || headingAt(lines, protectedCode, start - 1)) break;
        start -= 1;
        if (listItem.test(previous) && !standalone) break;
    }
    return start;
}

/** Keep document-scoped definitions, in source order, without unrelated content. */
function withReferenceDefinitions(source: string, fragment: string): string {
    const definitions: string[] = [];
    commonmarkLanguage.parser.parse(source).iterate({
        enter(node) {
            if (node.name !== 'LinkReference') return;
            // Container markers belong to the original quote/list, not to the
            // definition. The parser places continuation quote marks inside it.
            const marks: { from: number; to: number }[] = [];
            const cursor = node.node.cursor();
            while (cursor.next()) {
                if (cursor.from >= node.to) break;
                if (cursor.name === 'QuoteMark') {
                    const end = source[cursor.to] === ' ' ? cursor.to + 1 : cursor.to;
                    marks.push({ from: cursor.from, to: end });
                }
            }
            let definition = source.slice(node.from, node.to);
            for (const mark of marks.reverse()) {
                definition = definition.slice(0, mark.from - node.from) + definition.slice(mark.to - node.from);
            }
            definitions.push(definition);
            return false;
        },
    });
    // Prepending preserves CommonMark's first-definition-wins behavior even
    // when the fragment itself contains a later duplicate of an outside label.
    return definitions.length ? `${definitions.join('\n\n')}\n\n${fragment}` : fragment;
}

/**
 * Selects raw Markdown for an embed. `null` means missing; an empty string is a
 * valid empty block. Unlike a hover excerpt, formatting and code are retained.
 */
export function extractSectionMarkdown(markdown: string | null | undefined, sectionName: string): string | null {
    const source = (markdown ?? '').replace(/\r\n?/gu, '\n');
    const section = sectionName.trim().replace(/^#/u, '').toLocaleLowerCase();
    if (!section) return source;
    const lines = source.split('\n');
    const code = protectedLines(lines);
    if (section.startsWith('^')) {
        const blockId = section.slice(1).trim();
        if (!blockId) return null;
        for (let index = 0; index < lines.length; index += 1) {
            if (code[index]) continue;
            const line = lines[index] ?? '';
            const marker = /(?:^|\s)\^([a-zA-Z0-9_-]+)[ \t]*$/u.exec(line);
            if (marker?.[1]?.toLocaleLowerCase() !== blockId) continue;
            const content = line.slice(0, marker.index).trimEnd();
            let end = index;
            if (!content) {
                end -= 1;
                while (end >= 0 && !(lines[end] ?? '').trim()) end -= 1;
                if (end < 0) return '';
            }
            const start = blockStart(lines, code, end, !content);
            const block = lines.slice(start, end + 1);
            if (content) block[block.length - 1] = content;
            return withReferenceDefinitions(source, block.join('\n').trimEnd());
        }
        return null;
    }
    for (let index = 0; index < lines.length; index += 1) {
        const heading = headingAt(lines, code, index);
        if (!heading || heading.title !== section) continue;
        let end = lines.length;
        for (let next = heading.end + 1; next < lines.length; next += 1) {
            const candidate = headingAt(lines, code, next);
            if (candidate && candidate.level <= heading.level) { end = next; break; }
        }
        return withReferenceDefinitions(source, lines.slice(index, end).join('\n').trimEnd());
    }
    return null;
}
import { commonmarkLanguage } from '@codemirror/lang-markdown';
