import {
    useCallback,
    useEffect,
    useRef,
    type Dispatch,
    type KeyboardEvent,
    type RefObject,
    type SetStateAction,
} from 'react';

import type { GalleryArrowDirection, GallerySection } from './vaultGalleryModel';


export interface VaultGalleryNavigationApi {
    readonly focusFirstCell: () => boolean;
    readonly focusLastCell: () => boolean;
}


interface VaultGalleryNavigationOptions {
    readonly expandedGroups: ReadonlySet<string>;
    readonly groupedSections: readonly GallerySection[] | null;
    readonly onExitBottom?: () => void;
    readonly onExitTop?: () => void;
    readonly onFocusShell?: () => void;
    readonly onNoteSelect?: (noteId: string) => void;
    readonly openKeyboardPreview: (noteId: string, bounds: DOMRect) => void;
    readonly registerNavApi?: (api: VaultGalleryNavigationApi | null) => void;
    readonly setExpandedGroups: Dispatch<SetStateAction<Set<string>>>;
}


export interface VaultGalleryNavigation {
    readonly cardRefs: RefObject<(HTMLDivElement | null)[]>;
    readonly groupHeaderRefs: RefObject<(HTMLButtonElement | null)[]>;
    readonly handleCardKeyDown: (
        event: KeyboardEvent<HTMLDivElement>,
        flatIndex: number,
        noteId: string,
    ) => void;
    readonly handleGroupHeaderKeyDown: (
        event: KeyboardEvent<HTMLButtonElement>,
        index: number,
        groupId: string,
    ) => void;
}


export function useVaultGalleryNavigation({
    expandedGroups,
    groupedSections,
    onExitBottom,
    onExitTop,
    onFocusShell,
    onNoteSelect,
    openKeyboardPreview,
    registerNavApi,
    setExpandedGroups,
}: VaultGalleryNavigationOptions): VaultGalleryNavigation {
    const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
    const groupHeaderRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const pendingEnterGroupRef = useRef<string | null>(null);

    const focusCardAt = useCallback((index: number): boolean => {
        const element = cardRefs.current[index];
        if (!element) return false;
        element.focus({ preventScroll: true });
        element.scrollIntoView({ block: 'nearest' });
        return true;
    }, []);

    const focusGroupHeaderAt = useCallback((index: number): boolean => {
        const element = groupHeaderRefs.current[index];
        if (!element) return false;
        element.focus({ preventScroll: true });
        element.scrollIntoView({ block: 'nearest' });
        return true;
    }, []);

    useEffect(() => {
        if (!registerNavApi) return undefined;
        registerNavApi({
            focusFirstCell: () => {
                const headerIndex = groupHeaderRefs.current.findIndex(Boolean);
                if (headerIndex >= 0) return focusGroupHeaderAt(headerIndex);
                const cardIndex = cardRefs.current.findIndex(Boolean);
                return cardIndex >= 0 && focusCardAt(cardIndex);
            },
            focusLastCell: () => {
                for (let index = cardRefs.current.length - 1; index >= 0; index -= 1) {
                    if (cardRefs.current[index]) return focusCardAt(index);
                }
                return false;
            },
        });
        return () => {
            registerNavApi(null);
        };
    }, [focusCardAt, focusGroupHeaderAt, registerNavApi]);

    const moveByArrow = useCallback((
        direction: GalleryArrowDirection,
        fromIndex: number,
    ): void => {
        const elements = cardRefs.current;
        const source = elements[fromIndex];
        if (!source) return;
        if (direction === 'left' || direction === 'right') {
            const delta = direction === 'left' ? -1 : 1;
            let next = fromIndex + delta;
            while (next >= 0 && next < elements.length && !elements[next]) next += delta;
            if (next >= 0 && next < elements.length) focusCardAt(next);
            else if (direction === 'left') onExitTop?.();
            else onExitBottom?.();
            return;
        }
        const sourceBounds = source.getBoundingClientRect();
        const sourceX = sourceBounds.left + sourceBounds.width / 2;
        const sourceY = sourceBounds.top + sourceBounds.height / 2;
        let bestIndex = -1;
        let bestScore = Number.POSITIVE_INFINITY;
        elements.forEach((element, index) => {
            if (!element || index === fromIndex) return;
            const bounds = element.getBoundingClientRect();
            const deltaY = bounds.top + bounds.height / 2 - sourceY;
            if (direction === 'down' ? deltaY <= 1 : deltaY >= -1) return;
            const deltaX = bounds.left + bounds.width / 2 - sourceX;
            const score = Math.abs(deltaY) + Math.abs(deltaX) * 0.5;
            if (score < bestScore) {
                bestIndex = index;
                bestScore = score;
            }
        });
        if (bestIndex >= 0) focusCardAt(bestIndex);
        else if (direction === 'down') onExitBottom?.();
        else onExitTop?.();
    }, [focusCardAt, onExitBottom, onExitTop]);

    const handleCardKeyDown = useCallback((
        event: KeyboardEvent<HTMLDivElement>,
        flatIndex: number,
        noteId: string,
    ): void => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            onNoteSelect?.(noteId);
        } else if (event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault();
            const element = cardRefs.current[flatIndex];
            if (element) openKeyboardPreview(noteId, element.getBoundingClientRect());
        } else if (event.key.startsWith('Arrow')) {
            event.preventDefault();
            const direction = event.key.slice(5).toLowerCase() as GalleryArrowDirection;
            moveByArrow(direction, flatIndex);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            (onFocusShell ?? onExitTop)?.();
        }
    }, [moveByArrow, onExitTop, onFocusShell, onNoteSelect, openKeyboardPreview]);

    const handleGroupHeaderKeyDown = useCallback((
        event: KeyboardEvent<HTMLButtonElement>,
        index: number,
        groupId: string,
    ): void => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusGroupHeaderAt(index + 1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (index > 0) focusGroupHeaderAt(index - 1); else onExitTop?.();
        } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
            event.preventDefault();
            const wasExpanded = expandedGroups.has(groupId);
            setExpandedGroups((current) => {
                const next = new Set(current);
                if (wasExpanded) next.delete(groupId); else next.add(groupId);
                return next;
            });
            if (!wasExpanded) pendingEnterGroupRef.current = groupId;
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            (onFocusShell ?? onExitTop)?.();
        }
    }, [expandedGroups, focusGroupHeaderAt, onExitTop, onFocusShell, setExpandedGroups]);

    useEffect(() => {
        const groupId = pendingEnterGroupRef.current;
        if (!groupId || !groupedSections) return undefined;
        let cardIndex = 0;
        for (const section of groupedSections) {
            if (section.id === groupId) break;
            if (expandedGroups.has(section.id)) cardIndex += section.notes.length;
        }
        pendingEnterGroupRef.current = null;
        const frame = requestAnimationFrame(() => {
            focusCardAt(cardIndex);
        });
        return () => {
            cancelAnimationFrame(frame);
        };
    }, [expandedGroups, focusCardAt, groupedSections]);

    return {
        cardRefs,
        groupHeaderRefs,
        handleCardKeyDown,
        handleGroupHeaderKeyDown,
    };
}
