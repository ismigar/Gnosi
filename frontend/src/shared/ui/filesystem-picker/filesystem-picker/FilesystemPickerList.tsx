import { ChevronRight, File as FileIcon, Folder } from 'lucide-react';

import type { RefObject } from 'react';

import type { FilesystemPickerController } from './filesystemPickerTypes';

interface FilesystemPickerListProps {
    readonly itemRefs: RefObject<Array<HTMLDivElement | null>>;
    readonly listRef: RefObject<HTMLDivElement | null>;
    readonly picker: FilesystemPickerController;
}

const optionId = (index: number): string => `fp-opt-${String(index)}`;

export function FilesystemPickerList({
    itemRefs,
    listRef,
    picker,
}: FilesystemPickerListProps) {
    const {
        canMulti,
        error,
        handleListKeyDown,
        highlightItem,
        highlightedIndex,
        isChecked,
        isSearching,
        itemFilePath,
        items,
        loading,
        openItem,
        openItemNow,
        searchQuery,
        searchTruncated,
        showFiles,
        tn,
    } = picker;

    return (
        <div
            ref={listRef}
            role="listbox"
            tabIndex={0}
            aria-label={tn('list_aria')}
            aria-activedescendant={highlightedIndex >= 0
                ? optionId(highlightedIndex)
                : undefined}
            onKeyDown={handleListKeyDown}
            className="bg-[var(--bg-primary)]"
            style={{ flex: 1, overflowY: 'auto', padding: '10px', outline: 'none' }}
        >
            {loading ? (
                <div
                    className="text-[var(--text-tertiary)]"
                    style={{ textAlign: 'center', padding: '40px' }}
                >
                    {isSearching ? tn('searching') : tn('loading')}
                </div>
            ) : error ? (
                <div style={{ color: '#ef4444', padding: '20px', textAlign: 'center' }}>
                    {error}
                </div>
            ) : items.length === 0 ? (
                <div
                    className="text-[var(--text-tertiary)]"
                    style={{ textAlign: 'center', padding: '20px', fontSize: '0.9em' }}
                >
                    {isSearching
                        ? tn('no_results', { query: searchQuery })
                        : showFiles ? tn('no_files_folders') : tn('no_folders')}
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {items.map((item, index) => {
                        const active = index === highlightedIndex;
                        const isDir = item.kind === 'dir'
                            || (item.kind === 'search' && item.data.is_dir);
                        const name = item.kind === 'search' ? item.data.name : item.name;
                        const filePath = canMulti ? itemFilePath(item) : null;
                        const checked = filePath ? isChecked(filePath) : false;
                        const key = item.kind === 'search'
                            ? `s:${item.data.is_dir ? 'd' : 'f'}:${item.data.path}`
                            : `${item.kind === 'dir' ? 'd' : 'f'}:${item.name}`;
                        return (
                            <div
                                key={key}
                                id={optionId(index)}
                                role="option"
                                aria-selected={filePath ? checked : active}
                                ref={(element) => {
                                    itemRefs.current[index] = element;
                                }}
                                onClick={() => {
                                    openItem(index);
                                }}
                                onDoubleClick={() => {
                                    if (filePath) openItemNow(index);
                                }}
                                onMouseEnter={() => {
                                    highlightItem(index);
                                }}
                                className="text-[var(--text-primary)]"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    padding: '8px 12px',
                                    background: checked
                                        ? 'var(--bg-tertiary, var(--bg-secondary))'
                                        : active ? 'var(--bg-secondary)' : 'transparent',
                                    cursor: 'pointer',
                                    borderRadius: '6px',
                                    textAlign: 'left',
                                    width: '100%',
                                }}
                            >
                                {filePath && (
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        readOnly
                                        tabIndex={-1}
                                        aria-hidden="true"
                                        style={{ pointerEvents: 'none', flexShrink: 0 }}
                                    />
                                )}
                                {isDir
                                    ? <Folder size={18} className="text-[var(--gnosi-primary)]" />
                                    : <FileIcon size={18} className="text-[var(--text-secondary)]" />}
                                {item.kind === 'search' ? (
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {name}
                                        </div>
                                        <div
                                            className="text-[var(--text-tertiary)]"
                                            style={{ fontSize: '0.72rem', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                        >
                                            {item.data.path}
                                        </div>
                                    </div>
                                ) : (
                                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {name}
                                    </span>
                                )}
                                {isDir && (
                                    <ChevronRight size={14} className="text-[var(--text-tertiary)]" />
                                )}
                            </div>
                        );
                    })}
                    {isSearching && searchTruncated && (
                        <div
                            className="text-[var(--text-tertiary)]"
                            style={{ textAlign: 'center', padding: '10px', fontSize: '0.78rem', fontStyle: 'italic' }}
                        >
                            {tn('too_many')}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
