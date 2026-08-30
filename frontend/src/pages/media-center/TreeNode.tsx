import {memo, useState, type MouseEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {fetchMediaTree, type MediaTreeNode} from '../../shared/api/media-browser';
import {ChevronRight, ChevronDown, Folder, FolderOpen} from 'lucide-react';
export const TreeNode = memo(function TreeNode({ node, depth, activeAlbum, onSelect, root = 'images' }: {node: MediaTreeNode; depth: number; activeAlbum: string | null; onSelect: (album: string) => void; root?: string}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<MediaTreeNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const isActive = activeAlbum === node.path;

  const toggle = async (e: MouseEvent) => {
    e.stopPropagation();
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
    setExpanded((v) => !v);
  };

  return (
    <>
      <div
        style={{ paddingLeft: `${String(4 + depth * 14)}px` }}
        className={`w-full flex items-stretch rounded-xl transition-all ${
          isActive
            ? 'bg-[var(--bg-secondary)] border border-[var(--border-primary)] shadow-sm'
            : 'hover:bg-[var(--bg-secondary)]'
        }`}
      >
        <button
          type="button"
          onClick={(event) => { void toggle(event); }}
          className={`shrink-0 w-6 flex items-center justify-center ${
            node.has_children ? 'cursor-pointer' : 'cursor-default'
          }`}
          aria-label={expanded ? t('common.collapse') : t('common.expand')}
        >
          {node.has_children ? (
            loading ? (
              <span className="text-[var(--text-tertiary)] text-xs">…</span>
            ) : expanded ? (
              <ChevronDown size={14} className="text-[var(--text-tertiary)]" />
            ) : (
              <ChevronRight size={14} className="text-[var(--text-tertiary)]" />
            )
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => { onSelect(node.path); }}
          className={`flex items-center gap-2 min-w-0 flex-1 pr-3 py-2 text-left ${
            isActive ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-primary)]'
          }`}
          title={node.name}
        >
          {expanded ? (
            <FolderOpen size={16} className={`shrink-0 ${isActive ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'}`} />
          ) : (
            <Folder size={16} className={`shrink-0 ${isActive ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'}`} />
          )}
          <span className="text-sm font-medium truncate min-w-0">{node.name}</span>
        </button>
      </div>

      {expanded && children && children.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          activeAlbum={activeAlbum}
          onSelect={onSelect}
          root={root}
        />
      ))}
    </>
  );
});
