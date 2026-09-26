import { isActiveModalScope } from './useModalKeyboard';

// Scroll only the focused region, leaving each interactive control its own keys.
export function canKeyboardScroll(event: KeyboardEvent, container: HTMLElement): boolean {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !container.contains(active) || !isActiveModalScope(container)) return false;
    if (active.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="listbox"], [role="menu"], [role="menubar"], [role="tablist"], [role="tree"], [role="grid"], [role="slider"], [role="spinbutton"], [role="switch"], [role="radio"], [role="checkbox"]')) return false;
    if (event.key === ' ' && active.closest('button, a[href], summary, [role="button"]')) return false;
    // A nested dialog may use a different modal implementation.
    if (active.closest('[role="dialog"], [role="alertdialog"]') !== container.closest('[role="dialog"], [role="alertdialog"]')) return false;
    return true;
}
