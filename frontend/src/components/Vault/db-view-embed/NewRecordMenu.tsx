import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, ChevronDown, Search, LayoutTemplate } from 'lucide-react';
import { IconRenderer } from '../IconRenderer';
import { getTemplateMenuIcon } from '../templateMenuUtils';
import { subscribeDocumentEvent, subscribeWindowEvent, eventTargetIsWithin } from '../../../shared/platform/browser-events';
import type { ViewActionsProps } from './types';
export function NewRecordMenu({ onCreate, onCreateTemplate, onCreateFromSource, templates = [] }: ViewActionsProps) {
    const { t } = useTranslation();
    const [showNewMenu, setShowNewMenu] = useState(false);
    const [newMenuMaxHeight, setNewMenuMaxHeight] = useState<number | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!showNewMenu) return;
        return subscribeDocumentEvent('mousedown', event => {
            if (menuRef.current && !eventTargetIsWithin(menuRef.current, event.target)) setShowNewMenu(false);
        });
    }, [showNewMenu]);
    useEffect(() => {
        if (!showNewMenu || !menuRef.current) return;
        const update = () => {
            const bounds = menuRef.current?.getBoundingClientRect();
            if (bounds) setNewMenuMaxHeight(Math.max(0, window.innerHeight - bounds.bottom - 12));
        };
        // The initial measurement is scheduled before paint; resize/scroll stay synchronous.
        const frame = requestAnimationFrame(update);
        const resize = subscribeWindowEvent('resize', update);
        const scroll = subscribeWindowEvent('scroll', update, true);
        return () => { cancelAnimationFrame(frame); resize(); scroll(); };
    }, [showNewMenu]);
    return (<>            {onCreate && (
        <div className="relative" ref={menuRef}>
            <div className="vault-new-split">
                <button
                    type="button"
                    onClick={() => onCreate()}
                    className="vault-new-split__create"
                >
                    <Plus size={14} />
                    <span>{t('views_header.new_action', "New")}</span>
                </button>
                <button
                    type="button"
                    onClick={() => { setShowNewMenu(open => !open); }}
                    className="vault-new-split__menu"
                    title={t('views_header.new_options', "New record options")}
                    aria-label={t('views_header.new_options', "New record options")}
                    aria-haspopup="menu"
                    aria-expanded={showNewMenu}
                >
                    <ChevronDown size={14} />
                </button>
            </div>
            {showNewMenu && (
                <div
                    className="vault-new-record-menu absolute top-full right-0 mt-1 w-56 border rounded-lg shadow-xl py-1 !text-xs"
                    style={newMenuMaxHeight == null ? undefined : { maxHeight: `${String(newMenuMaxHeight)}px` }}
                >
                    <button
                        onClick={() => { setShowNewMenu(false); onCreate(); }}
                        className="w-full flex items-center gap-2 px-3 py-2 !text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] text-left"
                    >
                        <Plus size={14} className="text-[var(--text-tertiary)]" />
                        <span>{t('views_header.new_empty_record', "New record")}</span>
                    </button>
                    {onCreateTemplate && (
                        <button
                            onClick={() => { setShowNewMenu(false); onCreateTemplate(); }}
                            className="w-full flex items-center gap-2 px-3 py-2 !text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] text-left"
                        >
                            <LayoutTemplate size={14} className="text-[var(--text-tertiary)]" />
                            <span>{t('views_header.new_template', "New template")}</span>
                        </button>
                    )}
                    {onCreateFromSource && (
                        <button
                            onClick={() => { setShowNewMenu(false); onCreateFromSource(); }}
                            className="w-full flex items-center gap-2 px-3 py-2 !text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] text-left"
                        >
                            <Search size={14} className="text-[var(--text-tertiary)]" />
                            <span>{t('views_header.new_from_source')}</span>
                        </button>
                    )}
                    {templates.length > 0 && (
                        <>
                            <div className="h-px bg-[var(--border-primary)] my-1 mx-2" />
                            <div className="px-3 py-1 text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-tighter">{t('views_header.templates_title', "Templates")}</div>
                            {[...templates]
                                .sort((a, b) => (a.title || '').localeCompare((b.title || ''), undefined, { sensitivity: 'base', numeric: true }))
                                .map(tpl => (
                                    <button
                                        key={tpl.id}
                                        onClick={() => { setShowNewMenu(false); onCreate({}, tpl); }}
                                        className="w-full flex items-center gap-2 px-3 py-2 !text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] text-left group"
                                    >
                                        <IconRenderer icon={getTemplateMenuIcon(tpl)} size={16} className="shrink-0" />
                                        <span className="truncate">{tpl.title || t('view.untitled', "(untitled)")}</span>
                                    </button>
                                ))}
                        </>
                    )}
                </div>
            )}
        </div>
    )}</>);
}
