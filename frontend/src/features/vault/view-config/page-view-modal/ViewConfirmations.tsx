import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewActionsResult } from './useViewActions';
import type { useViewClosingResult } from './useViewClosing';

import ConfirmModal from '../../../../shared/ui/dialogs/ConfirmModal';
export function ViewConfirmations({
    modalViewToDelete, setModalViewToDelete, setModalViewToDeleteUsage, confirmDeleteViewFromModal,
    t, modalViewToDeleteUsage, discardConfirmOpen, setDiscardConfirmOpen,
    discardChanges
}: Pick<
    useViewStateResult & useViewActionsResult & ModalInput & useViewClosingResult,
    'modalViewToDelete'
    | 'setModalViewToDelete'
    | 'setModalViewToDeleteUsage'
    | 'confirmDeleteViewFromModal'
    | 't'
    | 'modalViewToDeleteUsage'
    | 'discardConfirmOpen'
    | 'setDiscardConfirmOpen'
    | 'discardChanges'
>) {
    return (<>            {modalViewToDelete && (
        <ConfirmModal
            isOpen={!!modalViewToDelete}
            onClose={() => { setModalViewToDelete(null); setModalViewToDeleteUsage(null); }}
            onConfirm={confirmDeleteViewFromModal}
            title={t('views_header.delete_view_title', "Delete view")}
            message={
                modalViewToDeleteUsage && modalViewToDeleteUsage.count > 0
                    ? `${t('views_header.delete_linked_view_confirm', { count: modalViewToDeleteUsage.count, name: modalViewToDelete.name || '', defaultValue: "Aquesta vista està enllaçada a {{count}} pàgina(es):" })}\n\n${modalViewToDeleteUsage.pages.map(p => `• ${p.title}`).join('\n')}\n\n${t('views_header.confirm_delete_anyway', { defaultValue: "Segur que la vols eliminar de totes maneres?" })}`
                    : t('views_header.delete_view_confirm', "Delete the view \"{{name}}\" EVERYWHERE?", { name: modalViewToDelete.name || '' })
            }
            confirmText={t('common.delete', "Delete")}
            cancelText={t('common.cancel', "Cancel")}
            isDestructive
        />
    )}
        <ConfirmModal
            isOpen={discardConfirmOpen}
            onClose={() => { setDiscardConfirmOpen(false); }}
            onConfirm={discardChanges}
            title={t('view.discard_changes_title', "Discard changes?")}
            message={t('view.discard_changes_message', "Your unsaved changes will be lost.")}
            confirmText={t('view.discard_changes_confirm', "Discard changes")}
            cancelText={t('view.continue_editing', "Continue editing")}
            isDestructive
        /></>);
}
