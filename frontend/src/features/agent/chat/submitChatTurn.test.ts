import { createInstance } from 'i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { startChatStream } from '../../../shared/api/chat-streaming';
import type { recoverChatStream } from './recoverChatStream';
import { chatTurnFixture, pendingResponse, streamResponse } from './chatTurnTestFixture';
import { submitChatTurn } from './submitChatTurn';

const api = vi.hoisted(() => ({ start: vi.fn<typeof startChatStream>(), recover: vi.fn<typeof recoverChatStream>(), log: vi.fn(), diagnostic: vi.fn() }));
vi.mock('../../../shared/api/chat-streaming', () => ({ startChatStream: api.start }));
vi.mock('./recoverChatStream', () => ({ recoverChatStream: api.recover }));
vi.mock('../../../shared/notifications/notifyError', () => ({ logError: api.log }));
vi.mock('./chatDiagnostics', () => ({ logChatError: api.diagnostic }));
const locale = createInstance();
beforeAll(async () => { await locale.init({ lng: 'en', fallbackLng: 'en', resources: {}, interpolation: { escapeValue: false } }); });
beforeEach(() => { vi.resetAllMocks(); });
const done = [{ type: 'message', content: 'answer' }, { type: 'done' }];

function interruptedStream(): Response {
  let opened = false;
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (opened) { controller.error(new Error('connection lost')); return; }
    opened = true;
    controller.enqueue(new TextEncoder().encode('{"type":"stream_open","sequence":1,"stream_id":"stream"}\n'));
  } }));
}

describe('typed chat submission', () => {
  it.each([{ readOnly: true }, { inputValue: '  ' }, { isLoading: true }, { agentHasModel: false }])('keeps the draft and makes no request when blocked: %j', async overrides => {
    const f = chatTurnFixture(locale.t, overrides); await submitChatTurn(f.context);
    expect(api.start).not.toHaveBeenCalled(); expect(f.messages()).toEqual([]);
    expect(f.context.clearDraftAttachments).not.toHaveBeenCalled(); expect(f.context.setIsLoading).not.toHaveBeenCalled();
  });
  it('preserves the exact request, visible mentions and attachment shape, without internal ids', async () => {
    const f = chatTurnFixture(locale.t, {
      inputValue: 'ask @Page ', notebookId: 'notebook',
      selectedMentions: [{ id: 'p', label: 'Page', type: 'page', token: '@Page' }, { id: 'hidden', label: 'Other', type: 'page', token: '@Other' }],
      contextRefs: Object.freeze([{ id: 'p', ref: 'page:p', type: 'page' }]),
      attachments: [{ id: 'upload', name: 'document.txt', size: 4, type: 'text/plain', path: null, url: '/fixture/file' }],
    });
    api.start.mockResolvedValueOnce(streamResponse(done)); await submitChatTurn(f.context);
    expect(api.start).toHaveBeenCalledTimes(1);
    const request = api.start.mock.calls[0]?.[0];
    expect(request?.context_refs).not.toBe(f.context.contextRefs);
    expect(request?.context_refs).toEqual(f.context.contextRefs);
    expect(typeof request?.turn_id).toBe('string');
    expect(request).toEqual({ message: 'ask @Page ', agent_id: 'agent', session_id: 'session', llm_mode: 'agent_default', notebook_id: 'notebook', turn_id: request?.turn_id, mentions: [{ id: 'p', type: 'page', label: 'Page' }], context_refs: [{ id: 'p', ref: 'page:p', type: 'page' }], attachments: [{ name: 'document.txt', size: 4, type: 'text/plain', path: null, url: '/fixture/file' }] });
    expect(f.messages()[0]).toMatchObject({ content: 'ask @Page ', role: 'user', turnId: request?.turn_id, mentions: request?.mentions, attachments: request?.attachments });
    expect(f.messages()[1]).toMatchObject({ role: 'assistant', content: 'answer' });
    expect(typeof f.messages()[1]?.processingMs).toBe('number');
    expect(f.context.setInputValue).toHaveBeenCalledWith(''); expect(f.context.clearDraftMentions).toHaveBeenCalledOnce(); expect(f.context.clearDraftAttachments).toHaveBeenCalledOnce();
    expect(f.context.setShowMentionMenu).toHaveBeenCalledWith(false);
    expect(f.context.setIsLoading).toHaveBeenNthCalledWith(1, true); expect(f.context.setIsLoading).toHaveBeenLastCalledWith(false);
    expect(f.context.requestAbortRef.current).toBeNull(); expect(f.context.processingStartedAtRef.current).toBeNull(); expect(f.input.style.height).toBe('auto');
  });
  it('allows an attachment-only turn, keeping raw whitespace in the wire request', async () => {
    const f = chatTurnFixture(locale.t, { inputValue: ' ', attachments: [{ id: 'file', name: 'a.txt', size: 1, type: 'text/plain', path: '/fixture/a', url: null }] });
    api.start.mockResolvedValueOnce(streamResponse(done)); await submitChatTurn(f.context);
    expect(f.messages()[0]?.content).toBe('(Attachments)'); expect(api.start.mock.calls[0]?.[0].message).toBe(' ');
  });
  it.each([
    [JSON.stringify({ detail: { code: 'agent_model_unavailable' } }), 'The selected agent model is unavailable. Configure the agent and try again.'],
    [JSON.stringify({ detail: 'specific failure' }), 'specific failure'],
    ['not JSON', 'Unavailable'],
  ])('preserves HTTP error details: %s', async (body, expected) => {
    const f = chatTurnFixture(locale.t); api.start.mockResolvedValueOnce(new Response(body, { status: 503, statusText: 'Unavailable' }));
    await submitChatTurn(f.context);
    expect(f.messages()[1]).toMatchObject({ content: `Error: ${expected}`, errorCode: 'network_error', retryable: true, recovery: { automatic: false, max_attempts: 1 } });
    expect(api.recover).not.toHaveBeenCalled();
  });
  it('tolerates malformed records, and adds a scoped diagnostic when no answer arrives', async () => {
    const f = chatTurnFixture(locale.t); api.start.mockResolvedValueOnce(new Response('invalid\n{"type":"done"}\n'));
    await submitChatTurn(f.context); expect(api.log).toHaveBeenCalledWith('chat.stream.record', expect.any(Error));
    expect(f.messages()[1]).toMatchObject({ role: 'system', content: 'Error: The assistant finished without returning a response. Please try again.' });
  });
  it('records final metrics on the last response without overwriting response-specific transparency', async () => {
    const f = chatTurnFixture(locale.t); api.start.mockResolvedValueOnce(streamResponse([
      { type: 'message', content: 'answer', explanation: { evidence_count: 2 } },
      { type: 'turn_metrics', total_ms: 2400, explanation: { evidence_count: 9 } }, { type: 'done' },
    ])); await submitChatTurn(f.context);
    expect(f.messages()[1]).toMatchObject({ timings: { total_ms: 2400 }, explanation: { evidence_count: 2 } });
    expect(typeof f.messages()[1]?.processingMs).toBe('number');
    expect(f.messages()[0]?.processingMs).toBeUndefined();
  });
  it('does not display an error or recover when deliberately aborted', async () => {
    const f = chatTurnFixture(locale.t); api.start.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    await submitChatTurn(f.context); expect(f.messages()).toHaveLength(1); expect(api.recover).not.toHaveBeenCalled(); expect(f.context.setIsLoading).toHaveBeenLastCalledWith(false);
  });
  it('handles unknown thrown values without crashing the error path', async () => {
    const f = chatTurnFixture(locale.t); api.start.mockRejectedValueOnce(null); await submitChatTurn(f.context);
    expect(f.messages()[1]?.content).toBe('Error: Unknown error');
  });
  it('discards a late response after the conversation changes', async () => {
    const f = chatTurnFixture(locale.t); const pending = pendingResponse(); api.start.mockReturnValueOnce(pending.promise);
    const operation = submitChatTurn(f.context); f.context.activeScopeRef.current = 'another'; pending.resolve(streamResponse(done));
    await operation; expect(f.messages()).toHaveLength(1); expect(api.recover).not.toHaveBeenCalled();
  });
  it('recovers an interrupted stream without another submission or an extra error bubble', async () => {
    const f = chatTurnFixture(locale.t); api.start.mockResolvedValueOnce(interruptedStream());
    api.recover.mockImplementationOnce((_state, context) => {
      context.setMessages(previous => [...previous, { content: 'recovered', role: 'assistant', turnId: context.turnId }]);
      return Promise.resolve(true);
    });
    await submitChatTurn(f.context); expect(api.start).toHaveBeenCalledOnce(); expect(api.recover).toHaveBeenCalledOnce();
    expect(f.messages()).toHaveLength(2); expect(f.messages()[1]?.content).toBe('recovered');
    expect(typeof f.messages()[1]?.processingMs).toBe('number');
  });
  it('retains the original transport error and local diagnostics when recovery fails', async () => {
    const f = chatTurnFixture(locale.t); api.start.mockResolvedValueOnce(interruptedStream());
    const failure = new Error('replay unavailable'); api.recover.mockRejectedValueOnce(failure);
    await submitChatTurn(f.context); expect(api.start).toHaveBeenCalledOnce();
    expect(api.diagnostic).toHaveBeenCalledWith('agent-chat-stream-resume', failure);
    expect(f.messages()[1]).toMatchObject({ content: 'Error: connection lost', retryable: true });
  });
  it('suppresses the fallback error when the scope changes during recovery', async () => {
    const f = chatTurnFixture(locale.t); api.start.mockResolvedValueOnce(interruptedStream());
    api.recover.mockImplementationOnce(() => { f.context.activeScopeRef.current = 'other'; return Promise.resolve(false); });
    await submitChatTurn(f.context); expect(f.messages()).toHaveLength(1);
  });
  it('does not clear a newer request when the aborted previous request finishes later', async () => {
    const f = chatTurnFixture(locale.t); const first = pendingResponse(); const second = pendingResponse();
    api.start.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const older = submitChatTurn(f.context); const olderController = f.context.requestAbortRef.current;
    const newer = submitChatTurn({ ...f.context, inputValue: 'new question' });
    const newerController = f.context.requestAbortRef.current; const newerStart = f.context.processingStartedAtRef.current;
    expect(olderController?.signal.aborted).toBe(true); expect(newerController).not.toBe(olderController);
    f.context.activeStreamRef.current = 'new-stream'; first.reject(new DOMException('Aborted', 'AbortError')); await older;
    expect(f.context.requestAbortRef.current).toBe(newerController); expect(f.context.activeStreamRef.current).toBe('new-stream');
    expect(f.context.processingStartedAtRef.current).toBe(newerStart); expect(f.context.setIsLoading).not.toHaveBeenCalledWith(false); expect(f.input.style.height).toBe('120px');
    second.resolve(streamResponse(done)); await newer; expect(f.context.requestAbortRef.current).toBeNull(); expect(f.context.setIsLoading).toHaveBeenLastCalledWith(false);
  });
  it('never applies late runtime or stream events to the superseding request', async () => {
    const f = chatTurnFixture(locale.t); const first = pendingResponse(); const second = pendingResponse();
    api.start.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const older = submitChatTurn(f.context); const newer = submitChatTurn({ ...f.context, inputValue: 'new question' });
    f.context.activeStreamRef.current = 'new-stream';
    first.resolve(streamResponse([{ type: 'stream_open', stream_id: 'stale-stream' }, { type: 'agent_runtime', provider: 'stale' }, ...done]));
    await older; expect(f.context.activeStreamRef.current).toBe('new-stream'); expect(f.context.setAgentRuntime).not.toHaveBeenCalled(); expect(f.messages()).toHaveLength(2);
    second.resolve(streamResponse(done)); await newer;
  });
});
