import { describe, expect, it } from 'vitest';

import { restoreToggleExpansionState, saveToggleExpansionState } from './toggleExpansionStateUtils';

function createStorage(values = {}) {
    const data = new Map(Object.entries(values));
    return {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => data.set(key, String(value)),
    };
}

describe('toggle expansion state', () => {
    it('restores an open toggle after its editor assigns a new block id', () => {
        const storage = createStorage();
        const initialBlocks = [{
            id: 'old-notes', type: 'toggleListItem', content: [{ type: 'text', text: 'Notes' }], children: [{
                id: 'old-index', type: 'toggleListItem', content: [{ type: 'text', text: 'Notes índex' }], children: [],
            }],
        }];
        storage.setItem('toggle-old-notes', 'true');
        storage.setItem('toggle-old-index', 'true');
        saveToggleExpansionState('page-1', initialBlocks, storage);

        const remountedBlocks = [{
            id: 'new-notes', type: 'toggleListItem', content: [{ type: 'text', text: 'Notes' }], children: [{
                id: 'new-index', type: 'toggleListItem', content: [{ type: 'text', text: 'Notes índex' }], children: [],
            }],
        }];
        restoreToggleExpansionState('page-1', remountedBlocks, storage);

        expect(storage.getItem('toggle-new-notes')).toBe('true');
        expect(storage.getItem('toggle-new-index')).toBe('true');
    });

    it('does not apply a saved state to a different toggle structure', () => {
        const storage = createStorage({
            'gnosi.vault.toggle-expansion.page-1': JSON.stringify({ '0:Notes': true }),
        });
        const blocks = [{
            id: 'new-toggle', type: 'toggleListItem', content: [{ type: 'text', text: 'Other section' }], children: [],
        }];

        restoreToggleExpansionState('page-1', blocks, storage);

        expect(storage.getItem('toggle-new-toggle')).toBeNull();
    });
});
