import {
    ArrowLeft,
    Folder,
    FolderOpen,
    Home,
    Search,
    X,
} from 'lucide-react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { FilesystemPickerList } from './FilesystemPickerList';
import type {
    FilesystemPickerController,
    FilesystemPickerMode,
} from './filesystemPickerTypes';

interface FilesystemPickerPanelProps {
    readonly itemRefs: RefObject<Array<HTMLDivElement | null>>;
    readonly listRef: RefObject<HTMLDivElement | null>;
    readonly mode: FilesystemPickerMode;
    readonly modalRef: RefObject<HTMLDivElement | null>;
    readonly onClose: () => void;
    readonly picker: FilesystemPickerController;
}

export function FilesystemPickerPanel({
    itemRefs,
    listRef,
    mode,
    modalRef,
    onClose,
    picker,
}: FilesystemPickerPanelProps) {
    const { t } = useTranslation();
    const {
        canMulti,
        canPickFolder,
        checkedPaths,
        currentPath,
        displayPath,
        goUp,
        handleConfirmMany,
        handleNativePick,
        handleSearchKeyDown,
        handleSearchQueryChange,
        handleSelectCurrentFolder,
        nativeAvailable,
        nativeError,
        nativePicking,
        openPath,
        roots,
        searchPlaceholder,
        searchQuery,
        titleText,
        tn,
    } = picker;

    return (
        <div
            className="fixed inset-0 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            style={{ zIndex: 'var(--z-modal)' }}
        >
            <div
                ref={modalRef}
                className="bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border-primary)]"
                role="dialog"
                aria-modal="true"
                aria-label={titleText}
                style={{
                    maxWidth: '560px',
                    width: '100%',
                    height: '660px',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    borderRadius: '10px',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                }}
            >
                <div
                    className="bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]"
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px' }}
                >
                    <h2
                        className="text-[var(--text-primary)]"
                        style={{ margin: 0, fontSize: '1.05em', fontWeight: 700 }}
                    >
                        {mode === 'any' ? '🗂️' : mode === 'file' ? '📄' : '📁'} {titleText}
                    </h2>
                    <button
                        onClick={onClose}
                        aria-label={tn('close')}
                        className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex' }}
                    >
                        <X size={18} />
                    </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                    <div
                        className="bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]"
                        style={{ padding: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                            <div
                                className="text-[var(--text-tertiary)]"
                                style={{ fontSize: '0.7rem', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                            >
                                {tn('real_path')}
                            </div>
                            <div
                                className="bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--gnosi-primary)]"
                                style={{ fontSize: '0.85em', wordBreak: 'break-all', padding: '8px 10px', borderRadius: '4px', fontFamily: 'monospace', lineHeight: '1.4' }}
                            >
                                {displayPath || currentPath || '—'}
                            </div>
                        </div>
                        <button
                            onClick={goUp}
                            title={tn('go_up_tip')}
                            aria-label={tn('go_up_aria')}
                            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-primary)] hover:bg-[var(--bg-primary)]"
                            style={{ background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 10px', borderRadius: '6px', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                        >
                            <ArrowLeft size={15} /> {tn('up')}
                        </button>
                    </div>

                    <div
                        className="bg-[var(--bg-primary)] border-b border-[var(--border-primary)]"
                        style={{ padding: '8px 12px', display: 'flex', gap: '12px', alignItems: 'center' }}
                    >
                        <span
                            className="text-[var(--text-tertiary)]"
                            style={{ fontSize: '0.75rem', fontWeight: 500, textTransform: 'uppercase' }}
                        >
                            {tn('shortcuts')}
                        </span>
                        <button
                            onClick={() => {
                                if (roots?.vault) openPath(roots.vault);
                            }}
                            disabled={!roots?.vault}
                            className="text-[var(--gnosi-primary)] hover:underline"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', cursor: roots?.vault ? 'pointer' : 'default', opacity: roots?.vault ? 1 : 0.4, fontSize: '0.85rem' }}
                        >
                            <Home size={14} /> {tn('vault')}
                        </button>
                        <button
                            onClick={() => {
                                if (roots?.home) openPath(roots.home);
                            }}
                            disabled={!roots?.home}
                            className="hover:underline"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', cursor: roots?.home ? 'pointer' : 'default', opacity: roots?.home ? 1 : 0.4, color: '#a78bfa', fontSize: '0.85rem' }}
                        >
                            <Folder size={14} /> {tn('home')}
                        </button>
                        <button
                            onClick={() => {
                                openPath(roots?.root || '/');
                            }}
                            className="hover:underline"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#f43f5e', fontSize: '0.85rem' }}
                        >
                            <Folder size={14} /> {tn('root')}
                        </button>
                        {nativeAvailable && (
                            <button
                                onClick={handleNativePick}
                                disabled={nativePicking}
                                title={tn('native_button_tip')}
                                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]"
                                style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px', background: 'transparent', cursor: nativePicking ? 'default' : 'pointer', opacity: nativePicking ? 0.6 : 1, padding: '4px 10px', borderRadius: '6px', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                            >
                                <FolderOpen size={14} />
                                {nativePicking ? tn('native_waiting') : tn('native_button')}
                            </button>
                        )}
                    </div>

                    <div style={{ padding: '10px 12px', position: 'relative' }}>
                        <Search
                            size={14}
                            className="text-[var(--text-tertiary)]"
                            style={{ position: 'absolute', left: '20px', top: '18px' }}
                        />
                        <input
                            type="text"
                            data-autofocus
                            placeholder={searchPlaceholder}
                            aria-label={searchPlaceholder}
                            className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)]"
                            style={{ width: '100%', padding: '6px 12px 6px 30px', borderRadius: '6px', fontSize: '0.9em' }}
                            value={searchQuery}
                            onChange={(event) => {
                                handleSearchQueryChange(event.target.value);
                            }}
                            onKeyDown={handleSearchKeyDown}
                        />
                    </div>

                    {nativeError && (
                        <div
                            role="status"
                            className="border-b border-[var(--border-primary)]"
                            style={{ color: '#ef4444', padding: '6px 12px', fontSize: '0.8rem' }}
                        >
                            {nativeError}
                        </div>
                    )}

                    <FilesystemPickerList
                        itemRefs={itemRefs}
                        listRef={listRef}
                        picker={picker}
                    />

                    <div
                        className="bg-[var(--bg-secondary)] border-t border-[var(--border-primary)]"
                        style={{ padding: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexShrink: 0 }}
                    >
                        <span
                            className="text-[var(--text-tertiary)]"
                            style={{ fontSize: '0.72rem', lineHeight: 1.4 }}
                        >
                            {canMulti
                                ? checkedPaths.length > 0
                                    ? tn('selected_count', { defaultValue: '{{count}} files selected', count: checkedPaths.length })
                                    : tn('multi_hint', { defaultValue: 'Click to tick several files · double-click to pick just one' })
                                : tn('keyboard_hints')}
                        </span>
                        <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
                            <button
                                onClick={onClose}
                                className="text-[var(--text-primary)] border border-[var(--border-primary)] hover:bg-[var(--bg-primary)]"
                                style={{ padding: '8px 16px', borderRadius: '6px', background: 'transparent', cursor: 'pointer' }}
                            >
                                {t('common.cancel')}
                            </button>
                            {canMulti && checkedPaths.length > 0 && (
                                <button
                                    onClick={handleConfirmMany}
                                    className="btn-gnosi btn-gnosi-primary"
                                    style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontWeight: 500 }}
                                >
                                    {tn('select_files_count', { defaultValue: 'Select {{count}} files', count: checkedPaths.length })}
                                </button>
                            )}
                            {canPickFolder && !(canMulti && checkedPaths.length > 0) && (
                                <button
                                    onClick={handleSelectCurrentFolder}
                                    className="btn-gnosi btn-gnosi-primary"
                                    style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontWeight: 500 }}
                                >
                                    {tn('select_this_folder')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
