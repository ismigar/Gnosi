import React, { useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppSidebar } from './components/AppSidebar';
import HomePage from './pages/HomePage';
import SupportPage from './pages/SupportPage';

// ── Lazily loaded routes (code-splitting) ──────────────────────────
// Every heavy page drags in large libraries (BlockEditor→blocknote/tiptap,
// GraphPage→sigma/graphology, MailPage→react-pdf, CalendarPage→fullcalendar,
// MediaCenter→framer-motion). Importing them with React.lazy takes them out of the bundle
// initial: the browser only downloads the route's chunk when it's navigated to.
// HomePage stays EAGER because it's the most common startup (without a flash of
// Suspense at the start).
const GraphPage = lazy(() => import('./pages/GraphPage'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const SocialDashboard = lazy(() => import('./pages/SocialDashboard'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const VaultDashboard = lazy(() => import('./pages/VaultDashboard'));
const ZoteroReaderPage = lazy(() =>
  import('./components/Vault/ZoteroReaderTab').then((m) => ({ default: m.ZoteroReaderPage })),
);
const ReaderDashboard = lazy(() => import('./pages/ReaderDashboard'));
const MailPage = lazy(() => import('./pages/MailPage'));
const MediaCenter = lazy(() => import('./pages/MediaCenter'));
const ContactsPage = lazy(() => import('./pages/ContactsPage'));
const SchedulerPage = lazy(() => import('./pages/SchedulerPage'));
const ComposerPage = lazy(() => import('./pages/ComposerPage'));
const SharedPage = lazy(() => import('./pages/SharedPage'));
import { Toaster } from './lib/toast';

import AgentChat from './components/AgentChat';
import MeetingReminderWatcher from './components/MeetingReminderWatcher';
import MeetingRecorder from './components/MeetingRecorder';
import PageOutline from './components/PageOutline';
import CommandPalette from './components/CommandPalette';
import { useTheme } from './hooks/useTheme';
import { useFileLinkInterceptor } from './hooks/useFileLinkInterceptor';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './components/Auth/LoginPage';

// Fallback while the chunk for a lazy route is downloading. Discreet and centered,
// reusing the auth bootstrap's style so there's no visual jump.
function RouteFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
      <div className="animate-pulse text-sm">{t('common.loading', 'Carregant…')}</div>
    </div>
  );
}

function App() {
  const { t } = useTranslation();
  const { effectiveTheme } = useTheme();
  const { user, gnosiMode, requireAuth, loading } = useAuth();
  // Captures clicks on file:// everywhere and redirects them to the system shell
  // via the backend, instead of letting Chrome open blank tabs.
  useFileLinkInterceptor();

  useEffect(() => {
    const root = window.document.documentElement;
    if (effectiveTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [effectiveTheme]);

  // Bootstrap: we wait to know the mode and whether there's a session before deciding.
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
        <div className="animate-pulse text-sm">{t('common.loading', 'Carregant…')}</div>
      </div>
    );
  }

  // Publicly shared pages (`/s/:token`): rendered OUTSIDE the
  // the auth gate and the app shell — anyone with the link can access them.
  if (window.location.pathname.startsWith('/s/')) {
    return (
      <>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/s/:token" element={<SharedPage />} />
          </Routes>
        </Suspense>
        <Toaster position="bottom-right" containerStyle={{ zIndex: 100001 }} />
      </>
    );
  }

  if (window.location.pathname === '/support') {
    return <SupportPage />;
  }

  // Gate in org mode, and in personal mode when the backend enforces auth
  // (GNOSI_REQUIRE_AUTH): without it, personal relies on the legacy fallback
  // and the single user goes straight in.
  if ((gnosiMode === 'org' || requireAuth) && !user) {
    return <LoginPage />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] transition-colors duration-300">
      {/* Global sidebar always present */}
      <AppSidebar />

      {/* Contingut principal */}
      <div id="page-content-scroll" className="flex-1 overflow-y-auto overflow-x-hidden bg-[var(--bg-secondary)] transition-colors duration-300">
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/vault/pdf" element={<ZoteroReaderPage />} />
          <Route path="/vault/*" element={<VaultDashboard />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/reader" element={<ReaderDashboard />} />
          <Route path="/mail" element={<MailPage />} />
          <Route path="/scheduler" element={<SchedulerPage />} />
          <Route path="/composer" element={<ComposerPage />} />
          <Route path="/social-dashboard" element={<SocialDashboard />} />
          <Route path="/media" element={<MediaCenter />} />
          <Route path="/contacts" element={<ContactsPage />} />
          {/* Catch-all: a non-existent URL (typo, stale link, route wrongly
              written by code) used to render ONLY the layout with a blank body.
              We redirect to the home page (replace so as not to leave the bad URL in
              the history). */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </div>
      {/* z-index above all modal overlays (GlobalSettingsModal:10000,
          ZoteroMappingModal and AIAgentModal:100000). Without this, toasts
          stayed hidden behind any open modal. */}
      <Toaster position="bottom-right" containerStyle={{ zIndex: 100001 }} />
      <CommandPalette />
      <PageOutline />
      <AgentChat />
      <MeetingReminderWatcher />
      <MeetingRecorder />
    </div>
  );
}

export default App;
