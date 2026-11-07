import { SavedFeedback } from './SavedFeedback';
import { CheckSquare, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type Status = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'incomplete';
/** Compact save badge matching the page editor's title actions. */
export function DraftSaveStatus({ status, detail }: { readonly status: Status; readonly detail?: string }) {
    const { t } = useTranslation();
    if (status === 'idle') return null;
    if (status === 'saved') return <SavedFeedback className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--gnosi-blue)]/5 text-[10px] font-bold uppercase tracking-wider"><CheckSquare size={12} />{t('skill_autosave.saved')}</SavedFeedback>;
    const failed = status === 'error' || status === 'incomplete';
    const color = failed ? 'bg-[var(--status-error)]/5 text-[var(--status-error)]/60'
        : 'bg-[var(--gnosi-primary)]/5 text-[var(--gnosi-primary)]/60';
    return <span role={failed ? 'alert' : 'status'} title={detail}
        className={`ml-auto flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${color}`}>
        {status === 'saving' ? <Loader2 size={12} className="animate-spin" /> : failed ? <X size={12} /> : null}
        {t(`skill_autosave.${status}`)}
    </span>;
}
