import { useTranslation } from 'react-i18next';
import { Info, X, Minimize2, Maximize2 } from 'lucide-react';
import { emitAppEvent } from '../../../shared/platform/app-events';
import { ChatIcon } from './ChatIcon';
import type { ChatAgentProfile } from './useChatConfiguration';

interface Props {
  readonly embedded: boolean;
  readonly isMinimized: boolean;
  readonly isLoading: boolean;
  readonly runtimeLimited: boolean;
  readonly agentHasModel: boolean;
  readonly agentIcon: string;
  readonly agentName: string;
  readonly selectedAgentId: string;
  readonly runtimeStatusLabel: string;
  readonly agentModel: string;
  readonly runtimeStatusHelp: string;
  readonly agentList: readonly ChatAgentProfile[];
  readonly archiveCurrentSession: () => void;
  readonly setIsMinimized: (value: boolean) => void;
  readonly setSelectedAgentId: (value: string) => void;
  readonly setShowSessionsView: (value: boolean) => void;
  readonly setIsOpen: (value: boolean) => void;
}

export function ChatHeader({ embedded, isMinimized, isLoading, runtimeLimited, agentHasModel, agentIcon, agentName, selectedAgentId, runtimeStatusLabel, agentModel, runtimeStatusHelp, agentList, archiveCurrentSession, setIsMinimized, setSelectedAgentId, setShowSessionsView, setIsOpen }: Props) {
    const { t } = useTranslation();
    return (
        <>
            {/* Header */}
            <div style={{
                padding: '12px 16px',
                background: 'var(--settings-header-bg, #f9fafb)',
                borderBottom: '1px solid var(--settings-border, #e5e7eb)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                cursor: 'pointer'
            }} onClick={() => { if (isMinimized) setIsMinimized(false); }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                        width: '32px', height: '32px', borderRadius: '8px',
                        background: 'rgba(37, 99, 235, 0.1)', color: 'var(--gnosi-blue)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        <ChatIcon icon={agentIcon} size={18} />
                    </div>
                    <div>
                        {embedded ? (
                            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                {agentName}
                            </div>
                        ) : <select
                            value={selectedAgentId}
                            onChange={(e) => { setSelectedAgentId(e.target.value); }}
                            onClick={(e) => { e.stopPropagation(); }}
                            disabled={isLoading}
                            style={{
                                margin: 0,
                                width: 'auto',
                                maxWidth: '190px',
                                border: 'none',
                                background: 'transparent',
                                color: 'var(--text-primary)',
                                fontSize: '0.9rem',
                                fontWeight: '700',
                                padding: 0,
                                outline: 'none',
                                cursor: 'pointer'
                            }}
                        >
                            {agentList.map((a) => (
                                <option key={a.id} value={a.id}>{a.name || a.id}</option>
                            ))}
                        </select>}
                        {!isMinimized && <div style={{ fontSize: '0.7rem', color: runtimeLimited ? '#f59e0b' : (agentHasModel ? '#10b981' : '#ef4444'), display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: runtimeLimited ? '#f59e0b' : (agentHasModel ? '#10b981' : '#ef4444') }}></span>
                            {runtimeStatusLabel}
                            {agentHasModel && <span style={{ color: 'var(--text-secondary)' }}>· {t('chat.agent_model', 'Model: {{model}}', { model: agentModel })}</span>}
                        </div>}
                    </div>
                </div>
                {!embedded && <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }} aria-label={isMinimized ? t('chat.expand_chat', "Expand chat") : t('chat.minimize_chat', "Minimize chat")} title={isMinimized ? t('chat.expand_chat', "Expand chat") : t('chat.minimize_chat', "Minimize chat")} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}>
                        {isMinimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); archiveCurrentSession(); setShowSessionsView(false); setIsOpen(false); }} aria-label={t('chat.close_chat', "Close chat")} title={t('chat.close_chat', "Close chat")} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}>
                        <X size={18} />
                    </button>
                </div>}
            </div>

            {!isMinimized && runtimeLimited && (
                <div
                    role="status"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 16px',
                        borderBottom: '1px solid var(--settings-border, #e5e7eb)',
                        background: 'color-mix(in srgb, #f59e0b 12%, var(--bg-primary))',
                        color: 'var(--text-primary)',
                        fontSize: '0.75rem',
                    }}
                >
                    <Info size={15} aria-hidden="true" style={{ flexShrink: 0, color: '#f59e0b' }} />
                    <span style={{ flex: 1 }}>{runtimeStatusHelp}</span>
                    <button
                        type="button"
                        onClick={() => { emitAppEvent('open-settings', 'ai'); }}
                        style={{
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--gnosi-blue)',
                            cursor: 'pointer',
                            padding: 0,
                            font: 'inherit',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {t('chat.runtime_review_settings', 'Review settings')}
                    </button>
                </div>
            )}

        </>
    );
}
