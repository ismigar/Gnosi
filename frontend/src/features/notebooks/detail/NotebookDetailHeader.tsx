import { useTranslation } from 'react-i18next';
import type { NotebookController } from './useNotebookController';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CircleStop, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import { vaultPath } from '../../../shared/routing/vaultRouting';
import StatusBadge from './StatusBadge';
import { isIndexing } from './notebookModel';

export default function NotebookDetailHeader({ controller }: { controller: NotebookController }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { notebook, setNotebook, patchNotebook, refresh, setShowDelete, cancelling, cancelRefresh } = controller;
    return (<>
            <header className="notebook-detail__header">
                <button className="notebook-icon-button" onClick={() => { void navigate(vaultPath('notebooks')); }} aria-label={t('notebooks.back_library', 'Back to library')}><ArrowLeft size={19} /></button>
                <div className="notebook-detail__identity">
                    <input value={notebook.title} onChange={(event) => { setNotebook((previous) => (previous ? { ...previous, title: event.target.value } : previous)); }} onBlur={(event) => { void patchNotebook({ title: event.target.value }); }} aria-label={t('notebooks.title_label', 'Title')} />
                    <div><StatusBadge status={notebook.status} /><span>{t('notebooks.revision_label', 'Revision {{revision}}', { revision: notebook.active_revision || '—' })}</span></div>
                </div>
                <div className="notebook-detail__actions">
                    {notebook.can_manage && <button className="btn-gnosi" onClick={() => { void refresh(); }}><RefreshCw size={15} />{t('notebooks.refresh', 'Refresh')}</button>}
                    {notebook.can_manage && <button className="notebook-icon-button notebook-icon-button--danger" onClick={() => { setShowDelete(true); }} aria-label={t('notebooks.delete', 'Delete notebook')}><Trash2 size={17} /></button>}
                </div>
            </header>

            {notebook.progress && isIndexing(notebook) && (
                <div className="notebook-progress">
                    <div className="notebook-progress__summary">
                        <div role="status" aria-live="polite" aria-atomic="true"><LoaderCircle size={15} className="animate-spin" /><span>{t('notebooks.index_progress', 'Indexing {{processed}} of {{total}} Resources', notebook.progress)}</span></div>
                        {notebook.can_manage && notebook.progress.cancellable && <button type="button" disabled={cancelling} onClick={() => { void cancelRefresh(); }}><CircleStop size={14} />{t('notebooks.cancel_indexing', 'Cancel indexing')}</button>}
                    </div>
                    {notebook.progress.current_resource_title && <span className="notebook-progress__resource">{t('notebooks.current_resource', 'Current Resource: {{resource}}', { resource: notebook.progress.current_resource_title })}</span>}
                    <div className="notebook-progress__track"><span style={{ width: `${String(notebook.progress.percent || 0)}%` }} /></div>
                </div>
            )}
            {notebook.last_error && <div className="notebook-warning" role="alert"><AlertCircle size={16} /><span>{notebook.last_error}</span></div>}

    </>);
}
