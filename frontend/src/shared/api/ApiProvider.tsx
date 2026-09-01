import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from './query-client';


export interface ApiProviderProps {
  readonly children: ReactNode;
}


export function ApiProvider({ children }: ApiProviderProps) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
