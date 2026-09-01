import { useCallback, useContext, useEffect, useState } from 'react';

import { logError } from '../../../../shared/notifications/notifyError';
import { transportFetch } from '../../../../shared/api/transports';
import { VaultEditorContext } from '../../../../shared/editor/VaultEditorContext';
import {
    isDismissedEmbedPickerError,
    isLocalFileEmbedUrl,
    readInsertResultUrl,
    type EmbedAvailability,
    type EmbedBlock,
    type EmbedEditor,
    type EmbedPickerTab,
} from './embedRendererModel';


interface InsertContentOptions {
    readonly initialTab: EmbedPickerTab;
}


type RequestInsertContent = (options: InsertContentOptions) => unknown;


interface AvailabilitySnapshot {
    readonly state: Extract<EmbedAvailability, 'missing' | 'ok'>;
    readonly url: string;
}


export interface EmbedRendererController {
    readonly availability: EmbedAvailability;
    readonly openPicker: (initialTab?: EmbedPickerTab) => Promise<void>;
}


interface ControllerOptions {
    readonly block: EmbedBlock | null | undefined;
    readonly caption: string;
    readonly editor: EmbedEditor | null | undefined;
    readonly url: string;
}


function isRequestInsertContent(value: unknown): value is RequestInsertContent {
    return typeof value === 'function';
}


export function useEmbedRendererController({
    block,
    caption,
    editor,
    url,
}: ControllerOptions): EmbedRendererController {
    const context = useContext(VaultEditorContext);
    const requestInsertContent = isRequestInsertContent(
        context.requestInsertContent,
    ) ? context.requestInsertContent : null;
    const localFile = isLocalFileEmbedUrl(url);
    const [availabilitySnapshot, setAvailabilitySnapshot] = useState<
        AvailabilitySnapshot
    >({ state: 'ok', url: '' });
    const availability: EmbedAvailability = !localFile || !url
        ? 'ok'
        : availabilitySnapshot.url === url
            ? availabilitySnapshot.state
            : 'checking';

    useEffect(() => {
        if (!localFile || !url) return undefined;
        let cancelled = false;
        const checkAvailability = async (): Promise<void> => {
            try {
                const response = await transportFetch(url, { method: 'HEAD' });
                if (!cancelled) {
                    setAvailabilitySnapshot({
                        state: response.ok ? 'ok' : 'missing',
                        url,
                    });
                }
            } catch {
                if (!cancelled) {
                    setAvailabilitySnapshot({ state: 'missing', url });
                }
            }
        };
        void checkAvailability();
        return () => {
            cancelled = true;
        };
    }, [localFile, url]);

    const openPicker = useCallback(async (
        initialTab: EmbedPickerTab = 'vault',
    ): Promise<void> => {
        const blockId = block?.id;
        if (!requestInsertContent || !editor || !blockId) return;
        try {
            const result = await requestInsertContent({ initialTab });
            const nextUrl = readInsertResultUrl(result);
            if (nextUrl) {
                editor.updateBlock(blockId, {
                    props: { caption, url: nextUrl },
                });
            }
        } catch (error: unknown) {
            if (!isDismissedEmbedPickerError(error)) {
                logError('embed-picker', error);
            }
        }
    }, [block?.id, caption, editor, requestInsertContent]);

    return { availability, openPicker };
}
