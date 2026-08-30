import { startChatStream } from '../../shared/api/chat-streaming';
import { readNdjsonRecords } from '../../shared/api/ndjson';
import { logError } from '../../lib/notifyError';
import { recordValue } from '../agentChatMessageTypes';
import { boundedProcessingMs } from '../agentChatMessageUtils';
import { selectedMentionsInText } from '../agentChatMentionUtils';
import { applyChatStreamEvent } from './applyChatStreamEvent';
import { logChatError } from './chatDiagnostics';
import type { ChatTurnContext } from './chatTurnTypes';
import { recoverChatStream } from './recoverChatStream';
import { createChatStreamState, lastTurnResponseIndex, type StreamEventContext } from './streamEventModel';

export async function submitChatTurn(context: ChatTurnContext): Promise<void> {
  const {
    t, inputValue, attachments, readOnly, isLoading, agentHasModel, selectedMentions,
    processingStartedAtRef, setMessages, setInputValue, clearDraftMentions,
    clearDraftAttachments, setShowMentionMenu, setIsLoading, setProcessingPhase,
    browserStorageScope, selectedAgentId, sessionId, activeScopeRef, activeStreamRef,
    setAgentRuntime, confirmationSummary, requestAbortRef, contextRefs, notebookId, inputRef,
  } = context;
  if (readOnly || (!inputValue.trim() && attachments.length === 0) || isLoading || !agentHasModel) return;

  const turnId = crypto.randomUUID();
  const processingStartedAt = performance.now();
  processingStartedAtRef.current = processingStartedAt;
  const mentions = selectedMentionsInText(inputValue, selectedMentions);
  const attachmentsPayload = attachments.map(({ name, size, type, path, url }) => ({ name, size, type, path, url }));
  const visibleContent = inputValue.trim() ? inputValue : t('chat.attachments_only_label', '(Attachments)');
  setMessages(previous => [...previous, { role: 'user', content: visibleContent, turnId, mentions, attachments: attachmentsPayload }]);
  setInputValue('');
  clearDraftMentions();
  clearDraftAttachments();
  setShowMentionMenu(false);
  setIsLoading(true);
  setProcessingPhase('routing');
  const requestScope = `${browserStorageScope}:${selectedAgentId}:${sessionId}`;
  const streamState = createChatStreamState();
  const streamContext: StreamEventContext = {
    t, requestScope, agentId: selectedAgentId, sessionId, turnId,
    activeScopeRef, activeStreamRef, setMessages, setAgentRuntime, setProcessingPhase, confirmationSummary,
  };
  let ownedController: AbortController | null = null;
  try {
    requestAbortRef.current?.abort();
    ownedController = new AbortController();
    requestAbortRef.current = ownedController;
    const response = await startChatStream({
      message: inputValue, agent_id: selectedAgentId, session_id: sessionId,
      llm_mode: 'agent_default', mentions, attachments: attachmentsPayload,
      context_refs: contextRefs, notebook_id: notebookId || undefined, turn_id: turnId,
    }, ownedController.signal);
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const error: unknown = await response.json();
        const payloadDetail = recordValue(error, 'detail');
        if (recordValue(payloadDetail, 'code') === 'agent_model_unavailable') {
          detail = t('chat.agent_model_unavailable', 'The selected agent model is unavailable. Configure the agent and try again.');
        } else if (typeof payloadDetail === 'string') {
          detail = payloadDetail || detail;
        }
      } catch {
        // Keep the HTTP status as the fallback for a non-JSON error body.
      }
      throw new Error(detail);
    }
    for await (const data of readNdjsonRecords(response, {
      onMalformed: error => { logError('chat.stream.record', error); },
    })) {
      if (requestAbortRef.current !== ownedController || activeScopeRef.current !== requestScope) return;
      try { applyChatStreamEvent(streamState, data, streamContext); }
      catch (error) { logError('chat.stream.event', error); }
    }
    if (!streamState.terminal || !streamState.responseReceived) {
      setMessages(previous => activeScopeRef.current !== requestScope ? previous : [...previous, {
        role: 'system',
        content: `${t('chat.error_prefix', 'Error')}: ${t('chat.empty_response', 'The assistant finished without returning a response. Please try again.')}`,
        turnId,
      }]);
    }
  } catch (error) {
    const aborted = ownedController?.signal.aborted || recordValue(error, 'name') === 'AbortError';
    let recovered = false;
    if (!aborted && streamState.streamId && activeScopeRef.current === requestScope) {
      try { recovered = await recoverChatStream(streamState, streamContext); }
      catch (resumeError) { logChatError('agent-chat-stream-resume', resumeError); }
    }
    if (!aborted && !recovered && activeScopeRef.current === requestScope) {
      const message = recordValue(error, 'message');
      const errorMessage = typeof message === 'string' ? message.trim() : '';
      setMessages(previous => activeScopeRef.current !== requestScope ? previous : [...previous, {
        role: 'assistant',
        content: `${t('chat.error_prefix', 'Error')}: ${errorMessage || t('errors.unknown', 'Unknown error')}`,
        turnId, errorCode: 'network_error', retryable: true,
        recovery: { retryable: true, action: 'retry_message', automatic: false, max_attempts: 1 },
      }]);
    }
  } finally {
    const elapsedMs = boundedProcessingMs(performance.now() - processingStartedAt);
    setMessages(previous => {
      if (activeScopeRef.current !== requestScope) return previous;
      const responseIndex = lastTurnResponseIndex(previous, turnId);
      if (responseIndex < 0) return previous;
      return previous.map((message, index) => index !== responseIndex ? message : {
        ...message, processingMs: elapsedMs,
        ...(streamState.metrics ? { timings: streamState.metrics } : {}),
        ...Object.fromEntries(Object.entries(streamState.transparency)
          .filter(([field, value]) => value !== null && message[field] == null)),
      });
    });
    // An older aborted request must not clear a newer turn's runtime state.
    if (requestAbortRef.current === ownedController) {
      requestAbortRef.current = null;
      activeStreamRef.current = '';
      processingStartedAtRef.current = null;
      setIsLoading(false);
      setProcessingPhase('routing');
      if (inputRef.current) inputRef.current.style.height = 'auto';
    }
  }
}
