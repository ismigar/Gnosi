import { useTranslation } from 'react-i18next';
import { Plus, PanelBottomClose } from 'lucide-react';
import { announceFloatingPanelOpen } from '../../hooks/useExclusiveFloatingPanel';
import { ChatIcon } from './ChatIcon';

interface Props {
  readonly isDockOpen: boolean;
  readonly agentIcon: string;
  readonly setIsDockOpen: (value: boolean) => void;
  readonly setIsOpen: (value: boolean) => void;
}

export function ChatDock({ isDockOpen, agentIcon, setIsDockOpen, setIsOpen }: Props) {
    const { t } = useTranslation();
    return (
        <>
        <button
            type="button"
            onClick={() => { setIsDockOpen(!isDockOpen); }}
            className="gnosi-floating-dock-toggle flex items-center justify-center rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] shadow-sm transition-colors hover:text-[var(--gnosi-primary)]"
            aria-label={isDockOpen ? t('common.close', 'Close') : t('chat.open_chat', 'Open chat')}
            title={isDockOpen ? t('common.close', 'Close') : t('chat.open_chat', 'Open chat')}
            aria-expanded={isDockOpen}
        >
            {isDockOpen ? <PanelBottomClose size={18} /> : <Plus size={20} />}
        </button>
        <button
            onClick={() => {
                announceFloatingPanelOpen('chat');
                setIsDockOpen(false);
                setIsOpen(true);
            }}
            className="premium-chat-trigger gnosi-floating-action gnosi-floating-action--chat"
            aria-label={t('chat.open_chat', "Open chat")}
            title={t('chat.open_chat', "Open chat")}
            style={{
                borderRadius: '50%',
                background: 'var(--gnosi-blue, #3b82f6)',
                color: 'white', border: 'none', cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s ease'
            }}
        >
            <ChatIcon icon={agentIcon} size={20} />
        </button>
        </>
    );
}
