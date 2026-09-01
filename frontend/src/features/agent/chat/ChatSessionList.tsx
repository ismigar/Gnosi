import { useTranslation } from 'react-i18next';
import type { StoredChatSession } from './sessionModel';

interface Props {
  readonly sortedSessions: readonly StoredChatSession[];
  readonly setShowSessionsView: (value: boolean) => void;
  readonly selectSession: (id: string) => void;
  readonly deleteSessionById: (id: string) => void;
}

export function ChatSessionList({ sortedSessions, setShowSessionsView, selectSession, deleteSessionById }: Props) {
    const { t } = useTranslation();
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-primary)' }}>{t('chat.sessions', 'Sessions')}</h4>
                <button
                    onClick={() => { setShowSessionsView(false); }}
                    style={{ border: '1px solid var(--settings-border, #e5e7eb)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: '10px', height: '24px', padding: '0 8px', fontSize: '0.68rem', cursor: 'pointer' }}
                >
                    {t('chat.back', "Back")}
                </button>
            </div>

            {sortedSessions.length === 0 && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{t('chat.no_sessions', "There are no sessions.")}</div>
            )}

            {sortedSessions.map((s) => (
                <div key={s.id} style={{ border: '1px solid var(--settings-border, #e5e7eb)', borderRadius: '12px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title || t('chat.session_fallback_name', "Session")}</div>
                        <div style={{ fontSize: '0.66rem', color: 'var(--text-secondary)' }}>{t('chat.messages_count', { count: s.messages.length, defaultValue_one: "{{count}} message", defaultValue_other: "{{count}} messages" })}{s.archived ? ` · ${t('chat.archived_suffix', "archived")}` : ''}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button
                            onClick={() => { selectSession(s.id); }}
                            style={{ border: '1px solid var(--settings-border, #e5e7eb)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: '10px', height: '24px', padding: '0 8px', fontSize: '0.68rem', cursor: 'pointer' }}
                        >
                            {t('chat.open_session', "Open")}
                        </button>
                        <button
                            onClick={() => { deleteSessionById(s.id); }}
                            aria-label={t('chat.delete_session_aria', "Delete session {{title}}", { title: s.title || t('common.untitled') })}
                            title={t('chat.delete_session_title', "Delete session")}
                            style={{ border: '1px solid var(--settings-border, #e5e7eb)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: '10px', width: '24px', height: '24px', fontSize: '0.7rem', cursor: 'pointer', lineHeight: 1 }}
                        >
                            x
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
