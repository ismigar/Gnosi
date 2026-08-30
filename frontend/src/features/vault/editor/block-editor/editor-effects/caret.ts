function caretRect(range: Range): DOMRect | undefined {
    return range.getClientRects()[0] || range.getBoundingClientRect();
}

/** Visual line tests deliberately measure the caret's own block, not the editor. */
export function caretOnBlockEdge(edge: 'first' | 'last'): boolean {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(edge === 'first');
    const rect = caretRect(range);
    if (!rect) return false;
    const focus = selection.focusNode;
    const node = focus?.nodeType === Node.TEXT_NODE ? focus.parentElement : focus;
    const element = node instanceof Element ? node : null;
    const block = element?.closest('.bn-block-content') || element?.closest('.bn-block');
    if (!block) return false;
    if (!block.textContent.trim()) return true;
    const bounds = block.getBoundingClientRect();
    const distance = edge === 'first' ? rect.top - bounds.top : bounds.bottom - rect.bottom;
    return distance < (rect.height || 20) * 0.75 + 6;
}
