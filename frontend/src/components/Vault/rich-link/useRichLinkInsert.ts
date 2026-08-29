import {
    useCallback,
    useEffect,
    useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../../lib/notifyError';
import { toast } from '../../../lib/toast';
import { fileUrlToSentinel } from '../markdown-mapper';
import {
    basenameOf,
    detectEmbedKind,
    embedKindForFile,
    RICH_LINK_TAB_ORDER,
    toFileUrl,
    type LocalLinkMode,
    type RichLinkEditor,
    type RichLinkTab,
} from './richLinkModel';


interface UseRichLinkInsertOptions {
    readonly editor?: RichLinkEditor | null;
    readonly onClose: () => void;
    readonly uploadFile?: (file: File) => Promise<string>;
}


export function useRichLinkInsert({
    editor,
    onClose,
    uploadFile,
}: UseRichLinkInsertOptions) {
    const { t } = useTranslation();
    const [tab, setTab] = useState<RichLinkTab>('url');
    const [url, setUrl] = useState('');
    const [linkText, setLinkText] = useState(() => {
        try {
            return editor?.getSelectedText?.() ?? '';
        } catch {
            return '';
        }
    });
    const [busy, setBusy] = useState(false);
    const [localPath, setLocalPath] = useState('');
    const [localMode, setLocalMode] = useState<LocalLinkMode>('link');
    const [pickerMode, setPickerMode] = useState<'file' | 'folder' | null>(null);
    const [dragOver, setDragOver] = useState(false);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                onClose();
                return;
            }
            if (!event.metaKey && !event.ctrlKey) return;
            if (event.key === '1' || event.key === '2' || event.key === '3') {
                const next = RICH_LINK_TAB_ORDER[Number(event.key) - 1];
                if (next) {
                    event.preventDefault();
                    setTab(next);
                }
                return;
            }
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                setTab((current) => {
                    const index = RICH_LINK_TAB_ORDER.indexOf(current);
                    const delta = event.key === 'ArrowRight' ? 1 : -1;
                    return RICH_LINK_TAB_ORDER[
                        (index + delta + RICH_LINK_TAB_ORDER.length)
                        % RICH_LINK_TAB_ORDER.length
                    ] ?? 'url';
                });
                return;
            }
            const key = event.key.toLowerCase();
            if (tab === 'local' && (key === 'l' || key === 'u')) {
                event.preventDefault();
                setLocalMode(key === 'l' ? 'link' : 'upload');
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [onClose, tab]);

    const insertInlineLink = useCallback((href: string, label = ''): void => {
        if (!editor) return;
        const text = (label || href).trim() || href;
        try {
            editor.insertInlineContent([{
                content: [{ styles: {}, text, type: 'text' }],
                href,
                type: 'link',
            }]);
        } catch (error: unknown) {
            logError('rich-link-inline-structured', error);
            try {
                editor.insertInlineContent(`[${text}](${href})`);
            } catch (fallbackError: unknown) {
                logError('rich-link-inline-fallback', fallbackError);
            }
        }
    }, [editor]);

    const insertEmbedBlock = useCallback((href: string, kind = detectEmbedKind(href)): void => {
        if (!editor) return;
        try {
            editor.insertBlocks(
                [{ props: { url: href }, type: kind }],
                editor.getTextCursorPosition().block,
                'after',
            );
        } catch (error: unknown) {
            logError('rich-link-embed-fallback', error);
            insertInlineLink(href, href);
        }
    }, [editor, insertInlineLink]);

    const runUpload = useCallback(async (
        file: File,
        embed: boolean,
    ): Promise<void> => {
        if (!uploadFile) {
            toast.error(t('editor.upload_unavailable', {
                defaultValue: 'File upload unavailable',
            }));
            return;
        }
        setBusy(true);
        try {
            const href = await uploadFile(file);
            if (embed) insertEmbedBlock(href, embedKindForFile(file));
            else insertInlineLink(href, linkText || file.name);
            onClose();
        } catch (error: unknown) {
            logError('rich-link-upload', error);
            toast.error(t('editor.upload_failed', {
                defaultValue: 'Error uploading the file',
            }));
        } finally {
            setBusy(false);
        }
    }, [insertEmbedBlock, insertInlineLink, linkText, onClose, t, uploadFile]);

    return {
        busy,
        dragOver,
        insertEmbedUrl: (): void => {
            const href = url.trim();
            if (!href) return;
            insertEmbedBlock(href);
            onClose();
        },
        insertLocalLink: (): void => {
            const fileUrl = toFileUrl(localPath);
            if (!fileUrl) return;
            const convertToSentinel = fileUrlToSentinel as (url: string) => unknown;
            const convertedUrl = convertToSentinel(fileUrl);
            insertInlineLink(
                typeof convertedUrl === 'string' ? convertedUrl : fileUrl,
                linkText || basenameOf(localPath),
            );
            onClose();
        },
        insertUrl: (): void => {
            const href = url.trim();
            if (!href) return;
            insertInlineLink(href, linkText);
            onClose();
        },
        linkText,
        localMode,
        localPath,
        pickerMode,
        setDragOver,
        setLinkText,
        setLocalMode,
        setLocalPath,
        setPickerMode,
        setTab,
        setUrl,
        tab,
        uploadEmbedFile: (file: File): Promise<void> => runUpload(file, true),
        uploadLinkFile: (file: File): Promise<void> => runUpload(file, false),
        url,
    };
}
