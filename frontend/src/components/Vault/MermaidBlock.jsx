import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Pencil, Check, Workflow } from 'lucide-react';

/**
 * MermaidBlock
 * Bloc de diagrama Mermaid. Desa el codi font a `props.code` i el serialitza
 * a Markdown com una fence ```mermaid (compatible amb Obsidian/GitHub).
 *
 * La llibreria `mermaid` és pesada i no està al bundle: es carrega de manera
 * mandrosa (dynamic import des d'un ESM CDN) NOMÉS quan hi ha un diagrama a
 * renderitzar. Si no es pot carregar (offline) o el codi té errors, es mostra
 * el codi font en cru com a fallback — la nota mai perd informació.
 */

let _mermaidPromise = null;
const loadMermaid = () => {
    if (_mermaidPromise) return _mermaidPromise;
    _mermaidPromise = import(/* @vite-ignore */ 'https://esm.sh/mermaid@11?bundle')
        .then((mod) => {
            const mermaid = mod.default || mod;
            mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' });
            return mermaid;
        })
        .catch((err) => {
            _mermaidPromise = null; // permet reintentar més tard
            throw err;
        });
    return _mermaidPromise;
};

let _mermaidSeq = 0;

export default function MermaidBlock({ block, editor }) {
    const code = String(block?.props?.code || '').trim();
    const [editing, setEditing] = useState(!code);
    const [draft, setDraft] = useState(code);
    const [svg, setSvg] = useState('');
    const [error, setError] = useState('');
    const renderToken = useRef(0);

    useEffect(() => { setDraft(code); }, [code]);

    // Renderitza el diagrama quan canvia el codi i no s'està editant.
    useEffect(() => {
        if (editing || !code) { setSvg(''); setError(''); return; }
        const token = ++renderToken.current;
        let cancelled = false;
        setError('');
        loadMermaid()
            .then(async (mermaid) => {
                const id = `gnosi-mermaid-${++_mermaidSeq}`;
                try {
                    const { svg: out } = await mermaid.render(id, code);
                    if (!cancelled && token === renderToken.current) setSvg(out);
                } catch (e) {
                    if (!cancelled && token === renderToken.current) {
                        setSvg('');
                        setError(String(e?.message || e || 'Error de sintaxi Mermaid'));
                    }
                }
            })
            .catch(() => {
                if (!cancelled && token === renderToken.current) {
                    setSvg('');
                    setError('No s\'ha pogut carregar Mermaid (sense connexió?).');
                }
            });
        return () => { cancelled = true; };
    }, [code, editing]);

    const save = useCallback(() => {
        const next = draft.trim();
        try { editor?.updateBlock(block, { type: 'mermaid', props: { code: next } }); } catch { /* noop */ }
        setEditing(false);
    }, [draft, editor, block]);

    if (editing) {
        return (
            <div className="bn-mermaid my-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3" contentEditable={false}>
                <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                        <Workflow size={14} /> Mermaid
                    </span>
                    <button
                        type="button"
                        onClick={save}
                        className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10"
                    >
                        <Check size={14} /> Fet
                    </button>
                </div>
                <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); }
                    }}
                    spellCheck={false}
                    placeholder={'graph TD\n  A[Inici] --> B[Final]'}
                    className="h-40 w-full resize-y rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                />
            </div>
        );
    }

    return (
        <div className="bn-mermaid group/mermaid relative my-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3" contentEditable={false}>
            <button
                type="button"
                onClick={() => setEditing(true)}
                title="Edita el diagrama"
                className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-tertiary)] opacity-0 shadow transition-opacity hover:text-[var(--gnosi-primary)] group-hover/mermaid:opacity-100"
            >
                <Pencil size={12} /> Edita
            </button>
            {error ? (
                <div>
                    <div className="mb-2 text-sm text-[var(--gnosi-danger,#dc2626)]">{error}</div>
                    <pre className="overflow-auto rounded bg-[var(--bg-primary)] p-2 font-mono text-xs text-[var(--text-secondary)]">{code}</pre>
                </div>
            ) : svg ? (
                <div className="flex justify-center overflow-auto" dangerouslySetInnerHTML={{ __html: svg }} />
            ) : (
                <div className="py-6 text-center text-sm text-[var(--text-tertiary)]">Renderitzant diagrama…</div>
            )}
        </div>
    );
}
