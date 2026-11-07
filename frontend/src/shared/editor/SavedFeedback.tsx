import { useEffect, useState, type ReactNode } from 'react';

export const SAVED_FEEDBACK_DURATION_MS = 1000;

/** Transient confirmation shared by all save indicators. Mount after a save. */
export function SavedFeedback({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
    const [visible, setVisible] = useState(true);
    useEffect(() => {
        const timer = setTimeout(() => { setVisible(false); }, SAVED_FEEDBACK_DURATION_MS);
        return () => { clearTimeout(timer); };
    }, []);
    if (!visible) return null;
    return <span role="status" className={className} style={{ color: 'var(--gnosi-blue)' }}>{children}</span>;
}
