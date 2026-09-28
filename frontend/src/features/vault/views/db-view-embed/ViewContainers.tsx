import type { BoxProps } from './types';
import type { ViewHeightMode } from '../../../../shared/records/model/viewHeight';

const tableClass = 'my-2 w-full max-w-full min-w-0 isolate';
const limitedClass = 'my-2 w-full max-w-full min-w-0 max-h-[70vh] min-h-[8rem] overflow-x-auto overflow-y-auto focus-within:ring-1 focus-within:ring-[var(--gnosi-primary)]/30 transition-all';
const contentClass = 'mt-0 mb-2 w-full max-w-full min-w-0 rounded-xl border border-transparent focus-within:border-[var(--gnosi-primary)]/50 focus-within:ring-1 focus-within:ring-[var(--gnosi-primary)]/30 overflow-x-clip transition-all';

export function EmbeddedViewBox({ children, viewType, heightMode }: BoxProps & {
    readonly viewType: string;
    readonly heightMode: ViewHeightMode;
}) {
    // Tables own horizontal scrolling, sticky columns and their vertical cap.
    // Isolate their sticky cells so they cannot cover the embed toolbar menus.
    const className = viewType === 'table' || viewType === 'list' ? tableClass
        : heightMode === 'content' ? contentClass : limitedClass;
    // Keep the same element/component identity when changing height: expanded
    // groups, selection and keyboard focus belong to the existing child view.
    return <div className={className}>{children}</div>;
}
