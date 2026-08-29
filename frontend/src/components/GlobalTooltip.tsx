import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ActiveTooltip {
    readonly content: string;
    readonly trigger: Element;
}

interface TooltipPosition {
    readonly left: number;
    readonly placement: 'bottom' | 'top';
    readonly top: number;
}

const TOOLTIP_ID = 'gnosi-global-tooltip';
const TOOLTIP_ATTRIBUTE = 'data-gnosi-tooltip';
const TITLE_SOURCE_ATTRIBUTE = 'data-gnosi-tooltip-source';
const ARIA_LABEL_SOURCE_ATTRIBUTE = 'data-gnosi-tooltip-aria-label-source';
const ARIA_LABEL_VALUE_ATTRIBUTE = 'data-gnosi-tooltip-aria-label-value';
const TOOLTIP_SELECTOR = `[${TOOLTIP_ATTRIBUTE}]`;
const RICH_TOOLTIP_SELECTOR = '.app-sidebar__tooltip, .row-action-tooltip, [role="tooltip"]';
const RICH_TOOLTIP_OWNER_SELECTOR = '.graph-legend-control, .vault-page-compact-header__preview-anchor';
const VIEWPORT_PADDING = 8;
const TRIGGER_GAP = 8;

function removeTooltipDescription(trigger: Element | null): void {
    if (!trigger) return;
    const descriptions = (trigger.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter(Boolean)
        .filter((id) => id !== TOOLTIP_ID);

    if (descriptions.length > 0) {
        trigger.setAttribute('aria-describedby', descriptions.join(' '));
    } else {
        trigger.removeAttribute('aria-describedby');
    }
}

function hasRichTooltip(trigger: Element): boolean {
    if (trigger.querySelector(RICH_TOOLTIP_SELECTOR)) return true;

    const owner = trigger.closest(RICH_TOOLTIP_OWNER_SELECTOR);
    if (owner) return true;

    const controlledIds = [
        ...(trigger.getAttribute('aria-controls') || '').split(/\s+/),
        ...(trigger.getAttribute('aria-describedby') || '').split(/\s+/),
    ].filter(Boolean);

    return controlledIds.some((id) => {
        const controlled = document.getElementById(id);
        return controlled?.getAttribute('role') === 'tooltip';
    });
}

function findTooltipTrigger(target: EventTarget | null): Element | null {
    return target instanceof Element ? target.closest(TOOLTIP_SELECTOR) : null;
}

function hasMeaningfulVisibleName(element: Element): boolean {
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
    if (/\p{L}|\p{N}/u.test(text)) return true;
    if (element.querySelector('img[alt]:not([alt=""])')) return true;
    return element.matches('input[type="button"], input[type="submit"], input[type="reset"]')
        && Boolean(element.getAttribute('value')?.trim());
}

function preserveTitleAsAccessibleName(element: Element, title: string): void {
    const generatedLabel = element.getAttribute(ARIA_LABEL_SOURCE_ATTRIBUTE) === 'title';
    const generatedValue = element.getAttribute(ARIA_LABEL_VALUE_ATTRIBUTE);

    if (generatedLabel) {
        if (element.getAttribute('aria-label') !== generatedValue) {
            element.removeAttribute(ARIA_LABEL_SOURCE_ATTRIBUTE);
            element.removeAttribute(ARIA_LABEL_VALUE_ATTRIBUTE);
            return;
        }
        if (title.trim()) {
            element.setAttribute('aria-label', title);
            element.setAttribute(ARIA_LABEL_VALUE_ATTRIBUTE, title);
        } else {
            element.removeAttribute('aria-label');
            element.removeAttribute(ARIA_LABEL_SOURCE_ATTRIBUTE);
            element.removeAttribute(ARIA_LABEL_VALUE_ATTRIBUTE);
        }
        return;
    }

    const isInteractive = element.matches('button, a[href], input, select, textarea, summary, [role], [tabindex]:not([tabindex="-1"])');
    const hasExplicitName = element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby');
    if (!title.trim() || !isInteractive || hasExplicitName || hasMeaningfulVisibleName(element)) return;

    element.setAttribute('aria-label', title);
    element.setAttribute(ARIA_LABEL_SOURCE_ATTRIBUTE, 'title');
    element.setAttribute(ARIA_LABEL_VALUE_ATTRIBUTE, title);
}

/**
 * Renders every HTML title through a single application-owned tooltip surface.
 * Native title bubbles cannot inherit the explicit Gnosi appearance, so titles
 * are adopted into a data attribute as components and portals enter the DOM.
 */
export function GlobalTooltip() {
    const tooltipRef = useRef<HTMLDivElement | null>(null);
    const hoveredTriggerRef = useRef<Element | null>(null);
    const focusedTriggerRef = useRef<Element | null>(null);
    const activeTriggerRef = useRef<Element | null>(null);
    const [activeTooltip, setActiveTooltip] = useState<ActiveTooltip | null>(null);
    const [position, setPosition] = useState<TooltipPosition | null>(null);

    useEffect(() => {
        activeTriggerRef.current = activeTooltip?.trigger || null;
    }, [activeTooltip]);

    useEffect(() => {
        const adoptTitle = (element: Node) => {
            if (!(element instanceof Element) || !element.hasAttribute('title')) return;

            const title = element.getAttribute('title') || '';
            preserveTitleAsAccessibleName(element, title);
            if (title.trim()) {
                element.setAttribute(TOOLTIP_ATTRIBUTE, title);
                element.setAttribute(TITLE_SOURCE_ATTRIBUTE, 'title');
            } else {
                element.removeAttribute(TOOLTIP_ATTRIBUTE);
                element.removeAttribute(TITLE_SOURCE_ATTRIBUTE);
            }
            element.removeAttribute('title');

            if (activeTriggerRef.current === element) {
                setActiveTooltip(title.trim() && !hasRichTooltip(element)
                    ? { trigger: element, content: title }
                    : null);
            }
        };

        const adoptTitlesWithin = (root: Node) => {
            if (!(root instanceof Element)) return;
            adoptTitle(root);
            root.querySelectorAll('[title]').forEach(adoptTitle);
        };

        document.querySelectorAll('[title]').forEach(adoptTitle);

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes') {
                    adoptTitle(mutation.target);
                    return;
                }
                mutation.addedNodes.forEach(adoptTitlesWithin);
            });
        });
        observer.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['title'],
        });

        const syncActiveTooltip = (): void => {
            const trigger = focusedTriggerRef.current || hoveredTriggerRef.current;
            const content = trigger?.getAttribute(TOOLTIP_ATTRIBUTE);
            if (!trigger || !content || hasRichTooltip(trigger)) {
                setActiveTooltip(null);
                return;
            }
            setActiveTooltip({ trigger, content });
        };

        const handleMouseOver = (event: MouseEvent): void => {
            const trigger = findTooltipTrigger(event.target);
            if (!trigger || trigger === hoveredTriggerRef.current) return;
            hoveredTriggerRef.current = trigger;
            syncActiveTooltip();
        };

        const handleMouseOut = (event: MouseEvent): void => {
            const trigger = hoveredTriggerRef.current;
            if (!trigger || (event.relatedTarget instanceof Node && trigger.contains(event.relatedTarget))) return;
            hoveredTriggerRef.current = null;
            syncActiveTooltip();
        };

        const handleFocusIn = (event: FocusEvent): void => {
            focusedTriggerRef.current = findTooltipTrigger(event.target);
            syncActiveTooltip();
        };

        const handleFocusOut = (event: FocusEvent): void => {
            const trigger = focusedTriggerRef.current;
            if (!trigger || (event.relatedTarget instanceof Node && trigger.contains(event.relatedTarget))) return;
            focusedTriggerRef.current = null;
            syncActiveTooltip();
        };

        const dismissTooltip = (): void => {
            hoveredTriggerRef.current = null;
            focusedTriggerRef.current = null;
            setActiveTooltip(null);
        };

        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') dismissTooltip();
        };

        document.addEventListener('mouseover', handleMouseOver);
        document.addEventListener('mouseout', handleMouseOut);
        document.addEventListener('focusin', handleFocusIn);
        document.addEventListener('focusout', handleFocusOut);
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('pointerdown', dismissTooltip, true);
        document.addEventListener('click', dismissTooltip, true);
        document.addEventListener('contextmenu', dismissTooltip, true);
        window.addEventListener('scroll', dismissTooltip, true);
        window.addEventListener('resize', dismissTooltip);

        return () => {
            observer.disconnect();
            document.removeEventListener('mouseover', handleMouseOver);
            document.removeEventListener('mouseout', handleMouseOut);
            document.removeEventListener('focusin', handleFocusIn);
            document.removeEventListener('focusout', handleFocusOut);
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('pointerdown', dismissTooltip, true);
            document.removeEventListener('click', dismissTooltip, true);
            document.removeEventListener('contextmenu', dismissTooltip, true);
            window.removeEventListener('scroll', dismissTooltip, true);
            window.removeEventListener('resize', dismissTooltip);
            removeTooltipDescription(activeTriggerRef.current);

            document.querySelectorAll(`[${TITLE_SOURCE_ATTRIBUTE}="title"]`).forEach((element) => {
                if (!element.hasAttribute('title')) {
                    element.setAttribute('title', element.getAttribute(TOOLTIP_ATTRIBUTE) || '');
                }
                element.removeAttribute(TOOLTIP_ATTRIBUTE);
                element.removeAttribute(TITLE_SOURCE_ATTRIBUTE);

                const generatedValue = element.getAttribute(ARIA_LABEL_VALUE_ATTRIBUTE);
                if (element.getAttribute(ARIA_LABEL_SOURCE_ATTRIBUTE) === 'title'
                    && element.getAttribute('aria-label') === generatedValue) {
                    element.removeAttribute('aria-label');
                }
                element.removeAttribute(ARIA_LABEL_SOURCE_ATTRIBUTE);
                element.removeAttribute(ARIA_LABEL_VALUE_ATTRIBUTE);
            });
        };
    }, []);

    useEffect(() => {
        const trigger = activeTooltip?.trigger;
        if (!trigger) return undefined;

        const describedBy = new Set((trigger.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
        describedBy.add(TOOLTIP_ID);
        trigger.setAttribute('aria-describedby', [...describedBy].join(' '));

        return () => {
            removeTooltipDescription(trigger);
        };
    }, [activeTooltip]);

    useLayoutEffect(() => {
        const trigger = activeTooltip?.trigger;
        const tooltip = tooltipRef.current;
        if (!trigger || !tooltip || !trigger.isConnected) {
            return;
        }

        const triggerRect = trigger.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const availableBelow = window.innerHeight - triggerRect.bottom;
        const placeAbove = availableBelow < tooltipRect.height + TRIGGER_GAP + VIEWPORT_PADDING
            && triggerRect.top > availableBelow;
        const top = placeAbove
            ? triggerRect.top - tooltipRect.height - TRIGGER_GAP
            : triggerRect.bottom + TRIGGER_GAP;
        const centeredLeft = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
        const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - tooltipRect.width - VIEWPORT_PADDING);

        setPosition({
            left: Math.min(Math.max(centeredLeft, VIEWPORT_PADDING), maxLeft),
            top: Math.max(VIEWPORT_PADDING, Math.min(top, window.innerHeight - tooltipRect.height - VIEWPORT_PADDING)),
            placement: placeAbove ? 'top' : 'bottom',
        });
    }, [activeTooltip]);

    if (!activeTooltip || typeof document === 'undefined') return null;

    return createPortal(
        <div
            ref={tooltipRef}
            id={TOOLTIP_ID}
            role="tooltip"
            className="gnosi-tooltip"
            data-placement={position?.placement || 'bottom'}
            style={position ? { left: position.left, top: position.top } : undefined}
        >
            {activeTooltip.content}
        </div>,
        document.body,
    );
}
