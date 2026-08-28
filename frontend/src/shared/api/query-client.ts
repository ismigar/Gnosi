import { QueryClient } from '@tanstack/react-query';

import { GnosiApiError } from './errors';


function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof GnosiApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 2;
}


export const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      retry: false,
    },
    queries: {
      refetchOnWindowFocus: false,
      retry: shouldRetry,
      staleTime: 15_000,
    },
  },
});
