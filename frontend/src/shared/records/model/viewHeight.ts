export type ViewHeightMode = 'limited' | 'content';

/** Older views keep their 70% cap; persisted values must be finite percentages. */
export function viewHeightPercent(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(1, Math.min(100, Math.round(value))) : 70;
}

/** Preserve the existing feed flow and bounded embeds when no choice is saved. */
export function viewHeightMode(value: unknown, viewType: string): ViewHeightMode {
    if (value === 'limited' || value === 'content') return value;
    return viewType === 'feed' ? 'content' : 'limited';
}
