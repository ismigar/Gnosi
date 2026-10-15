import { StrictMode, type PropsWithChildren } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { AuthProvider } from '../features/auth/context/AuthProvider';
import { ApiProvider } from '../shared/api/ApiProvider';
import { isPublicTokenPath } from '../shared/routing/publicRoutes';

function RoutedSessionProvider({ children }: PropsWithChildren) {
  const location = useLocation();
  return isPublicTokenPath(location.pathname) ? children : <AuthProvider>{children}</AuthProvider>;
}

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <StrictMode>
      <ApiProvider>
        <BrowserRouter>
          <RoutedSessionProvider>{children}</RoutedSessionProvider>
        </BrowserRouter>
      </ApiProvider>
    </StrictMode>
  );
}
