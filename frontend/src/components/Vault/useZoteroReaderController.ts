import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';

import { logError } from '../../lib/notifyError';
import { transportFetch } from '../../shared/api/transports';
import type { DocumentLocationEventDetail } from '../../shared/platform/app-events';
import {
  currentBrowserOrigin,
  openBrowserWindow,
  postWindowMessage,
  subscribeWindowEvent,
} from '../../shared/platform/browser-events';
import {
  fetchPersistedAnnotations,
  persistDeleteAnnotations,
  persistSaveAnnotations,
  type AnnotationPersistenceState,
} from './zoteroReaderPersistence';
import {
  isUnknownArray,
  isUnknownRecord,
  toFilesystemPath,
  type ZoteroAnnotation,
} from './zoteroReaderModel';

interface ZoteroReaderControllerOptions {
  readonly direction: 'ltr' | 'rtl';
  readonly kind: string;
  readonly language: string;
  readonly location: DocumentLocationEventDetail | null;
  readonly noSourceMessage: string;
  readonly rawSrc: string;
}

interface SourceValue<T> {
  readonly source: string;
  readonly value: T;
}

export interface ZoteroReaderController {
  readonly error: string | null;
  readonly iframeRef: RefObject<HTMLIFrameElement | null>;
  readonly openExternal: () => Promise<void>;
  readonly readerReady: boolean;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'number' || typeof error === 'boolean') return String(error);
  return 'Unknown error';
}

async function registerLocalFile(rawSrc: string): Promise<string> {
  const response = await transportFetch('/api/vault/local-file/register', {
    body: JSON.stringify({ file_path: toFilesystemPath(rawSrc) }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Could not open the PDF: ${detail || `HTTP ${String(response.status)}`}`);
  }
  const data: unknown = await response.json();
  if (!isUnknownRecord(data) || typeof data.url !== 'string') {
    throw new Error('Could not open the PDF: invalid registration response');
  }
  return data.url;
}

export async function openReaderDocumentExternally(rawSrc: string): Promise<void> {
  const filePath = toFilesystemPath(rawSrc);
  if (!filePath) return;
  const response = await transportFetch('/api/vault/open-local-path', {
    body: JSON.stringify({ path: `file://${filePath}` }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
}

export function useZoteroReaderController({
  direction,
  kind,
  language,
  location,
  noSourceMessage,
  rawSrc,
}: ZoteroReaderControllerOptions): ZoteroReaderController {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hostReadyRef = useRef(false);
  const initSentRef = useRef(false);
  const locationRef = useRef<DocumentLocationEventDetail | null>(location);
  const annotationsRef = useRef<ZoteroAnnotation[]>([]);
  const idMapRef = useRef(new Map<string, number>());
  const persistenceState = useMemo<AnnotationPersistenceState>(() => ({
    annotations: annotationsRef,
    idMap: idMapRef,
  }), []);
  const [registration, setRegistration] = useState<SourceValue<{
    readonly error: string | null;
    readonly url: string | null;
  }> | null>(null);
  const [annotationsSource, setAnnotationsSource] = useState<string | null>(null);
  const [readySource, setReadySource] = useState<string | null>(null);
  const [readerError, setReaderError] = useState<SourceValue<string> | null>(null);
  const isServed = /^https?:\/\//i.test(rawSrc) || rawSrc.startsWith('/api/');
  const pdfUrl = isServed
    ? rawSrc
    : registration?.source === rawSrc ? registration.value.url : null;
  const annotationsLoaded = Boolean(rawSrc) && annotationsSource === rawSrc;
  const readerReady = Boolean(rawSrc) && readySource === rawSrc;
  const error = !rawSrc
    ? noSourceMessage
    : readerError?.source === rawSrc
      ? readerError.value
      : registration?.source === rawSrc ? registration.value.error : null;

  const postToReader = useCallback((message: Readonly<Record<string, unknown>>) => {
    const iframeWindow = iframeRef.current?.contentWindow;
    if (iframeWindow) postWindowMessage(iframeWindow, message, currentBrowserOrigin());
  }, []);

  const loadAnnotations = useCallback((signal?: AbortSignal) => (
    fetchPersistedAnnotations(rawSrc, signal, persistenceState)
  ), [persistenceState, rawSrc]);

  const saveAnnotations = useCallback(async (values: readonly unknown[]) => {
    await persistSaveAnnotations(values, rawSrc, persistenceState, postToReader);
  }, [persistenceState, postToReader, rawSrc]);

  const deleteAnnotations = useCallback(async (values: readonly unknown[]) => {
    await persistDeleteAnnotations(values, persistenceState);
  }, [persistenceState]);

  useEffect(() => {
    if (!rawSrc || isServed) return;
    let cancelled = false;
    void registerLocalFile(rawSrc)
      .then((url) => {
        if (!cancelled) setRegistration({ source: rawSrc, value: { error: null, url } });
      })
      .catch((registrationError: unknown) => {
        if (!cancelled) {
          setRegistration({
            source: rawSrc,
            value: { error: errorMessage(registrationError), url: null },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isServed, rawSrc]);

  useEffect(() => {
    annotationsRef.current = [];
    idMapRef.current = new Map();
    initSentRef.current = false;
    if (!rawSrc) return;
    const controller = new AbortController();
    void loadAnnotations(controller.signal)
      .catch((loadError: unknown) => {
        if (!isAbortError(loadError)) logError('zotero-reader.load-annotations', loadError);
      })
      .finally(() => {
        if (!controller.signal.aborted) setAnnotationsSource(rawSrc);
      });
    return () => {
      controller.abort();
    };
  }, [loadAnnotations, rawSrc]);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  const sendInitIfReady = useCallback(() => {
    if (
      initSentRef.current
      || !hostReadyRef.current
      || !pdfUrl
      || !annotationsLoaded
    ) return;
    const iframeWindow = iframeRef.current?.contentWindow;
    if (!iframeWindow) return;
    initSentRef.current = true;
    postWindowMessage(iframeWindow, {
      payload: {
        annotations: annotationsRef.current,
        direction,
        kind,
        language,
        location: locationRef.current,
        options: { authorName: 'User', readOnly: false },
        pdfUrl,
      },
      target: 'zotero-reader',
      type: 'init',
    }, currentBrowserOrigin());
  }, [annotationsLoaded, direction, kind, language, pdfUrl]);

  useEffect(() => {
    sendInitIfReady();
  }, [sendInitIfReady]);

  useEffect(() => {
    if (!location || !readerReady) return;
    const iframeWindow = iframeRef.current?.contentWindow;
    if (!iframeWindow) return;
    postWindowMessage(iframeWindow, {
      location,
      target: 'zotero-reader',
      type: 'navigate',
    }, currentBrowserOrigin());
    const controller = new AbortController();
    void loadAnnotations(controller.signal)
      .then((annotations) => {
        if (controller.signal.aborted || !annotations) return;
        postWindowMessage(iframeWindow, {
          annotations,
          target: 'zotero-reader',
          type: 'set-annotations',
        }, currentBrowserOrigin());
      })
      .catch((refreshError: unknown) => {
        if (!isAbortError(refreshError)) {
          logError('zotero-reader.refresh-annotations', refreshError);
        }
      });
    return () => {
      controller.abort();
    };
  }, [loadAnnotations, location, readerReady]);

  useEffect(() => subscribeWindowEvent('message', (event) => {
    if (event.origin !== currentBrowserOrigin()) return;
    if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
    if (!isUnknownRecord(event.data) || event.data.source !== 'zotero-reader') return;
    const messageType = event.data.type;
    if (messageType === 'host-ready') {
      hostReadyRef.current = true;
      sendInitIfReady();
    } else if (messageType === 'ready') {
      setReadySource(rawSrc);
    } else if (messageType === 'error') {
      setReaderError({
        source: rawSrc,
        value: typeof event.data.message === 'string' ? event.data.message : 'Reader error',
      });
    } else if (messageType === 'save-annotations') {
      void saveAnnotations(isUnknownArray(event.data.annotations) ? event.data.annotations : []);
    } else if (messageType === 'delete-annotations') {
      void deleteAnnotations(isUnknownArray(event.data.ids) ? event.data.ids : []);
    } else if (messageType === 'open-link' && typeof event.data.url === 'string') {
      openBrowserWindow(event.data.url, '_blank', 'noopener,noreferrer');
    }
  }), [deleteAnnotations, rawSrc, saveAnnotations, sendInitIfReady]);

  const openExternal = useCallback(
    () => openReaderDocumentExternally(rawSrc),
    [rawSrc],
  );

  return {
    error,
    iframeRef,
    openExternal,
    readerReady,
  };
}
