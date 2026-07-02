import React from 'react';

/**
 * MentionInline
 * Menció d'una persona (contacte) al contingut, estil Notion `@Persona`.
 * Es desa a Markdown com a `@[Nom|id]` (token segur: no col·lisiona amb cites
 * `@key` ni amb wikilinks `[[…]]`). Mostra un xip amb el nom; en clicar obre la
 * fitxa del contacte a la secció Contactes.
 */
export default function MentionInline({ inlineContent }) {
    const name = String(inlineContent?.props?.name || '').trim() || 'Algú';
    const id = String(inlineContent?.props?.id || '').trim();

    const open = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (id) {
            // Navegació suau a la fitxa del contacte (sense recarregar l'SPA).
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
