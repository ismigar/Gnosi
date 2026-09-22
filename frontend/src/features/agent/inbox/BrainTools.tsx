import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ClipboardCheck, Loader2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { apiErrorDetail } from '../../../shared/api/errors';
import { fetchPluginLlmWikiConfig, runPluginLlmWikiMaintenance, type PluginLlmWikiMaintenanceResponse } from '../../../shared/api/plugins';
import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import { browserDocumentBody, browserViewportSize, eventTargetIsWithin, subscribeDocumentEvent, subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { BrainInbox } from './BrainInbox';
import { BrainReviewDialog } from './BrainReviewDialog';

interface BrainToolsProps {
    readonly tableId: string;
    readonly onChanged?: () => void;
}

export function BrainTools({ tableId, onChanged }: BrainToolsProps) {
    const { t } = useTranslation();
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, maxHeight: 300, width: 256 });
    const [reportOpen, setReportOpen] = useState(false);
    const [connectionsOpen, setConnectionsOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [semantic, setSemantic] = useState(false);
    const [error, setError] = useState('');
    const [lint, setLint] = useState<PluginLlmWikiMaintenanceResponse['lint'] | null>(null);
    const menuId = useId();
    const wrapperRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const requestRef = useRef<AbortController | null>(null);
    const positionMenu = useCallback((): void => {
        const bounds = triggerRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const viewport = browserViewportSize();
        const width = Math.min(256, viewport.width - 16);
        const top = bounds.bottom + 4;
        setMenuPosition({ top, left: Math.max(8, Math.min(bounds.right - width, viewport.width - width - 8)), maxHeight: Math.max(0, viewport.height - top - 8), width });
    }, []);

    const closeMenu = (): void => {
        setMenuOpen(false);
        if (menuOpen) triggerRef.current?.focus();
    };
    useModalKeyboard({ isOpen: menuOpen, onClose: closeMenu, containerRef: menuRef, trapFocus: true });
    useEffect(() => {
        if (!menuOpen) return;
        const unsubscribePointer = subscribeDocumentEvent('mousedown', event => {
            if (wrapperRef.current && menuRef.current && !eventTargetIsWithin(wrapperRef.current, event.target) && !eventTargetIsWithin(menuRef.current, event.target)) setMenuOpen(false);
        });
        const unsubscribeResize = subscribeWindowEvent('resize', positionMenu);
        const unsubscribeScroll = subscribeWindowEvent('scroll', positionMenu, true);
        return () => { unsubscribePointer(); unsubscribeResize(); unsubscribeScroll(); };
    }, [menuOpen, positionMenu]);
    useEffect(() => () => { requestRef.current?.abort(); }, []);

    const navigateMenu = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const index = items.findIndex(item => item === document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        event.preventDefault();
        items[next]?.focus();
    };

    const run = async (useAI: boolean): Promise<void> => {
        if (requestRef.current) return;
        const request = new AbortController();
        requestRef.current = request;
        closeMenu();
        setConnectionsOpen(false);
        setSemantic(useAI);
        setBusy(true);
        setError('');
        setLint(null);
        setReportOpen(true);
        try {
            const config = await fetchPluginLlmWikiConfig(request.signal);
            request.signal.throwIfAborted();
            if (!config.validation.valid || config.brain.table_id !== tableId) {
                setError(t('llm_wiki.tools.unavailable'));
                return;
            }
            const response = await runPluginLlmWikiMaintenance(useAI, request.signal);
            request.signal.throwIfAborted();
            setLint(response.lint);
            if (useAI) {
                setReportOpen(false);
                setConnectionsOpen(true);
            }
            onChanged?.();
        } catch (cause) {
            if (!request.signal.aborted) setError(apiErrorDetail(cause, t('settings.plugins.llm_wiki_error')));
        } finally {
            if (!request.signal.aborted) setBusy(false);
            requestRef.current = null;
        }
    };

    const actionClass = 'btn-gnosi btn-gnosi-secondary w-full !justify-start !px-3 !py-2 !text-xs text-left';
    return <>
        <div ref={wrapperRef} className="relative">
            <button
                ref={triggerRef}
                type="button"
                className="btn-gnosi btn-gnosi-secondary !px-3 !py-1.5 !text-xs"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls={menuOpen ? menuId : undefined}
                onClick={() => { positionMenu(); setMenuOpen(current => !current); }}
            >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />}
                {t('llm_wiki.tools.button')}
                <ChevronDown size={14} />
            </button>
            {menuOpen && createPortal(<div
                ref={menuRef}
                id={menuId}
                role="menu"
                aria-label={t('llm_wiki.tools.button')}
                onKeyDown={navigateMenu}
                style={menuPosition}
                className="fixed overflow-y-auto z-[var(--z-popover)] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-xl p-2 flex flex-col gap-2"
            >
                <button type="button" role="menuitem" className={actionClass} disabled={busy} onClick={() => { void run(false); }}>
                    <ClipboardCheck size={14} className="shrink-0" />{t('llm_wiki.tools.review')}
                </button>
                <button type="button" role="menuitem" className={actionClass} disabled={busy} onClick={() => { void run(true); }}>
                    <Sparkles size={14} className="shrink-0" />{t('settings.plugins.llm_wiki_semantic_run')}
                </button>
                {(lint || busy || error) && <button type="button" role="menuitem" className={actionClass} onClick={() => { closeMenu(); setReportOpen(true); }}>
                    {t('llm_wiki.tools.results')}
                </button>}
            </div>, browserDocumentBody())}
        </div>
        <BrainInbox open={connectionsOpen} onOpenChange={setConnectionsOpen} onAccepted={onChanged} />
        {reportOpen && <BrainReviewDialog
            busy={busy}
            semantic={semantic}
            error={error}
            lint={lint}
            onClose={() => { setReportOpen(false); }}
            onRetry={() => { void run(semantic); }}
        />}
    </>;
}
