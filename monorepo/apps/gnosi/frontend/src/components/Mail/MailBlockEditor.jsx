import React, { useMemo, useEffect, useRef } from 'react';
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/mantine/style.css";
import "@blocknote/core/fonts/inter.css";
import { useTheme } from '../../hooks/useTheme';

export default function MailBlockEditor({ initialContent, onChange, editorRef, minHeight = "200px" }) {
    const { effectiveTheme } = useTheme();
    const editor = useCreateBlockNote();
    const lastContentRef = useRef(initialContent);

    // Load initial content only once or when it changes significantly
    useEffect(() => {
        if (editor && initialContent !== undefined) {
             async function load() {
                try {
                    // Convert HTML to blocks
                    const blocks = await editor.tryParseHTMLToBlocks(initialContent || "");
                    if (blocks) {
                        editor.replaceBlocks(editor.topLevelBlocks, blocks);
                        lastContentRef.current = initialContent;
                    }
                } catch (e) {
                    console.error("Error parsing initial content for MailBlockEditor:", e);
                }
            }
            // Only load if the editor is empty and we have content, or if we want to force a reset
            if (editor.topLevelBlocks.length <= 1 && editor.topLevelBlocks[0]?.content?.length === 0) {
                load();
            }
        }
    }, [editor]); // Only run on mount or when editor is created

    // Expose editor through ref
    useEffect(() => {
        if (editorRef) {
            editorRef.current = editor;
        }
    }, [editor, editorRef]);

    return (
        <div className="mail-block-editor border border-[var(--border-primary)] rounded-2xl bg-[var(--bg-primary)] overflow-hidden transition-all duration-300" style={{ minHeight }}>
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
                /* Hide the side menu button for a cleaner signature experience if needed */
                .mail-block-editor .bn-side-menu {
                   /* opacity: 0.5; */
                }
            `}</style>
        </div>
    );
}
