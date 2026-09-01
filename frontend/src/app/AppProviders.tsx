import { StrictMode, type PropsWithChildren } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../features/auth/context/AuthProvider';
import { ApiProvider } from '../shared/api/ApiProvider';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <StrictMode>
      <ApiProvider>
        <BrowserRouter>
          <AuthProvider>{children}</AuthProvider>
        </BrowserRouter>
      </ApiProvider>
    </StrictMode>
  );
}
