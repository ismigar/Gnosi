import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { workspaceRequest, type WorkspaceIdentity, type WorkspaceRecord } from '../../shared/api/agent-workspace';
import type { WorkspaceNativeRequest } from '../../../../desktop/ipc-contract';

export interface WorkspaceItem extends WorkspaceRecord { readonly id: string }
export function workspaceText(record: WorkspaceRecord | null, field: string): string {
  return typeof record?.[field] === 'string' ? record[field] : '';
}

export function useAgentWorkspace(identity: WorkspaceIdentity, open: boolean) {
  const { t } = useTranslation();
  const [grants, setGrants] = useState<WorkspaceItem[]>([]);
  const [status, setStatus] = useState<WorkspaceRecord | null>(null);
  const [nativeRequests, setNativeRequests] = useState<WorkspaceItem[]>([]);
  const [documents, setDocuments] = useState<WorkspaceItem[]>([]);
  const [analyses, setAnalyses] = useState<WorkspaceItem[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const working = useRef(false);
  const nativeScope = useRef<string | null>(null);
  const labels = useMemo(() => ({ title: t('agent_workbench.title'), allow: t('agent_workbench.allow'), cancel: t('common.cancel'),
    browser: t('agent_workbench.browser_permission'), application: t('agent_workbench.application_permission'),
    type: t('agent_workbench.input_permission'), folder: t('agent_workbench.folder_permission') }), [t]);
  const native = useCallback(async (operation: WorkspaceRecord) => {
    if (!window.electronAPI?.workspaceOperation) throw new Error('workspace_desktop_unavailable');
    const actions = ['pick-folder', 'browser-open', 'browser-snapshot', 'browser-click', 'browser-type',
      'browser-takeover', 'browser-stop', 'app-open', 'app-type', 'messages-compose', 'revoke'];
    if (typeof operation.action !== 'string' || !actions.includes(operation.action)) throw new Error('workspace_invalid_native_action');
    if (!nativeScope.current) {
      const scope = await workspaceRequest<{ scope_key: string }>('native-scope', identity);
      if (!active.current) throw new Error('workspace_scope_changed');
      nativeScope.current = scope.scope_key;
    }
    return window.electronAPI.workspaceOperation({ ...operation, action: operation.action as WorkspaceNativeRequest['action'], agentId: identity.agent_id,
      sessionId: identity.session_id, scopeKey: nativeScope.current, labels });
  }, [identity, labels]);
  const perform = useCallback(async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
    if (working.current) return;
    working.current = true;
    setBusy(true); setError('');
    try { return await operation(); }
    catch { if (active.current) setError(t('agent_workbench.operation_failed')); }
    finally { working.current = false; if (active.current) setBusy(false); }
  }, [t]);
  const reload = useCallback(async (signal?: AbortSignal) => {
    const [items, nextStatus, documentItems, analysisItems] = await Promise.all([
      workspaceRequest<WorkspaceItem[]>('grants', identity, undefined, 'GET', signal),
      workspaceRequest<WorkspaceRecord>('status', identity, undefined, 'GET', signal),
      workspaceRequest<WorkspaceItem[]>('documents', identity, undefined, 'GET', signal),
      workspaceRequest<WorkspaceItem[]>('analysis', identity, undefined, 'GET', signal),
    ]);
    if (!signal?.aborted && active.current) {
      setGrants(items.filter(item => !item.revoked)); setStatus(nextStatus); setDocuments(documentItems); setAnalyses(analysisItems);
    }
  }, [identity]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      const scopeKey = nativeScope.current;
      nativeScope.current = null;
      if (scopeKey) void window.electronAPI?.workspaceOperation?.({ action: 'revoke', scopeKey,
        agentId: identity.agent_id, sessionId: identity.session_id, labels }).catch(() => undefined);
    };
  }, [native, identity, labels]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void reload(controller.signal).catch(() => { if (!controller.signal.aborted) setError(t('agent_workbench.operation_failed')); });
    return () => { controller.abort(); };
  }, [open, reload, t]);
  useEffect(() => {
    if (!open || !window.electronAPI?.workspaceOperation) return;
    const polling = { stopped: false, inFlight: false };
    const controller = new AbortController();
    const poll = async () => {
      if (polling.inFlight || polling.stopped) return;
      polling.inFlight = true;
      try {
        const items = await workspaceRequest<WorkspaceItem[]>('native', identity, undefined, 'GET', controller.signal);
        controller.signal.throwIfAborted();
        setNativeRequests(items);
        // A single claimed request is never automatically replayed after a disconnect.
        for (const item of items.filter(item => item.status === 'pending')) {
          controller.signal.throwIfAborted();
          const claimed = await workspaceRequest<WorkspaceItem>(`native/${encodeURIComponent(item.id)}/claim`, identity, {}, 'POST', controller.signal);
          controller.signal.throwIfAborted();
          let result: WorkspaceRecord;
          try { result = await native(claimed.operation as WorkspaceRecord); }
          catch { result = { error: 'native_operation_failed_or_declined' }; }
          await workspaceRequest(`native/${encodeURIComponent(item.id)}/complete`, identity,
            { lease: claimed.lease, result });
        }
      } catch { /* Unavailable connections are retried; claimed operations are not. */ }
      finally { polling.inFlight = false; }
    };
    void poll(); const timer = setInterval(() => { void poll(); }, 2000);
    return () => { polling.stopped = true; controller.abort(); clearInterval(timer); };
  }, [open, identity, native]);
  const addFolder = () => perform(async () => {
    const selection = await native({ action: 'pick-folder' });
    if (selection.canceled) return;
    await workspaceRequest('grants', identity, { path: selection.path, selection_token: selection.selection_token });
    await reload();
  });
  const revokeFolder = (id: string) => perform(async () => {
    await workspaceRequest(`grants/${encodeURIComponent(id)}`, identity, undefined, 'DELETE'); await reload();
  });
  return { grants, status, documents, analyses, nativeRequests, error, busy, perform, reload, addFolder, revokeFolder, native };
}
