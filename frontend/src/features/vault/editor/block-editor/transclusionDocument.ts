import { parseMarkdownHeading } from './markdownPreview';

export interface TransclusionRange { start: number; end: number }

/** Keep offsets in the original Markdown, including fenced code and whitespace. */
export function transclusionRange(source: string, section: string): TransclusionRange | null {
    if (!section) return { start: 0, end: source.length };
    const wanted = section.trim().toLowerCase();
    const lines = source.match(/[^\n]*\n|[^\n]+$/g) || [];
    let offset = 0;
    let fence: { char: string; length: number } | null = null;
    let start: number | null = null;
    let level = 0;
    for (const line of lines) {
        const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
        if (fenceMatch?.[1]) {
            const marker = fenceMatch[1];
            if (!fence) fence = { char: marker.charAt(0), length: marker.length };
            else if (marker[0] === fence.char && marker.length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)) fence = null;
            offset += line.length;
            continue;
        }
        if (!fence) {
            if (wanted.startsWith('^')) {
                const marker = line.match(/(?:^|\s)\^([\w-]+)\s*$/);
                if (marker?.[1]?.toLowerCase() === wanted.slice(1)) {
                    const markerStart = line.lastIndexOf(`^${marker[1]}`);
                    return { start: offset, end: offset + markerStart };
                }
            } else {
                const heading = parseMarkdownHeading(line);
                if (start !== null && heading && heading.level <= level) return { start, end: offset };
                if (start === null && heading?.title.toLowerCase() === wanted) {
                    start = offset + line.length;
                    level = heading.level;
                }
            }
        }
        offset += line.length;
    }
    return start === null ? null : { start, end: source.length };
}

export function replaceTransclusion(source: string, range: TransclusionRange, content: string): string {
    const suffix = source.slice(range.end);
    if (suffix.startsWith('^')) return source.slice(0, range.start) + content.trimEnd() + ' ' + suffix;
    const separator = suffix && content && !content.endsWith('\n') && !suffix.startsWith('^') ? '\n' : '';
    return source.slice(0, range.start) + content + separator + suffix;
}
