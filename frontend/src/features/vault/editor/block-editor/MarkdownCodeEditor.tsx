import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { defineStorageKey, readStorage, stringStorageCodec, writeStorage } from '../../../../shared/platform/browser-storage';
import { GnosiToggle } from '../../../../shared/ui/settings/SettingsPrimitives';
import { MarkdownCodeTextarea } from '../MarkdownCodeTextarea';
import { useMarkdownCode } from './useMarkdownCode';
import type { MarkdownCodeEditorProps } from './codeTypes';

const VaultMarkdown = lazy(() => import('../../../../shared/editor/VaultMarkdown'));
const previewKey = defineStorageKey('gnosi:markdown-preview', stringStorageCodec);
const vimKey = defineStorageKey('gnosi:markdown-vim', stringStorageCodec);

function MarkdownCodeSession(props: MarkdownCodeEditorProps) {
    const { text, ...editorProps } = useMarkdownCode(props);
    const { t } = useTranslation();
    const [preview, setPreview] = useState(() => readStorage(previewKey) === '1');
    const [vimMode, setVimMode] = useState(() => readStorage(vimKey) === '1');
    return <div className="markdown-code-editor">
        <div className="markdown-code-toolbar">
            <div className="markdown-code-option"><span>{t('editor.source_preview', 'Preview')}</span><GnosiToggle active={preview} label={t('editor.source_preview', 'Preview')}
                onChange={() => { setPreview(!preview); writeStorage(previewKey, preview ? '0' : '1'); }} /></div>
            <div className="markdown-code-option"><span>{t('editor.source_vim', 'Vim mode')}</span><GnosiToggle active={vimMode} label={t('editor.source_vim', 'Vim mode')}
                onChange={() => { setVimMode(!vimMode); writeStorage(vimKey, vimMode ? '0' : '1'); }} /></div>
            <span className="markdown-code-help">{t('editor.source_help', 'Alt-click adds a cursor. Ctrl/⌘ D selects the next match. Ctrl/⌘ F finds text.')}</span>
        </div>
        <div className="markdown-code-panes" data-preview={preview}>
            <MarkdownCodeTextarea value={text} {...editorProps} vimMode={vimMode} readOnly={props.readOnly} documentId={props.noteFilename} isActive={props.isActivePage} />
            {preview && <section className="markdown-code-preview" aria-label={t('editor.source_preview', 'Preview')}>
                <Suspense fallback={<span>{t('common.loading')}</span>}><VaultMarkdown md={text} idToTitle={props.idToTitle} vaultId={props.vaultId} allowVaultQueries sourcePageId={props.noteFilename}
                    onOpenInCurrentTab={props.onOpenInCurrentTab} onOpenInNewTab={props.onOpenInNewTab} onOpenParallel={props.onOpenParallel} /></Suspense>
            </section>}
        </div>
    </div>;
}

export function MarkdownCodeEditor(props: MarkdownCodeEditorProps) {
    // Flush the old page through its own captured callbacks before a new session
    // starts, even when a caller replaces props without a keyed editor parent.
    return <MarkdownCodeSession key={props.noteFilename ?? ''} {...props} />;
}
