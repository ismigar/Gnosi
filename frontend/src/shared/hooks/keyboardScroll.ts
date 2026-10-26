import { isActiveModalScope } from './useModalKeyboard';

export function ownsKeyboardNavigation(origin: Element | null): boolean {
    return Boolean(origin?.closest('[data-keyboard-navigation="true"], iframe, object, embed'));
}

export function isKeyboardScrollOriginVisible(origin: HTMLElement): boolean {
    for (let element: HTMLElement | null = origin; element; element = element.parentElement) {
        if (element.inert || element.hasAttribute('inert') || element.hidden) return false;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return true;
}

export function isVerticalScrollRegion(element: HTMLElement): boolean {
    if (element.clientHeight <= 0 || element.scrollHeight <= element.clientHeight + 1) return false;
    return /^(auto|scroll|overlay)$/.test(getComputedStyle(element).overflowY);
}

export function nearestVerticalScrollRegion(origin: HTMLElement, boundary?: HTMLElement): HTMLElement | null {
    if (!isKeyboardScrollOriginVisible(origin)) return null;
    for (let element: HTMLElement | null = origin; element; element = element.parentElement) {
        if (isVerticalScrollRegion(element)) return element;
        if (element === boundary) break;
    }
    return null;
}

// Scroll only the focused region, leaving each interactive control its own keys.
export function canKeyboardScroll(event: KeyboardEvent, container: HTMLElement, active: Element | null = document.activeElement): boolean {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (!(active instanceof HTMLElement) || !container.contains(active) || !isActiveModalScope(container)) return false;
    if (!isKeyboardScrollOriginVisible(active)) return false;
    if (active.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="listbox"], [role="menu"], [role="menubar"], [role="tablist"], [role="tree"], [role="grid"], [role="slider"], [role="spinbutton"], [role="radio"]')) return false;
    // Standalone switches and checkboxes use Space/Enter for activation, not
    // vertical navigation. Preserve those keys while allowing the form to scroll.
    if (active.closest('[role="switch"], [role="checkbox"]') && !['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) return false;
    if (event.key === ' ' && active.closest('button, a[href], summary, [role="button"]')) return false;
    // A nested dialog may use a different modal implementation.
    if (active.closest('[role="dialog"], [role="alertdialog"]') !== container.closest('[role="dialog"], [role="alertdialog"]')) return false;
    return true;
}
