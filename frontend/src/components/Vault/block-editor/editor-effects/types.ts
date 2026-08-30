import type { RefObject } from 'react';
import type { EditorView, EditorProps } from '@tiptap/pm/view';
import type { GnosiEditor, EditorBlock } from '../schema';
import type { InsertContentResult } from '../../insert-content/insertContentTypes';

export type ToggleDropHandler = NonNullable<EditorProps['handleDrop']>;
export type EffectsEditor = Pick<GnosiEditor,
    'document' | 'getBlock' | 'transact' | 'removeBlocks' | 'insertBlocks' | 'updateBlock'
    | 'getTextCursorPosition' | 'getSelection' | 'prosemirrorView' | 'focus'
    | 'setTextCursorPosition' | 'getSelectedText' | 'insertInlineContent'> & {
    onChange: (callback: () => void) => () => void;
};
export interface EmbedNavApi {
    focusFirstCell?: () => unknown;
    focusLastCell?: () => unknown;
}
export interface EditorFocusApi { focusFirstBlock: () => boolean; }
export interface LinkPasteContext {
    url: string;
    anchorBlockId: string;
    internalPageId: string;
    position: { left: number; top: number };
}
export interface EditorEffectBase {
    editor: EffectsEditor;
    editorWrapperRef: RefObject<HTMLDivElement | null>;
    editorReady: boolean;
}
export interface FileInsertionInputs {
    editor: EffectsEditor;
    requestInsertContent: (options: { initialFile: File; initialTab: 'upload' }) => Promise<InsertContentResult | null>;
    uploadFileToAssetsDirect: (file: File) => Promise<string | null>;
    applyInsertResultRef: RefObject<((result: InsertContentResult, anchor?: EditorBlock) => unknown) | null>;
}
export interface DropEffectInputs extends EditorEffectBase, FileInsertionInputs {
    toggleDropHandlerRef: RefObject<ToggleDropHandler | null>;
    setLinkPasteCtx: (value: LinkPasteContext) => void;
}
export interface NavigationInputs extends EditorEffectBase {
    registerEditorApi?: ((api: EditorFocusApi | null) => void) | null;
    onNavigateUp?: (() => void) | null;
    onOpenProperties?: (() => void) | null;
}
export interface EditorEffectsInputs extends DropEffectInputs, NavigationInputs {
    noteFilename?: string | null;
    metadata?: Readonly<Record<string, unknown>> | null;
    contextValue?: { readonly allTables: readonly unknown[] } | null;
    setIsCitePickerOpen: (value: boolean) => void;
}

// The view can be absent during initialization/disposal despite BlockNote's
// static getter signature. Keep the original runtime lifetime guards.
export function editorView(editor: { readonly prosemirrorView?: EditorView }): EditorView | undefined {
    return editor.prosemirrorView;
}
