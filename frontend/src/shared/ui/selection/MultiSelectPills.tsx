import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Plus, Search, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { eventTargetClosest, eventTargetIsWithin, subscribeDocumentEvent } from '../../platform/browser-events';
import { optionChipStyle, optionColorHex } from '../../records/model/optionCatalogUtils';
import { PropertyDropdownPortal } from './PropertyDropdownPortal';
import { foldAccents, propertyKey, readPropertyOptions, readPropertyValues } from './values';
import type { MultiSelectPillsProps, PropertyScalar } from './types';

export const MultiSelectPills = ({
    value,
    onChange,
    options,
    idToTitle,
    placeholder,
    onCreate,
    onDeleteOption,
    single = false,
    renderValue,
    label,
    portalZIndex,
    emptyMessage,
    unavailableLabel,
    disabled = false,
    minimum = 0,
}: MultiSelectPillsProps) => {
    const { t } = useTranslation();
    const listId = useId();
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    // Previous values of searchTerm/isOpen so we can reset
    // highlightedIndex DURING render (see the adjustment block below),
    // instead of a useEffect with setState (which triggers cascading renders).
    const [prevSearchTerm, setPrevSearchTerm] = useState(searchTerm);
    const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
    const containerRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const currentValues = useMemo(() => readPropertyValues(value), [value]);
    const { optionKeys, optionColorByKey } = useMemo(() => readPropertyOptions(options), [options]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !eventTargetIsWithin(containerRef.current, event.target) && !eventTargetClosest(event.target, '[data-property-dropdown]')) {
                setIsOpen(false);
            }
        };
        return subscribeDocumentEvent('mousedown', handleClickOutside);
    }, []);

    // Single mode: we show all options in the dropdown (including the
    // selected one) so the user can replace it without having to
    // deselect first. Multi mode: we hide the ones already selected
    // because they already appear as pills.
    // Accent-insensitive filter (NFD): "educacio" finds "Educació",
    // "historia" finds "Història". In a Catalan/Spanish vault the user
    // doesn't usually type accents, and without this, the option/relation wouldn't appear.
    const foldedTerm = foldAccents(searchTerm);
    const filteredOptions = optionKeys.filter(opt =>
        foldAccents(idToTitle[opt] || opt).includes(foldedTerm) &&
        (single || !currentValues.includes(opt))
    );
    const canCreate = Boolean(
        searchTerm && !optionKeys.includes(searchTerm) && onCreate
    );
    const totalItems = filteredOptions.length + (canCreate ? 1 : 0);

    // Resets the marked index when the search changes or the dropdown opens/closes:
    // keeping the outdated highlight would knock the arrow out of place and,
    // above all, Enter could select a different option than the first
    // visible one. We adjust it DURING render by comparing with the previous value
    // —recommended React pattern— instead of a useEffect with setState, which
    // triggers cascading renders (react-hooks/set-state-in-effect).
    // https://react.dev/learn/you-might-not-need-an-effect
    if (searchTerm !== prevSearchTerm || isOpen !== prevIsOpen) {
        setPrevSearchTerm(searchTerm);
        setPrevIsOpen(isOpen);
        setHighlightedIndex(0);
    }

    // Automatic scroll inside the dropdown so the marked option is always
    // visible when navigating with arrows in a long list.
    useEffect(() => {
        if (!listRef.current) return;
        const el = listRef.current.querySelector(`[data-idx="${String(highlightedIndex)}"]`);
        if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest' });
        }
    }, [highlightedIndex]);

    if (highlightedIndex >= totalItems && highlightedIndex > 0) setHighlightedIndex(Math.max(0, totalItems - 1));

    const toggleValue = (val: PropertyScalar) => {
        if (disabled || (currentValues.includes(val) && currentValues.length <= minimum)) return;
        if (single) {
            // Replace; if the clicked option was the selected one, deselect.
            const isCurrent = currentValues[0] === val;
            onChange(isCurrent ? '' : val);
            setIsOpen(false);
            return;
        }
        const next = currentValues.includes(val)
            ? currentValues.filter(v => v !== val)
            : [...currentValues, val];
        onChange(next);
    };

    const handleCreate = () => {
        if (!canCreate || !onCreate) return;
        onCreate(searchTerm);
        setSearchTerm('');
        if (single) setIsOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (totalItems === 0) return;
            setHighlightedIndex(i => Math.min(i + 1, totalItems - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightedIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (highlightedIndex < filteredOptions.length) {
                const selected = filteredOptions[Math.min(highlightedIndex, filteredOptions.length - 1)];
                if (selected !== undefined) toggleValue(selected);
            } else if (canCreate) {
                handleCreate();
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setIsOpen(false);
            containerRef.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus();
        } else if (e.key === 'Tab') {
            setIsOpen(false);
            containerRef.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus();
        }
    };

    return (
        <div className="relative w-full" ref={containerRef}>
            <div
                role="combobox"
                tabIndex={disabled ? -1 : 0}
                aria-label={label || placeholder}
                aria-expanded={isOpen}
                aria-controls={isOpen ? listId : undefined}
                aria-haspopup="listbox"
                aria-disabled={disabled}
                onKeyDown={event => {
                    if (event.target !== event.currentTarget || disabled) return;
                    if (['Enter', ' ', 'ArrowDown'].includes(event.key)) {
                        event.preventDefault(); setIsOpen(true);
                    }
                }}
                onClick={() => { if (!disabled) setIsOpen(!isOpen); }}
                className="flex flex-wrap gap-1.5 p-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg cursor-pointer hover:border-[var(--gnosi-primary)]/50 transition-all min-h-[42px] items-center"
            >
                {currentValues.length === 0 && <span className="text-[var(--text-secondary)] text-sm ml-1">{placeholder}</span>}
                {currentValues.map(val => {
                    if (renderValue) return <span key={propertyKey(val)}>{renderValue(val)}</span>;
                    const missing = unavailableLabel && !optionKeys.includes(propertyKey(val));
                    const chip = optionChipStyle(optionColorByKey[propertyKey(val)]);
                    return (
                    <span key={propertyKey(val)} style={chip || undefined} className="flex max-w-full items-center gap-1.5 px-2.5 py-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-full text-xs font-medium text-[var(--text-secondary)] shadow-sm">
                        <span className="min-w-0 [overflow-wrap:anywhere]">{idToTitle[propertyKey(val)] || val}{missing ? ` · ${unavailableLabel}` : ''}</span>
                        <button type="button" disabled={disabled || currentValues.length <= minimum} aria-label={`${t('common.delete', 'Delete')}: ${String(idToTitle[propertyKey(val)] || val)}`} title={t('common.delete', "Delete")} className="flex shrink-0 items-center cursor-pointer hover:text-[var(--status-error)] transition-colors" onClick={(e) => { e.stopPropagation(); toggleValue(val); }}>
                            <X size={10} />
                        </button>
                    </span>
                    );
                })}
                <ChevronDown aria-hidden="true" size={14} className="ml-auto shrink-0 text-[var(--text-secondary)]" />
            </div>
            {isOpen && (
                <PropertyDropdownPortal anchorRef={containerRef} zIndex={portalZIndex}>
                    <div className="relative mb-2 shrink-0">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]/60" />
                        <input
                            autoFocus
                            aria-label={label || t('common.search_placeholder')}
                            role="combobox"
                            aria-expanded="true"
                            aria-controls={listId}
                            aria-activedescendant={filteredOptions[highlightedIndex] !== undefined ? `${listId}-${String(highlightedIndex)}` : undefined}
                            className="w-full pl-9 pr-4 py-2 bg-[var(--bg-secondary)] border-none rounded-lg text-sm focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none text-[var(--text-primary)]"
                            placeholder={t('common.search_placeholder')}
                            value={searchTerm}
                            onChange={e => { setSearchTerm(e.target.value); }}
                            onKeyDown={handleKeyDown}
                        />
                    </div>
                    <div id={listId} role="listbox" aria-label={label} aria-multiselectable={!single} ref={listRef} className="overflow-y-auto flex-1 custom-scrollbar">
                        {filteredOptions.map((opt, idx) => {
                            const isHighlighted = idx === highlightedIndex;
                            return (
                                <div
                                    key={opt}
                                    data-idx={idx}
                                    id={`${listId}-${String(idx)}`}
                                    role="option"
                                    aria-selected={currentValues.includes(opt)}
                                    onClick={() => { toggleValue(opt); }}
                                    onMouseEnter={() => { setHighlightedIndex(idx); }}
                                    className={`p-2.5 text-sm rounded-lg cursor-pointer transition-colors flex items-center justify-between gap-2 group ${
                                        isHighlighted
                                            ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'
                                            : 'text-[var(--text-secondary)] hover:bg-[var(--gnosi-primary)]/10 hover:text-[var(--gnosi-primary)]'
                                    }`}
                                >
                                    <span className="flex items-center gap-2 truncate">
                                        {Boolean(optionColorByKey[opt]) && (
                                            <span className="shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: optionColorHex(optionColorByKey[opt]) }} />
                                        )}
                                        <span className="truncate">{idToTitle[opt] || opt}</span>
                                    </span>
                                    <span className="flex items-center gap-1 shrink-0">
                                        {onDeleteOption && (
                                            <span
                                                role="button"
                                                title={t('editor.delete_option', "Delete the option from the field")}
                                                onClick={(e) => { e.stopPropagation(); onDeleteOption(opt); }}
                                                className="flex items-center p-0.5 rounded text-[var(--text-tertiary)]/50 opacity-0 group-hover:opacity-100 hover:text-[var(--status-error)] transition-colors"
                                            >
                                                <Trash2 size={13} />
                                            </span>
                                        )}
                                        <Plus size={14} className={isHighlighted ? '' : 'opacity-0 group-hover:opacity-100'} />
                                    </span>
                                </div>
                            );
                        })}
                        {totalItems === 0 && emptyMessage ? <p role="status" className="text-sm p-2">{emptyMessage}</p> : null}
                        {canCreate && (
                            <button
                                data-idx={filteredOptions.length}
                                onMouseEnter={() => { setHighlightedIndex(filteredOptions.length); }}
                                onClick={handleCreate}
                                className={`btn-gnosi btn-gnosi-primary !text-xs !py-2 w-full mt-2 ${
                                    highlightedIndex === filteredOptions.length ? 'ring-2 ring-[var(--gnosi-primary)]/40' : ''
                                }`}
                            >
                                <Plus size={14} />
                                {t('common.create')} "{searchTerm}"
                            </button>
                        )}
                    </div>
                </PropertyDropdownPortal>
            )}
        </div>
    );
};
