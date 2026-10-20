/** Resolve visible tabs in saved order, retaining the anchor for legacy preferences. */
export function orderedPinnedViews<T extends { id?: string | null }>(
    views: readonly T[], anchorId: string, pins: ReadonlySet<string>,
): T[] {
    const byId = new Map(views.map(view => [view.id, view]));
    const ids = pins.has(anchorId) ? [...pins] : [anchorId, ...pins];
    return ids.flatMap(id => {
        const view = byId.get(id);
        return view ? [view] : [];
    });
}
