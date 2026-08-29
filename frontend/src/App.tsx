import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
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
interface AgentChatProps {
  readonly contextRefs?: readonly ModuleContextRef[];
  readonly storageIdentity?: string;
}

const AgentChat = lazy(() => import('./components/AgentChat')) as unknown as ComponentType<AgentChatProps>;
const MeetingReminderWatcher = lazy(() => import('./components/MeetingReminderWatcher'));
const MeetingRecorder = lazy(() => import('./components/MeetingRecorder'));
const NotebookCreateDialog = lazy(() => import('./components/Notebooks/NotebookCreateDialog'));
import { Toaster } from './lib/toast';

import PageOutline from './components/PageOutline';
import CommandPalette from './components/CommandPalette';
import { useTheme } from './hooks/useTheme';
import { useFileLinkInterceptor } from './hooks/useFileLinkInterceptor';
import { useFocusModality } from './hooks/useFocusModality';
import { useAuth } from './context/auth-context';
import { LoginPage } from './components/Auth/LoginPage';
import { GraphLoadingState } from './components/GraphLoadingState';
import { DesktopUpdateNotice } from './components/DesktopUpdateNotice';
import { vaultAgentContextRefs } from './lib/vaultAgentContext';
import { PluginRoute, PluginSurface } from './components/PluginGate';
import { usePlugins } from './plugins/usePlugins';
import {
  subscribeAppEvent,
  type ModuleContextRef,
} from './shared/platform/app-events';
import {
  activateVaultSlug,
  getActiveVaultSlug,
  legacyBrowserPathToCanonical,
  vaultAppFromPath,
  vaultPath,
} from './lib/vaultRouting';

interface RouteAnnouncementLabel {
  readonly fallback: string;
  readonly key: string;
  readonly match: (path: string) => boolean;
}

const ROUTE_ANNOUNCEMENT_LABELS: readonly RouteAnnouncementLabel[] = [
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

const APP_ANNOUNCEMENT_LABELS: Readonly<Record<string, readonly [string, string]>> = {
  knowledge: ['sidebar.nav_vault', 'Knowledge'],
  notebooks: ['sidebar.nav_notebooks', 'Notebooks'],
  graph: ['sidebar.nav_graph', 'Graph'],
  contacts: ['sidebar.nav_contacts', 'Contacts'],
  mail: ['sidebar.nav_mail', 'Mail'],
  calendar: ['sidebar.nav_calendar', 'Calendar'],
  reader: ['sidebar.nav_reader', 'Reader'],
  social: ['sidebar.nav_social', 'Social'],
  media: ['sidebar.nav_media', 'Photos'],
  planning: ['sidebar.nav_planning', 'Planning'],
  resources: ['sidebar.nav_literature', 'Literature Search'],
  automations: ['scheduler.title', 'Scheduler'],
};

interface VaultRouteScopeProps {
  readonly children: ReactNode;
}

interface ModuleContextOverride {
  readonly locationKey: string;
  readonly refs: readonly ModuleContextRef[];
}

function VaultRouteScope({ children }: VaultRouteScopeProps) {
  const { vaultHandle } = useParams();
  const vaultSlug = vaultHandle?.startsWith('@')
    ? decodeURIComponent(vaultHandle.slice(1)).toLowerCase()
    : '';
  const [resolvedSlug, setResolvedSlug] = useState(() => (
    getActiveVaultSlug() === vaultSlug ? vaultSlug : ''
  ));
  const [missingSlug, setMissingSlug] = useState('');

  useEffect(() => {
    let alive = true;
    if (getActiveVaultSlug() === vaultSlug) {
      return () => { alive = false; };
    }
    void activateVaultSlug(vaultSlug)
      .then((vault) => {
        if (!alive) return;
        if (vault) setResolvedSlug(vaultSlug);
        else setMissingSlug(vaultSlug);
      })
      .catch(() => {
        if (alive) setMissingSlug(vaultSlug);
      });
    return () => { alive = false; };
  }, [vaultSlug]);

  const ready = getActiveVaultSlug() === vaultSlug || resolvedSlug === vaultSlug;
  if (!vaultSlug || missingSlug === vaultSlug) return <Navigate to="/" replace />;
  if (!ready) return <RouteFallback />;
  return children;
}

function LegacyVaultRedirect() {
  const location = useLocation();
  const target = legacyBrowserPathToCanonical(location.pathname);
  return <Navigate to={`${target}${location.search}${location.hash}`} replace />;
}

// Fallback while the chunk for a lazy route is downloading. Discreet and centered,
// reusing the auth bootstrap's style so there's no visual jump.
function RouteFallback() {
  const { t } = useTranslation();
  const location = useLocation();

  if (vaultAppFromPath(location.pathname) === 'graph') {
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
  const [moduleContextOverride, setModuleContextOverride] = useState<ModuleContextOverride | null>(null);
  const [bulkNotebookResources, setBulkNotebookResources] = useState<readonly string[] | null>(null);
  const [vaultRevision, setVaultRevision] = useState(0);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const routeAnnouncement = useMemo(() => {
    const app = vaultAppFromPath(location.pathname);
    const appLabel = APP_ANNOUNCEMENT_LABELS[app];
    if (appLabel) {
      return t('accessibility.route_loaded', '{{page}} loaded', {
        page: t(appLabel[0], appLabel[1]),
      });
    }
    const route = ROUTE_ANNOUNCEMENT_LABELS.find(({ match }) => match(location.pathname));
    const page = route ? t(route.key, route.fallback) : t('fs_picker.home', 'Home');
    return t('accessibility.route_loaded', '{{page}} loaded', { page });
  }, [location.pathname, t]);
  // Captures clicks on file:// everywhere and redirects them to the system shell
  // via the backend, instead of letting Chrome open blank tabs.
  useFileLinkInterceptor();
  useFocusModality();

  useEffect(() => {
    return subscribeAppEvent('gnosi:vault-changed', () => {
      setModuleContextOverride(null);
      setBulkNotebookResources(null);
      setVaultRevision((revision) => revision + 1);
    });
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
    const byRoute: Readonly<Record<string, readonly ModuleContextRef[]>> = {
      '/reader': [{ id: 'route-reader', type: 'internal', ref: 'reader', label: t('reader_title'), scope: { unread_only: false, read_status: 'all', source_ids: [] } }],
      '/mail': [{ id: 'route-mail', type: 'internal', ref: 'mail', label: t('sidebar.mail', 'Mail'), scope: {} }],
      '/calendar': [{ id: 'route-calendar', type: 'internal', ref: 'calendar', label: t('sidebar.calendar', 'Calendars'), scope: {} }],
      '/contacts': [{ id: 'route-contacts', type: 'internal', ref: 'contacts', label: t('sidebar.contacts', 'Contacts'), scope: {} }],
    };
    const app = vaultAppFromPath(location.pathname);
    if (app === 'knowledge') return vaultAgentContextRefs();
    const canonicalByApp: Readonly<Record<string, readonly ModuleContextRef[]>> = {
      reader: byRoute['/reader'] ?? [],
      mail: byRoute['/mail'] ?? [],
      calendar: byRoute['/calendar'] ?? [],
      contacts: byRoute['/contacts'] ?? [],
    };
    if (app) return canonicalByApp[app] || [];
    return byRoute[location.pathname] || [];
  }, [location.pathname, t]);
  const moduleContextRefs = moduleContextOverride?.locationKey === location.key
    ? moduleContextOverride.refs
    : defaultModuleContextRefs;

  const handleSkipToContent = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    mainContentRef.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    // VaultDashboard publishes its initial context from a passive effect. Install
    // the parent listener during the layout phase so that first event cannot race
    // ahead and leave the assistant with only the broad route fallback.
    return subscribeAppEvent('gnosi:module-context', (refs) => {
      setModuleContextOverride({ locationKey: location.key, refs });
    });
  }, [location.key]);

  useEffect(() => {
    return subscribeAppEvent('gnosi:create-notebook', ({ resourceIds }) => {
      if (resourceIds.length) setBulkNotebookResources(resourceIds);
    });
  }, []);

  // Bootstrap: we wait to know the mode and whether there's a session before deciding.
  if (loading) {
    if (vaultAppFromPath(location.pathname) === 'graph') {
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
          <Route path="/:vaultHandle/graph/*" element={<VaultRouteScope><GraphPage /></VaultRouteScope>} />
          <Route path="/:vaultHandle/knowledge/document" element={<VaultRouteScope><ZoteroReaderPage /></VaultRouteScope>} />
          <Route path="/:vaultHandle/knowledge/*" element={<VaultRouteScope><VaultDashboard /></VaultRouteScope>} />
          <Route path="/:vaultHandle/calendar/*" element={<VaultRouteScope><PluginRoute pluginId="calendar"><CalendarPage /></PluginRoute></VaultRouteScope>} />
          <Route path="/:vaultHandle/reader/*" element={<VaultRouteScope><PluginRoute pluginId="feeds-reader"><ReaderDashboard /></PluginRoute></VaultRouteScope>} />
          <Route path="/:vaultHandle/mail/*" element={<VaultRouteScope><PluginRoute pluginId="mail"><MailPage /></PluginRoute></VaultRouteScope>} />
          <Route path="/:vaultHandle/automations/*" element={<VaultRouteScope><PluginRoute pluginId="automations"><SchedulerPage /></PluginRoute></VaultRouteScope>} />
          <Route path="/:vaultHandle/social/compose/*" element={<VaultRouteScope><PluginRoute pluginId="social-publishing"><ComposerPage /></PluginRoute></VaultRouteScope>} />
          <Route path="/:vaultHandle/social/*" element={<VaultRouteScope><PluginRoute pluginId="social-publishing"><SocialDashboard /></PluginRoute></VaultRouteScope>} />
          <Route path="/:vaultHandle/media/*" element={<VaultRouteScope><PluginRoute pluginId="social-publishing"><MediaCenter /></PluginRoute></VaultRouteScope>} />
          <Route path="/:vaultHandle/contacts/*" element={<VaultRouteScope><PluginRoute pluginId="contacts"><ContactsPage /></PluginRoute></VaultRouteScope>} />
          <Route path="/:vaultHandle/planning/*" element={<VaultRouteScope><PluginRoute pluginId="project-planning"><ProjectPlanningPage /></PluginRoute></VaultRouteScope>} />
          <Route path="/:vaultHandle/resources/*" element={<VaultRouteScope><PluginRoute pluginId="resources"><LiteraturePage /></PluginRoute></VaultRouteScope>} />
          <Route path="/:vaultHandle/notebooks/:notebookId" element={<VaultRouteScope><PluginRoute pluginId="grounded-notebooks"><NotebooksPage /></PluginRoute></VaultRouteScope>} />
          <Route path="/:vaultHandle/notebooks/*" element={<VaultRouteScope><PluginRoute pluginId="grounded-notebooks"><NotebooksPage /></PluginRoute></VaultRouteScope>} />
          <Route path="/graph" element={<LegacyVaultRedirect />} />
          <Route path="/vault/*" element={<LegacyVaultRedirect />} />
          <Route path="/calendar" element={<LegacyVaultRedirect />} />
          <Route path="/reader" element={<LegacyVaultRedirect />} />
          <Route path="/mail" element={<LegacyVaultRedirect />} />
          <Route path="/scheduler" element={<LegacyVaultRedirect />} />
          <Route path="/composer" element={<LegacyVaultRedirect />} />
          <Route path="/social-dashboard" element={<LegacyVaultRedirect />} />
          <Route path="/media" element={<LegacyVaultRedirect />} />
          <Route path="/contacts" element={<LegacyVaultRedirect />} />
          <Route path="/planning" element={<LegacyVaultRedirect />} />
          <Route path="/literature" element={<LegacyVaultRedirect />} />
          <Route path="/notebooks/*" element={<LegacyVaultRedirect />} />
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
      <PageOutline key={`outline-${String(vaultRevision)}`} />
      <PluginSurface pluginIds="ai-platform">
        <Suspense fallback={null}>
          {vaultAppFromPath(location.pathname) !== 'notebooks' && (
            <AgentChat key={`chat-${String(vaultRevision)}`} storageIdentity={user?.id || 'personal'} contextRefs={moduleContextRefs} />
          )}
        </Suspense>
      </PluginSurface>
      <PluginSurface pluginIds="grounded-notebooks">
        <Suspense fallback={null}>
          <NotebookCreateDialog
            key={`notebook-dialog-${String(vaultRevision)}`}
            isOpen={Array.isArray(bulkNotebookResources)}
            initialResourceIds={bulkNotebookResources || []}
            onClose={() => { setBulkNotebookResources(null); }}
            onCreated={(notebook) => { void navigate(vaultPath('notebooks', notebook.id)); }}
          />
        </Suspense>
      </PluginSurface>
      <PluginSurface pluginIds={['calendar', 'ai-platform']}>
        <Suspense fallback={null}>
          <MeetingReminderWatcher key={`meeting-reminders-${String(vaultRevision)}`} />
          <MeetingRecorder key={`meeting-recorder-${String(vaultRevision)}`} />
        </Suspense>
      </PluginSurface>
    </div>
  );
}

export default App;
