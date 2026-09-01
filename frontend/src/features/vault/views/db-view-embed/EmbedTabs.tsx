import { MoreHorizontal, Settings, Edit2, Copy, X, Trash2 } from 'lucide-react';
import { writeText, selectedKey } from './preferences';
import { legacyText } from './decode';
import type { EmbedModel } from './useEmbedController';
export function EmbedTabs({ model }: { model: EmbedModel ;}) {
    const { visibleTabs, activeViewId, viewId, setActiveViewId, pageId, handleRenameView, t, tabMenuFor, decideMenuDir, setTabMenuFor, menuUp, handleConfigureView, handleDuplicateView, handleUnpinView, handleDeleteView } = model;
    if (visibleTabs.length <= 1) return null;
    return (<div className="relative z-30 flex flex-wrap items-center gap-0.5 border-b border-[var(--border-primary)] mb-2">
        {visibleTabs.map(v => {
            const isActive = v.id === activeViewId;
            const isAnchor = v.id === viewId; // section's view (cannot be removed)
            return (
                <div
                    key={v.id}
                    className={`group relative flex items-center gap-1 px-2.5 py-1 text-xs whitespace-nowrap border-b-2 cursor-pointer ${isActive ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)] font-semibold' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                    onClick={() => {
                        setActiveViewId(v.id);
                        try { writeText(selectedKey(pageId, viewId), legacyText(v.id)); } catch { /* noop */ }
                    }}
                    onDoubleClick={() => { handleRenameView(v); }}
                    title={t('views_header.tab_tooltip', "Click to switch · double-click to rename")}
                >
                    <span>{v.name || v.heading || t('views_header.default_view_name', "View")}</span>
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); decideMenuDir(e); setTabMenuFor(m => m === v.id ? null : v.id); }}
                        className={`${tabMenuFor === v.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} text-[var(--text-tertiary)] hover:text-[var(--text-primary)]`}
                        title={t('views_header.view_options', "View options")}
                        aria-label={t('views_header.view_options', "View options")}
                    >
                        <MoreHorizontal size={13} />
                    </button>
                    {tabMenuFor === v.id && (
                        <>
                            <div className="fixed inset-0 z-[55]" onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); }} />
                            <div className={`absolute z-[60] left-0 ${menuUp ? "bottom-full mb-1" : "top-full mt-1"} w-56 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg py-1 text-[var(--text-primary)] font-normal`}>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); handleConfigureView(v); }}
                                    className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)]"
                                >
                                    <Settings size={13} className="text-[var(--text-tertiary)]" />
                                    {t('views_header.configure', "Configure")}
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); handleRenameView(v); }}
                                    className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)]"
                                >
                                    <Edit2 size={13} className="text-[var(--text-tertiary)]" />
                                    {t('views_header.rename', "Rename")}
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); void handleDuplicateView(v); }}
                                    className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)]"
                                >
                                    <Copy size={13} className="text-[var(--text-tertiary)]" />
                                    {t('views_header.duplicate', "Duplicate")}
                                </button>
                                {!isAnchor && (
                                    <>
                                        <div className="h-px bg-[var(--border-primary)] my-1 mx-2" />
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); handleUnpinView(v); }}
                                            className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)]"
                                        >
                                            <X size={13} className="text-[var(--text-tertiary)]" />
                                            {t('views_header.remove_from_page', "Remove from this page")}
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); handleDeleteView(v); }}
                                            className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-red-500 hover:bg-[var(--bg-tertiary)]"
                                        >
                                            <Trash2 size={13} />
                                            {t('views_header.delete_everywhere', "Delete everywhere…")}
                                        </button>
                                    </>
                                )}
                            </div>
                        </>
                    )}
                </div>
            );
        })}
    </div>);
}
