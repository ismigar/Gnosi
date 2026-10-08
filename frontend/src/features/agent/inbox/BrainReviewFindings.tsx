import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VaultEditorContext } from '../../../shared/editor/VaultEditorContext';
import { getActiveVaultSlug } from '../../../shared/api/vault-context';
import { dispatchWindowEvent } from '../../../shared/platform/browser-events';
import { usePageReferenceTitle } from '../../../shared/records/usePageReferenceTitle';

import { reviewFindings, type Finding } from './brainReviewFindingsModel';

function FindingLink({ finding, onClose }: { finding: Finding; onClose: () => void }) {
    const context = useContext(VaultEditorContext);
    const { t } = useTranslation();
    const title = usePageReferenceTitle(finding.id, context.idToTitle, finding.title, t('editor.untitled'));
    const open = () => {
        onClose();
        const handler = context.onOpenInCurrentTab || context.onOpenPage || context.onOpenParallel;
        if (handler) { handler(finding.id); return; }
        const slug = getActiveVaultSlug() || 'principal';
        window.history.pushState({}, '', `/@${encodeURIComponent(slug)}/knowledge/page/${encodeURIComponent(finding.id)}`);
        dispatchWindowEvent(new PopStateEvent('popstate'));
    };
    return <button type="button" onClick={open} className="block text-left text-[var(--gnosi-primary)] hover:underline break-words" title={title}>{title}</button>;
}

export function BrainReviewFindings({ label, count, value, onClose }: { label: string; count: number; value: unknown; onClose: () => void }) {
    const { t } = useTranslation();
    const items = reviewFindings(value);
    const [expanded, setExpanded] = useState(false);
    const [limit, setLimit] = useState(20);
    return <details className="rounded-lg border border-[var(--border-primary)] p-3" onToggle={event => { setExpanded(event.currentTarget.open); }}>
        <summary className="cursor-pointer font-medium text-[var(--text-primary)]">{label}</summary>
        {expanded && <div className="mt-3 space-y-2">
            {items.slice(0, limit).map(item => <FindingLink key={item.id} finding={item} onClose={onClose} />)}
            {items.length > limit && <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { setLimit(current => current + 20); }}>{t('llm_wiki.tools.show_more')}</button>}
            {count > 0 && items.length === 0 && <p>{t('llm_wiki.tools.details_unavailable')}</p>}
        </div>}
    </details>;
}
