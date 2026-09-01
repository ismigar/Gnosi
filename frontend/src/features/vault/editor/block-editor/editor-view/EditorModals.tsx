import { IconPicker } from '../../IconPicker';
import { InsertContentModal } from '../../../content/InsertContentModal';
import { CitePicker } from '../../../../literature/records/CitePicker';
import AIGenerateModal from '../../AIGenerateModal';
import PromptModal from '../../../../../shared/ui/dialogs/PromptModal';
import ContextualLinkPasteMenu from '../../ContextualLinkPasteMenu';
import type { EditorModalInputs } from './types';

export function EditorModals({ editor, t, inlineIconPickerAnchor, closeInlineIconPicker, insertInlineIcon,
    pendingInsert, getPendingInsert, setPendingInsert, tableId, isCitePickerOpen, setIsCitePickerOpen,
    insertCitation, aiRequest, setAiRequest, insertGeneratedMarkdown, linkCardCtx, setLinkCardCtx,
    doLinkCard, linkPasteCtx, applyContextualLinkPaste, closeContextualLinkPaste }: EditorModalInputs) {
    return <>
        <IconPicker isOpen={inlineIconPickerAnchor != null} onClose={closeInlineIconPicker}
            onSelectIcon={insertInlineIcon} currentIcon="" anchorRect={inlineIconPickerAnchor} />
        <InsertContentModal open={Boolean(pendingInsert)} initialFile={pendingInsert?.initialFile || null}
            initialTab={pendingInsert?.initialTab || 'vault'} tableId={tableId}
            onInsert={result => {
                const pending = getPendingInsert();
                setPendingInsert(null);
                try { pending?.resolve(result); } catch { /* Original resolver isolation. */ }
            }}
            onClose={() => {
                const pending = getPendingInsert();
                setPendingInsert(null);
                try { pending?.reject(new Error('cancelled')); } catch { /* Original resolver isolation. */ }
                // Return to this editor body, not the page title that held focus before insertion.
                try { editor.focus(); } catch { /* Editor may already be unmounted. */ }
            }} />
        <CitePicker isOpen={isCitePickerOpen} onClose={() => { setIsCitePickerOpen(false); }}
            onSelect={item => { if (item.citation_key) insertCitation(item.citation_key); }} />
        <AIGenerateModal request={aiRequest} onClose={() => { setAiRequest(null); }} onInsert={insertGeneratedMarkdown} t={t} />
        <PromptModal isOpen={linkCardCtx != null} onClose={() => { setLinkCardCtx(null); }} onSubmit={doLinkCard}
            title={t('editor.linkcard_title', { defaultValue: 'Link card' })}
            label={t('editor.linkcard_prompt', { defaultValue: 'Paste the card URL:' })}
            placeholder="https://" defaultValue="https://" inputType="url"
            confirmText={t('common.add', { defaultValue: 'Add' })} cancelText={t('common.cancel', { defaultValue: 'Cancel' })} />
        {linkPasteCtx && <ContextualLinkPasteMenu position={linkPasteCtx.position}
            onChoose={applyContextualLinkPaste} onClose={closeContextualLinkPaste} />}
    </>;
}
