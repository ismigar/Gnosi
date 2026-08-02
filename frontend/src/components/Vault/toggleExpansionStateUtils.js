const TOGGLE_STATE_PREFIX = 'gnosi.vault.toggle-expansion.';
const TOGGLE_DOM_STATE_PREFIX = 'gnosi.vault.toggle-dom-expansion.';

function contentSignature(content) {
    if (typeof content === 'string') return content.trim();
    if (!Array.isArray(content)) return '';
    return content.map((item) => {
        if (typeof item === 'string') return item;
        if (item?.type === 'text') return item.text || '';
        return item?.props?.title || item?.props?.content || '';
    }).join('').trim();
}

function toggleEntries(blocks, parentPath = '') {
    if (!Array.isArray(blocks)) return [];
    return blocks.flatMap((block, index) => {
        const path = parentPath ? `${parentPath}.${index}` : String(index);
        const entry = block?.type === 'toggleListItem'
            ? [{ id: block.id, key: `${path}:${contentSignature(block.content)}` }]
            : [];
        return [...entry, ...toggleEntries(block?.children, path)];
    });
}

function pageStorageKey(pageId) {
    return `${TOGGLE_STATE_PREFIX}${pageId}`;
}

function domStorageKey(pageId) {
    return `${TOGGLE_DOM_STATE_PREFIX}${pageId}`;
}

export function restoreToggleExpansionState(pageId, blocks, storage = window.localStorage) {
    if (!pageId || !storage) return;
    let saved = {};
    try {
        saved = JSON.parse(storage.getItem(pageStorageKey(pageId)) || '{}');
    } catch {
        return;
    }

    toggleEntries(blocks).forEach(({ id, key }) => {
        if (!id || !Object.hasOwn(saved, key)) return;
        storage.setItem(`toggle-${id}`, saved[key] ? 'true' : 'false');
    });
}

export function saveToggleExpansionState(pageId, blocks, storage = window.localStorage) {
    if (!pageId || !storage) return;
    const state = {};
    toggleEntries(blocks).forEach(({ id, key }) => {
        if (!id) return;
        state[key] = storage.getItem(`toggle-${id}`) === 'true';
    });

    try {
        storage.setItem(pageStorageKey(pageId), JSON.stringify(state));
    } catch {
        // Keep toggle controls usable when browser storage is unavailable.
    }
}

export function saveToggleDomExpansionState(pageId, root, storage = window.localStorage) {
    if (!pageId || !root || !storage) return;
    const state = Array.from(root.querySelectorAll('.bn-toggle-wrapper')).map(
        (wrapper) => wrapper.getAttribute('data-show-children') === 'true',
    );
    try {
        storage.setItem(domStorageKey(pageId), JSON.stringify(state));
    } catch {
        // Keep toggle controls usable when browser storage is unavailable.
    }
}

export function restoreToggleDomExpansionState(pageId, root, storage = window.localStorage) {
    if (!pageId || !root || !storage) return;
    let state;
    try {
        state = JSON.parse(storage.getItem(domStorageKey(pageId)) || 'null');
    } catch {
        return;
    }
    if (!Array.isArray(state)) return;
    Array.from(root.querySelectorAll('.bn-toggle-wrapper')).forEach((wrapper, index) => {
        if (!state[index] || wrapper.getAttribute('data-show-children') === 'true') return;
        wrapper.querySelector('.bn-toggle-button')?.click();
    });
}
