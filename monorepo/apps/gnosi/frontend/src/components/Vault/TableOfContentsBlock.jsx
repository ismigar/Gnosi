import React, { useState, useEffect, useCallback } from 'react';
import { List } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * TableOfContentsBlock
 * Insertable block that generates a table of contents from the document's
 * headings LIVE (it regenerates when the content changes). `content: "none"`.
 * Clicking an entry scrolls to the corresponding heading.
 *
 * Serialized to Markdown as `{{toc}}` (mirrors `{{bibliography}}`).
 */

// Extracts the plain text from a BlockNote inline content array.
const inlineText = (content) => {
    if (!Array.isArray(content)) return '';
    return content
        .map((it) => {
            if (!it || typeof it !== 'object') return '';
            if (typeof it.text === 'string') return it.text;
            // wikilink / cite / mention: uses the visible title if there is one
            return String(it.props?.title || it.props?.label || '');
        })
        .join('')
        .trim();
};

// Traverses the document (including children of columns/toggles) and collects the
// headings in order with their level, text, and block id (to scroll to).
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
    try { walk(editor?.document || []); } catch { /* editor not ready yet */ }
    return out;
};

export default function TableOfContentsBlock({ editor }) {
    const { t } = useTranslation();
    const [headings, setHeadings] = useState(() => extractHeadings(editor));

    useEffect(() => {
        if (!editor?.onChange) return undefined;
        // onChange returns an unsubscribe function in BlockNote >= 0.25.
        let unsub;
        try {
            unsub = editor.onChange(() => setHeadings(extractHeadings(editor)));
        } catch { /* noop */ }
        // Also recalculates on mount in case the document already had headings.
        setHeadings(extractHeadings(editor));
        return () => { try { unsub?.(); } catch { /* noop */ } };
    }, [editor]);

    const scrollTo = useCallback((id) => {
        try {
            const el = document.querySelector(`[data-id="${id}"]`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch { /* noop */ }
    }, []);

    // Minimum level to indent relatively (a doc that starts at H2
    // it shouldn't all end up indented).
    const minLevel = headings.length ? Math.min(...headings.map((h) => h.level)) : 1;

    return (
        <div
            className="bn-toc my-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3"
            contentEditable={false}
        >
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                <List size={14} />
                <span>{t('editor.toc_block_title', 'Índex')}</span>
            </div>
            {headings.length === 0 ? (
                <div className="text-sm italic text-[var(--text-tertiary)]">
                    {t('editor.toc_empty', "Afegeix encapçalaments per generar l'índex.")}
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
