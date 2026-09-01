import { type MarkdownBlock } from './model';
import { parsePlainMarkdownBlock } from './parse-plain';

const TABLE_SEPARATOR_RE = /^\|?\s*[:\- ]+\s*(\|?\s*[:\- ]+\s*)*\|?$/;

export interface ParsedTable {
    readonly block: MarkdownBlock;
    readonly nextIndex: number;
}

export function isTableStart(lines: readonly string[], index: number): boolean {
    const line = lines[index] ?? '';
    const separator = lines[index + 1] ?? '';
    return line.trim().startsWith('|') && TABLE_SEPARATOR_RE.test(separator.trim());
}

function splitRowCells(row: string): string[] {
    const output: string[] = [];
    let current = '';
    for (let index = 0; index < row.length; index += 1) {
        const character = row[index] ?? '';
        if (character === '\\' && row[index + 1] === '|') {
            current += '|';
            index += 1;
            continue;
        }
        if (character === '|') {
            output.push(current);
            current = '';
            continue;
        }
        current += character;
    }
    output.push(current);
    return output.slice(1, -1);
}

export async function parseTable(
    lines: readonly string[],
    startIndex: number,
    editor: unknown,
): Promise<ParsedTable> {
    const tableLines: string[] = [];
    let index = startIndex;
    while ((lines[index] ?? '').trim().startsWith('|')) {
        tableLines.push((lines[index] ?? '').trim());
        index += 1;
    }
    const dataLines = tableLines.filter((line) => !TABLE_SEPARATOR_RE.test(line));
    const rows: Array<{ readonly cells: unknown[][] }> = [];
    for (const line of dataLines) {
        const richCells: unknown[][] = [];
        for (const cell of splitRowCells(line)) {
            const text = cell.trim();
            let inline: unknown[] = [{ type: 'text', text, styles: {} }];
            if (text) {
                try {
                    const parsed = await parsePlainMarkdownBlock(text, editor);
                    const content = parsed[0]?.content;
                    if (Array.isArray(content) && content.length > 0) inline = content;
                } catch {
                    // Preserve the plain-text fallback used by the legacy parser.
                }
            }
            richCells.push(inline);
        }
        rows.push({ cells: richCells });
    }
    return {
        nextIndex: index,
        block: {
            id: Math.random().toString(36).substring(7),
            type: 'table',
            content: { type: 'tableContent', rows },
        },
    };
}
