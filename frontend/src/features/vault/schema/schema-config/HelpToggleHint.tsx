import React, { useState } from 'react';
export function HelpToggleHint({ text }: { text: string }) {
    const [open, setOpen] = useState(false);
    if (!text) return null;
    return (
        <span className="inline-flex flex-col gap-0.5">
            <button
                type="button"
                aria-expanded={open}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-primary)] text-[9px] font-bold leading-none text-[var(--text-tertiary)] hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]/40 transition-colors ml-1 shrink-0"
                title={text}
            >
                ?
            </button>
            {open && (
                <span className="block text-[11px] text-[var(--text-tertiary)] mt-0.5 animate-in fade-in duration-150 font-normal">
                    {text}
                </span>
            )}
        </span>
    );
}
