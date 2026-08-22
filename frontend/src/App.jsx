import React, { useEffect, useLayoutEffect, useMemo, useState, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
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
const LiteraturePage = lazy(() => import('./pages/LiteraturePage'));
const NotebooksPage = lazy(() => import('./pages/NotebooksPage'));
const AgentChat = lazy(() => import('./components/AgentChat'));
const MeetingReminderWatcher = lazy(() => import('./components/MeetingReminderWatcher'));
const MeetingRecorder = lazy(() => import('./components/MeetingRecorder'));
const NotebookCreateDialog = lazy(() => import('./components/Notebooks/NotebookCreateDialog'));
import { Toaster } from './lib/toast';

import PageOutline from './components/PageOutline';
import CommandPalette from './components/CommandPalette';
import { useTheme } from './hooks/useTheme';
import { useFileLinkInterceptor } from './hooks/useFileLinkInterceptor';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './components/Auth/LoginPage';
import { GraphLoadingState } from './components/GraphLoadingState';
import { DesktopUpdateNotice } from './components/DesktopUpdateNotice';
import { vaultAgentContextRefs } from './lib/vaultAgentContext';
import { PluginRoute, PluginSurface } from './components/PluginGate';
import { usePlugins } from './plugins/usePlugins';

const ROUTE_ANNOUNCEMENT_LABELS = [
  { match: (path) => path === '/', key: 'fs_picker.home', fallback: 'Home' },
  { match: (path) => path.startsWith('/vault'), key: 'sidebar.nav_vault', fallback: 'Knowledge' },
  { match: (path) => path.startsWith('/notebooks'), key: 'sidebar.nav_notebooks', fallback: 'Notebooks' },
  { match: (path) => path === '/graph', key: 'sidebar.nav_graph', fallback: 'Graph' },
  { match: (path) => path === '/contacts', key: 'sidebar.nav_contacts', fallback: 'Contacts' },
  { match: (path) => path === '/mail', key: 'sidebar.nav_mail', fallback: 'Mail' },
  { match: (path) => path === '/calendar', key: 'sidebar.nav_calendar', fallback: 'Calendar' },
  { match: (path) => path === '/reader', key: 'sidebar.nav_reader', fallback: 'Reader' },
  { match: (path) => path === '/social-dashboard', key: 'sidebar.nav_social', fallback: 'Social' },
  { match: (path) => path === '/media', key: 'sidebar.nav_media', fallback: 'Photos' },
  { match: (path) => path === '/planning', key: 'sidebar.nav_planning', fallback: 'Planning' },
  { match: (path) => path === '/literature', key: 'sidebar.nav_literature', fallback: 'Literature Search' },
  { match: (path) => path === '/dashboard', key: 'sidebar.nav_dashboard', fallback: 'Dashboard' },
  { match: (path) => path === '/scheduler', key: 'scheduler.title', fallback: 'Scheduler' },
  { match: (path) => path === '/composer', key: 'social.composer', fallback: 'Composer' },
];

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
  const navigate = useNavigate();
  const { effectiveTheme } = useTheme();
  const { user, gnosiMode, requireAuth, loading } = useAuth();
  const { loaded: pluginStateLoaded } = usePlugins();
  const [moduleContextOverride, setModuleContextOverride] = useState(null);
  const [bulkNotebookResources, setBulkNotebookResources] = useState(null);
  const [vaultRevision, setVaultRevision] = useState(0);
  const mainContentRef = React.useRef(null);
  const routeAnnouncement = useMemo(() => {
    const route = ROUTE_ANNOUNCEMENT_LABELS.find(({ match }) => match(location.pathname));
    const page = route ? t(route.key, route.fallback) : t('fs_picker.home', 'Home');
    return t('accessibility.route_loaded', '{{page}} loaded', { page });
  }, [location.pathname, t]);
  // Captures clicks on file:// everywhere and redirects them to the system shell
  // via the backend, instead of letting Chrome open blank tabs.
  useFileLinkInterceptor();

  useEffect(() => {
    const handleVaultChanged = () => {
      setModuleContextOverride(null);
      setBulkNotebookResources(null);
      setVaultRevision((revision) => revision + 1);
    };
    window.addEventListener('gnosi:vault-changed', handleVaultChanged);
    return () => window.removeEventListener('gnosi:vault-changed', handleVaultChanged);
  }, []);

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

  const handleSkipToContent = (event) => {
    event.preventDefault();
    mainContentRef.current?.focus({ preventScroll: true });
  };

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

  useEffect(() => {
    const openNotebookCreator = (event) => {
      const resourceIds = Array.isArray(event.detail?.resourceIds)
        ? event.detail.resourceIds.map(String)
        : [];
      if (resourceIds.length) setBulkNotebookResources(resourceIds);
    };
    window.addEventListener('gnosi:create-notebook', openNotebookCreator);
    return () => window.removeEventListener('gnosi:create-notebook', openNotebookCreator);
  }, []);

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

  // Optional surfaces are part of the shell contract. Wait for the active
  // Vault's explicit state so an old Vault can never flash a feature that is
  // disabled in the new one.
  if (!pluginStateLoaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
        <div className="animate-pulse text-sm">{t('common.loading', "Loading...")}</div>
      </div>
    );
  }

  return (
    <div className="gnosi-app-shell">
      <a
        className="gnosi-skip-link"
        href="#page-content-scroll"
        onClick={handleSkipToContent}
        data-testid="skip-to-content"
      >
        {t('accessibility.skip_to_content', 'Skip to main content')}
      </a>
      {/* Global sidebar always present */}
      <AppSidebar />

      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="route-announcer"
      >
        {routeAnnouncement}
      </p>

      {/* Main product surface */}
      <main
        key={vaultRevision}
        id="page-content-scroll"
        ref={mainContentRef}
        className="gnosi-app-content"
        tabIndex={-1}
      >
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/vault/pdf" element={<ZoteroReaderPage />} />
          <Route path="/vault/*" element={<VaultDashboard />} />
          <Route path="/calendar" element={<PluginRoute pluginId="calendar"><CalendarPage /></PluginRoute>} />
          <Route path="/reader" element={<PluginRoute pluginId="feeds-reader"><ReaderDashboard /></PluginRoute>} />
          <Route path="/mail" element={<PluginRoute pluginId="mail"><MailPage /></PluginRoute>} />
          <Route path="/scheduler" element={<PluginRoute pluginId="automations"><SchedulerPage /></PluginRoute>} />
          <Route path="/composer" element={<PluginRoute pluginId="social-publishing"><ComposerPage /></PluginRoute>} />
          <Route path="/social-dashboard" element={<PluginRoute pluginId="social-publishing"><SocialDashboard /></PluginRoute>} />
          <Route path="/media" element={<PluginRoute pluginId="social-publishing"><MediaCenter /></PluginRoute>} />
          <Route path="/contacts" element={<PluginRoute pluginId="contacts"><ContactsPage /></PluginRoute>} />
          <Route path="/planning" element={<PluginRoute pluginId="project-planning"><ProjectPlanningPage /></PluginRoute>} />
          <Route path="/literature" element={<PluginRoute pluginId="resources"><LiteraturePage /></PluginRoute>} />
          <Route path="/notebooks" element={<PluginRoute pluginId="grounded-notebooks"><NotebooksPage /></PluginRoute>} />
          <Route path="/notebooks/:notebookId" element={<PluginRoute pluginId="grounded-notebooks"><NotebooksPage /></PluginRoute>} />
          {/* Catch-all: a non-existent URL (typo, stale link, route wrongly
              written by code) used to render ONLY the layout with a blank body.
              We redirect to the home page (replace so as not to leave the bad URL in
              the history). */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </main>
      {/* Toasts use the registered global notification layer. */}
      <Toaster position="bottom-right" containerStyle={{ zIndex: 'var(--z-toast)' }} />
      <DesktopUpdateNotice />
      <CommandPalette />
      <PageOutline key={`outline-${vaultRevision}`} />
      <PluginSurface pluginIds="ai-platform">
        <Suspense fallback={null}>
          {!location.pathname.startsWith('/notebooks') && (
            <AgentChat key={`chat-${vaultRevision}`} storageIdentity={user?.id || 'personal'} contextRefs={moduleContextRefs} />
          )}
        </Suspense>
      </PluginSurface>
      <PluginSurface pluginIds="grounded-notebooks">
        <Suspense fallback={null}>
          <NotebookCreateDialog
            key={`notebook-dialog-${vaultRevision}`}
            isOpen={Array.isArray(bulkNotebookResources)}
            initialResourceIds={bulkNotebookResources || []}
            onClose={() => setBulkNotebookResources(null)}
            onCreated={(notebook) => navigate(`/notebooks/${notebook.id}`)}
          />
        </Suspense>
      </PluginSurface>
      <PluginSurface pluginIds={['calendar', 'ai-platform']}>
        <Suspense fallback={null}>
          <MeetingReminderWatcher key={`meeting-reminders-${vaultRevision}`} />
          <MeetingRecorder key={`meeting-recorder-${vaultRevision}`} />
        </Suspense>
      </PluginSurface>
    </div>
  );
}

export default App;
