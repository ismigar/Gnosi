import { Image as ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { MediaTreeNode as MediaTreeNodeModel } from '../../../../shared/api/media-browser';
import { MediaTreeNode } from './MediaTreeNode';


interface MediaPickerSidebarProps {
    readonly activePath: string | null;
    readonly activeRoot: string;
    readonly onSelectPath: (path: string) => void;
    readonly tree: readonly MediaTreeNodeModel[];
}


export function MediaPickerSidebar({
    activePath,
    activeRoot,
    onSelectPath,
    tree,
}: MediaPickerSidebarProps) {
    const { t } = useTranslation();
    return (
        <aside className="w-56 border-r border-[var(--border-primary)] overflow-y-auto p-2 flex flex-col gap-0.5 bg-[var(--bg-secondary)]/30">
            <button
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${activePath === '' ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]' : 'hover:bg-[var(--bg-secondary)] text-[var(--text-primary)]'}`}
                onClick={() => {
                    onSelectPath('');
                }}
                title={t(
                    'media_picker.recursive_hint',
                    'Recursive listing — may take a while the first time',
                )}
                type="button"
            >
                <ImageIcon size={14} />
                {t('media_picker.all_content', 'All content')}
            </button>
            <div className="h-px bg-[var(--border-primary)] my-1 mx-1 opacity-50" />
            {tree.map((node) => (
                <MediaTreeNode
                    activePath={activePath}
                    depth={0}
                    key={`${activeRoot}::${node.path}`}
                    node={node}
                    onSelectFolder={onSelectPath}
                    root={activeRoot}
                />
            ))}
        </aside>
    );
}
