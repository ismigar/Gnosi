import { memo, useState, type MouseEvent } from 'react';
import {
    ChevronDown,
    ChevronRight,
    Folder,
    FolderOpen,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    fetchMediaTree,
    type MediaTreeNode as MediaTreeNodeModel,
} from '../../../../shared/api/media-browser';


interface MediaTreeNodeProps {
    readonly activePath: string | null;
    readonly depth: number;
    readonly node: MediaTreeNodeModel;
    readonly onSelectFolder: (path: string) => void;
    readonly root: string;
}


export const MediaTreeNode = memo(function MediaTreeNodeComponent({
    activePath,
    depth,
    node,
    onSelectFolder,
    root,
}: MediaTreeNodeProps) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const [children, setChildren] = useState<readonly MediaTreeNodeModel[] | null>(null);
    const [loading, setLoading] = useState(false);
    const isActive = activePath === node.path;

    const toggle = async (event: MouseEvent<HTMLButtonElement>): Promise<void> => {
        event.stopPropagation();
        if (!node.has_children) return;
        if (!expanded && children === null) {
            setLoading(true);
            try {
                setChildren(await fetchMediaTree(root, node.path));
            } catch {
                setChildren([]);
            } finally {
                setLoading(false);
            }
        }
        setExpanded((current) => !current);
    };

    return (
        <>
            <div
                className={`w-full flex items-stretch rounded-lg transition-colors ${isActive ? 'bg-[var(--gnosi-primary)]/10' : 'hover:bg-[var(--bg-secondary)]'}`}
                style={{ paddingLeft: `${String(4 + depth * 14)}px` }}
            >
                <button
                    aria-label={expanded
                        ? t('common.collapse', 'Collapse')
                        : t('common.expand', 'Expand')}
                    className={`shrink-0 w-6 flex items-center justify-center ${node.has_children ? 'cursor-pointer' : 'cursor-default'}`}
                    onClick={(event) => {
                        void toggle(event);
                    }}
                    type="button"
                >
                    {node.has_children ? (
                        loading
                            ? <span className="text-[var(--text-tertiary)] text-xs">…</span>
                            : expanded
                                ? <ChevronDown className="text-[var(--text-tertiary)]" size={14} />
                                : <ChevronRight className="text-[var(--text-tertiary)]" size={14} />
                    ) : null}
                </button>
                <button
                    className={`flex items-center gap-2 min-w-0 flex-1 pr-2 py-1.5 text-left ${isActive ? 'text-[var(--gnosi-primary)] font-medium' : 'text-[var(--text-primary)]'}`}
                    onClick={() => {
                        onSelectFolder(node.path);
                    }}
                    title={node.name}
                    type="button"
                >
                    {expanded
                        ? <FolderOpen className="shrink-0 text-[var(--text-tertiary)]" size={14} />
                        : <Folder className="shrink-0 text-[var(--text-tertiary)]" size={14} />}
                    <span className="text-xs truncate">{node.name}</span>
                </button>
            </div>
            {expanded && children
                ? children.map((child) => (
                    <MediaTreeNode
                        activePath={activePath}
                        depth={depth + 1}
                        key={`${root}::${child.path}`}
                        node={child}
                        onSelectFolder={onSelectFolder}
                        root={root}
                    />
                ))
                : null}
        </>
    );
});
