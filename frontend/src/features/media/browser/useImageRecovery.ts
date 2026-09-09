import {useEffect, useState} from 'react';
import {transportFetch} from '../../../shared/api/transports';

const MAX_RECOVERY_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

function retryDelay(response: Response): number {
  const value = response.headers.get('Retry-After');
  if (!value) return 3000;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(1000, delay) : 3000;
}

/** Recover only images the browser has tried to display, preserving lazy loading. */
export function useImageRecovery(src: string) {
  const [request, setRequest] = useState(0);
  const [phase, setPhase] = useState<'initial' | 'pending' | 'ready' | 'failed'>('initial');
  const [recoveredSrc, setRecoveredSrc] = useState<string>();
  const [retryReady, setRetryReady] = useState(true);

  useEffect(() => {
    if (request === 0) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requestTimer: ReturnType<typeof setTimeout> | undefined;
    let objectUrl: string | undefined;
    let polls = 0;
    const fail = () => {
      if (!controller.signal.aborted) setPhase('failed');
    };
    const deadline = setTimeout(() => {
      fail();
      controller.abort();
      clearTimeout(timer);
      clearTimeout(requestTimer);
    }, MAX_RECOVERY_MS);

    const recover = async () => {
      requestTimer = setTimeout(() => {
        fail();
        controller.abort();
        clearTimeout(deadline);
      }, REQUEST_TIMEOUT_MS);
      try {
        const response = await transportFetch(src, {signal: controller.signal, cache: 'no-cache'});
        controller.signal.throwIfAborted();
        if (response.ok) {
          const blob = await response.blob();
          controller.signal.throwIfAborted();
          objectUrl = URL.createObjectURL(blob);
          setRecoveredSrc(objectUrl);
          setPhase('ready');
          clearTimeout(deadline);
          return;
        }
        await response.body?.cancel();
        const availability = response.headers.get('X-Gnosi-File-Availability');
        if (response.status === 503 && availability === 'failed') {
          setRetryReady(false);
          timer = setTimeout(() => {setRetryReady(true);}, retryDelay(response));
          clearTimeout(deadline);
          fail();
          return;
        }
        if (response.status === 503 && (availability === 'pending' || response.headers.has('Retry-After'))) {
          // A queued file may wait longer than the provider's active-download
          // timeout. Respect Retry-After and reduce polling while it remains queued.
          polls += 1;
          timer = setTimeout(() => {void recover();}, Math.max(retryDelay(response), Math.min(10_000, polls * 3000)));
          return;
        }
        clearTimeout(deadline);
        fail();
      } catch {
        clearTimeout(deadline);
        fail();
      } finally {
        clearTimeout(requestTimer);
      }
    };
    void recover();
    return () => {
      controller.abort();
      clearTimeout(deadline);
      clearTimeout(timer);
      clearTimeout(requestTimer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [request, src]);

  return {
    phase,
    recoveredSrc,
    retryReady,
    recover: () => {
      setPhase('pending');
      setRetryReady(true);
      setRequest(value => value + 1);
    },
    onError: () => {
      if (phase === 'initial') {
        setPhase('pending');
        setRequest(value => value + 1);
      } else if (phase === 'ready') {
        // The server returned bytes but the browser cannot decode an image.
        setPhase('failed');
      }
    },
  };
}
