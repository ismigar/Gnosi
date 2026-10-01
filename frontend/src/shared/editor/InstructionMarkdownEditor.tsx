import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { VaultMarkdown } from './VaultMarkdown';
import { indentInstructionLines, instructionMarkdownTokens } from './instructionMarkdown';
import './styles/instruction-markdown.css';

interface Props {
    readonly label: string;
    readonly description?: string;
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly placeholder?: string;
    readonly disabled?: boolean;
    readonly maxLength?: number;
}

/** A controlled Markdown source editor: preview never changes its original text. */
export function InstructionMarkdownEditor({ label, description, value, onChange, placeholder, disabled = false, maxLength }: Props) {
    const { t } = useTranslation();
    const id = useId();
    const [preview, setPreview] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const textarea = useRef<HTMLTextAreaElement>(null);
    const highlighted = useRef<HTMLPreElement>(null);
    const dialog = useRef<HTMLDivElement>(null);
    const expandButton = useRef<HTMLButtonElement>(null);
    const wasExpanded = useRef(false);
    const selection = useRef<{ start: number; end: number } | null>(null);
    const tokens = useMemo(() => instructionMarkdownTokens(value), [value]);
    useModalKeyboard({ isOpen: expanded, onClose: () => { setExpanded(false); }, containerRef: dialog, trapFocus: true });
    useEffect(() => {
        // Moving the editor into a portal replaces the original trigger node.
        if (wasExpanded.current && !expanded) expandButton.current?.focus();
        wasExpanded.current = expanded;
    }, [expanded]);
    useLayoutEffect(() => {
        if (!selection.current || !textarea.current) return;
        textarea.current.focus();
        textarea.current.setSelectionRange(selection.current.start, selection.current.end);
        selection.current = null;
    }, [value]);

    const indent = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (disabled || event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey)
            || !['[', ']'].includes(event.key)) return;
        event.preventDefault();
        const field = event.currentTarget;
        const change = indentInstructionLines(value, field.selectionStart, field.selectionEnd, event.key === '[');
        if (change.value === value) return;
        if (maxLength !== undefined && change.value.length > maxLength) return;
        selection.current = change;
        onChange(change.value);
    };

    const editor = <div className={`instruction-markdown${expanded ? ' instruction-markdown--expanded' : ''}`}>
        <div className="instruction-markdown__toolbar">
            <label className="settings-label" htmlFor={`${id}-source`} id={`${id}-label`}>{label}</label>
            <div className="instruction-markdown__actions" role="group" aria-label={t('instruction_editor.controls')}>
                <button type="button" className={`btn-gnosi ${preview ? 'btn-gnosi-secondary' : 'btn-gnosi-primary'}`}
                    aria-pressed={!preview} onClick={() => { setPreview(false); }}>{t('instruction_editor.edit')}</button>
                <button type="button" className={`btn-gnosi ${preview ? 'btn-gnosi-primary' : 'btn-gnosi-secondary'}`}
                    aria-pressed={preview} onClick={() => { setPreview(true); }}>{t('instruction_editor.preview')}</button>
                <button ref={expandButton} type="button" className="btn-gnosi btn-gnosi-secondary" aria-label={t(expanded ? 'instruction_editor.reduce' : 'instruction_editor.expand')}
                    title={t(expanded ? 'instruction_editor.reduce' : 'instruction_editor.expand')}
                    onClick={() => { setExpanded(current => !current); }}>
                    {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
            </div>
        </div>
        {description && <div className="settings-desc" id={`${id}-description`}>{description}</div>}
        <div className="instruction-markdown__source" hidden={preview}>
            <pre className="instruction-markdown__highlight" ref={highlighted} aria-hidden="true">
                {tokens.map((token, index) => <span key={index} className={`instruction-markdown__${token.kind}`}>{token.text}</span>)}{'\n'}
            </pre>
            <textarea ref={textarea} id={`${id}-source`} className="instruction-markdown__input" aria-label={label}
                aria-describedby={description ? `${id}-description` : undefined}
                value={value} placeholder={placeholder} disabled={disabled} maxLength={maxLength} spellCheck={false}
                onChange={event => { onChange(event.target.value); }} onKeyDown={indent}
                onScroll={event => {
                    if (!highlighted.current) return;
                    highlighted.current.scrollTop = event.currentTarget.scrollTop;
                    highlighted.current.scrollLeft = event.currentTarget.scrollLeft;
                }} />
        </div>
        {preview && <div className="instruction-markdown__preview feed-md" role="region" aria-label={t('instruction_editor.preview')}>
            {value ? <VaultMarkdown md={value} /> : <p>{t('instruction_editor.empty')}</p>}
        </div>}
        {!preview && <p className="instruction-markdown__help">{t('instruction_editor.help')}</p>}
    </div>;

    return expanded ? createPortal(<div className="instruction-markdown__backdrop">
        <div ref={dialog} className="instruction-markdown__dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-label`}>
            {editor}
        </div>
    </div>, document.body) : editor;
}
