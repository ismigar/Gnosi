// Closest scrollable ancestor of a node (or the document's scroll
// element if there isn't one).
export const getScrollableAncestor = (node: Element | null): Element => {
    let el = node?.parentElement || null;
    while (el) {
        const overflowY = getComputedStyle(el).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
            return el;
        }
        el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
};

// Auto-grow of a <textarea>: setting height:auto collapses it for an instant to
// to be able to measure the real scrollHeight of the content. If the textarea is in the middle
// of a long document, this momentary collapse makes the browser
// "chase" the cursor and scroll the container on every keystroke (the line
// edited kept sliding toward the bottom of the screen). We save and restore the
// scrollTop of the ancestor within the same tick, before paint → no
// flicker.
export const autoGrowTextarea = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    const scroller = getScrollableAncestor(el);
    const prevTop = scroller.scrollTop;
    el.style.height = 'auto';
    el.style.height = `${String(el.scrollHeight)}px`;
    if (scroller.scrollTop !== prevTop) {
        scroller.scrollTop = prevTop;
    }
};
