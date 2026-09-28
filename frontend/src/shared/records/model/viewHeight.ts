export type ViewHeightMode = 'limited' | 'content';

/** Preserve the existing feed flow and bounded embeds when no choice is saved. */
export function viewHeightMode(value: unknown, viewType: string): ViewHeightMode {
    if (value === 'limited' || value === 'content') return value;
    return viewType === 'feed' ? 'content' : 'limited';
}
