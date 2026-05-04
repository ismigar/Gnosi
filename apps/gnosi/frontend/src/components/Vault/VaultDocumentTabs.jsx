import React from 'react';
import { createPortal } from 'react-dom';
import { X, Columns2, Plus, Search, FileText, LayoutPanelLeft } from 'lucide-react';

export function VaultDocumentTabs({
    tabs,
    activeTabId,
    splitTabIds = [],
    onTabSelect,
    onTabClose,
    onToggleSplit,
    quickOpenItems = [],
    onQuickOpenItem,
    onQuickOpenParallel
}) {
    const DROPDOWN_WIDTH = 380;
    const VIEWPORT_MARGIN = 16;
    const normalizedTabs = tabs || [];
    const splitSet = new Set(splitTabIds);
    const [isQuickOpenVisible, setIsQuickOpenVisible] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [highlightedIndex, setHighlightedIndex] = React.useState(0);
    const [dropdownPos, setDropdownPos] = React.useState({ top: 0, left: VIEWPORT_MARGIN, width: DROPDOWN_WIDTH });
    const quickOpenRef = React.useRef(null);
    const inputRef = React.useRef(null);
    const plusButtonRef = React.useRef(null);
    const itemRefs = React.useRef([]);
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const quickOpenShortcutLabel = isMac ? 'Cmd+T' : 'Ctrl+T';
    const tabJumpShortcutLabel = isMac ? 'Cmd+1..9' : 'Ctrl+1..9';

    const isEditableTarget = React.useCallback((target) => {
        if (!(target instanceof HTMLElement)) return false;
        const tagName = target.tagName?.toLowerCase();
        return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    }, []);

    const filteredItems = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return quickOpenItems.slice(0, 12);
        return quickOpenItems
            .filter(item => {
                const titleMatch = (item.title || '').toLowerCase().includes(q);
                const subtitleMatch = (item.subtitle || '').toLowerCase().includes(q);
                return titleMatch || subtitleMatch;
            })
            .slice(0, 12);
    }, [query, quickOpenItems]);

    const closeQuickOpen = React.useCallback(() => {
        setIsQuickOpenVisible(false);
        setQuery('');
        setHighlightedIndex(0);
    }, []);

    const canOpenParallel = React.useCallback((item) => {
        return Boolean(item && onQuickOpenParallel && (item.type === 'page' || item.type === 'table'));
    }, [onQuickOpenParallel]);

    const openQuickOpen = React.useCallback(() => {
        const rect = plusButtonRef.current?.getBoundingClientRect();
        const width = Math.min(DROPDOWN_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
        if (rect) {
            const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
            const desiredLeft = rect.left;
            setDropdownPos({
                top: rect.bottom + 8,
                left: Math.min(Math.max(desiredLeft, VIEWPORT_MARGIN), maxLeft),
                width
            });
        } else {
            setDropdownPos({ top: VIEWPORT_MARGIN, left: VIEWPORT_MARGIN, width });
        }
        setIsQuickOpenVisible(true);
    }, []);

    React.useEffect(() => {
        if (!isQuickOpenVisible) return undefined;
        const onDocumentClick = (event) => {
            if (quickOpenRef.current && !quickOpenRef.current.contains(event.target)) {
                closeQuickOpen();
            }
        };
        document.addEventListener('mousedown', onDocumentClick);
        return () => document.removeEventListener('mousedown', onDocumentClick);
    }, [closeQuickOpen, isQuickOpenVisible]);

    React.useEffect(() => {
        if (isQuickOpenVisible) {
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [isQuickOpenVisible]);

    React.useEffect(() => {
        if (!isQuickOpenVisible) return undefined;

        const updatePosition = () => {
            const rect = plusButtonRef.current?.getBoundingClientRect();
            const width = Math.min(DROPDOWN_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
            if (!rect) return;
            const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
            setDropdownPos({
                top: rect.bottom + 8,
                left: Math.min(Math.max(rect.left, VIEWPORT_MARGIN), maxLeft),
                width
            });
        };

        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isQuickOpenVisible]);

    React.useEffect(() => {
        if (!isQuickOpenVisible) {
            itemRefs.current = [];
            return;
        }
        setHighlightedIndex(0);
    }, [isQuickOpenVisible]);

    React.useEffect(() => {
        if (filteredItems.length === 0) {
            setHighlightedIndex(0);
            return;
        }
        setHighlightedIndex((currentIndex) => Math.min(currentIndex, filteredItems.length - 1));
    }, [filteredItems]);

    React.useEffect(() => {
        if (!isQuickOpenVisible || filteredItems.length === 0) return;
        itemRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
    }, [filteredItems, highlightedIndex, isQuickOpenVisible]);

    React.useEffect(() => {
        const handleKeyDown = (event) => {
            if (isEditableTarget(event.target)) return;

            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 't') {
                event.preventDefault();
                openQuickOpen();
                return;
            }

            if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key) && normalizedTabs.length > 0) {
                event.preventDefault();
                const requestedIndex = Number(event.key) - 1;
                const targetIndex = event.key === '9'
                    ? normalizedTabs.length - 1
                    : Math.min(requestedIndex, normalizedTabs.length - 1);
                const targetTab = normalizedTabs[targetIndex];
                if (targetTab) {
                    onTabSelect(targetTab.id);
                }
                return;
            }

            if (event.key === 'Escape') {
                closeQuickOpen();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [closeQuickOpen, isEditableTarget, normalizedTabs, onTabSelect, openQuickOpen]);

    const handleOpenItem = (item) => {
        if (!onQuickOpenItem) return;
        onQuickOpenItem(item);
        closeQuickOpen();
    };

    const handleOpenParallel = (item) => {
        if (!onQuickOpenParallel) return;
        onQuickOpenParallel(item);
        closeQuickOpen();
    };

    const handleQuickOpenKeyDown = (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (filteredItems.length === 0) return;
            setHighlightedIndex((currentIndex) => Math.min(currentIndex + 1, filteredItems.length - 1));
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (filteredItems.length === 0) return;
            setHighlightedIndex((currentIndex) => Math.max(currentIndex - 1, 0));
            return;
        }

        if (event.key === 'Enter') {
            if (filteredItems.length === 0) return;
            event.preventDefault();
            const selectedItem = filteredItems[highlightedIndex];
            if ((event.metaKey || event.ctrlKey) && canOpenParallel(selectedItem)) {
                handleOpenParallel(selectedItem);
                return;
            }
            handleOpenItem(selectedItem);
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            closeQuickOpen();
        }
    };

    return (
        <div className="relative flex items-center gap-1 overflow-x-auto px-4 pt-1 pb-0 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] shrink-0">
            {normalizedTabs.map(tab => {
                const isActive = tab.id === activeTabId;
                const isSplit = splitSet.has(tab.id);
                const canSplit = !tab.isTable;

                let tabClasses = "w-[184px] flex items-center gap-2 px-3 py-1.5 rounded-t-md text-sm font-medium transition-colors border-b-2 ";
                if (isActive) {
                    tabClasses += "border-[var(--gnosi-blue)] text-[var(--gnosi-blue)] bg-[var(--bg-primary)] shadow-sm";
                } else if (isSplit) {
                    tabClasses += "border-purple-400 text-purple-700 bg-purple-50/10";
                } else {
                    tabClasses += "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]";
                }

                return (
                    <div
                        key={tab.id}
                        className={tabClasses + " group cursor-pointer select-none flex-shrink-0"}
                        onClick={() => onTabSelect(tab.id)}
                        title={tab.title || 'Sense Títol'}
                    >
                        <span className="truncate flex-1 min-w-0" title={tab.title || 'Sense Títol'}>{tab.title || 'Sense Títol'}</span>

                        <div className="flex items-center ml-1">
                            {!isActive && canSplit && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onToggleSplit(tab.id); }}
                                    className={`p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${isSplit ? 'text-purple-600 bg-purple-100/20' : 'text-[var(--text-tertiary)] hover:text-indigo-600 hover:bg-indigo-50/20'}`}
                                    title={isSplit ? "Treure de la vista paral·lela" : "Obrir en paral·lel"}
                                >
                                    <Columns2 size={14} />
                                </button>
                            )}
                            <button
                                onClick={(e) => { e.stopPropagation(); onTabClose(tab.id); }}
                                className="p-1 rounded text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-50/10 transition-colors"
                                title="Tancar pestanya"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    </div>
                );
            })}

            <button
                ref={plusButtonRef}
                onClick={() => {
                    if (isQuickOpenVisible) {
                        closeQuickOpen();
                        return;
                    }
                    openQuickOpen();
                }}
                className="ml-1 flex items-center justify-center w-8 h-8 rounded text-[var(--text-secondary)] hover:text-indigo-700 hover:bg-[var(--bg-tertiary)] transition-colors"
                title={`Nova pestanya o cerca ràpida (${quickOpenShortcutLabel}). Canviar pestanya: ${tabJumpShortcutLabel}`}
            >
                <Plus size={16} />
            </button>

            {isQuickOpenVisible && createPortal(
                <div
                    ref={quickOpenRef}
                    className="fixed bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[9999]"
                    style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
                >
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-primary)]">
                        <Search size={14} className="text-[var(--text-tertiary)]" />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                setHighlightedIndex(0);
                            }}
                            onKeyDown={handleQuickOpenKeyDown}
                            placeholder="Cerca pàgines i taules..."
                            className="w-full text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] bg-transparent outline-none"
                        />
                    </div>

                    <div className="max-h-72 overflow-y-auto py-1">
                        {filteredItems.length === 0 ? (
                            <div className="px-3 py-4 text-xs text-slate-500">Sense resultats</div>
                        ) : (
                            filteredItems.map((item, index) => {
                                const isHighlighted = index === highlightedIndex;
                                return (
                                <div
                                    key={`${item.type}-${item.id}`}
                                    ref={(node) => {
                                        itemRefs.current[index] = node;
                                    }}
                                    className={`flex items-center gap-2 px-2 py-1.5 ${isHighlighted ? 'bg-indigo-50/20' : 'hover:bg-[var(--bg-secondary)]'}`}
                                    onMouseEnter={() => setHighlightedIndex(index)}
                                >
                                    <button
                                        onClick={() => handleOpenItem(item)}
                                        className="flex-1 min-w-0 flex items-center gap-2 text-left"
                                    >
                                        {item.type === 'table' ? (
                                            <LayoutPanelLeft size={14} className={`shrink-0 ${isHighlighted ? 'text-indigo-600' : 'text-indigo-500'}`} />
                                        ) : (
                                            <FileText size={14} className={`shrink-0 ${isHighlighted ? 'text-indigo-500' : 'text-[var(--text-tertiary)]'}`} />
                                        )}
                                        <div className="min-w-0">
                                            <div className={`text-sm truncate ${isHighlighted ? 'text-indigo-900' : 'text-[var(--text-primary)]'}`}>{item.title}</div>
                                            <div className="text-[11px] text-[var(--text-tertiary)] truncate">{item.subtitle}</div>
                                        </div>
                                    </button>

                                    {canOpenParallel(item) && (
                                        <button
                                            onClick={() => handleOpenParallel(item)}
                                            className={`p-1 rounded transition-colors ${isHighlighted ? 'text-purple-600 hover:bg-purple-100/20' : 'text-[var(--text-tertiary)] hover:text-purple-600 hover:bg-purple-50/10'}`}
                                            title={item.type === 'table' ? 'Obrir taula en paral·lel' : 'Obrir en paral·lel'}
                                        >
                                            <Columns2 size={14} />
                                        </button>
                                    )}
                                </div>
                            );})
                        )}
                    </div>
                </div>
            , document.body)}
        </div>
    );
}
