import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BlockNoteView } from '@blocknote/mantine';
import {
    BasicTextStyleButton, BlockNoteViewEditor, BlockTypeSelect, CreateLinkButton,
    FormattingToolbar, FormattingToolbarController, NestBlockButton, UnnestBlockButton,
    SuggestionMenuController, getDefaultReactSlashMenuItems, useCreateBlockNote,
} from '@blocknote/react';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import { useTheme } from '../hooks/useTheme';
import { resolveBlockNoteDictionary } from './locales/registry';
import '@blocknote/mantine/style.css';

export interface InstructionRichEditorProps {
    readonly label: string;
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly disabled?: boolean;
    readonly maxLength?: number;
    readonly placeholder?: string;
}

const TEXT_COMMANDS = new Set([
    'heading', 'heading_2', 'heading_3', 'paragraph', 'quote',
    'numbered_list', 'bullet_list', 'check_list', 'code_block', 'table', 'divider',
]);

function InstructionFormattingToolbar() {
    return <FormattingToolbar>
                <BlockTypeSelect />
                <BasicTextStyleButton basicTextStyle="bold" />
                <BasicTextStyleButton basicTextStyle="italic" />
                <BasicTextStyleButton basicTextStyle="strike" />
                <BasicTextStyleButton basicTextStyle="code" />
                <CreateLinkButton />
                <NestBlockButton />
                <UnnestBlockButton />
    </FormattingToolbar>;
}

export default function InstructionRichEditor({ label, value, onChange, disabled, maxLength, placeholder }: InstructionRichEditorProps) {
    const { t, i18n } = useTranslation();
    const { effectiveTheme } = useTheme();
    const [dictionary] = useState(() => resolveBlockNoteDictionary(i18n.resolvedLanguage || i18n.language));
    const [error, setError] = useState('');
    const [loadFailed, setLoadFailed] = useState(false);
    const editor = useCreateBlockNote({
        dictionary: { ...dictionary, placeholders: { ...dictionary.placeholders, default: placeholder || dictionary.placeholders.default } },
        _tiptapOptions: { editorProps: { attributes: { 'aria-label': label, role: 'textbox', 'aria-multiline': 'true' } } },
    });
    const applying = useRef(false);
    const accepted = useRef<string | null>(null);
    const attempted = useRef<string | null>(null);
    const original = useRef({ text: value, serialized: '' });
    const blocks = useRef(editor.document);

    useLayoutEffect(() => {
        if (accepted.current === value || attempted.current === value) return;
        attempted.current = value;
        applying.current = true;
        const reportLoad = (failed: boolean) => { queueMicrotask(() => {
            if (attempted.current !== value) return;
            setLoadFailed(failed);
            setError(failed ? t('instruction_editor.source_required') : '');
        }); };
        try {
            const parsed = editor.tryParseMarkdownToBlocks(value);
            editor.replaceBlocks(editor.document, parsed.length ? parsed : [{ type: 'paragraph' }]);
            original.current = { text: value, serialized: editor.blocksToMarkdownLossy() };
            accepted.current = value;
            blocks.current = editor.document;
            reportLoad(false);
        } catch {
            accepted.current = null;
            reportLoad(true);
        } finally {
            applying.current = false;
        }
    }, [editor, value, t]);

    const changed = () => {
        if (applying.current || disabled || accepted.current === null) return;
        const serialized = editor.blocksToMarkdownLossy();
        const next = serialized === original.current.serialized ? original.current.text : serialized;
        if (next === accepted.current) return;
        if (maxLength !== undefined && next.length > maxLength) {
            applying.current = true;
            try { editor.replaceBlocks(editor.document, blocks.current); }
            finally { applying.current = false; }
            setError(t('instruction_editor.too_long', { count: maxLength }));
            return;
        }
        setError('');
        accepted.current = next;
        blocks.current = editor.document;
        onChange(next);
    };

    return <div className="instruction-markdown__rich">
        <BlockNoteView editor={editor} theme={effectiveTheme} editable={!disabled && !loadFailed} onChange={changed}
            formattingToolbar={false} slashMenu={false} sideMenu={false} renderEditor={false}>
            {!disabled && !loadFailed && <FormattingToolbarController formattingToolbar={InstructionFormattingToolbar} />}
            <BlockNoteViewEditor />
            {!disabled && !loadFailed && <SuggestionMenuController triggerCharacter="/" getItems={query => Promise.resolve(
                filterSuggestionItems(getDefaultReactSlashMenuItems(editor).filter(item => 'key' in item
                    && typeof item.key === 'string' && TEXT_COMMANDS.has(item.key)), query),
            )} />}
        </BlockNoteView>
        {error && <p role="alert" className="instruction-markdown__help">{error}</p>}
    </div>;
}
