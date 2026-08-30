import {
    forwardRef,
    type ChangeEventHandler,
    type KeyboardEventHandler,
} from 'react';

export interface MarkdownCodeTextareaProps {
    readonly ariaLabel: string;
    readonly onChange: ChangeEventHandler<HTMLTextAreaElement>;
    readonly onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
    readonly placeholder?: string;
    readonly value: string;
}

/**
 * Visible editing surface used by the Vault Markdown source mode.
 *
 * The inline minimum height is intentional: the auto-grow helper controls the
 * textarea height directly, and an empty document otherwise collapses to zero.
 */
export const MarkdownCodeTextarea = forwardRef(function MarkdownCodeTextarea({
    value,
    onChange,
    onKeyDown,
    ariaLabel,
    placeholder,
}: MarkdownCodeTextareaProps, ref: React.ForwardedRef<HTMLTextAreaElement>) {
    return (
        <textarea
            ref={ref}
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            aria-label={ariaLabel}
            placeholder={placeholder}
            spellCheck={false}
            rows={1}
            style={{ minHeight: '500px' }}
            className="block w-full bg-transparent p-0 font-mono text-sm leading-6 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none resize-none border-0 focus:ring-0 overflow-hidden"
        />
    );
});
