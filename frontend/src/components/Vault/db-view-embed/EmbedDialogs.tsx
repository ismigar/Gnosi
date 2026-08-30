import ConfirmModal from '../../ConfirmModal';
import PromptModal from '../../PromptModal';
import type { EmbedModel } from './useEmbedController';
export function EmbedDialogs({ model }: { model: EmbedModel ;}) {
    const { confirmDeleteView, setConfirmDeleteView, setDeleteViewUsage, doDeleteView, t, deleteViewUsage, renameView, setRenameView, doRename, isImportQuickPresetOpen, setIsImportQuickPresetOpen, importQuickPresets, renameQuickPresetId, setRenameQuickPresetId, submitQuickPresetRename, quickPresets } = model;
    return (<>            <ConfirmModal
        isOpen={confirmDeleteView != null}
        onClose={() => { setConfirmDeleteView(null); setDeleteViewUsage(null); }}
        onConfirm={doDeleteView}
        title={t('views_header.delete_view_title', "Delete view")}
        message={
            confirmDeleteView
                ? deleteViewUsage && deleteViewUsage.count > 0
                    ? `${t('views_header.delete_linked_view_confirm', { count: deleteViewUsage.count, name: confirmDeleteView.name || confirmDeleteView.heading || '', defaultValue: "Aquesta vista està enllaçada a {{count}} pàgina(es):" })}\n\n${deleteViewUsage.pages.map(p => `• ${p.title}`).join('\n')}\n\n${t('views_header.confirm_delete_anyway', { defaultValue: "Segur que la vols eliminar de totes maneres?" })}`
                    : t('views_header.delete_view_confirm', "Delete the view \"{{name}}\" EVERYWHERE? It will disappear from all pages.", { name: confirmDeleteView.name || confirmDeleteView.heading || '' })
                : ''
        }
        confirmText={t('common.delete', "Delete")}
        cancelText={t('common.cancel', "Cancel")}
        isDestructive
    />
        <PromptModal
            isOpen={renameView != null}
            onClose={() => { setRenameView(null); }}
            onSubmit={doRename}
            title={t('views_header.rename_view_title', "Rename view")}
            label={t('views_header.new_view_name_label', "New view name")}
            defaultValue={renameView ? (renameView.name || renameView.heading || '') : ''}
            confirmText={t('common.rename', "Rename")}
            cancelText={t('common.cancel', "Cancel")}
        />
        <PromptModal
            isOpen={isImportQuickPresetOpen}
            onClose={() => { setIsImportQuickPresetOpen(false); }}
            onSubmit={importQuickPresets}
            title={t('views_header.import_quick_views', 'Import configuration')}
            message={t('views_header.import_quick_views_hint', 'Paste a configuration copied from another view.')}
            defaultValue=""
            confirmText={t('views_header.import_quick_views', 'Import configuration')}
        />
        <PromptModal
            isOpen={renameQuickPresetId != null}
            onClose={() => { setRenameQuickPresetId(null); }}
            onSubmit={submitQuickPresetRename}
            title={t('views_header.rename_view_title', "Rename view")}
            label={t('views_header.new_view_name_label', "New view name")}
            defaultValue={quickPresets.find((preset) => preset.id === renameQuickPresetId)?.label || ''}
            confirmText={t('common.rename', "Rename")}
            cancelText={t('common.cancel', "Cancel")}
        /></>);
}
