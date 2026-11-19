import { describe, expect, it } from 'vitest';
import { createShapeId, createTLStore, defaultShapeUtils, type TLStore } from '@bigbluebutton/tldraw';
import { b64Vecs, toRichText } from '@tldraw/tlschema';

import { PageCardShapeUtil } from './canvasPageCardShape';
import { JsonCanvasNodeShapeUtil } from './json-canvas/JsonCanvasNodeShape';
import captured from './drawing-snapshot/v5-stroke.fixture.json';
import { loadDrawingDocument, serializeDrawingDocument } from './drawingSnapshot';

type Fields = Record<string, unknown>;
const stroke = captured.document.store['shape:Wn3CurXQazs5x-v1Jt8k4'];
const page = captured.document.store['page:page'];

function newStore(): TLStore {
    return createTLStore({ shapeUtils: [...defaultShapeUtils, PageCardShapeUtil, JsonCanvasNodeShapeUtil] });
}

function legacyShape(id: string, type: string, props: Fields, overrides: Fields = {}) {
    return { ...stroke, id: `shape:${id}`, type, props, ...overrides };
}

function withRecords(...additions: (Fields & { id: string })[]) {
    const store: Record<string, Fields> = structuredClone(captured.document.store);
    for (const record of additions) store[record.id] = record;
    return { document: { schema: captured.document.schema, store }, session: captured.session };
}

const richText = {
    type: 'doc',
    content: [
        { type: 'paragraph', content: [
            { type: 'text', text: 'One', marks: [{ type: 'bold' }] }, { type: 'hardBreak' }, { type: 'text', text: 'Two' },
        ] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Three' }] },
    ],
};
const arrow = legacyShape('arrow', 'arrow', {
    kind: 'arc', elbowMidPoint: 0.5, dash: 'solid', size: 'm', fill: 'none', color: 'blue', labelColor: 'black',
    bend: 0, start: { x: 0, y: 0 }, end: { x: 32, y: 16 }, arrowheadStart: 'none', arrowheadEnd: 'arrow',
    richText, labelPosition: 0.6, font: 'sans', scale: 1,
});
const binding = {
    id: 'binding:card', typeName: 'binding', type: 'arrow', fromId: arrow.id, toId: 'shape:card',
    props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 1 }, isExact: true, isPrecise: true, snap: 'none' },
    meta: { provenance: 'fixture' },
};

function nativeRecord(store: TLStore, id: string) {
    return store.serialize()[createShapeId(id)];
}

describe('drawing snapshot compatibility', () => {
    it('restores every point of the captured v5 stroke and preserves its entire source across edits and reopens', () => {
        const store = newStore();
        const before = JSON.stringify(captured);
        const original = loadDrawingDocument(store, captured);
        const id = createShapeId(stroke.id.slice('shape:'.length));
        expect(store.get(id)).toMatchObject({
            x: 326, y: 287, props: {
                segments: [{ type: 'free', points: Array.from({ length: 13 }, (_, n) => ({ x: n * 8, y: n * 4, z: 0.5 })) }],
            },
        });
        store.update(id, shape => ({ ...shape, x: 410 }));
        const first = serializeDrawingDocument(store, original);
        expect(first.originalTldrawV5).toEqual(captured);
        const reopened = newStore();
        const retained = loadDrawingDocument(reopened, structuredClone(first));
        expect(reopened.get(id)?.x).toBe(410);
        reopened.update(id, shape => ({ ...shape, y: 205 }));
        const second = serializeDrawingDocument(reopened, retained);
        expect(second.originalTldrawV5).toEqual(captured);
        expect(JSON.stringify(second.originalTldrawV5)).toBe(before);
        expect(second.document).toMatchObject({ store: { [id]: { x: 410, y: 205 } }, schema: { schemaVersion: 1 } });
        expect(JSON.stringify(captured)).toBe(before);
    });

    it('decodes pressure and applies lazy resize to a three-dimensional highlighter path', () => {
        const points = [{ x: 0, y: 0, z: 0.25 }, { x: 8, y: 4, z: 0.75 }, { x: 12, y: 8, z: 0.5 }];
        const highlight = legacyShape('pressure', 'highlight', {
            segments: [{ type: 'free', path: b64Vecs.encodePoints(points) }], size: 's', color: 'red',
            isPen: true, isComplete: true, scale: 1, scaleX: -2, scaleY: 3,
        });
        const store = newStore();
        loadDrawingDocument(store, withRecords(highlight));
        expect(nativeRecord(store, 'pressure')).toMatchObject({
            props: { isPen: true, segments: [{ points: [
                { x: -0, y: 0, z: 0.25 }, { x: -16, y: 12, z: 0.75 }, { x: -24, y: 24, z: 0.5 },
            ] }] },
        });
    });

    it('loads earlier v5 point arrays without rounding their coordinates or pressure', () => {
        const points = [{ x: 0, y: 0, z: 0.123456 }, { x: 1.234567, y: -3.456789, z: 0.987654 }];
        const old = withRecords({ ...stroke, props: { ...stroke.props, segments: [{ type: 'free', points }], isPen: true } });
        const snapshot = {
            ...old,
            document: { ...old.document, schema: {
                ...old.document.schema, sequences: { ...old.document.schema.sequences, 'com.tldraw.shape.draw': 2 },
            } },
        };
        const store = newStore();
        const original = loadDrawingDocument(store, snapshot);
        expect(nativeRecord(store, stroke.id.slice(6))).toMatchObject({ props: { segments: [{ type: 'free', points }] } });
        expect(serializeDrawingDocument(store, original).originalTldrawV5).toEqual(snapshot);
    });

    it('preserves pages, grouped shapes, card references, JSON Canvas payloads, arrow bindings and asset sources', () => {
        const otherPage = { ...page, id: 'page:other', name: 'Second', index: 'a2', meta: { jsonCanvasRoot: '{"version":1}' } };
        const parent = { parentId: otherPage.id };
        const group = legacyShape('group', 'group', {}, parent);
        const card = legacyShape('card', 'page-card', {
            w: 260, h: 170, pageId: 'vault-7', pageTitle: 'Field notes',
        }, { parentId: group.id });
        const json = JSON.stringify({ id: 'source', type: 'text', text: 'Body', sourceMetadata: 42 });
        const node = legacyShape('canvas', 'json-canvas-node', { w: 120, h: 80, data: json }, parent);
        const end = { ...binding, id: 'binding:other', toId: node.id, props: { ...binding.props, terminal: 'end' } };
        const asset = {
            typeName: 'asset', id: 'asset:pasted', type: 'image', meta: { ref: 'source' },
            props: {
                name: 'sketch.png', w: 64, h: 32, mimeType: 'image/png', isAnimated: false,
                fileSize: 12, pixelRatio: 2, src: 'data:image/png;base64,AA==',
            },
        };
        const image = legacyShape('image', 'image', {
            w: 48, h: 24, assetId: asset.id, url: '', crop: null, playing: true, flipX: false, flipY: false, altText: 'Sketch',
        }, parent);
        const legacy = withRecords(otherPage, group, card, node, { ...arrow, ...parent }, binding, end, asset, image);
        const store = newStore();
        const snapshot = { ...legacy, session: { currentPageId: otherPage.id } };
        const original = loadDrawingDocument(store, snapshot);
        expect(nativeRecord(store, 'card')).toMatchObject({ parentId: group.id, props: card.props });
        expect(nativeRecord(store, 'canvas')).toMatchObject({ parentId: otherPage.id, props: node.props });
        expect(nativeRecord(store, 'arrow')).toMatchObject({ props: {
            text: 'One\nTwo\nThree',
            start: {
                type: 'binding', boundShapeId: card.id, normalizedAnchor: binding.props.normalizedAnchor,
                isExact: true, isPrecise: true,
            },
            end: { type: 'binding', boundShapeId: node.id },
        } });
        const saved = serializeDrawingDocument(store, original);
        expect(saved).toMatchObject({
            document: { store: {
                [otherPage.id]: otherPage,
                [asset.id]: { props: { src: asset.props.src } },
                [image.id]: { props: { assetId: asset.id } },
            } },
            session: { currentPageId: otherPage.id }, originalTldrawV5: snapshot,
        });
    });

    it('projects formatted text, notes, geometry and cubic line handles into native editable shapes', () => {
        const text = legacyShape('label', 'text', {
            color: 'blue', size: 'm', font: 'sans', textAlign: 'end', w: 100, autoSize: false, scale: 1.5, richText,
        });
        const note = legacyShape('note', 'note', {
            size: 's', font: 'sans', color: 'yellow', align: 'middle', verticalAlign: 'middle', url: '', richText,
            scale: 1, growY: 5, labelColor: 'black', fontSizeAdjustment: 1, textLastEditedBy: null,
        });
        const geo = legacyShape('geo', 'geo', {
            w: 95, h: 40, geo: 'rectangle', dash: 'dotted', growY: 0, url: '', scale: 1, flipX: false, flipY: false,
            labelColor: 'black', color: 'blue', fill: 'solid', size: 'm', font: 'sans', align: 'end',
            verticalAlign: 'middle', richText: toRichText('Box'),
        });
        const line = legacyShape('line', 'line', {
            color: 'green', dash: 'draw', size: 'm', spline: 'cubic', scale: 1,
            points: {
                a3: { id: 'a3', index: 'a3', x: 20, y: 5 },
                a1: { id: 'a1', index: 'a1', x: 0, y: 0 },
                a2: { id: 'a2', index: 'a2', x: 5, y: 25 },
            },
        });
        const store = newStore();
        loadDrawingDocument(store, withRecords(text, note, geo, line));
        expect(nativeRecord(store, 'label')).toMatchObject({ props: { text: 'One\nTwo\nThree', align: 'end', scale: 1.5 } });
        expect(nativeRecord(store, 'note')).toMatchObject({ props: { text: 'One\nTwo\nThree', growY: 5 } });
        expect(nativeRecord(store, 'geo')).toMatchObject({ props: { text: 'Box', w: 95, h: 40, geo: 'rectangle', dash: 'dotted' } });
        expect(nativeRecord(store, 'line')).toMatchObject({ props: { spline: 'cubic', handles: {
            start: { id: 'start', x: 0 }, 'handle:a2': { index: 'a2', y: 25 }, end: { id: 'end', x: 20 },
        } } });
    });

    it('loads native and v5 direct snapshots and both historical document wrappers', () => {
        const seed = newStore();
        loadDrawingDocument(seed, captured);
        const native = seed.getSnapshot();
        for (const document of [native, captured.document]) {
            const wrapped = [
                { ...document },
                { document },
                { document: document.store, schema: document.schema },
            ];
            for (const payload of wrapped) {
                const store = newStore();
                const original = loadDrawingDocument(store, payload);
                const saved = serializeDrawingDocument(store, original);
                expect(store.getSnapshot().store).toEqual(native.store);
                if (document === native) {
                    expect(original).toBeNull();
                    expect(saved).not.toHaveProperty('originalTldrawV5');
                } else {
                    expect(saved.originalTldrawV5).toEqual(payload);
                }
            }
        }
    });

    it('protects malformed or unsupported records and keeps the previously loaded drawing intact', () => {
        const store = newStore();
        const retained = loadDrawingDocument(store, captured);
        const saved = serializeDrawingDocument(store, retained);
        const native = store.getSnapshot();
        const unsafe = [
            { elements: [{ type: 'rectangle' }] }, { document: { schema: captured.document.schema, store: {} } },
            withRecords({ ...stroke, parentId: 'page:missing' }),
            withRecords(legacyShape('unknown', 'unavailable-plugin', {})),
            withRecords(legacyShape('card', 'json-canvas-node', { w: 100, h: 90, data: '{"type":"text","text":{}}' })),
            withRecords({ ...stroke, props: { ...stroke.props, segments: [{ type: 'free', path: '!'.repeat(16) }] } }),
            withRecords({ ...stroke, props: { ...stroke.props, segments: [{ type: 'free', path: 'AAA=' }] } }),
            withRecords(arrow, binding),
            withRecords(arrow, { ...binding, toId: stroke.id }, { ...binding, id: 'binding:duplicate', toId: stroke.id }),
            withRecords({ ...arrow, props: { ...arrow.props, kind: 'elbow' } }),
            { ...saved, originalTldrawV5: { ...captured, originalTldrawV5: captured } },
            { document: { ...native, store: { ...native.store, [stroke.id]: { ...stroke, type: 'nonexistent' } } } },
        ];
        for (const payload of unsafe) {
            expect(() => loadDrawingDocument(store, payload)).toThrow();
            expect(store.getSnapshot()).toEqual(native);
        }
    });
});
