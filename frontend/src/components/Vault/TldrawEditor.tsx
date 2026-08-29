/**
 * Drawing editor based on Tldraw for the Gnosi Vault.
 * Replaces ExcalidrawEditor and is fully compatible with React 19.
 */
import { useRef, useState } from 'react';
import { createTLStore, type Editor } from 'tldraw';
import 'tldraw/tldraw.css';

import { useMediaQuery } from '../../hooks/useMediaQuery';
import { usePlugins } from '../../plugins/usePlugins';
import { browserHasTouchPoints } from '../../shared/platform/browser-events';
import { TldrawEditorView } from './tldraw-editor/TldrawEditorView';
import { CANVAS_SHAPE_UTILS } from './tldraw-editor/tldrawEditorBridges';
import {
    canvasEditorFrom,
    type CanvasEditor,
    type TldrawEditorProps,
} from './tldraw-editor/tldrawEditorTypes';
import { useTldrawHandwriting } from './tldraw-editor/useTldrawHandwriting';
import { useTldrawPageCards } from './tldraw-editor/useTldrawPageCards';
import { useTldrawPersistence } from './tldraw-editor/useTldrawPersistence';

export default function TldrawEditor({
    allNotes = [],
    drawingId = null,
    onClose,
    onOpenPage = null,
    onSaveSuccess = null,
    tables = [],
    title = null,
}: TldrawEditorProps) {
    const { isEnabled } = usePlugins();
    const [store] = useState(() => createTLStore({
        shapeUtils: CANVAS_SHAPE_UTILS,
    }));
    const editorRef = useRef<CanvasEditor | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [penOnly, setPenOnly] = useState(false);
    const coarsePointer = useMediaQuery('(pointer: coarse)');
    const cardsEnabled = isEnabled('canvas-cards');
    const supportsTouch = browserHasTouchPoints() || coarsePointer;

    const persistence = useTldrawPersistence({
        drawingId,
        onSaveSuccess,
        store,
        title,
    });
    const pageCards = useTldrawPageCards({
        allNotes,
        cardsEnabled,
        editorRef,
        loadState: persistence.loadState,
        wrapperRef,
    });
    const handwriting = useTldrawHandwriting({ editorRef });

    const onEditorMount = (editor: Editor): void => {
        editorRef.current = canvasEditorFrom(editor);
    };

    return (
        <TldrawEditorView
            allNotes={allNotes}
            cardsEnabled={cardsEnabled}
            closeSelectedPage={pageCards.closeSelectedPage}
            createNote={pageCards.createNote}
            isSearchOpen={pageCards.isSearchOpen}
            loadState={persistence.loadState}
            onClose={onClose}
            onEditorMount={onEditorMount}
            onOpenPage={onOpenPage}
            onRecognize={handwriting.recognize}
            onSearchSelect={pageCards.insertFromSearch}
            openSearch={pageCards.openSearch}
            penOnly={penOnly}
            recognizing={handwriting.recognizing}
            retryLoad={persistence.retryLoad}
            selectedPage={pageCards.selectedPage}
            setPenOnly={setPenOnly}
            setSearchOpen={pageCards.setSearchOpen}
            shapeUtils={CANVAS_SHAPE_UTILS}
            store={store}
            supportsTouch={supportsTouch}
            tables={tables}
            title={title}
            wrapperRef={wrapperRef}
        />
    );
}
