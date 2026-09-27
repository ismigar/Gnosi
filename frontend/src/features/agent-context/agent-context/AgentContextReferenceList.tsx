import type { ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { InternalContextSource } from '../../../shared/api/agent-context';
import { CONTEXT_KIND_ICONS, type ContextReference } from './agentContextModel';
import { internalSourceLabel } from './agentContextLabels';
import { sourceSummary } from './sourceSummary';

interface ReferenceListProps {
    readonly editingRefId: string | null;
    readonly onEdit: (id: string | null) => void;
    readonly onRemove: (id: string) => void;
    readonly references: readonly ContextReference[];
    readonly descriptors: readonly InternalContextSource[];
    readonly renderEditor: (reference: ContextReference, descriptor?: InternalContextSource) => ReactNode;
}
export function AgentContextReferenceList({ editingRefId, onEdit, onRemove, references, descriptors, renderEditor }: ReferenceListProps) {
    const { t } = useTranslation();
    return <div className="agent-source-list">
        {references.map(reference => {
            const Icon = CONTEXT_KIND_ICONS[reference.type];
            const descriptor = descriptors.find(item => item.id === reference.ref);
            const internal = reference.type === 'internal';
            const expanded = editingRefId === reference.id;
            const label = internal ? internalSourceLabel(t, reference.ref, reference.label)
                : ['page', 'table', 'database', 'vault'].includes(reference.type) ? `Vault · ${reference.label}` : reference.label;
            const copy = <><Icon size={17} /><span className="agent-source-copy"><strong>{label}</strong>
                <span>{sourceSummary(t, reference, descriptor)}</span></span></>;
            return <section className="agent-source-row" key={reference.id}>
                <div className="agent-source-heading">
                    {internal ? <button type="button" className="agent-source-expand" aria-expanded={expanded}
                        aria-label={`${t('settings.ai.context_configure_source', 'Configure source scope')}: ${label}`}
                        onClick={() => { onEdit(expanded ? null : reference.id); }}>
                        {copy}<ChevronDown size={16} className={expanded ? 'is-expanded' : ''} />
                    </button> : <div className="agent-source-expand">{copy}</div>}
                    <button type="button" className="agent-source-remove" aria-label={`${t('settings.ai.context_remove_source', 'Remove from context')}: ${label}`}
                        onClick={() => { onRemove(reference.id); }}><X size={16} /></button>
                </div>
                {internal && expanded ? renderEditor(reference, descriptor) : null}
            </section>;
        })}
    </div>;
}
