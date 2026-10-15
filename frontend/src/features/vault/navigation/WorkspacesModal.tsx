import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutPanelLeft, Plus, Trash2, X, FolderOpen } from 'lucide-react';

import { useActiveVaultId } from '../../../shared/hooks/useActiveVaultId';
import { getActiveVaultId } from '../../../shared/api/vault-context';
import { defaultWorkspaceLayout, readWorkspaces, saveWorkspaceTab, type SavedWorkspace, type WorkspaceLayout, type WorkspaceTab } from './workspacesModel';
import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import {
    defineStorageKey,
    jsonStorageCodec,
    readStorage,
    writeStorage,
} from '../../../shared/platform/browser-storage';

interface WorkspacesModalProps {
    readonly currentTabs?: readonly WorkspaceTab[];
    readonly currentLayout?: WorkspaceLayout;
    readonly isOpen: boolean;
    readonly onClose: () => unknown;
    readonly onRestore?: (workspace: SavedWorkspace) => unknown;
}

const WORKSPACES_STORAGE_KEY = defineStorageKey(
    'gnosi.workspaces',
    jsonStorageCodec((value): value is unknown[] => Array.isArray(value)),
);

function loadWorkspaces(): readonly SavedWorkspace[] {
    return readWorkspaces(readStorage(WORKSPACES_STORAGE_KEY), getActiveVaultId());
}

function saveWorkspaces(list: readonly SavedWorkspace[]): void {
    writeStorage(WORKSPACES_STORAGE_KEY, list.slice(0, 30));
}

function createWorkspaceId(): string {
    return typeof crypto !== 'undefined'
        ? crypto.randomUUID()
        : String(Math.random()).slice(2);
}

export default function WorkspacesModal({
    isOpen,
    onClose,
    currentTabs = [],
    currentLayout,
    onRestore,
}: WorkspacesModalProps) {
    const { t } = useTranslation();
    const vaultId = useActiveVaultId();
    const [items, setItems] = useState(loadWorkspaces);
    const [name, setName] = useState('');
    const panelRef = useRef<HTMLDivElement>(null);
    useModalKeyboard({ isOpen, onClose, containerRef: panelRef, trapFocus: true });

    if (!isOpen) return null;

    const saveable = currentTabs.map(tab => saveWorkspaceTab(tab, t('common.untitled', 'Untitled')));
    const saveCurrent = () => {
        if (!name.trim() || saveable.length === 0) return;
        const saved: SavedWorkspace = { version: 2, id: createWorkspaceId(), name: name.trim(), vaultId, tabs: saveable, layout: currentLayout ?? defaultWorkspaceLayout(saveable) };
        const next = [saved, ...items].slice(0, 30);
        setItems(next);
        saveWorkspaces(next);
        setName('');
    };
    const remove = (id: string) => {
        const next = items.filter((workspace) => workspace.id !== id);
        setItems(next);
        saveWorkspaces(next);
    };
    const restore = (workspace: SavedWorkspace) => {
        onRestore?.(workspace);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[150] flex items-start justify-center px-4 pt-[14vh]">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm"></div>
            <div ref={panelRef} className="relative w-full max-w-md overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl" role="dialog" aria-modal="true" aria-label={t('doc_tabs.workspaces_title', 'Workspaces')}>
                <div className="flex items-center justify-between border-b border-[var(--border-primary)] px-4 py-3">
                    <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><LayoutPanelLeft size={16} /> {t('doc_tabs.workspaces_title', "Workspaces")}</span>
                    <button type="button" onClick={onClose} className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]" aria-label={t('common.close', 'Close')}><X size={16} /></button>
                </div>
                <div className="border-b border-[var(--border-primary)] p-3">
                    <div className="flex gap-2">
                        <input
                            data-autofocus
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveCurrent(); }}
                            placeholder={t('doc_tabs.workspaces_save_placeholder', "Save the {{count}} open tabs as…", { count: saveable.length })}
                            className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                        />
                        <button onClick={saveCurrent} disabled={!name.trim() || saveable.length === 0} className="flex items-center gap-1 rounded-lg bg-[var(--gnosi-primary)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                            <Plus size={15} /> {t('common.save', "Save")}
                        </button>
                    </div>
                </div>
                <div className="max-h-80 overflow-auto p-2">
                    {items.filter(item => item.vaultId === vaultId).length === 0 ? (
                        <div className="px-3 py-8 text-center text-sm text-[var(--text-tertiary)]">{t('doc_tabs.workspaces_empty', "No saved workspaces yet.")}</div>
                    ) : items.filter(item => item.vaultId === vaultId).map((workspace) => (
                        <div key={workspace.id} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-[var(--bg-secondary)]">
                            <button onClick={() => {
                                restore(workspace);
                            }} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                                <FolderOpen size={15} className="shrink-0 text-[var(--text-tertiary)]" />
                                <span className="truncate text-sm text-[var(--text-primary)]">{workspace.name}</span>
                                <span className="shrink-0 text-xs text-[var(--text-tertiary)]">{workspace.tabs.length}</span>
                            </button>
                            <button onClick={() => {
                                remove(workspace.id);
                            }} title={t('common.erase', "Delete")} className="rounded p-1 text-[var(--text-tertiary)] hover:text-[var(--gnosi-danger,#dc2626)]"><Trash2 size={14} /></button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
