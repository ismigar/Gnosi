import { SlidersHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    CONTEXT_KIND_ICONS,
    type ContextReference,
} from './agentContextModel';


interface ReferenceListProps {
    readonly editingRefId: string | null;
    readonly onEdit: (id: string | null) => void;
    readonly onRemove: (id: string) => void;
    readonly references: readonly ContextReference[];
}


export function AgentContextReferenceList({
    editingRefId,
    onEdit,
    onRemove,
    references,
}: ReferenceListProps) {
    const { t } = useTranslation();
    if (references.length === 0) return null;
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {references.map((reference) => {
                const Icon = CONTEXT_KIND_ICONS[reference.type];
                return (
                    <span key={reference.id} style={{
                        alignItems: 'center',
                        background: 'var(--settings-sidebar-bg)',
                        border: '1px solid var(--settings-border)',
                        borderRadius: '10px',
                        display: 'inline-flex',
                        fontSize: '0.8rem',
                        gap: '6px',
                        padding: '6px 10px',
                    }}>
                        <Icon size={14} />
                        {reference.label}
                        {reference.type === 'internal' ? (
                            <button
                                aria-label={t(
                                    'settings.ai.context_configure_source',
                                    'Configure source scope',
                                )}
                                onClick={() => {
                                    onEdit(editingRefId === reference.id
                                        ? null
                                        : reference.id);
                                }}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--text-tertiary)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                }}
                                type="button"
                            >
                                <SlidersHorizontal size={13} />
                            </button>
                        ) : null}
                        <button
                            aria-label={t(
                                'settings.ai.context_remove_source',
                                'Remove from context',
                            )}
                            onClick={() => {
                                onRemove(reference.id);
                            }}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--text-tertiary)',
                                cursor: 'pointer',
                                display: 'flex',
                            }}
                            type="button"
                        >
                            <X size={13} />
                        </button>
                    </span>
                );
            })}
        </div>
    );
}
