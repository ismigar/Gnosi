import { useState, useMemo, useRef, type MouseEvent } from 'react';
import { Hash, ChevronRight, FileText, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import { openVaultNote } from '../../../shared/routing/vaultQuickNavigation';
import { IconRenderer } from '../../../shared/ui/previews/IconRenderer';
import {
    buildTagTree,
    tagNoteIcon,
    type TagNote,
    type TagTreeNode,
} from './vaultTagTree';

/**
 * TagsModal
 * Obsidian-style HIERARCHICAL tag view (`#a/b/c`). Builds the tree from
 * `pages[].metadata.tags` (list or CSV). On the left, the expandable
 * tree with counts (includes descendants); on the right, the pages for the
 * selected tag (the tag or any descendant). Fully client-side.
 */

interface TagNodeProps {
    readonly depth: number;
    readonly expanded: ReadonlySet<string>;
    readonly node: TagTreeNode;
    readonly onSelect: (path: string) => void;
    readonly selected: string;
    readonly toggle: (path: string) => void;
}


function TagNode({
    node,
    depth,
    selected,
    onSelect,
    expanded,
    toggle,
}: TagNodeProps) {
    const hasChildren = node.children.size > 0;
    const isOpen = expanded.has(node.fullPath);
    const isSel = selected === node.fullPath;
    return (
        <div>
            <div
                className={`flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-sm ${isSel ? 'bg-[var(--gnosi-primary)]/12 text-[var(--gnosi-primary)]' : 'hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
                style={{ paddingLeft: depth * 14 + 4 }}
                onClick={() => {
                    onSelect(node.fullPath);
                }}
            >
                {hasChildren ? (
                    <button type="button" onClick={(event: MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); toggle(node.fullPath); }} className="shrink-0 rounded p-0.5 hover:bg-[var(--bg-tertiary)]">
                        <ChevronRight size={13} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    </button>
                ) : <span className="w-[18px] shrink-0" />}
                <Hash size={13} className="shrink-0 opacity-60" />
                <span className="truncate">{node.name}</span>
                <span className="ml-auto shrink-0 text-xs text-[var(--text-tertiary)]">{node.pages.size}</span>
            </div>
            {hasChildren && isOpen && (
                <div>
                    {Array.from(node.children.values())
                        .sort((a, b) => b.pages.size - a.pages.size)
                        .map((child) => (
                            <TagNode key={child.fullPath} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} expanded={expanded} toggle={toggle} />
                        ))}
                </div>
            )}
        </div>
    );
}

export interface TagsModalProps {
    readonly allNotes?: readonly TagNote[];
    readonly isOpen: boolean;
    readonly onClose: () => unknown;
    readonly onNoteSelect?: (pageId: string) => void;
}


export default function TagsModal({
    isOpen,
    onClose,
    allNotes = [],
    onNoteSelect,
}: TagsModalProps) {
    const { t } = useTranslation();
    const [selected, setSelected] = useState('');
    const [expanded, setExpanded] = useState(() => new Set<string>());
    const [filter, setFilter] = useState('');
    const panelRef = useRef<HTMLDivElement>(null);
    useModalKeyboard({ isOpen, onClose, containerRef: panelRef, trapFocus: true });

    const root = useMemo(() => buildTagTree(allNotes), [allNotes]);

    const topNodes = useMemo(() => {
        const list = Array.from(root.children.values());
        const f = filter.trim().toLowerCase();
        const filtered = f ? list.filter((n) => n.fullPath.toLowerCase().includes(f) || n.name.toLowerCase().includes(f)) : list;
        return filtered.sort((a, b) => b.pages.size - a.pages.size);
    }, [root, filter]);

    const selectedNode = useMemo(() => {
        if (!selected) return null;
        const parts = selected.split('/');
        let node: TagTreeNode | undefined = root;
        for (const part of parts) {
            node = node.children.get(part);
            if (!node) return null;
        }
        return node;
    }, [root, selected]);

    const toggle = (path: string): void => {
        setExpanded((previous) => {
            const next = new Set(previous);
            if (next.has(path)) next.delete(path); else next.add(path);
            return next;
        });
    };

    if (!isOpen) return null;

    const totalTags = root.children.size;
    const pages = selectedNode ? Array.from(selectedNode.pages.values()) : [];

    return (
        <div className="fixed inset-0 z-[150] flex items-start justify-center pt-[10vh] px-4">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm"></div>
            <div ref={panelRef} className="relative flex h-[70vh] w-full max-w-3xl overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl" role="dialog" aria-modal="true" aria-label={t('tags.title', 'Tags')}>
                {/* Tag tree */}
                <div className="flex w-1/2 flex-col border-r border-[var(--border-primary)]">
                    <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2.5">
                        <Hash size={16} className="text-[var(--gnosi-primary)]" />
                        <span className="text-sm font-semibold text-[var(--text-primary)]">{t('tags.title', "Tags")}</span>
                        <span className="text-xs text-[var(--text-tertiary)]">({totalTags})</span>
                    </div>
                    <div className="border-b border-[var(--border-primary)] px-2 py-1.5">
                        <input
                            data-autofocus
                            value={filter}
                            onChange={(event) => {
                                setFilter(event.target.value);
                            }}
                            placeholder={t('tags.filter_placeholder', "Filter tags…")}
                            className="w-full rounded bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none"
                        />
                    </div>
                    <div className="flex-1 overflow-auto p-1.5">
                        {topNodes.length === 0 ? (
                            <div className="px-3 py-6 text-center text-sm text-[var(--text-tertiary)]">{t('tags.empty_vault', "No tags in the Vault.")}</div>
                        ) : topNodes.map((node) => (
                            <TagNode key={node.fullPath} node={node} depth={0} selected={selected} onSelect={setSelected} expanded={expanded} toggle={toggle} />
                        ))}
                    </div>
                </div>
                {/* Pages for the selected tag */}
                <div className="flex w-1/2 flex-col">
                    <div className="flex items-center justify-between border-b border-[var(--border-primary)] px-3 py-2.5">
                        <span className="truncate text-sm font-medium text-[var(--text-secondary)]">
                            {selected ? `#${selected}` : t('tags.pick_tag', "Choose a tag")}
                        </span>
                        <button type="button" onClick={onClose} className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]" aria-label={t('common.close', 'Close')}><X size={16} /></button>
                    </div>
                    <div className="flex-1 overflow-auto p-1.5">
                        {!selected ? (
                            <div className="px-3 py-8 text-center text-sm text-[var(--text-tertiary)]">{t('tags.pick_tag_hint', "Select a tag to see its pages.")}</div>
                        ) : pages.length === 0 ? (
                            <div className="px-3 py-8 text-center text-sm text-[var(--text-tertiary)]">{t('tags.no_pages', "No pages.")}</div>
                        ) : pages.map((note) => (
                            <button
                                key={note.id}
                                onClick={() => { openVaultNote(onNoteSelect, { id: note.id }); onClose(); }}
                                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--bg-secondary)]"
                            >
                                {tagNoteIcon(note) ? <IconRenderer icon={tagNoteIcon(note)} size={15} className="shrink-0" /> : <FileText size={15} className="shrink-0 text-[var(--text-tertiary)]" />}
                                <span className="truncate text-[var(--text-primary)]">{note.title || t('common.untitled', "Untitled")}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
