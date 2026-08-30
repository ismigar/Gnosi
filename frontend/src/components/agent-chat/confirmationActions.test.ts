import { createInstance } from 'i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelPendingAction, confirmPendingAction } from './confirmationActions';
import { mergeLiveConfirmationRecords, withConfirmationStatus, type ConfirmationActionContext, type ConfirmationConversation } from './confirmationState';
import { mergeConfirmationRecords, type ConfirmationRecord } from '../agentConfirmationUtils';
import type { AgentConfirmation } from './confirmationModel';
import type { cancelChatAction, confirmChatAction, fetchChatConfirmationStatus } from '../../shared/api/chat-confirmations';

const api = vi.hoisted(() => ({
  confirm: vi.fn<typeof confirmChatAction>(),
  cancel: vi.fn<typeof cancelChatAction>(),
  status: vi.fn<typeof fetchChatConfirmationStatus>(),
}));
vi.mock('../../shared/api/chat-confirmations', () => ({ confirmChatAction: api.confirm, cancelChatAction: api.cancel, fetchChatConfirmationStatus: api.status }));
vi.mock('../../lib/notifyError', () => ({ logError: vi.fn(), notifyError: vi.fn() }));
const i18n = createInstance();
beforeAll(async () => { await i18n.init({ lng: 'en', fallbackLng: 'en', resources: {} }); });
beforeEach(() => { vi.resetAllMocks(); });

function setup() {
  const confirmation: AgentConfirmation = { confirmation_id: 'action', agent_id: 'origin-agent', session_id: 'origin-session', client_scope: 'vault:workspace:user:origin-agent:origin-session', details: { body: 'private' }, status: 'pending', destructive: true };
  let messages: ConfirmationConversation = [{ role: 'assistant', content: 'review', confirmation, preserved: 'metadata' }];
  let pending: AgentConfirmation | null = confirmation;
  const context: ConfirmationActionContext = {
    browserStorageScope: 'vault:workspace:user', selectedAgentId: 'different-agent', sessionId: 'different-session',
    activeScopeRef: { current: confirmation.client_scope ?? '' },
    pendingConfirmation: confirmation, t: i18n.t,
    setMessages: (update) => { messages = typeof update === 'function' ? update(messages) : update; },
    setPendingConfirmation: (update) => { pending = typeof update === 'function' ? update(pending) : update; },
  };
  return { context, messages: () => messages, pending: () => pending };
}

describe('confirmation execution reconciliation', () => {
  it('merges live confirmations exactly like the legacy contract without losing metadata or long content', () => {
    const untouched = { content: 'full'.repeat(6000), llm: { model: 'fixture' }, opaque: { kept: true } };
    const messages: ConfirmationConversation = [untouched, { role: 'assistant', content: 'old', confirmation: { confirmation_id: 'a', details: { before: 'private' } }, extra: 'kept' }];
    const records: AgentConfirmation[] = [{ confirmation_id: 'a', status: 'pending', details: { before: 'private', after: 'changed' } }, { confirmation_id: 'b', status: 'pending' }];
    const summary = (record: ConfirmationRecord) => `Review ${record.confirmation_id}`;
    const result = mergeLiveConfirmationRecords(messages, records, summary);
    expect(result).toEqual(mergeConfirmationRecords<ConfirmationRecord>(messages, records, summary));
    expect(result[0]).toBe(untouched); expect(result[0]?.content).toHaveLength(24000);
    expect(result[1]).toMatchObject({ extra: 'kept', confirmation: { details: { before: 'private', after: 'changed' } } });
    expect(result[2]).toMatchObject({ content: 'Review b', role: 'assistant' });
  });
  it('executes once in the originating scope and scrubs terminal review details', async () => {
    api.confirm.mockResolvedValue({ ok: true, statusText: '', payload: { detail: {}, result: {}, status: 'completed' } });
    const state = setup();
    await confirmPendingAction(state.context);
    expect(api.confirm).toHaveBeenCalledExactlyOnceWith('action', { agent_id: 'origin-agent', session_id: 'origin-session' });
    expect(api.status).not.toHaveBeenCalled();
    expect(state.pending()).toBeNull();
    expect(state.messages()[0]).toMatchObject({ preserved: 'metadata', confirmation: { status: 'completed', destructive: false, details: {} } });
    expect(state.messages()[1]?.content).toBe('Action completed after confirmation.');
  });

  it.each(['completed', 'partial', 'outcome_unknown', 'expired'])('reconciles a lost execution response as %s without replaying it', async (status) => {
    api.confirm.mockRejectedValue(new Error('lost response'));
    api.status.mockResolvedValue({ status, detail: {}, result: { updated_count: 2, rollback_failed_ids: ['one'] } });
    const state = setup();
    await confirmPendingAction(state.context);
    expect(api.confirm).toHaveBeenCalledOnce();
    expect(api.status).toHaveBeenCalledExactlyOnceWith('action', { agent_id: 'origin-agent', session_id: 'origin-session' });
    expect(state.messages()[0]?.confirmation?.status).toBe(status);
    const message = state.messages()[1]?.content;
    if (status === 'partial') expect(message).toContain('2 completed, 1 failed');
    if (status === 'outcome_unknown') expect(message).toContain('Check the target before trying again');
  });

  it('reports uncertainty when neither execution nor status can be observed', async () => {
    api.confirm.mockRejectedValue(new Error('offline'));
    api.status.mockRejectedValue(new Error('offline'));
    const state = setup();
    await confirmPendingAction(state.context);
    expect(state.messages()[0]?.confirmation?.status).toBe('outcome_unknown');
    expect(state.messages()[1]?.content).toContain('outcome is unknown');
    expect(api.confirm).toHaveBeenCalledOnce();
  });

  it('reconciles an HTTP failure while preserving its localized error message', async () => {
    api.confirm.mockResolvedValue({ ok: false, statusText: 'Conflict', payload: { detail: { code: 'confirmation_outcome_unknown' }, result: {} } });
    api.status.mockResolvedValue({ status: 'completed', detail: {}, result: {} });
    const state = setup();
    await confirmPendingAction(state.context);
    expect(state.messages()[0]?.confirmation?.status).toBe('completed');
    expect(state.messages()[1]?.content).toBe('Conflict');
  });

  it('preserves partial success counts and defaults a missing success status to completed', async () => {
    const state = setup();
    api.confirm.mockResolvedValueOnce({ ok: true, statusText: '', payload: { status: 'partial', detail: {}, result: { purged_count: 3, failed_count: 1 } } });
    await confirmPendingAction(state.context);
    expect(state.messages()[1]?.content).toContain('3 completed, 1 failed');
    api.confirm.mockResolvedValueOnce({ ok: true, statusText: '', payload: { detail: {}, result: {} } });
    const next = setup();
    await confirmPendingAction(next.context);
    expect(next.messages()[0]?.confirmation?.status).toBe('completed');
  });

  it('does not add completion to a newly selected scope', async () => {
    const state = setup();
    api.confirm.mockImplementation(() => {
      state.context.activeScopeRef.current = 'another-scope';
      return Promise.resolve({ ok: true, statusText: '', payload: { detail: {}, result: {} } });
    });
    await confirmPendingAction(state.context);
    expect(state.messages()).toHaveLength(1);
    expect(state.messages()[0]?.confirmation?.status).toBe('pending');
  });
});

describe('confirmation cancellation', () => {
  it('closes the review and cancels only once', async () => {
    api.cancel.mockResolvedValue(true);
    const state = setup();
    await cancelPendingAction(state.context);
    expect(state.pending()).toBeNull();
    expect(api.cancel).toHaveBeenCalledExactlyOnceWith('action', { agent_id: 'origin-agent', session_id: 'origin-session' });
    expect(state.messages()[0]?.confirmation?.status).toBe('cancelled');
  });

  it.each(['http', 'network'])('uses authoritative status after a %s cancellation failure', async (failure) => {
    if (failure === 'http') api.cancel.mockResolvedValue(false);
    else api.cancel.mockRejectedValue(new Error('offline'));
    api.status.mockResolvedValue({ status: 'completed', detail: {}, result: {} });
    const state = setup();
    await cancelPendingAction(state.context);
    expect(api.cancel).toHaveBeenCalledOnce();
    expect(state.messages()[0]?.confirmation?.status).toBe('completed');
  });

  it('keeps a pending action reviewable if neither cancellation nor reconciliation succeeds', async () => {
    api.cancel.mockRejectedValue(new Error('offline'));
    api.status.mockRejectedValue(new Error('offline'));
    const state = setup();
    await cancelPendingAction(state.context);
    expect(state.messages()[0]?.confirmation).toMatchObject({ status: 'pending', details: { body: 'private' } });
  });

  it('discards reconciliation after the active scope changes', async () => {
    api.cancel.mockResolvedValue(false);
    const state = setup();
    api.status.mockImplementation(() => {
      state.context.activeScopeRef.current = 'another-scope';
      return Promise.resolve({ status: 'cancelled', detail: {}, result: {} });
    });
    await cancelPendingAction(state.context);
    expect(state.messages()[0]?.confirmation?.status).toBe('pending');
  });

  it('does not scrub an unrelated card or a nonterminal pending card', () => {
    const state = setup();
    expect(withConfirmationStatus(state.messages(), 'unrelated', 'completed')[0]).toBe(state.messages()[0]);
    expect(withConfirmationStatus(state.messages(), 'action', 'pending')[0]?.confirmation?.details).toEqual({ body: 'private' });
  });
});
