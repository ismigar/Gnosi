import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import NotebookCreateDialog from './create/NotebookCreateDialog';
import { vaultPath } from '../../lib/vaultRouting';
import { NotebookDetail } from './detail/NotebookDetail';
import NotebookLibrary from './detail/NotebookLibrary';
import './NotebooksPage.css';

export { NotebookDetail } from './detail/NotebookDetail';

export default function NotebooksPage() {
    const { notebookId } = useParams();
    const navigate = useNavigate();
    const [createOpen, setCreateOpen] = useState(false);
    return (
        <>
            {notebookId ? <NotebookDetail notebookId={notebookId} /> : <NotebookLibrary onCreate={() => { setCreateOpen(true); }} />}
            <NotebookCreateDialog isOpen={createOpen} onClose={() => { setCreateOpen(false); }} onCreated={(notebook) => { void navigate(vaultPath('notebooks', notebook.id)); }} />
        </>
    );
}
