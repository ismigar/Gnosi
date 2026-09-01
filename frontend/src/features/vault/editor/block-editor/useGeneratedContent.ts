import { useCallback, useState } from 'react';
import { blocksToRichMarkdown, richMarkdownToBlocks } from '../../../../shared/editor/markdown-mapper';
import type { AiGenerateRequest } from '../AIGenerateModal';
import type { EditorBlock, EditorSchema, GnosiEditor } from './schema';
import { readEditorBlocks } from './blockValues';

function resolveAnchor(value: unknown, editor: GnosiEditor): EditorBlock | undefined {
    if (typeof value === 'string') return editor.getBlock(value);
    if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return editor.getBlock(value.id);
    return undefined;
}

export function useGeneratedContent(editor: GnosiEditor, schema: EditorSchema, handleSave: () => Promise<void>) {
    const [aiRequest, setAiRequest] = useState<AiGenerateRequest | null>(null);
    const openAICommand = useCallback((mode: AiGenerateRequest['mode'] = 'free') => {
        let context = ''; let anchor: EditorBlock | null = null;
        try { context = blocksToRichMarkdown(editor.document); } catch { /* keep prompt available */ }
        try { anchor = editor.getTextCursorPosition().block; } catch { /* selection no longer available */ }
        setAiRequest({ mode, context, anchor });
    }, [editor]);
    const insertGeneratedMarkdown = useCallback(async (markdown: string, anchor: unknown) => {
        if (!markdown) return;
        try {
            const blocks = readEditorBlocks(await richMarkdownToBlocks(markdown, editor), schema);
            if (blocks.length) {
                editor.insertBlocks(blocks, resolveAnchor(anchor, editor) || editor.getTextCursorPosition().block, 'after');
                setTimeout(() => { void handleSave(); }, 150);
            }
        } catch (error) { console.error('insertGeneratedMarkdown failed:', error); }
    }, [editor, handleSave, schema]);
    return { aiRequest, setAiRequest, openAICommand, insertGeneratedMarkdown };
}
