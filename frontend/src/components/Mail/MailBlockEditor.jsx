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

export default function MailBlockEditor({ initialContent, onChange, editorRef, minHeight = "200px", onAttachFile }) {
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
                        lastContentRef.current = initialContent;
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
                        editor.blocksToHTML(editor.topLevelBlocks).then(html => {
                            if (html !== lastContentRef.current) {
                                lastContentRef.current = html;
                                onChange(html);
                            }
                        });
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
            `}</style>
        </div>
    );
}
