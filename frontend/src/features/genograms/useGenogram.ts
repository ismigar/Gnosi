import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchGenogram, genogramRequestContext } from '../../shared/api/genograms';
import { subscribeAppEvent } from '../../shared/platform/app-events';
import { configValue, type Config, type Network } from './model';
import type { Layout } from './layout';
import { errorMessage } from './errors';

export interface GenogramViewProps {
  view: Readonly<Record<string, unknown>>;
  eligibleIds: readonly string[];
  rowsVersion?: unknown;
  search?: string;
  onUpdateView?: (...args: readonly unknown[]) => unknown;
  onNoteSelect?: (id: string) => void;
  onChanged?: () => void;
}
export function useGenogram(props: GenogramViewProps) {
  const { t } = useTranslation();
  const initialConfig = useMemo(() => configValue(props.view.genogram), [props.view.genogram]);
  const [config, setConfig] = useState(initialConfig);
  const [network, setNetwork] = useState<Network | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0), [scope, setScope] = useState(genogramRequestContext().vaultId);
  const worker = useRef<Worker | null>(null), revision = useRef(0), saves = useRef(Promise.resolve());
  const pendingSaves = useRef(0), saveRevision = useRef(0), mounted = useRef(true);
  const configRef = useRef(initialConfig);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Synchronize the external saved view only when no optimistic save is pending.
  useEffect(() => {
    if (pendingSaves.current === 0) {
      configRef.current = initialConfig;
      setConfig(initialConfig);
    }
  }, [initialConfig]);
  useEffect(() => subscribeAppEvent('gnosi:vault-changed', () => { setNetwork(null); setLayout(null); setScope(genogramRequestContext().vaultId); }), []);
  useEffect(() => subscribeAppEvent('gnosi:genograms-changed', () => { setRefresh(n => n + 1); }), []);
  const requestKey = JSON.stringify({ table_id: props.view.table_id, view_id: props.view.id, config, eligible_ids: props.eligibleIds });
  useEffect(() => {
    const abort = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the external network request lifecycle.
    setLoading(true); setError('');
    const body = { table_id: typeof props.view.table_id === 'string' ? props.view.table_id : '', config, eligible_ids: [...props.eligibleIds] };
    void fetchGenogram(body, abort.signal).then(result => {
      if (!abort.signal.aborted && genogramRequestContext().vaultId === scope) setNetwork(result);
    }).catch((reason: unknown) => { if (!abort.signal.aborted) setError(errorMessage(reason, t)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => { abort.abort(); };
    // The serialized request includes every query input; row identity refreshes edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, refresh, scope, props.rowsVersion]);
  useEffect(() => {
    const current = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
    worker.current = current;
    current.onmessage = (event: MessageEvent<{ revision: number; layout?: Layout; error?: string }>) => {
      if (event.data.revision !== revision.current) return;
      if (event.data.layout) setLayout(event.data.layout);
      if (event.data.error) setError(t('genograms.layout_error'));
    };
    current.onerror = () => { setError(t('genograms.layout_error')); };
    return () => { current.onmessage = null; current.terminate(); worker.current = null; };
  }, [scope, t]);
  const visible = useMemo(() => {
    if (!network) return { people: [], relations: [] };
    const ids = new Set(network.visible_ids), invalid = new Set(network.issues.filter(issue => issue.severity === 'error').map(issue => issue.record_id));
    return { people: network.people.filter(person => ids.has(person.id)), relations: network.relations.filter(relation => !invalid.has(relation.id) && ids.has(relation.source) && ids.has(relation.target)) };
  }, [network]);
  useEffect(() => {
    revision.current++;
    worker.current?.postMessage({ revision: revision.current, input: { ...visible, config } });
  }, [visible, config, scope]);
  const update = (patch: Partial<Config>) => {
    const next = { ...configRef.current, ...patch };
    const before = configRef.current;
    configRef.current = next;
    const saveId = ++saveRevision.current;
    pendingSaves.current++;
    setConfig(next);
    const currentScope = scope;
    saves.current = saves.current.then(async () => {
      if (!mounted.current || currentScope !== genogramRequestContext().vaultId) return;
      if (!props.onUpdateView) throw new Error('Missing view persistence');
      await props.onUpdateView({ ...props.view, genogram: next });
    }).catch((reason: unknown) => { if (mounted.current && currentScope === genogramRequestContext().vaultId) { if (saveId === saveRevision.current) { configRef.current = before; setConfig(before); } setError(errorMessage(reason, t)); } }).finally(() => { pendingSaves.current--; });
  };
  return { config, update, network, layout, error, setError, loading, visible, scope, reload: () => { setRefresh(n => n + 1); } };
}
