import { useTranslation } from 'react-i18next';
import type { NotebookController } from './useNotebookController';
import ConfirmModal from '../../../shared/ui/dialogs/ConfirmModal';
import AddResourcesDialog from './AddResourcesDialog';
import NotebookGroupDialog from './NotebookGroupDialog';

export default function NotebookDetailDialogs({ controller }: { controller: NotebookController }) {
    const { t } = useTranslation();
    const { notebook, currentIds, load, showAdd, setShowAdd, showGroupModal, editingGroup, setShowGroupModal, setEditingGroup, handleSaveGroup, showDelete, setShowDelete, deleteNotebook, showClear, setShowClear, clearConversation } = controller;
    return (<>
            {showAdd && <AddResourcesDialog notebookId={notebook.id} currentIds={currentIds} onClose={() => { setShowAdd(false); }} onAdded={() => load({ refresh: false })} />}
            {showGroupModal && (
                <NotebookGroupDialog
                    isOpen={showGroupModal}
                    initialName={editingGroup?.name || ''}
                    onClose={() => { setShowGroupModal(false); setEditingGroup(null); }}
                    onSave={handleSaveGroup}
                />
            )}
            <ConfirmModal isOpen={showDelete} onClose={() => { setShowDelete(false); }} onConfirm={deleteNotebook} title={t('notebooks.delete_title', 'Delete notebook?')} message={t('notebooks.delete_message', 'Indexes and notebook conversations will be deleted. Original Resources, attachments, and URLs will not be changed.')} confirmText={t('notebooks.delete', 'Delete notebook')} cancelText={t('common.cancel', 'Cancel')} isDestructive />
            <ConfirmModal isOpen={showClear} onClose={() => { setShowClear(false); }} onConfirm={clearConversation} title={t('notebooks.clear_conversation_title', 'Clear this conversation?')} message={t('notebooks.clear_conversation_message', 'This removes the active conversation history. It does not change sources or other conversation modes.')} confirmText={t('notebooks.clear_conversation', 'Clear conversation')} cancelText={t('common.cancel', 'Cancel')} isDestructive />
    </>);
}
