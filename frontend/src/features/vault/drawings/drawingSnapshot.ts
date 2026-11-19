import {
    createSessionStateSnapshotSignal,
    createTLStore,
    isPageId,
    isShapeId,
    loadSessionStateSnapshotIntoStore,
    T,
    type TLStore,
    type TLStoreSnapshot,
} from '@bigbluebutton/tldraw';
import type { TLStoreSnapshot as V5Snapshot } from '@tldraw/tlschema';
import { validateDrawingRecords } from './drawing-snapshot/integrity';
import { convertV5Snapshot } from './drawing-snapshot/tldrawV5';
import { isRecord } from './tldraw-editor/tldrawEditorModel';

type DrawingDocument = Record<string, unknown>;

function readSnapshot(payload: DrawingDocument) {
    if ('elements' in payload || payload.type === 'excalidraw') throw new Error('Unsupported drawing format');
    const wrapped = 'document' in payload;
    if (wrapped && 'store' in payload) throw new Error('Ambiguous drawing stores');
    const document = wrapped ? payload.document : payload;
    if (!isRecord(document)) throw new Error('Missing drawing document');
    const schema = document.schema ?? payload.schema;
    const records = 'store' in document ? document.store : wrapped ? document : undefined;
    if (!isRecord(schema) || !isRecord(records)) throw new Error('Missing drawing schema or store');
    if (schema.schemaVersion === 2) {
        if (!isRecord(schema.sequences) || !Object.hasOwn(schema.sequences, 'com.tldraw.store') ||
            !Object.values(schema.sequences).every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) {
            throw new Error('Invalid drawing schema sequences');
        }
    } else if (schema.schemaVersion !== 1 || !isRecord(schema.recordVersions) || !Number.isSafeInteger(schema.storeVersion)) {
        throw new Error('Unsupported drawing schema');
    }
    for (const [id, record] of Object.entries(records)) {
        if (!isRecord(record) || record.id !== id || typeof record.typeName !== 'string' ||
            !id.startsWith(`${record.typeName}:`) || id.length === record.typeName.length + 1) {
            throw new Error('Invalid drawing record identity');
        }
    }
    const hasPage = Object.values(records).some(record => isRecord(record) && record.typeName === 'page');
    if (!Object.hasOwn(records, 'document:document') || !hasPage) {
        throw new Error('Drawing has no document or page');
    }
    return { store: records, schema };
}

const pageId = T.string.refine(value => {
    if (!isPageId(value)) throw new Error('Invalid session page');
    return value;
});
const shapeId = T.string.refine(value => {
    if (!isShapeId(value)) throw new Error('Invalid session selection');
    return value;
});
const sessionState = T.object({
    version: T.literal(0),
    currentPageId: pageId,
    exportBackground: T.boolean,
    isFocusMode: T.boolean,
    isDebugMode: T.boolean,
    isToolLocked: T.boolean,
    isGridMode: T.boolean,
    pageStates: T.arrayOf(T.object({
        pageId,
        camera: T.object({ x: T.number, y: T.number, z: T.number }),
        selectedShapeIds: T.arrayOf(shapeId),
        focusedGroupId: shapeId.nullable(),
    })),
});

function restoreSession(store: TLStore, session: unknown) {
    if (session == null) return;
    if (!isRecord(session)) throw new Error('Invalid drawing session');
    const defaults = createSessionStateSnapshotSignal(store).get();
    // Older wrappers sometimes only saved the current page. Keep additional v5 fields in the original.
    const knownFields = Object.fromEntries(Object.entries(session).filter(([key]) => defaults && Object.hasOwn(defaults, key)));
    const state = sessionState.validate({ ...defaults, ...knownFields });
    if (!store.has(state.currentPageId)) throw new Error('Missing current drawing page');
    loadSessionStateSnapshotIntoStore(store, state);
}

/** Restore only a complete, verified drawing. A failed conversion leaves the caller's store intact. */
export function loadDrawingDocument(store: TLStore, document: DrawingDocument): DrawingDocument | null {
    const snapshot = readSnapshot(document);
    const legacy = snapshot.schema.schemaVersion === 2;
    let original: DrawingDocument | null = legacy ? document : null;
    if ('originalTldrawV5' in document) {
        const archive = document.originalTldrawV5;
        if (legacy || !isRecord(archive) || 'originalTldrawV5' in archive || readSnapshot(archive).schema.schemaVersion !== 2) {
            throw new Error('Invalid preserved drawing');
        }
        original = archive;
    }

    // The fork clears a store before validating all its records. Stage the entire load before touching the editor.
    const staged = createTLStore({ schema: store.schema, defaultName: store.props.defaultName });
    const native = legacy
        ? convertV5Snapshot(staged, snapshot as unknown as V5Snapshot)
        : snapshot as unknown as TLStoreSnapshot;
    staged.loadSnapshot(native);
    const current = staged.getSnapshot();
    for (const [id, record] of Object.entries(native.store)) {
        if (['shape', 'page', 'asset', 'document'].includes(record.typeName) && !Object.hasOwn(current.store, id)) {
            throw new Error('Migration removed a drawing record');
        }
    }
    validateDrawingRecords(current.store);
    restoreSession(staged, document.session);
    store.loadSnapshot(staged.getSnapshot('all'));
    return original;
}

export function serializeDrawingDocument(store: TLStore, original: DrawingDocument | null): DrawingDocument {
    if (original && 'originalTldrawV5' in original) throw new Error('Nested preserved drawing');
    const document = store.getSnapshot();
    validateDrawingRecords(document.store);
    const session = createSessionStateSnapshotSignal(store).get();
    return { document, ...(session && { session }), ...(original && { originalTldrawV5: original }) };
}
