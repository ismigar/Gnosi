import { Columns2, Edit2, LayoutPanelLeft, Plus, Trash2 } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmModal } from '../../../../shared/ui/dialogs/ConfirmModal';
import { RenamePromptModal } from './RenamePromptModal';
import { useMenuDismissal } from './useMenuDismissal';
import type { SidebarController } from './useSidebarController';
export function RegistryDialogs({ view }: { view: SidebarController; }) {
    const { menuState, onTableSelect, setMenuState, t, onOpenTable, onOpenTableParallel, setRenameModal, setConfirmModal, confirmModal, onDeleteDatabase, onDeleteTable, renameModal, onRenameDatabase, onRenameTable } = view;
    const sidebarMenuRef = useRef<HTMLDivElement>(null);
    const close = useCallback(() => { if (menuState) setMenuState(null); }, [menuState, setMenuState]);
    useMenuDismissal(Boolean(menuState?.type), sidebarMenuRef, close);
    return (<>
        {menuState && (menuState.type === 'database' || menuState.type === 'table') && createPortal(
            <div
                ref={sidebarMenuRef}
                className="vault-sidebar__menu fixed w-40 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[var(--z-popover)] py-1 animate-in fade-in zoom-in-95 duration-100 max-h-[calc(100vh-20px)] overflow-y-auto"
                style={{ top: menuState.y, left: menuState.x }}
            >
                {menuState.type === 'table' && (
                    <>
                        <button
                            onClick={() => {
                                if (onTableSelect) onTableSelect(menuState.id);
                                setMenuState(null);
                            }}
                            className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                        >
                            <LayoutPanelLeft size={14} className="text-[var(--text-secondary)]/60" />
                            <span>{t('sidebar.open_table')}</span>
                        </button>
                        {onOpenTable && (
                            <button
                                onClick={() => {
                                    onOpenTable(menuState.id);
                                    setMenuState(null);
                                }}
                                className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                            >
                                <Plus size={14} className="text-[var(--text-secondary)]/60" />
                                <span>{t('sidebar.open_new_tab')}</span>
                            </button>
                        )}
                        {onOpenTableParallel && (
                            <button
                                onClick={() => {
                                    onOpenTableParallel(menuState.id);
                                    setMenuState(null);
                                }}
                                className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                            >
                                <Columns2 size={14} className="text-[var(--text-secondary)]/60" />
                                <span>{t('sidebar.open_parallel')}</span>
                            </button>
                        )}
                        <div className="h-px bg-[var(--border-primary)] my-1 mx-2"></div>
                    </>
                )}
                <button
                    onClick={() => {
                        setRenameModal({ isOpen: true, type: menuState.type, id: menuState.id, name: menuState.name });
                        setMenuState(null);
                    }}
                    className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                >
                    <Edit2 size={14} className="text-[var(--text-secondary)]/60" />
                    <span>{t('sidebar.rename')}</span>
                </button>
                <div className="h-px bg-[var(--border-primary)] my-1 mx-2"></div>
                <button
                    onClick={() => {
                        setConfirmModal({
                            isOpen: true,
                            type: menuState.type,
                            id: menuState.id,
                            name: menuState.name
                        });
                        setMenuState(null);
                    }}
                    className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--status-error)] hover:bg-[var(--bg-secondary)] transition-colors font-medium"
                >
                    <Trash2 size={14} className="text-[var(--status-error)]" />
                    <span>{t('common.delete')}</span>
                </button>
            </div>,
            document.body
        )}
        {confirmModal.isOpen && (
            <ConfirmModal
                isOpen={confirmModal.isOpen}
                onClose={() => { setConfirmModal({ ...confirmModal, isOpen: false }); }}
                onConfirm={async () => {
                    if (confirmModal.type === 'database') {
                        await onDeleteDatabase(confirmModal.id);
                    } else {
                        await onDeleteTable(confirmModal.id);
                    }
                    setConfirmModal({ ...confirmModal, isOpen: false });
                }}
                title={confirmModal.type === 'database' ? t('sidebar.confirm_delete_db_title') : t('sidebar.confirm_delete_table_title')}
                message={confirmModal.type === 'database' ? t('sidebar.confirm_delete_db_msg') : t('sidebar.confirm_delete_table_msg')}
                confirmText={t('common.delete')}
                isDestructive={true}
            />
        )}
        <RenamePromptModal
            isOpen={renameModal.isOpen}
            type={renameModal.type}
            defaultValue={renameModal.name}
            onClose={() => { setRenameModal({ isOpen: false, type: '', id: '', name: '' }); }}
            onConfirm={async (newName) => {
                if (renameModal.type === 'database') await onRenameDatabase(renameModal.id, newName);
                else await onRenameTable(renameModal.id, newName);
                setRenameModal({ isOpen: false, type: '', id: '', name: '' });
            }}
        />
    </>);
}
