import { LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNotebookController } from './useNotebookController';
import NotebookDetailHeader from './NotebookDetailHeader';
import NotebookMobileTabs from './NotebookMobileTabs';
import NotebookSourcesPanel from './NotebookSourcesPanel';
import NotebookChatPanel from './NotebookChatPanel';
import NotebookSettingsPanel from './NotebookSettingsPanel';
import NotebookDetailDialogs from './NotebookDetailDialogs';

export function NotebookDetail({ notebookId }: { notebookId: string }) {
    const { t } = useTranslation();
    const state = useNotebookController(notebookId);
    const { notebook, loading } = state;
    if (loading || !notebook) return <div className="notebooks-page notebook-detail-loading"><LoaderCircle className="animate-spin" /> {t('common.loading', 'Loading...')}</div>;
    const controller = { ...state, notebook };
    return (
        <div className="notebook-detail">
            <NotebookDetailHeader controller={controller} />
            <NotebookMobileTabs controller={controller} />
            <div className="notebook-workspace">
                <NotebookSourcesPanel controller={controller} />
                <NotebookChatPanel controller={controller} />
                <NotebookSettingsPanel controller={controller} />
            </div>
            <NotebookDetailDialogs controller={controller} />
        </div>
    );
}
