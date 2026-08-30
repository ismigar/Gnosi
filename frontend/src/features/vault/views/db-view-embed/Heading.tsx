import type { ReactNode, ElementType } from 'react';
export function Heading({ level, children }: { level: number; children: ReactNode; }) {
    const safeLevel = Math.min(Math.max(level || 1, 1), 6);
    const tags: Record<number, ElementType> = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6' };
    const Tag = tags[safeLevel] || 'h1';
    const cls = safeLevel === 1 ? 'text-2xl font-bold mb-3'
        : safeLevel === 2 ? 'text-xl font-bold mb-2'
            : 'text-lg font-semibold mb-2';
    return <Tag className={`${cls} text-[var(--text-primary)]`}>{children}</Tag>;
}
