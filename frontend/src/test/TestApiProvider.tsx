import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';


export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        enabled: false,
        gcTime: Infinity,
        retry: false,
      },
    },
  });
}


interface TestApiProviderProps {
  readonly children: ReactNode;
  readonly client?: QueryClient;
}


export function TestApiProvider({
  children,
  client = createTestQueryClient(),
}: TestApiProviderProps) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
