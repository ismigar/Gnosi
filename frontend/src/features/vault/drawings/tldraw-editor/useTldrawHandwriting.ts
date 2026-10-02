import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { createShapeId, toRichText } from '@tldraw/tlschema';
import { useTranslation } from 'react-i18next';

import { recognizeHandwriting, fetchHandwritingStatus, cancelHandwritingDownload, type HandwritingStatusResponse } from '../../../../shared/api/drawings';
import { GnosiApiError, apiErrorDetail } from '../../../../shared/api/errors';
import { logError } from '../../../../shared/notifications/notifyError';
import { toast } from '../../../../shared/notifications/toast';
import type { CanvasEditor } from './tldrawEditorTypes';

interface UseTldrawHandwritingOptions {
    readonly editorRef: RefObject<CanvasEditor | null>;
}

export interface TldrawHandwriting {
    readonly recognize: () => Promise<void>;
    readonly recognizing: boolean;
    readonly status: HandwritingStatusResponse | undefined;
    readonly cancelDownload: () => Promise<void>;
}

export function useTldrawHandwriting({
    editorRef,
}: UseTldrawHandwritingOptions): TldrawHandwriting {
    const { t, i18n } = useTranslation();
    const language = (i18n.resolvedLanguage ?? i18n.language).split('-')[0];
    const [recognizing, setRecognizing] = useState(false);
    const [status, setStatus] = useState<HandwritingStatusResponse>();

    useEffect(() => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const poll = async () => {
            try {
                const current = await fetchHandwritingStatus(controller.signal);
                if (!controller.signal.aborted) setStatus(current);
            } catch { /* Status must not start a download or block drawing. */ }
            if (!controller.signal.aborted && (recognizing || status?.state === 'downloading' || status?.state === 'loading')) timer = setTimeout(() => { void poll(); }, 1000);
        };
        void poll();
        return () => { controller.abort(); if (timer) clearTimeout(timer); };
    }, [recognizing, status?.state]);

    const cancelDownload = useCallback(async () => {
        try {
            const cancelling = await cancelHandwritingDownload();
            if (cancelling) setStatus(previous => previous ? { ...previous, cancelling: true } : previous);
        } catch (error) {
            logError('tldraw.handwriting-download-cancellation', error);
            toast.error(t('tldraw.ocr_cancel_error'));
        }
    }, [t]);

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
            const result = await recognizeHandwriting(image.blob, { language });
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
            if (error instanceof GnosiApiError && error.status === 409
                && apiErrorDetail(error, '') === 'handwriting_download_cancelled') return;
            logError('tldraw.handwriting-recognition', error);
            toast.error(error instanceof GnosiApiError && error.status === 503
                ? t('tldraw.engine_unavailable')
                : error instanceof GnosiApiError && error.status === 422
                    ? apiErrorDetail(error, t('tldraw.recognize_error'))
                    : t('tldraw.recognize_error'));
        } finally {
            setRecognizing(false);
        }
    }, [editorRef, language, recognizing, t]);

    return { recognize, recognizing, status, cancelDownload };
}
