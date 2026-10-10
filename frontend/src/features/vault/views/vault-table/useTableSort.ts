import { useRef, useState } from 'react';
import { resolveViewSorts } from '../../../../shared/records/model/schemaUtils';
import { notifyError } from '../../../../shared/notifications/notifyError';
import type { TableInputs } from './tableInputs';
import type { useTableIdentity } from './useTableIdentity';

type Sort = { field: string; direction: 'asc' | 'desc' };
type Override = { scope: string; base: string; sorts: Sort[]; version: number };
type Inputs = Pick<TableInputs, 'activeView' | 'onUpdateView'> & Pick<ReturnType<typeof useTableIdentity>, 't'>;

/** Apply sorting immediately; serialize optional saves so older responses cannot win. */
export function useTableSort({ activeView, onUpdateView, t }: Inputs) {
    const scope = `${activeView?.table_id ?? ''}:${activeView?.id ?? ''}`;
    const saved = resolveViewSorts(activeView, { field: 'last_modified', direction: 'desc' });
    const signature = JSON.stringify(saved);
    const [override, setOverride] = useState<Override | null>(null);
    const queue = useRef<Promise<unknown>>(Promise.resolve());
    const [pending, setPending] = useState(0);
    const sequence = useRef(0);
    const applies = override?.scope === scope && (pending > 0 || override.base === signature || JSON.stringify(override.sorts) === signature);
    const sorts = applies ? override.sorts : saved;
    const effectiveView = applies ? { ...activeView, sort: sorts, sorts } : activeView;
    const handleSort = (field: string) => {
        const primary = sorts[0];
        const next: Sort[] = [{ field, direction: primary?.field === field && primary.direction === 'asc' ? 'desc' : 'asc' }];
        const version = ++sequence.current;
        setOverride({ scope, base: signature, sorts: next, version });
        if (!onUpdateView) return;
        setPending(count => count + 1);
        const updated = { ...activeView, sort: next, sorts: next };
        queue.current = queue.current.then(() => onUpdateView(updated)).catch((error: unknown) => {
            setOverride(current => current?.version === version ? null : current);
            notifyError('table-sort-save', error, t('table.sort_save_error'));
        }).finally(() => {
            setPending(count => Math.max(0, count - 1));
            setOverride(current => current?.version === version ? { ...current } : current);
        });
    };
    return { activeView: effectiveView, handleSort };
}
