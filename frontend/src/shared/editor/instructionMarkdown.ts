export interface MarkdownToken {
    readonly text: string;
    readonly kind: 'plain' | 'marker' | 'code' | 'emphasis' | 'link';
}

/** Highlight the source without parsing or serializing the stored instructions. */
export function instructionMarkdownTokens(value: string): MarkdownToken[] {
    const tokens: MarkdownToken[] = [];
    let fence: { character: string; length: number } | null = null;
    for (const line of value.split(/(?<=\n)/)) {
        const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line);
        if (fence) {
            tokens.push({ text: line, kind: 'code' });
            if (delimiter?.[1]?.startsWith(fence.character)
                && delimiter[1].length >= fence.length && !delimiter[2]?.trim()) fence = null;
            continue;
        }
        if (delimiter?.[1]) {
            fence = { character: delimiter[1][0] ?? '`', length: delimiter[1].length };
            tokens.push({ text: line, kind: 'code' });
            continue;
        }
        const pattern = /^ {0,3}#{1,6}(?=\s)|^\s*(?:[-+*]|\d+[.)]|>)(?=\s)|`+[^`\n]+`+|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|\[[^\]\n]+\]\([^\n)]*\)/g;
        let offset = 0;
        for (const match of line.matchAll(pattern)) {
            if (match.index > offset) tokens.push({ text: line.slice(offset, match.index), kind: 'plain' });
            const text = match[0];
            const kind = text.startsWith('`') ? 'code'
                : text.startsWith('[') ? 'link'
                    : /^(\*\*|__|\*[^\s])/.test(text) ? 'emphasis' : 'marker';
            tokens.push({ text, kind });
            offset = match.index + text.length;
        }
        if (offset < line.length) tokens.push({ text: line.slice(offset), kind: 'plain' });
    }
    return tokens;
}

export function indentInstructionLines(value: string, start: number, end: number, outdent: boolean) {
    const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
    const selected = value.slice(lineStart, end);
    const replacement = selected.split('\n').map(line => outdent
        ? line.replace(/^( {1,2}|\t)/, '') : `  ${line}`).join('\n');
    const firstDelta = outdent ? -(/^( {1,2}|\t)/.exec(selected)?.[0].length ?? 0) : 2;
    return {
        value: value.slice(0, lineStart) + replacement + value.slice(end),
        start: Math.max(lineStart, start + firstDelta),
        end: end + replacement.length - selected.length,
    };
}
