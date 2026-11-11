import { useTranslation } from 'react-i18next';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { blocksToRichMarkdown, richMarkdownToBlocks } from '../../../../shared/editor/markdown-mapper';
import type { AiGenerateRequest } from '../AIGenerateModal';
import type { EditorBlock, EditorSchema, GnosiEditor } from './schema';
import { readEditorBlocks } from './blockValues';

function resolveAnchor(value: unknown, editor: GnosiEditor): EditorBlock | undefined {
    if (typeof value === 'string') return editor.getBlock(value);
    if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return editor.getBlock(value.id);
    return undefined;
}

export function useGeneratedContent(editor: GnosiEditor, schema: EditorSchema, handleSave: () => Promise<void>, pageKey = '', editable = true) {
    const { t } = useTranslation();
    const live = useRef({ editor, pageKey, editable });
    useLayoutEffect(() => {
        live.current = { editor, pageKey, editable };
        return () => { live.current.editable = false; };
    }, [editor, pageKey, editable]);
    const pageEdit = useRef<{ anchor: object; editor: GnosiEditor; pageKey: string; snapshot: string } | null>(null);
    const [aiRequest, setAiRequest] = useState<AiGenerateRequest | null>(null);
    const openAICommand = useCallback((mode: AiGenerateRequest['mode'] = 'free') => {
        let context = ''; let anchor: EditorBlock | null = null;
        try { context = blocksToRichMarkdown(editor.document); } catch { /* keep prompt available */ }
        try { anchor = editor.getTextCursorPosition().block; } catch { /* selection no longer available */ }
        setAiRequest({ mode, context, anchor });
    }, [editor]);
    const openPageEdit = useCallback(() => {
        if (!live.current.editable) return;
        const anchor = {};
        pageEdit.current = { anchor, editor, pageKey, snapshot: JSON.stringify(editor.document) };
        setAiRequest({ mode: 'free', context: blocksToRichMarkdown(editor.document), anchor, replacePage: true });
    }, [editor, pageKey]);
    const insertGeneratedMarkdown = useCallback(async (markdown: string, anchor: unknown) => {
        if (!markdown) return;
        const target = pageEdit.current;
        const replacing = target?.anchor === anchor;
        const assertCurrent = () => {
            if (replacing && (!target || live.current.editor !== target.editor || live.current.pageKey !== target.pageKey
                || !live.current.editable || JSON.stringify(editor.document) !== target.snapshot)) {
                throw new Error(t('editor.ai_edit_stale', 'The page changed. Close this preview and request a new edit.'));
            }
        };
        assertCurrent();
        const blocks = readEditorBlocks(await richMarkdownToBlocks(markdown, editor), schema);
        assertCurrent();
        if (!blocks.length) throw new Error(t('editor.ai_empty', 'The AI returned no content.'));
        if (replacing) editor.replaceBlocks(editor.document, blocks);
        else editor.insertBlocks(blocks, resolveAnchor(anchor, editor) || editor.getTextCursorPosition().block, 'after');
        await handleSave();
    }, [editor, handleSave, schema, t]);
    return { aiRequest, setAiRequest, openAICommand, openPageEdit, insertGeneratedMarkdown };
}
