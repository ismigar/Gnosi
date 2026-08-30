import { afterEach, describe, expect, it } from 'vitest';
import { removeStorage, writeStorage } from '../../../shared/platform/browser-storage';
import { groupSourceIds, isIndexing, moveResource, nextMobileTab, notebookChatContext, notebookStorageIdentity, NOTEBOOK_USER_ID, toggleIds } from './notebookModel';
import { notebookFixture, sourcesFixture } from './notebookTestFixtures';

afterEach(() => { removeStorage(NOTEBOOK_USER_ID); });

describe('notebook model', () => {
    it('toggles sources immutably and keeps unrelated selection', () => {
        const selected = new Set(['source-a', 'source-c']);
        expect([...toggleIds(selected, ['source-a', 'source-b'], true)]).toEqual(['source-c']);
        expect([...toggleIds(selected, ['source-a', 'source-b'], false)]).toEqual(['source-a', 'source-c', 'source-b']);
        expect([...selected]).toEqual(['source-a', 'source-c']);
    });

    it('collects group sources and moves a Resource without duplicating ownership', () => {
        const groups = [{ id: 'one', name: 'One', resource_ids: ['resource-1'] }, { id: 'two', name: 'Two', resource_ids: ['resource-2'] }];
        expect(groupSourceIds(groups[0] ?? { id: '', name: '', resource_ids: [] }, sourcesFixture().items)).toEqual(['source-a', 'source-b']);
        expect(moveResource(groups, 'resource-1', 'two')).toEqual([
            { id: 'one', name: 'One', resource_ids: [] },
            { id: 'two', name: 'Two', resource_ids: ['resource-2', 'resource-1'] },
        ]);
        expect(moveResource(groups, 'resource-1', '')[0]?.resource_ids).toEqual([]);
        expect(groups[0]?.resource_ids).toEqual(['resource-1']);
    });

    it('wraps accessible mobile tab navigation and ignores unrelated keys', () => {
        expect(nextMobileTab('settings', 'ArrowRight')).toBe('sources');
        expect(nextMobileTab('sources', 'ArrowLeft')).toBe('settings');
        expect(nextMobileTab('chat', 'Home')).toBe('sources');
        expect(nextMobileTab('chat', 'End')).toBe('settings');
        expect(nextMobileTab('chat', 'Enter')).toBeUndefined();
    });

    it('preserves the streaming context contract including an explicitly empty selection', () => {
        const notebook = notebookFixture();
        expect(notebookChatContext(notebook, false, new Set())[0]?.scope).toEqual({ selection: 'all', source_ids: [] });
        expect(notebookChatContext(notebook, true, new Set())[0]?.scope).toEqual({ selection: 'sources', source_ids: [] });
        expect(notebookChatContext(notebook, true, new Set(['source-b']))).toEqual([{
            id: 'notebook:notebook-1', type: 'notebook', ref: 'notebook-1', label: 'Research notebook',
            scope: { selection: 'sources', source_ids: ['source-b'] },
        }]);
    });

    it('reads the existing persisted identity and retains the personal fallback', () => {
        expect(notebookStorageIdentity()).toBe('personal');
        writeStorage(NOTEBOOK_USER_ID, 'member-42');
        expect(notebookStorageIdentity()).toBe('member-42');
        writeStorage(NOTEBOOK_USER_ID, '');
        expect(notebookStorageIdentity()).toBe('personal');
    });

    it('polls queued/indexing only', () => {
        const notebook = notebookFixture();
        expect(isIndexing(notebook)).toBe(false);
        const progress = { state: 'queued', processed: 0, total: 2, percent: 0, revision: 2, cancellable: true, cancel_requested_at: null, current_resource_id: null, current_resource_title: null, error: null, job_id: 'job' };
        expect(isIndexing({ ...notebook, progress })).toBe(true);
        expect(isIndexing({ ...notebook, progress: { ...progress, state: 'indexing' } })).toBe(true);
        expect(isIndexing({ ...notebook, progress: { ...progress, state: 'available' } })).toBe(false);
    });
});
