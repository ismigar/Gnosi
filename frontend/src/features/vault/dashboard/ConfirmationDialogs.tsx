import { Loader2 } from 'lucide-react';
import ConfirmModal from '../../../shared/ui/dialogs/ConfirmModal';
import type { DashboardController } from './useDashboardController';
export function ConfirmationDialogs(dashboard: DashboardController) {
  const context = dashboard;
  const {
    closePromptModal,
    executeCreateContent,
    executeDeleteView,
    handleDeletePage,
    promptModal,
    setPromptModal,
    setTemplateToDelete,
    setViewToDelete,
    setViewToDeleteUsage,
    t,
    templateToDelete,
    viewToDelete,
    viewToDeleteUsage,
  } = context;
  return <>
    {viewToDelete && (<ConfirmModal
      isOpen={!!viewToDelete}
      onClose={() => { setViewToDelete(null); setViewToDeleteUsage(null); }}
      onConfirm={() => { void executeDeleteView(); }}
      title={t('common.confirm_delete_view')}
      message={viewToDeleteUsage && viewToDeleteUsage.count > 0
        ? `${t('views_header.delete_linked_view_confirm', { count: viewToDeleteUsage.count, name: viewToDelete.name, defaultValue: "Aquesta vista està enllaçada a {{count}} pàgina(es):" })}\n\n${viewToDeleteUsage.pages.map(p => `• ${p.title}`).join('\n')}\n\n${t('views_header.confirm_delete_anyway', { defaultValue: "Segur que la vols eliminar de totes maneres?" })}`
        : t('common.confirm_delete_view_msg', { name: viewToDelete.name })}
      confirmText={t('common.delete')}
      isDestructive={true}
    />)}

    {templateToDelete && (<ConfirmModal
      isOpen={!!templateToDelete}
      onClose={() => { setTemplateToDelete(null); }}
      onConfirm={async () => {
        await handleDeletePage(templateToDelete.id, templateToDelete.title);
        setTemplateToDelete(null);
      }}
      title={t('common.confirm_delete_template')}
      message={t('common.confirm_delete_template_msg', { title: templateToDelete.title || t('common.untitled') })}
      confirmText={t('common.delete')}
      isDestructive={true}
    />)}

    {promptModal.isOpen && (<div className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-[var(--z-modal)] flex items-center justify-center p-4">
      <form
        onSubmit={(event) => { void executeCreateContent(event); }}
        onClick={(e) => { e.stopPropagation(); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            closePromptModal();
          }
        }}
        className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200"
      >
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
          {promptModal.isRename ? t('common.rename_view', { name: promptModal.targetView?.name }) :
            (promptModal.isView ? t('common.new_view') :
              (promptModal.isDrawing ? t('common.new_drawing') :
                (promptModal.isDashboard ? t('common.new_dashboard') :
                  (promptModal.isDatabase && promptModal.databaseId ? t('common.new_table') :
                    (promptModal.isApp ? t('common.new_app') :
                      (promptModal.isTemplate ? t('common.save_as_template') : t('common.new_page')))))))}
        </h3>
        <div className="mb-6">
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
            {promptModal.isRename ? t('common.prompt_new_name') : t('common.prompt_name')}
          </label>
          <input
            autoFocus
            type="text"
            value={promptModal.inputValue}
            onChange={(e) => { setPromptModal(prev => ({ ...prev, inputValue: e.target.value })); }}
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-gnosi focus:border-gnosi"
            placeholder={promptModal.defaultTitle}
            disabled={promptModal.isLoading}
            onFocus={(e) => { e.target.select(); }}
          />
        </div>
        <div className="flex justify-end gap-3 w-full">
          <button
            type="button"
            onClick={closePromptModal}
            className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-md transition-colors"
            disabled={promptModal.isLoading}
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={promptModal.isLoading || !promptModal.inputValue.trim()}
            className="btn btn-gnosi-primary px-4 py-2 text-sm font-medium disabled:opacity-50 flex items-center gap-2"
          >
            {promptModal.isLoading && <Loader2
              size={16}
              className="animate-spin"
            />}
            {promptModal.isRename ? t('common.rename') : t('common.create')}
          </button>
        </div>
      </form>
    </div>)}


  </>;
}
