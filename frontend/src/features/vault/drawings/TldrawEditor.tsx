import { useCallback, useEffect, useRef, useState } from 'react';
import { createTLStore, type Editor } from '@bigbluebutton/tldraw';
import '@bigbluebutton/tldraw/tldraw.css';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../../shared/hooks/useTheme';

import { useMediaQuery } from '../../../shared/hooks/useMediaQuery';
import { usePlugins } from '../../../shared/plugins/usePlugins';
import { browserHasTouchPoints } from '../../../shared/platform/browser-events';
import { TldrawEditorView } from './tldraw-editor/TldrawEditorView';
import { CANVAS_SHAPE_UTILS, CUSTOM_SHAPE_UTILS } from './tldraw-editor/tldrawEditorBridges';
import type { TldrawEditorProps } from './tldraw-editor/tldrawEditorTypes';
import { useTldrawHandwriting } from './tldraw-editor/useTldrawHandwriting';
import { useTldrawPageCards } from './tldraw-editor/useTldrawPageCards';
import { useJsonCanvasIO } from './json-canvas/useJsonCanvasIO';
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
    const { isDark } = useTheme();
    const { i18n } = useTranslation();
    const language = (i18n.resolvedLanguage ?? i18n.language).split('-')[0];
    const [store] = useState(() => createTLStore({
        shapeUtils: CANVAS_SHAPE_UTILS,
    }));
    const editorRef = useRef<Editor | null>(null);
    const [mountedEditor, setMountedEditor] = useState<Editor | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [penOnly, setPenOnly] = useState(false);
    const coarsePointer = useMediaQuery('(pointer: coarse)');
    const cardsEnabled = isEnabled('canvas-cards');
    const supportsTouch = browserHasTouchPoints() || coarsePointer;

    useEffect(() => {
        if (mountedEditor) mountedEditor.user.updateUserPreferences({ locale: language, isDarkMode: isDark });
    }, [isDark, language, mountedEditor]);

    const persistence = useTldrawPersistence({
        drawingId,
        onSaveSuccess,
        editorReady: mountedEditor !== null,
        store,
        title,
    });
    const canvasIO = useJsonCanvasIO(editorRef, allNotes, title, persistence.save);
    const pageCards = useTldrawPageCards({
        allNotes,
        cardsEnabled,
        editorRef,
        mountedEditor,
        wrapperRef,
    });
    const handwriting = useTldrawHandwriting({ editorRef });

    const onEditorMount = useCallback((editor: Editor) => {
        editorRef.current = editor;
        setMountedEditor(editor);
        return () => {
            editorRef.current = null;
            setMountedEditor(null);
        };
    }, []);

    return (
        <TldrawEditorView
            allNotes={allNotes}
            cardsEnabled={cardsEnabled}
            closeSelectedPage={pageCards.closeSelectedPage}
            createNote={pageCards.createNote}
            isSearchOpen={pageCards.isSearchOpen}
            editorReady={mountedEditor !== null}
            loadState={persistence.loadState}
            unsupportedDocument={persistence.unsupportedDocument}
            onClose={onClose}
            onEditorMount={onEditorMount}
            onImportCanvas={canvasIO.importFile}
            onExportCanvas={canvasIO.exportFile}
            onOpenPage={onOpenPage}
            onRecognize={handwriting.recognize}
            onSearchSelect={pageCards.insertFromSearch}
            openSearch={pageCards.openSearch}
            penOnly={penOnly}
            recognizing={handwriting.recognizing}
            handwritingStatus={handwriting.status}
            onCancelDownload={handwriting.cancelDownload}
            retryLoad={persistence.retryLoad}
            selectedPage={pageCards.selectedPage}
            setPenOnly={setPenOnly}
            setSearchOpen={pageCards.setSearchOpen}
            shapeUtils={CUSTOM_SHAPE_UTILS}
            store={store}
            supportsTouch={supportsTouch}
            tables={tables}
            title={title}
            wrapperRef={wrapperRef}
        />
    );
}
