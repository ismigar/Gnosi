import { useEffect, useState } from 'react';
import { recordWebsiteDestinations, type RecordWebsiteDestination } from '../../shared/api/sites';
import { useRequestContext } from '../../shared/hooks/useRequestContext';

/** Read actual source bindings in the same authenticated scope as the visible record. */
export function useRecordWebsiteDestinations(selection: { page_id?: string; table_id?: string }, enabled = true) {
  const context = useRequestContext();
  const { page_id, table_id } = selection;
  const [revision, refresh] = useState(0);
  const key = JSON.stringify([context, page_id, table_id, enabled, revision]);
  const [state, setState] = useState<{ key: string; destinations: RecordWebsiteDestination[] }>({ key: '', destinations: [] });
  useEffect(() => {
    if (!enabled || (!page_id && !table_id)) return;
    const controller = new AbortController();
    void recordWebsiteDestinations({ page_id, table_id }, context, controller.signal).then(destinations => {
      if (!controller.signal.aborted) setState({ key, destinations });
    }).catch(() => { if (!controller.signal.aborted) setState({ key, destinations: [] }); });
    return () => { controller.abort(); };
  }, [context, key, enabled, page_id, table_id]); // Selection values form the stable query identity.
  return { websiteDestinations: state.key === key ? state.destinations : [], refreshWebsiteDestinations: () => { refresh(value => value + 1); } };
}
