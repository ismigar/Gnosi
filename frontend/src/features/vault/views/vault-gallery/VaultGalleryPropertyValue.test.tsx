import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { subscribeAppEvent, type RelationUnlinkedEventDetail } from '../../../../shared/platform/app-events';
import type { RelationItemProps } from '../../properties/RelationItem';
import { RELATION_UNLINKED_EVENT } from '../../properties/relationItemUtils';
import { VaultGalleryPropertyValue } from './VaultGalleryPropertyValue';

const mocks = vi.hoisted(() => ({ relation: vi.fn<(props: RelationItemProps) => void>() }));

vi.mock('../../properties/RelationItem', () => ({ RelationItem: (props: RelationItemProps) => {
    mocks.relation(props);
    return <span data-relation={props.relationId}>{props.title}</span>;
} }));

type PropertyProps = ComponentProps<typeof VaultGalleryPropertyValue>;

const baseProps: PropertyProps = {
    allNotes: [],
    field: 'Source',
    idToTitle: {},
    localeSettings: {
        currencyCode: 'EUR', dateFormat: 'locale', dateLocale: 'en-US',
        decimalSymbol: '.', numberLocale: 'en-US',
    },
    metadataKey: 'source_alias',
    note: { id: 'page', metadata: null },
    schema: {},
    type: 'relation',
    value: ['first', 'second'],
};

function relation(id: string): RelationItemProps {
    const props = mocks.relation.mock.calls.find(([candidate]) => candidate.relationId === id)?.[0];
    if (!props) throw new Error(`Missing relation ${id}`);
    return props;
}

describe('VaultGalleryPropertyValue open inputs', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    function render(overrides: Partial<PropertyProps> = {}): void {
        act(() => { root.render(<VaultGalleryPropertyValue {...baseProps} {...overrides} />); });
    }

    it('matches opaque table IDs by identity and renders scalar related titles', () => {
        const tableId = new Map([['imported', 4n]]);
        const onNoteSelect = vi.fn();
        render({
            allNotes: [
                { id: 'first', title: 42n, resolved_table_id: tableId, metadata: null },
                { id: 'second', metadata: { table_id: tableId }, title: false },
                { id: 'first', title: 'Wrong table', resolved_table_id: new Map(tableId), metadata: null },
            ],
            schema: { Source_config: { relation_database_id: tableId } },
            idToTitle: { second: 'Fallback title' },
            onNoteSelect,
        });
        expect(relation('first').title).toBe('42');
        expect(relation('second').title).toBe('Fallback title');
        relation('first').onOpen?.('first');
        expect(onNoteSelect).toHaveBeenCalledWith('first');
        expect(relation('first').onRemove).toBeUndefined();
    });

    it('keeps imported relation coercion, including nested and cyclic objects', () => {
        const imported = { name: ' first ', toString() { return this.name; } };
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        const value = [imported, ['second', 'third'], cyclic, 4n, null];
        render({ value });
        expect(mocks.relation.mock.calls.map(([props]) => props.relationId))
            .toEqual(['first', 'second,third', '[object Object]', '4']);
        expect(relation('first').onOpen).toBeUndefined();
        expect(value[0]).toBe(imported);
        expect(cyclic.self).toBe(cyclic);
    });

    it('propagates native coercion errors rather than discarding the value', () => {
        const error = new Error('Imported relation cannot stringify');
        const value = { toString() { throw error; } };
        expect(() => { render({ value }); }).toThrow(error);
        expect(mocks.relation).not.toHaveBeenCalled();
    });

    it('awaits synchronous unknown returns and emits the exact undo payload', async () => {
        const opaque = new Map();
        const onUpdateNote = vi.fn((_id: string, _patch: { readonly metadata: Record<string, string[]> }): unknown => opaque);
        const events: RelationUnlinkedEventDetail[] = [];
        const unsubscribe = subscribeAppEvent(RELATION_UNLINKED_EVENT, detail => { events.push(detail); });
        const value = ['first', 'second'];
        try {
            render({ onUpdateNote, value, allNotes: [{ id: 'first', title: 42n, metadata: null }] });
            await relation('first').onRemove?.('first');
            expect(onUpdateNote).toHaveBeenCalledWith('page', { metadata: { source_alias: ['second'] } });
            expect(events).toEqual([{
                pageId: 'page', field: 'Source', metadataKey: 'source_alias', relationId: 'first',
                relationTitle: 42n, previousValue: ['first', 'second'], nextValue: ['second'],
            }]);
            expect(value).toEqual(['first', 'second']);
        } finally { unsubscribe(); }
    });

    it('announces undo only after async save settles and preserves callback mutations', async () => {
        let complete: ((value: unknown) => void) | undefined;
        const pending = new Promise<unknown>(resolve => { complete = resolve; });
        const onUpdateNote = vi.fn((_id: string, patch: { readonly metadata: Record<string, string[]> }) => {
            patch.metadata.source_alias?.push('callback-added');
            return pending;
        });
        const events: RelationUnlinkedEventDetail[] = [];
        const unsubscribe = subscribeAppEvent(RELATION_UNLINKED_EVENT, detail => { events.push(detail); });
        const value = ['first', 'second'];
        try {
            render({ onUpdateNote, value });
            const operation = relation('first').onRemove?.('first');
            expect(events).toEqual([]);
            complete?.(new Set([4n]));
            await operation;
            expect(events[0]?.nextValue).toEqual(['second', 'callback-added']);
            expect(events[0]?.previousValue).toEqual(value);
            expect(value).toEqual(['first', 'second']);
        } finally {
            complete?.(undefined);
            unsubscribe();
        }
    });

    it.each(['sync', 'async'])('preserves %s failures without announcing an undoable save', async mode => {
        const error = new Error('Save rejected');
        const onUpdateNote = vi.fn((): unknown => {
            if (mode === 'sync') throw error;
            return Promise.reject(error);
        });
        const listener = vi.fn();
        const unsubscribe = subscribeAppEvent(RELATION_UNLINKED_EVENT, listener);
        try {
            render({ onUpdateNote });
            await expect(relation('first').onRemove?.('first')).rejects.toBe(error);
            expect(listener).not.toHaveBeenCalled();
            expect(onUpdateNote).toHaveBeenCalledOnce();
        } finally { unsubscribe(); }
    });

    it('renders an absent metadata value as the existing placeholder', () => {
        render({ value: null });
        expect(container.textContent).toBe('-');
        expect(mocks.relation).not.toHaveBeenCalled();
    });
});
