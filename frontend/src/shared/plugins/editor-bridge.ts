import { currentRequestContext, type RequestContext } from '../api/request-context';
import { subscribeAppEvent } from '../platform/app-events';
import { subscribeWindowEvent } from '../platform/browser-events';

/** Serializable capability snapshot, never a DOM/editor instance. */
export interface PluginEditorGuard {
    readonly vaultId: string;
    readonly documentId: string;
    readonly sessionId: string;
    readonly documentVersion: number;
    readonly selectionVersion: number;
}
export interface PluginEditorSelection extends PluginEditorGuard {
    readonly readOnly: boolean;
    readonly mainIndex: number;
    readonly ranges: readonly { readonly from: number; readonly to: number; readonly text: string }[];
}
export interface PluginSourceEditor {
    readonly getSelection: () => PluginEditorSelection;
    readonly replaceSelection: (text: string) => PluginEditorSelection;
}

interface ScopedEditor {
    readonly editor: PluginSourceEditor;
    readonly contextKey: string;
}

const editors = new Map<symbol, ScopedEditor>();
let active: symbol | null = null;

function editorContextKey(context: RequestContext): string {
    return JSON.stringify([context.userEmail, context.userId, context.vaultId, context.workspaceId]);
}

export function registerPluginSourceEditor(editor: PluginSourceEditor, context: RequestContext = currentRequestContext()) {
    const token = Symbol('source-editor');
    const contextKey = editorContextKey(context);
    editors.set(token, { editor, contextKey });
    active = token;
    const invalidate = () => { editors.delete(token); if (active === token) active = null; };
    const invalidateChangedContext = () => { if (editorContextKey(currentRequestContext()) !== contextKey) invalidate(); };
    const stopVault = subscribeAppEvent('gnosi:vault-changed', invalidate);
    const stopStorage = subscribeWindowEvent('storage', invalidateChangedContext);
    const stopFocus = subscribeWindowEvent('focus', invalidateChangedContext);
    return {
        activate: () => { invalidateChangedContext(); if (editors.has(token)) active = token; },
        dispose: () => { stopVault(); stopStorage(); stopFocus(); invalidate(); },
    };
}

function currentEditor(): PluginSourceEditor {
    const registration = active ? editors.get(active) : undefined;
    const context = currentRequestContext();
    if (!registration || registration.contextKey !== editorContextKey(context)
        || registration.editor.getSelection().vaultId !== context.vaultId) {
        if (active) editors.delete(active);
        active = null;
        throw new Error('No active Markdown source editor');
    }
    return registration.editor;
}

export function getPluginEditorSelection(): PluginEditorSelection {
    return currentEditor().getSelection();
}

/** Check and replace synchronously so user input cannot interleave with the edit. */
export function replacePluginEditorSelection(text: unknown, expected: unknown): PluginEditorSelection {
    if (typeof text !== 'string' || text.length > 1_000_000) throw new Error('Replacement must be text of at most 1,000,000 characters');
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)) throw new Error('A current editor snapshot is required');
    const guard = expected as Partial<PluginEditorGuard>;
    const editor = currentEditor();
    const current = editor.getSelection();
    if (current.readOnly) throw new Error('The current page is read-only');
    if (text.length * current.ranges.length > 1_000_000) throw new Error('Combined replacement is too large');
    if (guard.vaultId !== current.vaultId || guard.documentId !== current.documentId || guard.sessionId !== current.sessionId
        || guard.documentVersion !== current.documentVersion || guard.selectionVersion !== current.selectionVersion) {
        throw new Error('Editor selection changed; read it again before replacing');
    }
    return editor.replaceSelection(text);
}
