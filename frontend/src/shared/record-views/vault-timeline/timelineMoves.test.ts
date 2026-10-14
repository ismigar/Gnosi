import { describe, expect, it } from 'vitest';
import { planTimelineMove, timelineMoveTarget } from './timelineMoves';
import type { TimelineRecord } from './types';

const notes: TimelineRecord[] = [
    { id: 'a', metadata: { title: 'Preserved', timeline_order: 0 } },
    { id: 'child', metadata: { parent_id: 'a' } },
    { id: 'grandchild', metadata: { parent_id: 'child' } },
    { id: 'b', metadata: { timeline_order: 1 } },
    { id: 'c', metadata: { timeline_order: 2 } },
];
const parentOf = (note: TimelineRecord) => typeof note.metadata?.parent_id === 'string'
    ? note.metadata.parent_id : null;

describe('timeline row moves', () => {
    it('moves a whole subtree among siblings without rewriting descendants or unrelated metadata', () => {
        expect(timelineMoveTarget(notes, parentOf, 'a', 'down')).toEqual({ id: 'b', placement: 'after' });
        const changes = planTimelineMove(notes, parentOf, 'a', 'b', 'after');
        expect(changes.map(change => change.id)).toEqual(['b', 'a', 'c']);
        expect(changes[1]?.patch.metadata).toEqual({ timeline_order: 1, parent_id: null });
        expect(notes[0]?.metadata?.title).toBe('Preserved');
        expect(notes[1]?.metadata?.parent_id).toBe('a');
    });
    it('indents under the previous sibling and outdents after the parent', () => {
        expect(timelineMoveTarget(notes, parentOf, 'b', 'indent')).toEqual({ id: 'a', placement: 'inside' });
        expect(planTimelineMove(notes, parentOf, 'b', 'a', 'inside')[1]?.patch.metadata)
            .toEqual({ timeline_order: 1, parent_id: 'a' });
        expect(timelineMoveTarget(notes, parentOf, 'child', 'outdent')).toEqual({ id: 'a', placement: 'after' });
        expect(planTimelineMove(notes, parentOf, 'child', 'a', 'after').map(change => change.id))
            .toEqual(['a', 'child', 'b', 'c']);
    });
    it('rejects self and descendant targets including hidden grandchildren', () => {
        expect(planTimelineMove(notes, parentOf, 'a', 'a', 'inside')).toEqual([]);
        expect(planTimelineMove(notes, parentOf, 'a', 'grandchild', 'inside')).toEqual([]);
        expect(planTimelineMove(notes, parentOf, 'a', 'grandchild', 'after')).toEqual([]);
    });
    it('disables movements at sibling and hierarchy boundaries', () => {
        expect(timelineMoveTarget(notes, parentOf, 'a', 'up')).toBeNull();
        expect(timelineMoveTarget(notes, parentOf, 'a', 'indent')).toBeNull();
        expect(timelineMoveTarget(notes, parentOf, 'a', 'outdent')).toBeNull();
        expect(timelineMoveTarget(notes, parentOf, 'c', 'down')).toBeNull();
    });
});
