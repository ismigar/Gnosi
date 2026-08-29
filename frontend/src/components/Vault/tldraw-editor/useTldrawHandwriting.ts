import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { createShapeId, toRichText } from '@tldraw/tlschema';
import { useTranslation } from 'react-i18next';

import {
    recognizeHandwriting,
    warmupHandwriting,
} from '../../../shared/api/drawings';
import { GnosiApiError } from '../../../shared/api/errors';
import { logError } from '../../../lib/notifyError';
import { toast } from '../../../lib/toast';
import type { CanvasEditor } from './tldrawEditorTypes';

interface UseTldrawHandwritingOptions {
    readonly editorRef: RefObject<CanvasEditor | null>;
}

export interface TldrawHandwriting {
    readonly recognize: () => Promise<void>;
    readonly recognizing: boolean;
}

export function useTldrawHandwriting({
    editorRef,
}: UseTldrawHandwritingOptions): TldrawHandwriting {
    const { t } = useTranslation();
    const [recognizing, setRecognizing] = useState(false);

    useEffect(() => {
        void warmupHandwriting().catch(() => undefined);
    }, []);

    const recognize = useCallback(async (): Promise<void> => {
        const editor = editorRef.current;
        if (!editor || recognizing) return;
        let ids = [...editor.getSelectedShapeIds()];
        if (ids.length === 0) ids = [...editor.getCurrentPageShapeIds()];
        if (ids.length === 0) {
            toast.error(t('tldraw.no_strokes'));
            return;
        }

        setRecognizing(true);
        try {
            const image = await editor.toImage(ids, {
                background: true,
                darkMode: false,
                format: 'png',
                padding: 16,
                scale: 2,
            });
            if (!image?.blob) throw new Error('Could not export the image');
            const result = await recognizeHandwriting(image.blob);
            const text = result.text.trim();
            if (!text) {
                toast.error(t('tldraw.no_text_recognized'));
                return;
            }

            const bounds = editor.getSelectionPageBounds()
                ?? editor.getCurrentPageBounds();
            const center = editor.getViewportPageBounds().center;
            const textId = createShapeId();
            editor.createShape({
                id: textId,
                props: {
                    color: 'black',
                    richText: toRichText(text),
                    size: 'm',
                },
                type: 'text',
                x: bounds?.x ?? center.x,
                y: bounds ? bounds.maxY + 24 : center.y,
            });
            editor.select(textId);
            toast.success(result.corrected
                ? t('tldraw.recognized_corrected')
                : t('tldraw.recognized'));
        } catch (error) {
            logError('tldraw.handwriting-recognition', error);
            toast.error(error instanceof GnosiApiError && error.status === 503
                ? t('tldraw.engine_unavailable')
                : t('tldraw.recognize_error'));
        } finally {
            setRecognizing(false);
        }
    }, [editorRef, recognizing, t]);

    return { recognize, recognizing };
}
