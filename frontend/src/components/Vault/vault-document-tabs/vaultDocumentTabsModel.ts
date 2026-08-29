export const QUICK_OPEN_DROPDOWN_WIDTH = 380;
export const QUICK_OPEN_VIEWPORT_MARGIN = 16;


export interface DocumentTab {
    readonly id: string;
    readonly isTable?: boolean;
    readonly title?: string;
}


export interface QuickOpenItem {
    readonly id: string;
    readonly subtitle?: string;
    readonly title?: string;
    readonly type: string;
}


export interface QuickOpenPosition {
    readonly left: number;
    readonly top: number;
    readonly width: number;
}


export function foldDocumentSearch(value: unknown): string {
    if (
        typeof value !== 'string'
        && typeof value !== 'number'
        && typeof value !== 'bigint'
        && typeof value !== 'boolean'
    ) return '';
    return String(value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/gu, '');
}


export function filterQuickOpenItems(
    items: readonly QuickOpenItem[],
    query: string,
    limit = 12,
): QuickOpenItem[] {
    const foldedQuery = foldDocumentSearch(query.trim());
    if (!foldedQuery) return items.slice(0, limit);
    return items.filter((item) => (
        foldDocumentSearch(item.title ?? '').includes(foldedQuery)
        || foldDocumentSearch(item.subtitle ?? '').includes(foldedQuery)
    )).slice(0, limit);
}


export function canQuickOpenInParallel(
    item: QuickOpenItem | null | undefined,
    hasParallelHandler: boolean,
): boolean {
    return Boolean(
        item
        && hasParallelHandler
        && (item.type === 'page' || item.type === 'table'),
    );
}


export function calculateQuickOpenPosition(
    anchor: Pick<DOMRect, 'bottom' | 'left'> | null,
    viewportWidth: number,
): QuickOpenPosition {
    const width = Math.min(
        QUICK_OPEN_DROPDOWN_WIDTH,
        Math.max(0, viewportWidth - QUICK_OPEN_VIEWPORT_MARGIN * 2),
    );
    if (!anchor) return {
        left: QUICK_OPEN_VIEWPORT_MARGIN,
        top: QUICK_OPEN_VIEWPORT_MARGIN,
        width,
    };
    const maxLeft = Math.max(
        QUICK_OPEN_VIEWPORT_MARGIN,
        viewportWidth - width - QUICK_OPEN_VIEWPORT_MARGIN,
    );
    return {
        left: Math.min(
            Math.max(anchor.left, QUICK_OPEN_VIEWPORT_MARGIN),
            maxLeft,
        ),
        top: anchor.bottom + 8,
        width,
    };
}


export function isEditableDocumentTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tagName = target.tagName.toLowerCase();
    return target.isContentEditable
        || tagName === 'input'
        || tagName === 'textarea'
        || tagName === 'select';
}


export function tabIndexForShortcut(key: string, tabCount: number): number | null {
    if (!/^[1-9]$/u.test(key) || tabCount <= 0) return null;
    if (key === '9') return tabCount - 1;
    return Math.min(Number(key) - 1, tabCount - 1);
}
