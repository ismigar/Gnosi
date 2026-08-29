import { useState, useEffect, useCallback } from 'react';
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
interface TocHeading {
    readonly id: string;
    readonly level: number;
    readonly text: string;
}

interface TocEditor {
    readonly document?: unknown;
    readonly onChange?: (listener: () => void) => (() => void) | undefined;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function scalarText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
        return String(value);
    }
    return '';
}

const inlineText = (content: unknown): string => {
    if (!isUnknownArray(content)) return '';
    return content
        .map((it) => {
            if (!isUnknownRecord(it)) return '';
            if (typeof it.text === 'string') return it.text;
            // wikilink / cite / mention: uses the visible title if there is one
            const props = isUnknownRecord(it.props) ? it.props : {};
            return scalarText(props.title) || scalarText(props.label);
        })
        .join('')
        .trim();
};

// Traverses the document (including children of columns/toggles) and collects the
// headings in order with their level, text, and block id (to scroll to).
const extractHeadings = (editor?: TocEditor | null): TocHeading[] => {
    const out: TocHeading[] = [];
    const walk = (blocks: unknown): void => {
        if (!isUnknownArray(blocks)) return;
        for (const block of blocks) {
            if (!isUnknownRecord(block)) continue;
            if (block.type === 'heading') {
                const text = inlineText(block.content);
                const props = isUnknownRecord(block.props) ? block.props : {};
                if (text) out.push({ id: scalarText(block.id), level: Number(props.level) || 1, text });
            }
            walk(block.children);
        }
    };
    try { walk(editor?.document || []); } catch { /* editor not ready yet */ }
    return out;
};

export interface TableOfContentsBlockProps {
    readonly editor?: TocEditor | null;
}

export default function TableOfContentsBlock({ editor }: TableOfContentsBlockProps) {
    const { t } = useTranslation();
    const [headings, setHeadings] = useState(() => extractHeadings(editor));

    useEffect(() => {
        if (!editor?.onChange) return undefined;
        // onChange returns an unsubscribe function in BlockNote >= 0.25.
        let unsubscribe: (() => void) | undefined;
        try {
            const result = editor.onChange(() => {
                setHeadings(extractHeadings(editor));
            });
            unsubscribe = typeof result === 'function' ? result : undefined;
        } catch { /* noop */ }
        // Also recalculates on mount in case the document already had headings.
        setHeadings(extractHeadings(editor));
        return () => { try { unsubscribe?.(); } catch { /* noop */ } };
    }, [editor]);

    const scrollTo = useCallback((id: string): void => {
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
                <span>{t('editor.toc_block_title', "Contents")}</span>
            </div>
            {headings.length === 0 ? (
                <div className="text-sm italic text-[var(--text-tertiary)]">
                    {t('editor.toc_empty', "Add headings to generate the index.")}
                </div>
            ) : (
                <ul className="space-y-0.5">
                    {headings.map((h, i) => (
                        <li key={`${h.id}-${String(i)}`} style={{ paddingLeft: `${String((h.level - minLevel) * 16)}px` }}>
                            <button
                                type="button"
                                onClick={() => {
                                    scrollTo(h.id);
                                }}
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
