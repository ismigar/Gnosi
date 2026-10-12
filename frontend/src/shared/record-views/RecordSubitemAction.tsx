import { useContext } from 'react';
import { RecordSubitemContext } from './recordSubitemContext';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** The same per-record action in the existing view button bars. */
export function RecordSubitemAction({ recordId, className = '' }: { recordId: string; className?: string }) {
    const addSubitem = useContext(RecordSubitemContext);
    const { t } = useTranslation();
    if (!addSubitem) return null;
    return <button type="button" aria-label={t('table.add_subitem')} title={t('table.add_subitem')}
        onClick={event => { event.preventDefault(); event.stopPropagation(); addSubitem(recordId); }}
        className={`shrink-0 rounded p-1 text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] hover:bg-[var(--bg-secondary)] ${className}`}>
        <Plus size={14} />
    </button>;
}
