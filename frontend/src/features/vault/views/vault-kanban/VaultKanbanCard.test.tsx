import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { subscribeAppEvent, type RelationUnlinkedEventDetail } from '../../../../shared/platform/app-events';
import type { RelationItemProps } from '../../properties/RelationItem';
import { VaultKanbanCard, type VaultKanbanCardProps } from './VaultKanbanCard';

const relationProbe = vi.hoisted(() => vi.fn<(props: RelationItemProps) => null>(() => null));
vi.mock('../../properties/RelationItem', () => ({ RelationItem: relationProbe }));

const baseProps: VaultKanbanCardProps = {
    canDrag: false,
    fields: [],
    fromStatus: 'Idea',
    idToTitle: {},
    isSelected: false,
    localeSettings: {
        currencyCode: 'EUR', dateFormat: 'locale', dateLocale: 'en-US',
        decimalSymbol: '.', numberLocale: 'en-US',
    },
    note: { id: 'page', metadata: null },
    onDragEnd: () => undefined,
    onToggleSelect: () => undefined,
    schema: {},
    selectedCount: 0,
    titlePreviewProps: {},
    untitledLabel: 'Untitled',
};

function relationRemoval(): NonNullable<RelationItemProps['onRemove']> {
    const remove = relationProbe.mock.calls[0]?.[0].onRemove;
    if (!remove) throw new Error('Relation removal callback missing');
    return remove;
}

afterEach(() => { vi.clearAllMocks(); });

describe('VaultKanbanCard open inputs', () => {
    it('keeps Date native coercion for numeric and opaque timestamps', () => {
        const timestamp = 1_700_000_000_000;
        const opaque = {
            [Symbol.toPrimitive](hint: string) {
                expect(this).toBe(opaque);
                expect(hint).toBe('default');
                return timestamp;
            },
        };
        for (const value of [timestamp, opaque, new Date(timestamp)]) {
            const html = renderToStaticMarkup(<VaultKanbanCard {...baseProps}
                note={{ id: 'page', last_modified: value }} />);
            expect(html).toContain(new Date(timestamp).toLocaleDateString());
        }
        const failure = new Error('native date coercion failed');
        expect(() => renderToStaticMarkup(<VaultKanbanCard {...baseProps}
            note={{ id: 'page', last_modified: { [Symbol.toPrimitive]() { throw failure; } } }} />))
            .toThrow(failure);
        expect(() => renderToStaticMarkup(<VaultKanbanCard {...baseProps}
            note={{ id: 'page', last_modified: 1n }} />)).toThrow(TypeError);
    });

    it('retains existing object display and recursive array formatting without touching metadata', () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        const metadata = { Text: [cyclic, new Map(), Symbol('value'), 7n, false, null] };
        const html = renderToStaticMarkup(<VaultKanbanCard {...baseProps}
            fields={[{ field: 'Text', type: 'text' }]} note={{ id: 'page', metadata }} />);
        expect(html).toContain('[object Object],[object Map],[object Symbol],7,false,');
        expect(metadata.Text[0]).toBe(cyclic);
    });

    it('preserves native number formatting and propagates coercion failures', () => {
        const failure = new Error('number coercion failed');
        expect(() => renderToStaticMarkup(<VaultKanbanCard {...baseProps}
            fields={[{ field: 'Number', type: 'number' }]}
            note={{ id: 'page', metadata: { Number: { [Symbol.toPrimitive]() { throw failure; } } } }} />))
            .toThrow(failure);
    });

    it('does not silently sanitize recursive arrays that previously raised a rendering error', () => {
        const cyclic: unknown[] = [];
        cyclic.push(cyclic);
        expect(() => renderToStaticMarkup(<VaultKanbanCard {...baseProps}
            fields={[{ field: 'Text', type: 'text' }]} note={{ id: 'page', metadata: { Text: cyclic } }} />))
            .toThrow(RangeError);
    });

    it('forwards optional navigation and decoratively named relation updates, including undo values', async () => {
        const relationValues = ['related', 'retained'];
        const metadata = { '🔗 Related': relationValues, opaque: new Set() };
        const onOpen = vi.fn<(id: string) => void>();
        const onUpdateNote = vi.fn<NonNullable<VaultKanbanCardProps['onUpdateNote']>>(() => new Map());
        const events = vi.fn<(detail: RelationUnlinkedEventDetail) => void>();
        const unsubscribe = subscribeAppEvent('gnosi:relation-unlinked', (detail) => { events(detail); });
        try {
            renderToStaticMarkup(<VaultKanbanCard {...baseProps}
                note={{ id: 'page', metadata }} fields={[{ field: 'Related', type: 'relation' }]}
                idToTitle={{ related: 'Related title' }} onNoteSelect={onOpen} onUpdateNote={onUpdateNote} />);
            expect(relationProbe.mock.calls[0]?.[0].onOpen).toBe(onOpen);
            relationProbe.mock.calls[0]?.[0].onOpen?.('related');
            expect(onOpen).toHaveBeenCalledWith('related');
            await relationRemoval()('related');
            expect(onUpdateNote).toHaveBeenCalledWith('page', { metadata: { '🔗 Related': ['retained'] } });
            expect(events).toHaveBeenCalledWith({
                pageId: 'page', field: 'Related', metadataKey: '🔗 Related',
                relationId: 'related', relationTitle: 'Related title',
                previousValue: ['related', 'retained'], nextValue: ['retained'],
            });
            expect(metadata['🔗 Related']).toBe(relationValues);
            expect(relationValues).toEqual(['related', 'retained']);
        } finally {
            unsubscribe();
        }
    });

    it.each(['sync', 'async'])('preserves %s removal failures without announcing undo for an unsaved change', async (mode) => {
        const failure = new Error('Relation update failed');
        const onUpdateNote = vi.fn<NonNullable<VaultKanbanCardProps['onUpdateNote']>>(() => {
            if (mode === 'sync') throw failure;
            return Promise.reject(failure);
        });
        const events = vi.fn<(detail: RelationUnlinkedEventDetail) => void>();
        const unsubscribe = subscribeAppEvent('gnosi:relation-unlinked', (detail) => { events(detail); });
        try {
            renderToStaticMarkup(<VaultKanbanCard {...baseProps}
                note={{ id: 'page', metadata: { Related: ['related'] } }}
                fields={[{ field: 'Related', type: 'relation' }]} onUpdateNote={onUpdateNote} />);
            expect(relationProbe.mock.calls[0]?.[0].onOpen).toBeUndefined();
            await expect(relationRemoval()('related')).rejects.toBe(failure);
            expect(events).not.toHaveBeenCalled();
        } finally {
            unsubscribe();
        }
    });
});
