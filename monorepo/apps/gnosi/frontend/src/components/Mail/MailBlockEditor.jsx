import React, { useMemo, useEffect, useRef, useCallback } from 'react';
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/mantine/style.css";
import "@blocknote/core/fonts/inter.css";
import { useTheme } from '../../hooks/useTheme';
import { toast } from 'react-hot-toast';

async function uploadFileToVault(file) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/vault/assets/upload', { method: 'POST', body: formData });
    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();
    return data.url;
}

export default function MailBlockEditor({ initialContent, onChange, editorRef, minHeight = "200px", onAttachFile, autoFocus = false, prependEmptyLines = 0 }) {
    const { effectiveTheme } = useTheme();
    const editor = useCreateBlockNote({
        uploadFile: uploadFileToVault,
    });
    const lastContentRef = useRef(initialContent);

    useEffect(() => {
        if (editor && initialContent !== undefined) {
             async function load() {
                try {
                    const blocks = await editor.tryParseHTMLToBlocks(initialContent || "");
                    if (blocks) {
                        editor.replaceBlocks(editor.topLevelBlocks, blocks);
                        if (prependEmptyLines > 0 && editor.topLevelBlocks.length > 0) {
                            const emptyBlocks = Array.from({ length: prependEmptyLines }, () => ({ type: 'paragraph', content: [] }));
                            editor.insertBlocks(emptyBlocks, editor.topLevelBlocks[0], 'before');
                        }
                        lastContentRef.current = initialContent;
                        try { editor.setTextCursorPosition(editor.topLevelBlocks[0], 'start'); } catch { /* ok */ }
                    }
                } catch (e) {
                    console.error("Error parsing initial content for MailBlockEditor:", e);
                }
            }
            if (editor.topLevelBlocks.length <= 1 && editor.topLevelBlocks[0]?.content?.length === 0) {
                load();
            }
        }
    }, [editor]);

    useEffect(() => {
        if (editorRef) editorRef.current = editor;
    }, [editor, editorRef]);

    useEffect(() => {
        if (!autoFocus || !editor) return;
        const t = setTimeout(() => {
            try {
                editor.setTextCursorPosition(editor.topLevelBlocks[0], 'start');
                editor.focus();
            } catch { /* ok */ }
        }, 150);
        return () => clearTimeout(t);
    }, [autoFocus, editor]);

    const handleDrop = useCallback(async (e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        const files = Array.from(e.dataTransfer.files);
        for (const file of files) {
            if (file.type.startsWith('image/')) {
                try {
                    const url = await uploadFileToVault(file);
                    const pos = editor.getTextCursorPosition();
                    editor.insertBlocks(
                        [{ type: 'image', props: { url, caption: '' } }],
                        pos.block,
                        'after'
                    );
                } catch {
                    toast.error('Error inserint imatge');
                }
            } else {
                onAttachFile?.(file);
            }
        }
    }, [editor, onAttachFile]);

    const handleDragOver = useCallback((e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
    }, []);

    useEffect(() => {
        if (!editor) return;

        const handleAutoLink = (e) => {
            if (e.key !== ' ') return;
            if (!editor._tiptapEditor?.isFocused) return;

            editor.transact((tr) => {
                const { $from } = tr.selection;
                const textBeforeCursor = $from.parent.textContent.slice(0, $from.parentOffset);
                const lastWord = textBeforeCursor.split(/\s+/).pop();
                if (!lastWord) return tr;

                const urlPattern = /^(https?:\/\/|www\.)\S+\.\S{2,}$/;
                const emailPattern = /^\S+@\S+\.\S{2,}$/;
                if (!urlPattern.test(lastWord) && !emailPattern.test(lastWord)) return tr;

                let href = lastWord;
                if (emailPattern.test(lastWord)) href = `mailto:${lastWord}`;
                else if (lastWord.startsWith('www.')) href = `https://${lastWord}`;

                const to = $from.pos;
                const from = to - lastWord.length;
                const linkMark = editor.pmSchema.marks.link?.create({ href });
                if (!linkMark) return tr;

                return tr.addMark(from, to, linkMark);
            });
        };

        document.addEventListener('keydown', handleAutoLink);
        return () => document.removeEventListener('keydown', handleAutoLink);
    }, [editor]);

    return (
        <div
            className="mail-block-editor rounded-2xl bg-[var(--bg-primary)] overflow-hidden transition-all duration-300"
            style={{ minHeight }}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
        >
            <BlockNoteView
                editor={editor}
                onChange={() => {
                    if (onChange) {
                        const html = editor.blocksToHTMLLossy(editor.topLevelBlocks);
                        if (html !== lastContentRef.current) {
                            lastContentRef.current = html;
                            onChange(html);
                        }
                    }
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
