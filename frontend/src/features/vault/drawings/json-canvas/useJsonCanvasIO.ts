import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { Editor } from 'tldraw';
import { downloadBlob } from '../../../../shared/platform/download';
import { toast } from '../../../../shared/notifications/toast';
import type { TldrawVaultNote } from '../tldraw-editor/tldrawEditorTypes';
import { exportJsonCanvas, importJsonCanvas } from './editorAdapter';
import { JsonCanvasError, MAX_CANVAS_BYTES } from './model';

export function useJsonCanvasIO(editorRef: RefObject<Editor | null>, notes: readonly TldrawVaultNote[], title: string | null, save: () => Promise<void>) {
    const { t } = useTranslation();
    const report = (error: unknown) => {
        if (error instanceof JsonCanvasError && error.reason === 'not_empty') toast.error(t('json_canvas.not_empty', 'Open an empty drawing before importing a canvas.'));
        else if (error instanceof JsonCanvasError && error.reason === 'unsupported') toast.error(t('json_canvas.unsupported', 'This canvas contains a shape or connection that JSON Canvas cannot represent. Nothing was imported or exported.'));
        else if (error instanceof JsonCanvasError && error.reason === 'too_large') toast.error(t('json_canvas.too_large', 'The canvas exceeds the limit of 10 MB or 5,000 items.'));
        else toast.error(t('json_canvas.invalid', 'The canvas could not be read. Check that it is a valid .canvas file.'));
    };
    const importFile = async (file: File) => {
        const editor = editorRef.current;
        if (!editor) return;
        try {
            if (file.size > MAX_CANVAS_BYTES) throw new JsonCanvasError('too_large');
            const serialized = await file.text();
            if (editorRef.current !== editor) return;
            importJsonCanvas(editor, serialized, notes);
            await save();
            toast.success(t('json_canvas.imported', 'Canvas imported.'));
        } catch (error) { report(error); }
    };
    const exportFile = () => {
        const editor = editorRef.current;
        if (!editor) return;
        try {
            const document = exportJsonCanvas(editor, notes);
            const filename = (title || t('tldraw.untitled_drawing', 'Untitled drawing')).replace(/[\\/:*?"<>|]/g, '-');
            downloadBlob(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }), `${filename}.canvas`);
        } catch (error) { report(error); }
    };
    return { importFile, exportFile };
}
