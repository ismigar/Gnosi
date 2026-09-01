import { cancelChatAction, confirmChatAction, fetchChatConfirmationStatus, type ConfirmationPayload } from '../../../shared/api/chat-confirmations';
import { logChatError as logError } from './chatDiagnostics';
import { confirmationRequest, localizedConfirmationError, partialConfirmationMessage, recoveredConfirmationMessage, withConfirmationStatus, type ConfirmationActionContext } from './confirmationState';

export async function confirmPendingAction(context: ConfirmationActionContext): Promise<void> {
  const { pendingConfirmation: confirmation, setPendingConfirmation, activeScopeRef, setMessages, t } = context;
  if (!confirmation?.confirmation_id) return;
  const { scope, requestScope } = confirmationRequest(confirmation, context);
  const updateStatus = (status: string) => { setMessages((previous) => withConfirmationStatus(previous, confirmation.confirmation_id, status)); };
  let response;
  try {
    response = await confirmChatAction(confirmation.confirmation_id, scope);
  } catch (error) {
    logError('agent-chat-confirm', error);
    let recovered: ConfirmationPayload | null = null;
    try { recovered = await fetchChatConfirmationStatus(confirmation.confirmation_id, scope); }
    catch (statusError) { logError('agent-chat-confirm-reconcile', statusError); }
    setPendingConfirmation(null);
    if (activeScopeRef.current !== requestScope) return;
    const status = recovered?.status || 'outcome_unknown';
    updateStatus(status);
    setMessages((previous) => [...previous, { role: 'system', content: recoveredConfirmationMessage(status, recovered, t) }]);
    return;
  }
  const { payload } = response;
  if (!response.ok) {
    let authoritative = payload;
    try { authoritative = await fetchChatConfirmationStatus(confirmation.confirmation_id, scope) || payload; }
    catch (statusError) { logError('agent-chat-confirm-failed-reconcile', statusError); }
    setPendingConfirmation(null);
    if (activeScopeRef.current !== requestScope) return;
    const status = authoritative.status || (payload.detail.code === 'confirmation_outcome_unknown' ? 'outcome_unknown' : 'failed');
    updateStatus(status);
    const fallback = response.statusText || t('chat.confirmations.errors.confirmation_action_failed', 'The action could not be completed.');
    setMessages((previous) => [...previous, { role: 'system', content: localizedConfirmationError(payload, fallback, t) }]);
    return;
  }
  const status = payload.status || 'completed';
  setPendingConfirmation(null);
  if (activeScopeRef.current !== requestScope) return;
  updateStatus(status);
  setMessages((previous) => [...previous, { role: 'system', content: status === 'partial' ? partialConfirmationMessage(payload, t) : t('chat.confirmations.completed', 'Action completed after confirmation.') }]);
}

export async function cancelPendingAction(context: ConfirmationActionContext): Promise<void> {
  const { pendingConfirmation: confirmation, setPendingConfirmation, activeScopeRef, setMessages } = context;
  setPendingConfirmation(null);
  if (!confirmation?.confirmation_id) return;
  const { scope, requestScope } = confirmationRequest(confirmation, context);
  const updateStatus = (status: string) => { setMessages((previous) => withConfirmationStatus(previous, confirmation.confirmation_id, status)); };
  try {
    const ok = await cancelChatAction(confirmation.confirmation_id, scope);
    if (activeScopeRef.current !== requestScope) return;
    let status = ok ? 'cancelled' : 'pending';
    if (!ok) {
      try { status = (await fetchChatConfirmationStatus(confirmation.confirmation_id, scope))?.status || status; }
      catch (statusError) { logError('agent-chat-cancel-reconcile', statusError); }
    }
    if (activeScopeRef.current !== requestScope) return;
    updateStatus(status);
  } catch (error) {
    logError('agent-chat-cancel', error);
    if (activeScopeRef.current !== requestScope) return;
    let status = 'pending';
    try { status = (await fetchChatConfirmationStatus(confirmation.confirmation_id, scope))?.status || status; }
    catch (statusError) { logError('agent-chat-cancel-pending-reconcile', statusError); }
    if (activeScopeRef.current !== requestScope) return;
    updateStatus(status);
  }
}
