import { useTranslation } from 'react-i18next';
import type { NotebookController } from './useNotebookController';
import { Trash2 } from 'lucide-react';

export default function NotebookSettingsPanel({ controller }: { controller: NotebookController }) {
    const { t } = useTranslation();
    const { notebook, mobileTab, useResponsiveTabs, patchNotebook, setShowClear } = controller;
    return (
                <aside
                    id="notebook-settings-panel"
                    className={`notebook-settings-panel notebook-mobile-tabpanel ${mobileTab === 'settings' ? 'is-mobile-active' : ''}`}
                    role={useResponsiveTabs ? 'tabpanel' : undefined}
                    aria-labelledby={useResponsiveTabs ? 'notebook-settings-tab' : undefined}
                    hidden={useResponsiveTabs && mobileTab !== 'settings'}
                >
                    <div className="notebook-panel-heading"><div><h2>{t('notebooks.settings_tab', 'Settings')}</h2><span>{t('notebooks.settings_help', 'Access and conversation behavior')}</span></div></div>
                    <label className="notebook-field"><span>{t('notebooks.visibility_label', 'Visibility')}</span><select value={notebook.visibility} disabled={!notebook.can_manage} onChange={(event) => { void patchNotebook({ visibility: event.target.value === 'workspace' ? 'workspace' : 'private' }); }}><option value="private">{t('notebooks.visibility_private', 'Private')}</option><option value="workspace">{t('notebooks.visibility_workspace', 'Workspace')}</option></select></label>
                    <label className="notebook-field"><span>{t('notebooks.conversation_label', 'Conversation')}</span><select value={notebook.conversation_mode} disabled={!notebook.can_manage} onChange={(event) => { void patchNotebook({ conversation_mode: event.target.value === 'shared' ? 'shared' : 'private_member' }); }}><option value="private_member">{t('notebooks.conversation_private', 'Private per member')}</option><option value="shared">{t('notebooks.conversation_shared', 'Shared')}</option></select></label>
                    <p className="notebook-settings-note">{notebook.conversation_mode === 'shared' ? t('notebooks.shared_history_note', 'Shared history is append-only and visible to authorized members.') : t('notebooks.private_history_note', 'Each member has an isolated history. Switching modes does not merge conversations.')}</p>
                    {(notebook.conversation_mode !== 'shared' ? notebook.can_chat : notebook.can_manage) && (
                        <button className="notebook-clear-conversation" type="button" onClick={() => { setShowClear(true); }}>
                            <Trash2 size={14} />{t('notebooks.clear_conversation', 'Clear conversation')}
                        </button>
                    )}
                </aside>
    );
}
