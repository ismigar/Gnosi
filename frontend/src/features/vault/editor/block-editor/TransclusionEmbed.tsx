import { forwardRef, useContext, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Maximize2, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VaultEditorContext } from '../../../../shared/editor/VaultEditorContext';
import { fetchVaultPage } from '../../../../shared/api/vaults';
import { extractSectionPreview, markdownToPlainText } from './markdownPreview';
import { isRequestCancelled } from './media';

interface TransclusionProps { readonly block: { readonly props: { readonly target?: string; readonly alias?: string; readonly section?: string } }; }

export const TransclusionEmbed = forwardRef<HTMLDivElement, TransclusionProps>(({ block }, ref) => {
    const { t } = useTranslation();
    const context = useContext(VaultEditorContext);
    const { idToTitle, onOpenParallel, onOpenPage = () => {} } = context;
    const target = (block.props.target || '').trim();
    const alias = (block.props.alias || '').trim();
    const section = (block.props.section || '').trim();
    const [error, setError] = useState('');

    const resolvedId = useMemo(() => {
        if (!target) return null;
        if (idToTitle[target]) return target;

        const lowerTarget = target.toLowerCase();
        const byTitle = Object.entries(idToTitle).find(([, title]) => (title || '').toLowerCase() === lowerTarget);
        return byTitle?.[0] || null;
    }, [target, idToTitle]);

    const displayTitle = alias || idToTitle[resolvedId || ''] || target || t('editor.transclusion');
    const [preview, setPreview] = useState('');

    useEffect(() => {
        const controller = new AbortController();
        const loadPreview = async () => {
            if (!resolvedId) {
                setError(t('editor.note_not_found'));
                return;
            }

            try {
                const response = await fetchVaultPage(resolvedId, controller.signal);
                const raw = response.content || '';
                const scopedSection = section ? extractSectionPreview(raw, section) : '';
                const clean = scopedSection || markdownToPlainText(raw);

                if (controller.signal.aborted) return;

                if (section && !scopedSection) {
                    setError(t('editor.section_not_found'));
                    return;
                }

                setPreview(clean.slice(0, 300) || t('editor.no_content'));
            } catch (error) {
                if (isRequestCancelled(error, controller.signal)) return;
                setError(t('editor.preview_load_error'));
            }
        };

        void loadPreview();
        return () => {
            controller.abort();
        };
    }, [resolvedId, section, t]);

    // Decides between opening in the current tab (normal click) or in parallel (cmd-click).
    // Same convention as wikilinks: transclusion is a visual link to another
    // note, so a click should open it like a normal link.
    const openTarget = (e: MouseEvent<HTMLDivElement | HTMLButtonElement>) => {
        if (!resolvedId) return;
        if ((e.metaKey || e.ctrlKey) && onOpenParallel) {
            onOpenParallel(resolvedId);
        } else if (onOpenPage) {
            onOpenPage(resolvedId);
        } else if (onOpenParallel) {
            onOpenParallel(resolvedId);
        }
    };
    return (
        <div
            ref={ref}
            className="my-4 p-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 cursor-pointer hover:border-[var(--gnosi-primary)]/40 transition-colors"
            onClick={openTarget}
            title={resolvedId ? t('editor.open_embedded_note') : t('editor.note_unresolved')}
        >
            <div className="flex items-center gap-2 text-[var(--gnosi-primary)] text-xs font-semibold uppercase tracking-wider mb-2">
                <Maximize2 size={13} />
                {t('editor.transclusion')}
            </div>
            <div className="text-sm font-semibold text-[var(--text-primary)] mb-1">{displayTitle}</div>
            {section ? <div className="text-[11px] text-[var(--gnosi-primary)] mb-1">#{section}</div> : null}
            <div className="text-xs text-[var(--text-tertiary)] leading-relaxed">{preview}</div>
            <div className="p-4 bg-[var(--bg-secondary)]/20 border border-dashed border-[var(--border-primary)] rounded-lg flex flex-col items-center gap-3 mt-3">
                <button
                    onClick={(e) => { e.stopPropagation(); openTarget(e); }}
                    className="text-xs font-semibold text-[var(--gnosi-primary)] hover:underline flex items-center gap-1.5"
                >
                    <ExternalLink size={14} />
                    {resolvedId ? t('editor.open_embedded_note') : t('editor.note_unresolved')}
                </button>
                {error && <div className="text-[10px] text-[var(--status-error)] italic">{error}</div>}
            </div>
        </div>
    );
});
TransclusionEmbed.displayName = 'TransclusionEmbed';
