import React, { useState, useEffect, useCallback } from 'react';
import { List } from 'lucide-react';

/**
 * TableOfContentsBlock
 * Bloc inserible que genera un índex de continguts a partir dels headings
 * del document en VIU (es regenera quan canvia el contingut). `content: "none"`.
 * En clicar una entrada, fa scroll fins al heading corresponent.
 *
 * Es serialitza a Markdown com a `{{toc}}` (mirall de `{{bibliography}}`).
 */

// Extreu el text pla d'un array de contingut inline de BlockNote.
const inlineText = (content) => {
    if (!Array.isArray(content)) return '';
    return content
        .map((it) => {
            if (!it || typeof it !== 'object') return '';
            if (typeof it.text === 'string') return it.text;
            // wikilink / cite / mention: usa el títol visible si n'hi ha
            return String(it.props?.title || it.props?.label || '');
        })
        .join('')
        .trim();
};

// Recorre el document (incloent fills de columnes/toggles) i recull els
// headings en ordre amb el seu nivell, text i id de bloc (per fer scroll).
const extractHeadings = (editor) => {
    const out = [];
    const walk = (blocks) => {
        for (const b of blocks || []) {
            if (b?.type === 'heading') {
                const text = inlineText(b.content);
                if (text) out.push({ id: b.id, level: Number(b.props?.level) || 1, text });
            }
            if (Array.isArray(b?.children) && b.children.length) walk(b.children);
        }
    };
    try { walk(editor?.document || []); } catch { /* editor encara no llest */ }
    return out;
};

export default function TableOfContentsBlock({ editor }) {
    const [headings, setHeadings] = useState(() => extractHeadings(editor));

    useEffect(() => {
        if (!editor?.onChange) return undefined;
        // onChange retorna una funció de desubscripció en BlockNote >= 0.25.
        let unsub;
        try {
            unsub = editor.onChange(() => setHeadings(extractHeadings(editor)));
        } catch { /* noop */ }
        // Recalcula també a muntar per si el document ja tenia headings.
        setHeadings(extractHeadings(editor));
        return () => { try { unsub?.(); } catch { /* noop */ } };
    }, [editor]);

    const scrollTo = useCallback((id) => {
        try {
            const el = document.querySelector(`[data-id="${id}"]`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch { /* noop */ }
    }, []);

    // Nivell mínim per indentar de forma relativa (un doc que comença en H2
    // no ha de quedar tot indentat).
    const minLevel = headings.length ? Math.min(...headings.map((h) => h.level)) : 1;

    return (
        <div
            className="bn-toc my-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3"
            contentEditable={false}
        >
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                <List size={14} />
                <span>Índex</span>
            </div>
            {headings.length === 0 ? (
                <div className="text-sm italic text-[var(--text-tertiary)]">
                    Afegeix encapçalaments per generar l'índex.
                </div>
            ) : (
                <ul className="space-y-0.5">
                    {headings.map((h, i) => (
                        <li key={`${h.id}-${i}`} style={{ paddingLeft: `${(h.level - minLevel) * 16}px` }}>
                            <button
                                type="button"
                                onClick={() => scrollTo(h.id)}
                                className="text-left text-sm text-[var(--text-secondary)] hover:text-[var(--gnosi-primary)] hover:underline transition-colors"
                            >
                                {h.text}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
