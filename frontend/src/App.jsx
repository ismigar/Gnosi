import React, { useEffect, useLayoutEffect, useMemo, useState, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppSidebar } from './components/AppSidebar';
import HomePage from './pages/HomePage';

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
const ProjectPlanningPage = lazy(() => import('./pages/ProjectPlanningPage'));
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
import { GraphLoadingState } from './components/GraphLoadingState';
import { DesktopUpdateNotice } from './components/DesktopUpdateNotice';
import { vaultAgentContextRefs } from './lib/vaultAgentContext';

// Fallback while the chunk for a lazy route is downloading. Discreet and centered,
// reusing the auth bootstrap's style so there's no visual jump.
function RouteFallback() {
  const { t } = useTranslation();
  const location = useLocation();

  if (location.pathname === '/graph') {
    return <GraphLoadingState />;
  }

  return (
    <div className="gnosi-route-skeleton" role="status" aria-live="polite">
      <div className="gnosi-route-skeleton__header">
        <span className="gnosi-skeleton gnosi-route-skeleton__title" />
        <span className="gnosi-skeleton gnosi-route-skeleton__action" />
      </div>
      <div className="gnosi-route-skeleton__body">
        <span className="gnosi-skeleton gnosi-route-skeleton__panel" />
        <span className="gnosi-skeleton gnosi-route-skeleton__content" />
      </div>
      <span className="sr-only">{t('common.loading', "Loading...")}</span>
    </div>
  );
}

function App() {
  const { t } = useTranslation();
  const location = useLocation();
  const { effectiveTheme } = useTheme();
  const { user, gnosiMode, requireAuth, loading } = useAuth();
  const [moduleContextOverride, setModuleContextOverride] = useState(null);
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

  useEffect(() => {
    const pageScroller = document.getElementById('page-content-scroll');
    if (pageScroller) pageScroller.scrollTop = 0;
  }, [location.pathname]);

  const defaultModuleContextRefs = useMemo(() => {
    const byRoute = {
      '/reader': [{ id: 'route-reader', type: 'internal', ref: 'reader', label: t('reader_title'), scope: { unread_only: false, read_status: 'all', source_ids: [] } }],
      '/mail': [{ id: 'route-mail', type: 'internal', ref: 'mail', label: t('sidebar.mail', 'Mail'), scope: {} }],
      '/calendar': [{ id: 'route-calendar', type: 'internal', ref: 'calendar', label: t('sidebar.calendar', 'Calendars'), scope: {} }],
      '/contacts': [{ id: 'route-contacts', type: 'internal', ref: 'contacts', label: t('sidebar.contacts', 'Contacts'), scope: {} }],
    };
    if (location.pathname.startsWith('/vault')) return vaultAgentContextRefs();
    return byRoute[location.pathname] || [];
  }, [location.pathname, t]);
  const moduleContextRefs = moduleContextOverride?.locationKey === location.key
    ? moduleContextOverride.refs
    : defaultModuleContextRefs;

  useLayoutEffect(() => {
    const updateModuleContext = (event) => {
      if (Array.isArray(event.detail)) {
        setModuleContextOverride({ locationKey: location.key, refs: event.detail });
      }
    };
    // VaultDashboard publishes its initial context from a passive effect. Install
    // the parent listener during the layout phase so that first event cannot race
    // ahead and leave the assistant with only the broad route fallback.
    window.addEventListener('gnosi:module-context', updateModuleContext);
    return () => window.removeEventListener('gnosi:module-context', updateModuleContext);
  }, [location.key]);

  // Bootstrap: we wait to know the mode and whether there's a session before deciding.
  if (loading) {
    if (location.pathname === '/graph') {
      return <GraphLoadingState />;
    }

    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
        <div className="animate-pulse text-sm">{t('common.loading', "Loading...")}</div>
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
        <Toaster position="bottom-right" containerStyle={{ zIndex: 'var(--z-toast)' }} />
      </>
    );
  }

  // Gate in org mode, and in personal mode when the backend enforces auth
  // (GNOSI_REQUIRE_AUTH): without it, personal relies on the legacy fallback
  // and the single user goes straight in.
  if ((gnosiMode === 'org' || requireAuth) && !user) {
    return <LoginPage />;
  }

  return (
    <div className="gnosi-app-shell">
      {/* Global sidebar always present */}
      <AppSidebar />

      {/* Contingut principal */}
      <div id="page-content-scroll" className="gnosi-app-content">
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
          <Route path="/planning" element={<ProjectPlanningPage />} />
          {/* Catch-all: a non-existent URL (typo, stale link, route wrongly
              written by code) used to render ONLY the layout with a blank body.
              We redirect to the home page (replace so as not to leave the bad URL in
              the history). */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </div>
      {/* Toasts use the registered global notification layer. */}
      <Toaster position="bottom-right" containerStyle={{ zIndex: 'var(--z-toast)' }} />
      <DesktopUpdateNotice />
      <CommandPalette />
      <PageOutline />
      <AgentChat storageIdentity={user?.id || 'personal'} contextRefs={moduleContextRefs} />
      <MeetingReminderWatcher />
      <MeetingRecorder />
    </div>
  );
}

export default App;
