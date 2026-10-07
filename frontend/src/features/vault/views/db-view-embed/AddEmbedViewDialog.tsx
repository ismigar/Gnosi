import { useId, useRef, useState } from 'react';
import { createPanePortal as createPortal } from '../../../../shared/ui/createPanePortal';
import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalKeyboard } from '../../../../shared/hooks/useModalKeyboard';
import { browserDocumentBody } from '../../../../shared/platform/browser-events';
import type { EmbedView } from './types';

interface AddEmbedViewDialogProps {
    views: readonly EmbedView[];
    onCreate?: () => void;
    onSelect: (id: string) => void;
    onClose: () => void;
}

export function AddEmbedViewDialog({ views, onCreate, onSelect, onClose }: AddEmbedViewDialogProps) {
    const { t } = useTranslation();
    const titleId = useId();
    const panelRef = useRef<HTMLDivElement>(null);
    const [search, setSearch] = useState('');
    const matchingViews = views.filter(view => (view.name || view.heading || '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
    useModalKeyboard({ isOpen: true, onClose, containerRef: panelRef, trapFocus: true, confirmDisabled: true });
    return createPortal(
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[var(--z-modal)] p-4 backdrop-blur-sm">
            <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
                className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-lg border border-[var(--border-primary)] flex flex-col max-h-[85vh]">
                <div className="px-5 py-4 border-b border-[var(--border-primary)] flex items-center justify-between gap-3">
                    <h2 id={titleId} className="text-sm font-bold text-[var(--text-primary)]">{t('views_header.add_view', 'Add view')}</h2>
                    <button type="button" onClick={onClose} className="gnosi-close-btn" aria-label={t('common.close', 'Close')}><X size={16} /></button>
                </div>
                <div className="p-5 space-y-4 overflow-y-auto">
                    <button type="button" className="btn-gnosi btn-gnosi-primary w-full" onClick={onCreate} disabled={!onCreate}>
                        <Plus size={16} />{t('views_header.create_new_view', 'Create a new view')}
                    </button>
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('views_header.add_existing_view', 'Add an existing view')}</h3>
                    <input type="search" value={search} onChange={event => { setSearch(event.target.value); }}
                        aria-label={t('views_header.search_existing_views', 'Search existing views')}
                        placeholder={t('views_header.search_existing_views', 'Search existing views')}
                        className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)]" />
                    <div className="space-y-1">
                        {matchingViews.map(view => <button key={view.id} type="button" onClick={() => { if (view.id) onSelect(view.id); }}
                            className="w-full text-left px-3 py-2 rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]">
                            {view.name || view.heading || t('views_header.default_view_name', 'View')}
                        </button>)}
                        {matchingViews.length === 0 && <p role="status" className="text-sm text-[var(--text-secondary)]">
                            {t('views_header.no_available_views', 'No matching views available to add.')}
                        </p>}
                    </div>
                </div>
            </div>
        </div>, browserDocumentBody(),
    );
}
