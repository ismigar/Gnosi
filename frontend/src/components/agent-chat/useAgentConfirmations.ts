import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { mergeConfirmationRecords, startConfirmationRefresh } from '../agentConfirmationUtils';
import { fetchChatConfirmations } from '../../shared/api/chat-confirmations';
import { logError } from '../../lib/notifyError';
import { confirmPendingAction, cancelPendingAction } from './confirmationActions';
import type { AgentConfirmation } from './confirmationModel';
import type { ConfirmationActionContext } from './confirmationState';

type Options = Omit<ConfirmationActionContext, 't'> & { readonly scopeReady: boolean };

export function useAgentConfirmations(options: Options) {
  const { browserStorageScope, scopeReady, selectedAgentId, sessionId, activeScopeRef, setMessages } = options;
  const { t } = useTranslation();
  const confirmationTitle = useCallback((confirmation: AgentConfirmation) => t(confirmation.title_key || 'chat.confirmations.title', 'Confirm action', confirmation.details ?? {}), [t]);
  const confirmationSummary = useCallback((confirmation: AgentConfirmation) => t(confirmation.summary_key || 'chat.confirmations.summary', 'Review this action before continuing.', confirmation.details ?? {}), [t]);

  useEffect(() => {
    if (!scopeReady || !selectedAgentId || !sessionId) return;
    const requestScope = `${browserStorageScope}:${selectedAgentId}:${sessionId}`;
    const controller = new AbortController();
    let inFlight = false;
    const refresh = () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      void fetchChatConfirmations({ agent_id: selectedAgentId, session_id: sessionId }, controller.signal)
        .then((confirmations) => {
          if (!confirmations || controller.signal.aborted || activeScopeRef.current !== requestScope) return;
          const records = confirmations.map((item) => ({ ...item, client_scope: requestScope, agent_id: selectedAgentId, session_id: sessionId }));
          setMessages((previous) => mergeConfirmationRecords(previous, records, confirmationSummary));
        })
        .catch((error: unknown) => {
          if (!(error instanceof Error && error.name === 'AbortError')) logError('agent-chat-confirmations-refresh', error);
        })
        .finally(() => { inFlight = false; });
    };
    const stop = startConfirmationRefresh(refresh, window.setInterval.bind(window), window.clearInterval.bind(window));
    return () => { stop(); controller.abort(); };
  }, [activeScopeRef, browserStorageScope, confirmationSummary, scopeReady, selectedAgentId, sessionId, setMessages]);

  return {
    confirmationTitle,
    confirmationSummary,
    confirmPendingAction: () => confirmPendingAction({ ...options, t }),
    cancelPendingAction: () => cancelPendingAction({ ...options, t }),
  };
}
