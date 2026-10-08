import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { BrainReviewFindings } from './BrainReviewFindings';
import { reviewFindings } from './brainReviewFindingsModel';
import { VaultEditorContext } from '../../../shared/editor/VaultEditorContext';

const id = '9c05e9c1-dd54-470f-bac9-ff59cbd70bd4';
const container = document.createElement('div');
let root: ReturnType<typeof createRoot> | undefined;
beforeAll(() => { Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(() => { act(() => { root?.unmount(); }); root = undefined; });

it('extracts note and resource identities and deduplicates multiple findings for one note', () => {
    expect(reviewFindings([{ id, title: 'A note' }, { id, title: 'A note' }, null]))
        .toEqual([{ id, title: 'A note' }]);
    expect(reviewFindings([{ resource_id: id }])).toEqual([{ id, title: '' }]);
    expect(reviewFindings([{ notes: [{ id, title: 'Duplicate note' }] }])).toEqual([{ id, title: 'Duplicate note' }]);
});

it('opens the affected record by ID and closes the review, while showing its title', () => {
    const open = vi.fn(); const close = vi.fn();
    root = createRoot(container);
    act(() => { root?.render(<VaultEditorContext.Provider value={{ allTables: [], idToTitle: { [id]: 'A resource' }, onCreateRecord: null, onDeletePage: null, onEditSchema: null, onOpenParallel: null, onOpenPage: open, pageId: null, registry: { databases: [], tables: [], views: [] } }}>
        <BrainReviewFindings label="Changed resources" count={1} value={[{ resource_id: id }]} onClose={close} />
    </VaultEditorContext.Provider>); });
    const details = container.querySelector('details');
    if (!details) throw new Error('Missing category');
    act(() => { details.open = true; details.dispatchEvent(new Event('toggle')); });
    const link = container.querySelector('button');
    expect(link?.textContent).toBe('A resource');
    act(() => { link?.click(); });
    expect(open).toHaveBeenCalledWith(id);
    expect(close).toHaveBeenCalledOnce();
});
