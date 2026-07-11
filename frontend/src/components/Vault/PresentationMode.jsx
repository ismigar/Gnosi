import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import { VaultMarkdown } from './VaultMarkdown';
import i18n from '../../i18n';

/**
 * PresentationMode
 * Full-screen presentation / slides mode generated from the note's Markdown.
 * Slides are separated by a `---` line (Obsidian Slides / reveal.js style
 * separator); if there is none, it splits by first/second-level
 * headings. Navigation: ←/→, Space, PgUp/PgDn; Esc to exit.
 */

// Removes the initial YAML frontmatter if there is one.
const stripFrontmatter = (md) => {
    const m = String(md || '').match(/^---\n[\s\S]*?\n---\n?/);
    return m ? md.slice(m[0].length) : String(md || '');
};

const splitSlides = (md) => {
    const body = stripFrontmatter(md).trim();
    if (!body) return [i18n.t('editor.presentation_empty_note', '(Nota buida)')];
    // 1) Explicit `---` separators on their own line.
    const bySep = body.split(/\n[ \t]*---[ \t]*\n/);
    if (bySep.length > 1) return bySep.map((s) => s.trim()).filter(Boolean);
    // 2) Fallback: splits by H1/H2 headings (each one starts a slide).
    const lines = body.split('\n');
    const slides = [];
    let cur = [];
    for (const line of lines) {
        if (/^#{1,2}\s/.test(line) && cur.some((l) => l.trim())) {
            slides.push(cur.join('\n').trim());
            cur = [line];
        } else {
            cur.push(line);
        }
    }
    if (cur.some((l) => l.trim())) slides.push(cur.join('\n').trim());
    return slides.length ? slides : [body];
};

export default function PresentationMode({ isOpen, onClose, markdown = '' }) {
    const { t } = useTranslation();
    const slides = useMemo(() => splitSlides(markdown), [markdown]);
    const [idx, setIdx] = useState(0);

    useEffect(() => { if (isOpen) setIdx(0); }, [isOpen]);

    const next = useCallback(() => setIdx((i) => Math.min(i + 1, slides.length - 1)), [slides.length]);
    const prev = useCallback(() => setIdx((i) => Math.max(i - 1, 0)), []);

    useEffect(() => {
        if (!isOpen) return undefined;
        const onKey = (e) => {
            if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); next(); }
            else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, next, prev, onClose]);

    const goFullscreen = () => {
        const el = document.getElementById('gnosi-presentation');
        if (el?.requestFullscreen) el.requestFullscreen().catch(() => {});
    };

    if (!isOpen) return null;

    return (
        <div id="gnosi-presentation" className="fixed inset-0 z-[100003] flex flex-col bg-[var(--bg-primary)]">
            {/* Barra superior */}
            <div className="flex items-center justify-between px-4 py-2 text-[var(--text-tertiary)]">
                <span className="text-sm">{idx + 1} / {slides.length}</span>
                <div className="flex items-center gap-1">
                    <button onClick={goFullscreen} title={t('editor.presentation_fullscreen', 'Pantalla completa')} className="rounded p-1.5 hover:bg-[var(--bg-secondary)]"><Maximize2 size={16} /></button>
                    <button onClick={onClose} title={t('editor.presentation_exit', 'Surt (Esc)')} className="rounded p-1.5 hover:bg-[var(--bg-secondary)]"><X size={18} /></button>
                </div>
            </div>
            {/* Diapositiva */}
            <div className="flex flex-1 items-center justify-center overflow-auto px-6 py-4" onClick={next}>
                <div className="prose-slide w-full max-w-3xl text-[var(--text-primary)] [&_h1]:text-4xl [&_h1]:mb-4 [&_h2]:text-3xl [&_h2]:mb-3 [&_p]:text-xl [&_li]:text-xl [&_*]:leading-relaxed">
                    <VaultMarkdown md={slides[idx] || ''} />
                </div>
            </div>
            {/* Controls inferiors */}
            <div className="flex items-center justify-center gap-4 py-3">
                <button onClick={prev} disabled={idx === 0} className="rounded-full p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-30"><ChevronLeft size={22} /></button>
                <div className="flex gap-1">
                    {slides.map((_, i) => (
                        <button key={i} onClick={(e) => { e.stopPropagation(); setIdx(i); }} className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-6 bg-[var(--gnosi-primary)]' : 'w-1.5 bg-[var(--border-primary)]'}`} />
                    ))}
                </div>
                <button onClick={next} disabled={idx === slides.length - 1} className="rounded-full p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-30"><ChevronRight size={22} /></button>
            </div>
        </div>
    );
}
