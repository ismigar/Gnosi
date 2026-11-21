import { startChatStream } from '../../../shared/api/chat-streaming';
import { readNdjsonRecords } from '../../../shared/api/ndjson';
import { logError } from '../../../shared/notifications/notifyError';
import { recordValue } from '../model/agentChatMessageTypes';
import { boundedProcessingMs } from '../model/agentChatMessageUtils';
import { selectedMentionsInText } from '../model/agentChatMentionUtils';
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
  const entryScope = `${browserStorageScope}:${selectedAgentId}:${sessionId}`;
  if (activeScopeRef.current !== entryScope) return;
  if (readOnly || (!inputValue.trim() && attachments.length === 0) || isLoading || !agentHasModel) return;

  const turnId = context.queuedTurnId || crypto.randomUUID();
  let successful = false;
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
    const cancelId = crypto.randomUUID();
    activeStreamRef.current = `request-${cancelId}`;
    const response = await startChatStream({
      message: inputValue, agent_id: selectedAgentId, profile_id: context.profileId, session_id: sessionId,
      llm_mode: 'agent_default', mentions, attachments: attachmentsPayload,
      context_refs: [...contextRefs], notebook_id: notebookId || undefined, turn_id: turnId, cancel_id: cancelId,
    }, ownedController.signal);
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const error: unknown = await response.json();
        const payloadDetail = recordValue(error, 'detail');
        const code = recordValue(payloadDetail, 'code');
        if (code === 'agent_model_unavailable') {
          detail = t('chat.agent_model_unavailable', 'The selected agent model is unavailable. Configure the agent and try again.');
        } else if (typeof code === 'string' && ['agent_command_unknown', 'agent_command_duplicate', 'agent_command_unavailable', 'agent_command_request_required', 'agent_command_invalid'].includes(code)) {
          detail = t(`agent_commands.${code}`);
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
      if (ownedController.signal.aborted || requestAbortRef.current !== ownedController || activeScopeRef.current !== requestScope) return;
      try {
        applyChatStreamEvent(streamState, data, streamContext);
      }
      catch (error) { logError('chat.stream.event', error); }
    }
    if (!streamState.terminal && streamState.streamId) throw new Error(t('chat.empty_response', 'The connection closed before the response was complete.'));
    successful = streamState.terminal && streamState.responseReceived && !streamState.failed;
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
      try { recovered = await recoverChatStream(streamState, streamContext, { signal: ownedController?.signal }); }
      catch (resumeError) { if (!ownedController?.signal.aborted) logChatError('agent-chat-stream-resume', resumeError); }
    }
    successful = recovered && !streamState.failed;
    if (!aborted && !ownedController?.signal.aborted && !recovered && !streamState.responseReceived && activeScopeRef.current === requestScope) {
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
    await context.onOutcome?.(successful);
    const elapsedMs = boundedProcessingMs(performance.now() - processingStartedAt);
    setMessages(previous => {
      if (activeScopeRef.current !== requestScope) return previous;
      const responseIndex = lastTurnResponseIndex(previous, turnId);
      if (responseIndex < 0) return previous;
      return previous.map((message, index) => index !== responseIndex ? message : {
        ...message, processingMs: message.processingMs ?? elapsedMs,
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
