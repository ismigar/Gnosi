import React, { useMemo, useEffect } from 'react';
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/mantine/style.css";
import "@blocknote/core/fonts/inter.css";
import { useTheme } from '../../hooks/useTheme';

export default function MailBlockEditor({ initialContent, onChange, editorRef }) {
    const { effectiveTheme } = useTheme();
    // Initialize BlockNote editor
    const editor = useCreateBlockNote();

    // Use useMemo for the content or handle it via ref to avoid unnecessary re-renders
    useEffect(() => {
        if (initialContent && editor) {
            // If it's HTML or text, we might need to convert it, 
            // but for simplicity let's assume it starts empty or we use markdown/blocks.
            // Gmail replies usually start with original content.
            // For now, if initialContent is provided, we can try to insert it.
            async function load() {
                try {
                    // BlockNote expects an array of blocks or HTML. 
                    // Let's try to convert HTML if possible, otherwise treat as text.
                    const blocks = await editor.tryParseHTMLToBlocks(initialContent);
                    if (blocks && blocks.length > 0) {
                        editor.replaceBlocks(editor.topLevelBlocks, blocks);
                    }
                } catch (e) {
                    console.error("Error parsing initial content for MailBlockEditor:", e);
                }
            }
            load();
        }
    }, [initialContent, editor]);

    // Expose editor through ref if needed by parent (e.g. for inserting availability)
    useEffect(() => {
        if (editorRef) {
            editorRef.current = editor;
        }
    }, [editor, editorRef]);

    return (
        <div className="mail-block-editor border border-[var(--border-primary)] rounded-2xl bg-[var(--bg-primary)] min-h-[200px] overflow-hidden transition-colors duration-300">
            <BlockNoteView
                editor={editor}
                onChange={() => {
                    // Notify parent of changes
                    if (onChange) {
                        // We translate to HTML for sending
                        editor.blocksToHTML(editor.topLevelBlocks).then(onChange);
                    }
                }}
                theme={effectiveTheme}
            />
            <style jsx global>{`
                .mail-block-editor .bn-editor {
                    padding: 1rem !important;
                    min-height: 200px;
                    background: transparent !important;
                }
                .mail-block-editor .bn-container {
                     background: var(--bg-primary) !important;
                }
                .mail-block-editor .bn-main-content {
                    color: var(--text-primary) !important;
                }
                .mail-block-editor .bn-toolbar {
                    background: var(--bg-secondary) !important;
                    border-bottom: 1px solid var(--border-primary) !important;
                    color: var(--text-primary) !important;
                }
            `}</style>
        </div>
    );
}
