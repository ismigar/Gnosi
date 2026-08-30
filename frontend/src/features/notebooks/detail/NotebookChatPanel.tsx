import { useTranslation } from 'react-i18next';
import type { NotebookController } from './useNotebookController';
import { BookOpen, LoaderCircle } from 'lucide-react';
import AgentChat from '../../../components/AgentChat';
import { notebookChatContext, notebookStorageIdentity } from './notebookModel';

export default function NotebookChatPanel({ controller }: { controller: NotebookController }) {
    const { t } = useTranslation();
    const { notebook, mobileTab, useResponsiveTabs, selectedSourceIds, chatOptionsLoaded, chatEpoch } = controller;
    const selectedSourceCount = chatOptionsLoaded ? selectedSourceIds.size : notebook.source_counts.available;
    const chatContext = notebookChatContext(notebook, chatOptionsLoaded, selectedSourceIds);
    return (
                <section
                    id="notebook-chat-panel"
                    className={`notebook-chat-panel notebook-mobile-tabpanel ${mobileTab === 'chat' ? 'is-mobile-active' : ''}`}
                    role={useResponsiveTabs ? 'tabpanel' : undefined}
                    aria-labelledby={useResponsiveTabs ? 'notebook-chat-tab' : undefined}
                    hidden={useResponsiveTabs && mobileTab !== 'chat'}
                >
                    {notebook.chat_ready ? (
                        <>
                            <div className="notebook-chat-context-bar">
                                <div>
                                    <BookOpen size={15} aria-hidden="true" />
                                    <span>
                                        {t('notebooks.chat_context_summary', '{{sources}} sources', { sources: selectedSourceCount })}
                                    </span>
                                </div>
                            </div>
                            {selectedSourceCount > 0 ? (
                                <AgentChat
                                    key={`${notebook.conversation_session_id}:${String(chatEpoch)}`}
                                    embedded
                                    storageIdentity={notebookStorageIdentity()}
                                    forcedSessionId={notebook.conversation_session_id}
                                    forcedAgentId="gnosy"
                                    notebookId={notebook.id}
                                    conversationMode={notebook.conversation_mode}
                                    contextRefs={chatContext}
                                    readOnly={!notebook.can_chat}
                                />
                            ) : (
                                <div className="notebook-chat-blocked"><BookOpen size={26} /><h2>{t('notebooks.no_chat_sources_title', 'Choose at least one source')}</h2><p>{t('notebooks.no_chat_sources_description', 'Select sources from this notebook or add another notebook to start a grounded conversation.')}</p></div>
                            )}
                        </>
                    ) : <div className="notebook-chat-blocked"><LoaderCircle size={26} className={notebook.status !== 'error' ? 'animate-spin' : ''} /><h2>{t('notebooks.chat_preparing_title', 'Preparing the first sources')}</h2><p>{t('notebooks.chat_preparing_description', 'Conversation becomes available when at least one source has been indexed.')}</p></div>}
                </section>

    );
}
