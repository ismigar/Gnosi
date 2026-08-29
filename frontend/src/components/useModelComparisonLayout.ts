import {
    useEffect,
    useRef,
    useState,
    type RefObject,
    type UIEventHandler,
} from 'react';

import { subscribeWindowEvent } from '../shared/platform/browser-events';


export interface ModelComparisonLayout {
    readonly bodyRef: RefObject<HTMLDivElement | null>;
    readonly filterHeight: number;
    readonly modalRef: RefObject<HTMLElement | null>;
    readonly onScrollbarScroll: UIEventHandler<HTMLDivElement>;
    readonly profileHelpRef: RefObject<HTMLElement | null>;
    readonly scrollbarRef: RefObject<HTMLDivElement | null>;
    readonly tableScrollWidth: number;
    readonly tableViewportWidth: number;
    readonly tableWrapRef: RefObject<HTMLDivElement | null>;
    readonly toolbarRef: RefObject<HTMLDivElement | null>;
}


const isInteractiveTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    return ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
        || target.isContentEditable;
};


export function useModelComparisonLayout(
    isOpen: boolean,
    refreshMarker: unknown,
): ModelComparisonLayout {
    const [tableScrollWidth, setTableScrollWidth] = useState(0);
    const [tableViewportWidth, setTableViewportWidth] = useState(0);
    const [filterHeight, setFilterHeight] = useState(0);
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const modalRef = useRef<HTMLElement | null>(null);
    const profileHelpRef = useRef<HTMLElement | null>(null);
    const tableWrapRef = useRef<HTMLDivElement | null>(null);
    const scrollbarRef = useRef<HTMLDivElement | null>(null);
    const toolbarRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const tableWrap = tableWrapRef.current;
        if (!isOpen || !refreshMarker || !tableWrap) return undefined;
        const table = tableWrap.querySelector<HTMLTableElement>(
            '.model-comparison-table',
        );
        if (!table) return undefined;
        const updateWidth = (): void => {
            setTableScrollWidth(table.scrollWidth);
            setTableViewportWidth(tableWrap.clientWidth);
        };
        const observer = new ResizeObserver(updateWidth);
        observer.observe(table);
        observer.observe(tableWrap);
        const frame = requestAnimationFrame(updateWidth);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [isOpen, refreshMarker]);

    useEffect(() => {
        const toolbar = toolbarRef.current;
        if (!isOpen || !toolbar) return undefined;
        const updateHeight = (): void => {
            setFilterHeight(toolbar.offsetHeight);
        };
        const observer = new ResizeObserver(updateHeight);
        observer.observe(toolbar);
        const frame = requestAnimationFrame(updateHeight);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [isOpen, refreshMarker]);

    useEffect(() => {
        if (!isOpen) return undefined;
        return subscribeWindowEvent('keydown', (event) => {
            if (isInteractiveTarget(event.target)) return;
            const body = bodyRef.current;
            if (!body) return;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                const scrollbar = scrollbarRef.current;
                if (!scrollbar) return;
                event.preventDefault();
                event.stopPropagation();
                scrollbar.scrollBy({
                    behavior: 'smooth',
                    left: event.key === 'ArrowLeft' ? -80 : 80,
                });
                return;
            }
            const distance = event.key === 'ArrowDown'
                ? 80
                : event.key === 'ArrowUp'
                    ? -80
                    : event.key === 'PageDown'
                        ? body.clientHeight * 0.85
                        : event.key === 'PageUp'
                            ? -body.clientHeight * 0.85
                            : null;
            if (distance !== null) {
                event.preventDefault();
                event.stopPropagation();
                body.scrollBy({ behavior: 'smooth', top: distance });
            } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                event.stopPropagation();
                body.scrollTo({
                    behavior: 'smooth',
                    top: event.key === 'Home' ? 0 : body.scrollHeight,
                });
            }
        }, true);
    }, [isOpen]);

    return {
        bodyRef,
        filterHeight,
        modalRef,
        onScrollbarScroll: (event) => {
            tableWrapRef.current?.style.setProperty(
                '--model-table-scroll-left',
                `${event.currentTarget.scrollLeft.toString()}px`,
            );
        },
        profileHelpRef,
        scrollbarRef,
        tableScrollWidth,
        tableViewportWidth,
        tableWrapRef,
        toolbarRef,
    };
}
