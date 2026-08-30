import type { GnosiEditor } from './schema';

export type PartialInlineArray = Exclude<Parameters<GnosiEditor['insertInlineContent']>[0], string>;
export type PartialInlineItem = PartialInlineArray[number];

export function expandBracketRange(text: string, start: number, end: number) {
    let safeStart = Math.max(0, start || 0);
    let safeEnd = Math.max(safeStart, end || safeStart);
    let leftExtra = 0; let rightExtra = 0;
    while (safeStart > 0 && text[safeStart - 1] === '[' && leftExtra < 2) { safeStart -= 1; leftExtra += 1; }
    while (safeEnd < text.length && text[safeEnd] === ']' && rightExtra < 2) { safeEnd += 1; rightExtra += 1; }
    return { start: safeStart, end: safeEnd };
}

export function inlineText(item: PartialInlineItem): string {
    return typeof item !== 'string' && 'text' in item ? item.text : '';
}

/** Replace a token across styled runs, preserving untouched inline nodes/styles. */
export function replaceTokenInInlineArray(items: PartialInlineArray, start: number, end: number, replacement: PartialInlineItem): PartialInlineArray | null {
    let cursor = 0; let injected = false;
    const next: PartialInlineArray = [];
    for (const item of items) {
        const text = inlineText(item);
        const itemStart = cursor; const itemEnd = cursor + (text ? text.length : 1);
        if (!text) {
            if (itemEnd <= start || itemStart >= end) next.push(item);
            else if (!injected) { next.push(replacement); injected = true; }
        } else if (itemEnd <= start || itemStart >= end) next.push(item);
        else if (typeof item !== 'string' && 'text' in item) {
            const left = text.slice(0, Math.max(0, start - itemStart));
            const right = text.slice(text.length - Math.max(0, itemEnd - end));
            if (left) next.push({ ...item, text: left });
            if (!injected) { next.push(replacement); injected = true; }
            if (right) next.push({ ...item, text: right });
        }
        cursor = itemEnd;
    }
    return injected ? next : null;
}

/** Older wrappers included index; native BlockNote cursors do not. */
export function legacyCursorIndex(value: object): number | undefined {
    const index: unknown = Reflect.get(value, 'index');
    return typeof index === 'number' ? index : undefined;
}
