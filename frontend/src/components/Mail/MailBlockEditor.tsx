import {
    useCallback,
    useEffect,
    useRef,
    type ClipboardEvent,
    type DragEvent,
    type RefObject,
} from 'react';
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import '@blocknote/mantine/style.css';
import '@blocknote/core/fonts/inter.css';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../hooks/useTheme';
import { logError } from '../../lib/notifyError';
import { toast } from '../../lib/toast';
import { uploadVaultAsset } from '../../shared/api/vault-specialized';
import { subscribeDocumentEvent } from '../../shared/platform/browser-events';
import { blockHasContent, parseMailHtml } from './mailBlockNoteAdapter';


interface MailBlockEditorProps {
    readonly autoFocus?: boolean;
    readonly editorRef?: RefObject<BlockNoteEditor | null>;
    readonly initialContent?: string;
    readonly minHeight?: string;
    readonly onAttachFile?: (file: File) => void;
    readonly onChange?: (html: string) => void;
    readonly prependEmptyLines?: number;
}


async function uploadFileToVault(file: File): Promise<string> {
    return (await uploadVaultAsset(file)).url;
}


export default function MailBlockEditor({
    initialContent,
    onChange,
    editorRef,
    minHeight = '200px',
    onAttachFile,
    autoFocus = false,
    prependEmptyLines = 0,
}: MailBlockEditorProps) {
    const { t } = useTranslation();
    const { effectiveTheme } = useTheme();
    const onAttachFileRef = useRef(onAttachFile);
    const initialContentRef = useRef(initialContent);
    const prependEmptyLinesRef = useRef(prependEmptyLines);

    useEffect(() => {
        onAttachFileRef.current = onAttachFile;
    }, [onAttachFile]);

    const editor = useCreateBlockNote({
        uploadFile: async (file: File): Promise<string> => {
            if (!file.type.startsWith('image/') && onAttachFileRef.current) {
                onAttachFileRef.current(file);
                toast(t('mail.file_attached', 'Attached: {{name}}', { name: file.name }), {
                    icon: '📎',
                });
                throw new Error('File redirected to attachments');
            }
            return uploadFileToVault(file);
        },
    });
    const lastContentRef = useRef(initialContent);

    useEffect(() => {
        const content = initialContentRef.current;
        if (content === undefined) return;
        const firstBlock = editor.document[0];
        if (!firstBlock || blockHasContent(firstBlock)) return;
        try {
            const blocks = parseMailHtml(editor, content || '');
            if (blocks.length === 0) return;
            editor.replaceBlocks(editor.document, blocks);
            const currentFirstBlock = editor.document[0];
            if (prependEmptyLinesRef.current > 0 && currentFirstBlock) {
                const emptyBlocks: PartialBlock[] = Array.from(
                    { length: prependEmptyLinesRef.current },
                    () => ({ type: 'paragraph', content: [] }),
                );
                editor.insertBlocks(emptyBlocks, currentFirstBlock, 'before');
            }
            lastContentRef.current = content;
            const cursorBlock = editor.document[0];
            if (cursorBlock) editor.setTextCursorPosition(cursorBlock, 'start');
        } catch (error) {
            logError('mail-block-editor.initial-content', error);
        }
    }, [editor]);

    useEffect(() => {
        if (editorRef) editorRef.current = editor;
    }, [editor, editorRef]);

    useEffect(() => {
        if (!autoFocus) return undefined;
        const timer = setTimeout(() => {
            const firstBlock = editor.document[0];
            if (firstBlock) editor.setTextCursorPosition(firstBlock, 'start');
            editor.focus();
        }, 150);
        return () => {
            clearTimeout(timer);
        };
    }, [autoFocus, editor]);

    const insertFiles = useCallback(async (files: readonly File[]): Promise<void> => {
        for (const file of files) {
            if (file.type.startsWith('image/')) {
                try {
                    const url = await uploadFileToVault(file);
                    const position = editor.getTextCursorPosition();
                    editor.insertBlocks(
                        [{ type: 'image', props: { url, caption: '' } }],
                        position.block,
                        'after',
                    );
                } catch {
                    toast.error(t('mail.insert_image_error', 'Error inserting image'));
                }
            } else if (onAttachFile) {
                onAttachFile(file);
                toast(t('mail.file_attached', 'Attached: {{name}}', { name: file.name }), {
                    icon: '📎',
                });
            }
        }
    }, [editor, onAttachFile, t]);

    const handleDrop = useCallback((event: DragEvent<HTMLDivElement>): void => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.stopPropagation();
        void insertFiles(Array.from(event.dataTransfer.files));
    }, [insertFiles]);
    const handlePasteCapture = useCallback((event: ClipboardEvent<HTMLDivElement>): void => {
        if (!onAttachFile || event.clipboardData.files.length === 0) return;
        if (Array.from(event.clipboardData.types).includes('text/html')) return;
        event.preventDefault();
        event.stopPropagation();
        void insertFiles(Array.from(event.clipboardData.files));
    }, [insertFiles, onAttachFile]);
    const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>): void => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
    }, []);

    useEffect(() => subscribeDocumentEvent('keydown', (event) => {
        if (event.key !== ' ' || !editor.prosemirrorView.hasFocus()) return;
        editor.transact((transaction) => {
            const { $from } = transaction.selection;
            const textBeforeCursor = $from.parent.textContent.slice(0, $from.parentOffset);
            const lastWord = textBeforeCursor.split(/\s+/).at(-1);
            if (!lastWord) return transaction;
            const urlPattern = /^(https?:\/\/|www\.)\S+\.\S{2,}$/;
            const emailPattern = /^\S+@\S+\.\S{2,}$/;
            if (!urlPattern.test(lastWord) && !emailPattern.test(lastWord)) {
                return transaction;
            }
            const href = emailPattern.test(lastWord)
                ? `mailto:${lastWord}`
                : lastWord.startsWith('www.') ? `https://${lastWord}` : lastWord;
            const linkMark = editor.pmSchema.marks.link?.create({ href });
            if (!linkMark) return transaction;
            const to = $from.pos;
            return transaction.addMark(to - lastWord.length, to, linkMark);
        });
    }), [editor]);

    return (
        <div
            className="mail-block-editor overflow-hidden rounded-2xl bg-[var(--bg-primary)] transition-all duration-300"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onPasteCapture={handlePasteCapture}
            style={{ minHeight }}
        >
            <BlockNoteView
                editor={editor}
                onChange={() => {
                    if (!onChange) return;
                    const html = editor.blocksToHTMLLossy(editor.document);
                    if (html === lastContentRef.current) return;
                    lastContentRef.current = html;
                    onChange(html);
                }}
                theme={effectiveTheme}
            />
            <style>{`
                .mail-block-editor .bn-editor {
                    padding: 0.75rem 1rem !important;
                    min-height: ${minHeight};
                    background: transparent !important;
                }
                .mail-block-editor .bn-container {
                    background: var(--bg-primary) !important;
                }
                .mail-block-editor .bn-main-content {
                    color: var(--text-primary) !important;
                    font-size: 0.9rem;
                    line-height: 1.5;
                }
                .mail-block-editor .bn-toolbar {
                    background: var(--bg-secondary) !important;
                    border-bottom: 1px solid var(--border-primary) !important;
                    color: var(--text-primary) !important;
                    padding: 4px !important;
                }
                .mail-block-editor .bn-block-content blockquote,
                .mail-block-editor blockquote {
                    border-left: 3px solid var(--gnosi-blue) !important;
                    padding-left: 0.75rem !important;
                    color: var(--text-secondary) !important;
                    opacity: 0.8;
                    margin: 4px 0 !important;
                }
                .mail-block-editor a {
                    color: var(--gnosi-blue) !important;
                    text-decoration: underline !important;
                    cursor: pointer !important;
                }
            `}</style>
        </div>
    );
}
