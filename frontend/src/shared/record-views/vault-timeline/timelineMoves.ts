import type { TimelineRecord, TimelinePatch } from './types';

export type TimelineMove = 'up' | 'down' | 'indent' | 'outdent';
export type TimelinePlacement = 'before' | 'inside' | 'after';

export function planTimelineMove(
    notes: readonly TimelineRecord[],
    parentOf: (note: TimelineRecord) => string | null,
    sourceId: string,
    targetId: string,
    placement: TimelinePlacement,
): readonly { id: string; patch: TimelinePatch }[] {
    const source = notes.find(note => note.id === sourceId);
    const target = notes.find(note => note.id === targetId);
    if (!source || !target || sourceId === targetId) return [];
    const parentId = placement === 'inside' ? targetId : parentOf(target);
    // A subtree must never become its own ancestor, including through hidden rows.
    const seen = new Set<string>([sourceId]);
    let ancestor = parentId;
    while (ancestor) {
        if (seen.has(ancestor)) return [];
        seen.add(ancestor);
        const note = notes.find(candidate => candidate.id === ancestor);
        ancestor = note ? parentOf(note) : null;
    }
    const siblings = notes.filter(note => note.id !== sourceId && parentOf(note) === parentId);
    const targetIndex = siblings.findIndex(note => note.id === targetId);
    const index = placement === 'inside' ? siblings.length
        : targetIndex + (placement === 'after' ? 1 : 0);
    if (index < 0) return [];
    siblings.splice(index, 0, source);
    return siblings.map((note, order) => ({
        id: note.id,
        patch: { metadata: {
            timeline_order: order,
            ...(note.id === sourceId ? { parent_id: parentId } : {}),
        } },
    }));
}

export function timelineMoveTarget(
    notes: readonly TimelineRecord[],
    parentOf: (note: TimelineRecord) => string | null,
    id: string,
    action: TimelineMove,
): { id: string; placement: TimelinePlacement } | null {
    const source = notes.find(note => note.id === id);
    if (!source) return null;
    const parentId = parentOf(source);
    if (action === 'outdent') return parentId && notes.some(note => note.id === parentId)
        ? { id: parentId, placement: 'after' } : null;
    const siblings = notes.filter(note => parentOf(note) === parentId);
    const index = siblings.findIndex(note => note.id === id);
    const target = siblings[index + (action === 'down' ? 1 : -1)];
    return target ? { id: target.id, placement: action === 'indent' ? 'inside'
        : action === 'down' ? 'after' : 'before' } : null;
}
