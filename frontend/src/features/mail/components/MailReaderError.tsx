import type { ReactNode } from 'react';


export function MailReaderError({
  children, kind, onRetry, retryLabel,
}: {
  readonly children: ReactNode;
  readonly kind: 'message' | 'thread' | 'thread-message';
  readonly onRetry: () => void;
  readonly retryLabel: string;
}) {
  return (
    <div role="status" data-mail-reader-error={kind} className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/70 px-4 py-3 text-sm text-[var(--text-secondary)]">
      <p>{children}</p>
      <button className="shrink-0 rounded-lg bg-[var(--sidebar-item-active)] px-3 py-1.5 text-xs font-bold text-[var(--gnosi-blue)] hover:opacity-80" onClick={onRetry} type="button">
        {retryLabel}
      </button>
    </div>
  );
}
