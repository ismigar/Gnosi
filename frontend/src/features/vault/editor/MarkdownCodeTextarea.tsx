import { useLayoutEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers, placeholder as editorPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { markdown } from '@codemirror/lang-markdown';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { getCM, vim } from '@replit/codemirror-vim';
import { currentRequestContext, type RequestContext } from '../../../shared/api/request-context';
import { registerPluginSourceEditor, type PluginEditorSelection } from '../../../shared/plugins/editor-bridge';
import './markdown-code-editor.css';

export interface MarkdownCodeTextareaProps {
    readonly ariaLabel: string;
    readonly onChange: (value: string) => void;
    readonly onSave: () => void;
    readonly placeholder?: string;
    readonly value: string;
    readonly vimMode?: boolean;
    readonly readOnly?: boolean;
    readonly documentId?: string | null;
    readonly isActive?: boolean;
}

const externalChange = Annotation.define<boolean>();
const markdownHighlighting = HighlightStyle.define([
    { tag: tags.heading, color: 'var(--gnosi-link)', fontWeight: '700' },
    { tag: tags.strong, fontWeight: '700' }, { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: [tags.link, tags.url], color: 'var(--gnosi-link)', textDecoration: 'underline' },
    { tag: [tags.quote, tags.monospace, tags.string], color: 'var(--text-secondary)' },
    { tag: [tags.processingInstruction, tags.comment, tags.meta], color: 'var(--text-tertiary)' },
    { tag: [tags.keyword, tags.atom, tags.number], color: 'var(--gnosi-link)' },
]);
const editorTheme = EditorView.theme({
    '&': { minHeight: '500px', backgroundColor: 'transparent', color: 'var(--text-primary)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--font-mono, monospace)', fontSize: '14px', lineHeight: '1.7' },
    '.cm-content': { minHeight: '500px', caretColor: 'var(--text-primary)' },
    '.cm-gutters': { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-tertiary)', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--gnosi-primary) 7%, transparent)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text-primary)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--gnosi-primary) 25%, transparent)' },
    '.cm-panels': { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' },
    '.cm-textfield': { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' },
});

/** The smallest replacement preserves selections before and after external edits. */
function markdownReplacement(previous: string, next: string) {
    let from = 0;
    while (from < previous.length && from < next.length && previous[from] === next[from]) from += 1;
    let oldEnd = previous.length; let newEnd = next.length;
    while (oldEnd > from && newEnd > from && previous[oldEnd - 1] === next[newEnd - 1]) { oldEnd -= 1; newEnd -= 1; }
    return { from, to: oldEnd, insert: next.slice(from, newEnd) };
}

/** CodeMirror owns cursor/history state; React only supplies document changes. */
export function MarkdownCodeTextarea(props: MarkdownCodeTextareaProps) {
    const host = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const callbacks = useRef(props);
    const originContext = useRef<RequestContext | null>(null);
    const version = useRef({ document: 0, selection: 0 });
    const registration = useRef<ReturnType<typeof registerPluginSourceEditor> | null>(null);
    const compartments = useRef({ vim: new Compartment(), editable: new Compartment(), label: new Compartment(), placeholder: new Compartment() });
    useLayoutEffect(() => { callbacks.current = props; });
    useLayoutEffect(() => {
        if (!host.current) return;
        const initial = callbacks.current;
        originContext.current = currentRequestContext();
        const slots = compartments.current;
        const view = new EditorView({
            parent: host.current,
            state: EditorState.create({
                doc: initial.value,
                extensions: [
                    EditorState.allowMultipleSelections.of(true),
                    slots.vim.of(initial.vimMode ? vim() : []),
                    keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave(); return true; } }]),
                    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
                    history(), drawSelection(), lineNumbers(), highlightActiveLine(), highlightSelectionMatches(),
                    markdown(), syntaxHighlighting(markdownHighlighting), EditorView.lineWrapping, editorTheme,
                    slots.editable.of([EditorState.readOnly.of(Boolean(initial.readOnly)), EditorView.editable.of(!initial.readOnly)]),
                    slots.label.of(EditorView.contentAttributes.of({ 'aria-label': initial.ariaLabel })),
                    slots.placeholder.of(editorPlaceholder(initial.placeholder ?? '')),
                    EditorView.domEventHandlers({ focus: () => { registration.current?.activate(); return false; } }),
                    EditorView.updateListener.of(update => {
                        if (update.docChanged) version.current.document += 1;
                        if (update.docChanged || update.selectionSet) version.current.selection += 1;
                        if (update.docChanged && !update.transactions.some(transaction => transaction.annotation(externalChange))) {
                            callbacks.current.onChange(update.state.doc.toString());
                        }
                    }),
                ],
            }),
        });
        viewRef.current = view;
        return () => { viewRef.current = null; view.destroy(); };
    }, []);
    useLayoutEffect(() => {
        const view = viewRef.current;
        const documentId = props.documentId;
        const context = originContext.current;
        if (!view || !documentId || props.isActive === false || !context) return;
        const sessionId = uuidv4();
        const vaultId = context.vaultId;
        const getSelection = (): PluginEditorSelection => ({
            vaultId, documentId, sessionId, documentVersion: version.current.document, selectionVersion: version.current.selection,
            readOnly: view.state.readOnly, mainIndex: view.state.selection.mainIndex,
            ranges: view.state.selection.ranges.map(range => ({ from: range.from, to: range.to, text: view.state.sliceDoc(range.from, range.to) })),
        });
        const bridge = registerPluginSourceEditor({ getSelection, replaceSelection: text => {
            view.dispatch(view.state.replaceSelection(text));
            view.focus();
            return getSelection();
        } }, context);
        registration.current = bridge;
        return () => { bridge.dispose(); if (registration.current === bridge) registration.current = null; };
    }, [props.documentId, props.isActive]);
    useLayoutEffect(() => {
        const view = viewRef.current;
        if (!view || view.state.doc.toString() === props.value) return;
        view.dispatch({
            changes: markdownReplacement(view.state.doc.toString(), props.value),
            annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
        });
    }, [props.value]);
    useLayoutEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({ effects: compartments.current.vim.reconfigure(props.vimMode ? vim() : []) });
        const cm = getCM(view);
        if (cm) cm.save = () => { callbacks.current.onSave(); };
    }, [props.vimMode]);
    useLayoutEffect(() => {
        viewRef.current?.dispatch({ effects: compartments.current.editable.reconfigure([
            EditorState.readOnly.of(Boolean(props.readOnly)), EditorView.editable.of(!props.readOnly),
        ]) });
    }, [props.readOnly]);
    useLayoutEffect(() => {
        viewRef.current?.dispatch({ effects: [
            compartments.current.label.reconfigure(EditorView.contentAttributes.of({ 'aria-label': props.ariaLabel })),
            compartments.current.placeholder.reconfigure(editorPlaceholder(props.placeholder ?? '')),
        ] });
    }, [props.ariaLabel, props.placeholder]);
    return <div ref={host} className="markdown-code-surface" />;
}
