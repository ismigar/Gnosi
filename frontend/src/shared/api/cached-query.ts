import type { QueryKey } from '@tanstack/react-query';

import { queryClient } from './query-client';

interface CachedQueryOptions<T> {
  readonly queryKey: QueryKey;
  readonly queryFn: (signal: AbortSignal) => Promise<T>;
  readonly signal?: AbortSignal;
  readonly staleTime?: number;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function respectCallerAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

export function fetchCachedQuery<T>({
  queryKey,
  queryFn,
  signal,
  staleTime = 15_000,
}: CachedQueryOptions<T>): Promise<T> {
  const sharedPromise = queryClient.query({
    queryFn: ({ signal: sharedSignal }) => queryFn(sharedSignal),
    queryKey,
    staleTime,
  });
  return respectCallerAbort(sharedPromise, signal);
}

export async function invalidateCachedQuery(queryKey: QueryKey): Promise<void> {
  await queryClient.invalidateQueries({ exact: true, queryKey });
}
