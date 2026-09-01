import { BlockNoteView } from '@blocknote/mantine';
import { SideMenuController } from '@blocknote/react';
import { VaultEditorContext } from '../../../../../shared/editor/VaultEditorContext';
import SpellCheckLayer from '../../SpellCheckLayer';
import AICorrectLayer from '../../AICorrectLayer';
import { SelectableSideMenu } from '../SelectableSideMenu';
import { EditorSuggestions } from './EditorSuggestions';
import { EditorModals } from './EditorModals';
import { suggestPastedFrame } from './pasteSuggestion';
import css from './editor.css?raw';
import type { EditorViewProps } from './types';

export function EditorView({ editorWrapperRef, ...props }: EditorViewProps) {
    const { editor, providerValue, isEditable, effectiveTheme, spellEnabled, noteFilename, onLangDetected, spellLang } = props;
    return <VaultEditorContext.Provider value={providerValue}>
        <style>{css}</style>
        <div ref={editorWrapperRef}
            onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
            onPaste={event => { suggestPastedFrame(event, props); }}>
            <BlockNoteView editor={editor} editable={isEditable} slashMenu={false} sideMenu={false} theme={effectiveTheme}>
                <SideMenuController sideMenu={SelectableSideMenu} floatingUIOptions={{ elementProps: { style: { zIndex: 'var(--z-popover)' } } }} />
                <EditorSuggestions {...props} />
            </BlockNoteView>
        </div>
        <SpellCheckLayer editor={editor} enabled={spellEnabled} pageId={noteFilename} onLangDetected={onLangDetected} />
        <AICorrectLayer editor={editor} lang={spellLang} />
        <EditorModals {...props} />
    </VaultEditorContext.Provider>;
}
