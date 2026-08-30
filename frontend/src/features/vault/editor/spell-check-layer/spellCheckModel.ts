import type { Speller } from '../spellcheck/nspellManager';
import type { SpellError } from '../spellcheck/spellcheckPlugin';


export interface SpellMenuState extends SpellError {
    readonly suggestions: readonly string[];
    readonly x: number;
    readonly y: number;
}


export interface SpellMenuPosition {
    readonly left: number;
    readonly top: number;
}


interface ViewportSize {
    readonly height: number;
    readonly width: number;
}


function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return value !== null && typeof value === 'object';
}


function collectText(value: unknown): string[] {
    if (Array.isArray(value)) return value.flatMap(collectText);
    if (!isRecord(value)) return [];
    const ownText = typeof value.text === 'string' ? [value.text] : [];
    return [...ownText, ...collectText(value.content)];
}


export function extractEditorText(document: readonly unknown[]): string {
    return document
        .map((block) => collectText(block).join(''))
        .join(' ')
        .trim();
}


export function getSpellSuggestions(
    speller: Speller | null,
    word: string,
): readonly string[] {
    try {
        return (speller?.suggest(word) ?? []).slice(0, 7);
    } catch {
        return [];
    }
}


export function fitSpellMenu(
    menu: Pick<SpellMenuState, 'x' | 'y'>,
    viewport: ViewportSize,
): SpellMenuPosition {
    const horizontalMargin = 8;
    const maximumLeft = Math.max(horizontalMargin, viewport.width - 230);
    const maximumTop = Math.max(horizontalMargin, viewport.height - 260);
    return {
        left: Math.max(horizontalMargin, Math.min(menu.x, maximumLeft)),
        top: Math.max(horizontalMargin, Math.min(menu.y, maximumTop)),
    };
}
