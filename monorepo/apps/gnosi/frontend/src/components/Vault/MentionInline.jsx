import React from 'react';

/**
 * MentionInline
 * Mention of a person (contact) in the content, Notion `@Person` style.
 * Saved to Markdown as `@[Name|id]` (safe token: doesn't collide with citations
 * `@key` or wikilinks `[[…]]`). Shows a chip with the name; clicking it opens the
 * contact's card in the Contacts section.
 */
export default function MentionInline({ inlineContent }) {
    const name = String(inlineContent?.props?.name || '').trim() || 'Algú';
    const id = String(inlineContent?.props?.id || '').trim();

    const open = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (id) {
            // Smooth navigation to the contact's card (without reloading the SPA).
            try {
                window.history.pushState({}, '', `/contacts?id=${encodeURIComponent(id)}`);
                window.dispatchEvent(new PopStateEvent('popstate'));
            } catch { /* noop */ }
        }
    };

    return (
        <span
            contentEditable={false}
            onClick={open}
            title={name}
            className="bn-mention mx-0.5 inline-flex cursor-pointer select-none items-center rounded px-1 text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10"
        >
            @{name}
        </span>
    );
}
