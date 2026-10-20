import { forwardRef, useContext, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Maximize2, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VaultEditorContext } from '../../../../shared/editor/VaultEditorContext';
import { fetchVaultPage } from '../../../../shared/api/vaults';
import { TransclusionContent } from './TransclusionContent';
import type { VaultPage } from '../../../../shared/api/vaults';
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
    const ancestors = context.transclusionAncestors || [];
    const path = [...ancestors, ...(context.pageId ? [context.pageId] : [])];
    const circular = !!resolvedId && (path.includes(resolvedId) || path.length >= 8);
    const childContext = { ...context, pageId: resolvedId, transclusionAncestors: path };
    const [loaded, setLoaded] = useState<{ id: string; page: VaultPage } | null>(null);
    const page = loaded?.id === resolvedId ? loaded.page : null;

    useEffect(() => {
        const controller = new AbortController();
        const loadPreview = async () => {
            setError('');
            if (circular) return;
            if (!resolvedId) {
                setError(t('editor.note_not_found'));
                return;
            }

            try {
                const response = await fetchVaultPage(resolvedId, controller.signal);
                if (!controller.signal.aborted) setLoaded({ id: resolvedId, page: response });
            } catch (error) {
                if (isRequestCancelled(error, controller.signal)) return;
                setError(t('editor.preview_load_error'));
            }
        };

        void loadPreview();
        return () => {
            controller.abort();
        };
    }, [resolvedId, section, circular, t]);

    // Decides between opening in the current tab (normal click) or in parallel (cmd-click).
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
            className="my-4 p-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 transition-colors"
            contentEditable={false}
        >
            <div className="flex items-center gap-2 text-[var(--gnosi-primary)] text-xs font-semibold uppercase tracking-wider mb-2">
                <Maximize2 size={13} />
                {t('editor.transclusion')}
            </div>
            <div className="text-sm font-semibold text-[var(--text-primary)] mb-1">{displayTitle}</div>
            {section ? <div className="text-[11px] text-[var(--gnosi-primary)] mb-1">#{section}</div> : null}
            {circular ? <div>{t('editor.transclusion_circular')}</div> : page ? <TransclusionContent key={`${resolvedId || ''}#${section}`} page={page} section={section} context={childContext} /> : !error ? <div>{t('editor.loading_editor')}</div> : null}
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
