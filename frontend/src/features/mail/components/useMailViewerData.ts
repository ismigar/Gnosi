import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';

import type { MailTagsContextValue } from '../hooks/useMailTags';
import { logError } from '../../../shared/notifications/notifyError';
import { toast } from '../../../shared/notifications/toast';
import { extractMailEntities, type MailAnalysisMetadata } from '../../../shared/api/mail';
import { mailMessageIdentity } from '../mailIdentity';
import { normalizeMailEntities } from './mailViewerModel';
import { useMailReaderContent } from './useMailReaderContent';
import type {
  MailAnalysisStatus,
  MailExtractedEntities,
  MailViewerAccount,
  MailViewerMessage,
} from './mailViewerTypes';


interface MailViewerDataInput {
  readonly account: MailViewerAccount | null;
  readonly mailTags: MailTagsContextValue;
  readonly onMailRead?: (mail: MailViewerMessage) => void;
  readonly selectedMail: MailViewerMessage | null;
  readonly t: TFunction;
}


export function useMailViewerData({
  account, mailTags, onMailRead, selectedMail, t,
}: MailViewerDataInput) {
  const content = useMailReaderContent({ account, onMailRead, selectedMail });
  const [extractedEntities, setExtractedEntities] = useState<MailExtractedEntities | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<MailAnalysisStatus>('idle');
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const analysisRequestRef = useRef(0);
  const analysisRunningRef = useRef(false);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const { getMessageTags } = mailTags;
  const selectedMailIdentity = selectedMail ? mailMessageIdentity(selectedMail, account?.email) : null;
  const extractedEntitiesRef = useRef<MailExtractedEntities | null>(null);
  const scanEntities = useCallback(async (
    context: string,
    metadata: MailAnalysisMetadata = {},
  ): Promise<void> => {
    if (!context || analysisRunningRef.current) return;
    const requestId = ++analysisRequestRef.current;
    const abortController = new AbortController();
    analysisAbortRef.current = abortController;
    analysisRunningRef.current = true;
    setAnalyzing(true);
    setAnalysisStatus('analyzing');
    try {
      const response = await extractMailEntities(
        context,
        metadata,
        abortController.signal,
      );
      if (requestId !== analysisRequestRef.current) return;
      const entities = normalizeMailEntities(response);
      const hasResults = entities.events.length > 0 || entities.contacts.length > 0
        || entities.localAnalysis !== null;
      if (response.error && !hasResults) {
        const status: MailAnalysisStatus = entities.analysisReason
          ?? (response.error === 'not_configured'
            ? 'not_configured'
            : response.error === 'invalid_response'
              ? 'invalid_response'
              : 'temporarily_unavailable');
        setAnalysisStatus(status);
        return;
      }
      if (hasResults) {
        setExtractedEntities(entities);
        extractedEntitiesRef.current = entities;
        setAnalysisStatus('results');
        if (entities.resultSource === 'provider') {
          toast.success(t('mail.smart_suggestions_found', 'Smart suggestions found'));
        }
      } else {
        setAnalysisStatus(entities.analysisReason ?? 'no_entities');
      }
    } catch {
      if (requestId !== analysisRequestRef.current) return;
      if (abortController.signal.aborted) return;
      const previous = extractedEntitiesRef.current;
      setAnalysisStatus(previous ? 'results' : 'temporarily_unavailable');
    } finally {
      if (requestId === analysisRequestRef.current) {
        analysisAbortRef.current = null;
        analysisRunningRef.current = false;
        setAnalyzing(false);
      }
    }
  }, [t]);

  useEffect(() => {
    const id = selectedMail?.id;
    if (!id) {
      queueMicrotask(() => { setActiveTagIds([]); });
      return undefined;
    }
    let cancelled = false;
    void getMessageTags(selectedMail)
      .then((tags) => { if (!cancelled) setActiveTagIds(tags); })
      .catch((error: unknown) => {
        logError('mail-viewer.message-tags', error);
        if (!cancelled) setActiveTagIds([]);
      });
    return () => { cancelled = true; };
  }, [getMessageTags, selectedMail, selectedMail?.id, selectedMailIdentity]);

  useEffect(() => {
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    analysisRequestRef.current += 1;
    analysisRunningRef.current = false;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setAnalyzing(false);
      setAnalysisStatus('idle');
      setExtractedEntities(null);
      extractedEntitiesRef.current = null;
    });
    return () => {
      active = false;
      analysisAbortRef.current?.abort();
    };
  }, [selectedMailIdentity]);

  return {
    ...content,
    activeTagIds,
    analysisStatus,
    analyzing,
    extractedEntities,
    scanEntities,
    setActiveTagIds,
    setExtractedEntities,
  };
}
