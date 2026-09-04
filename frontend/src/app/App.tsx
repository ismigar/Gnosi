import { ApplicationRoutes, SharedRoutes } from './routes';
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppSidebar } from './navigation/AppSidebar';
import { NotebookCreateDialog } from '../features/notebooks';
import { MeetingRecorder, MeetingReminderWatcher } from '../features/meetings';

import { Toaster } from '../shared/notifications/toast';
import { AgentChatLauncher } from '../features/agent/AgentChatLauncher';

import PageOutline from './outline/PageOutline';
import CommandPalette from './navigation/CommandPalette';
import { useTheme } from '../shared/hooks/useTheme';
import { useFileLinkInterceptor } from './integration/useFileLinkInterceptor';
import { useFocusModality } from '../shared/hooks/useFocusModality';
import { useAuth } from '../shared/auth/auth-context';
import { LoginPage } from '../features/auth';
import { GraphLoadingState } from '../shared/ui/loading/GraphLoadingState';
import { DesktopUpdateNotice } from './desktop/DesktopUpdateNotice';
import { vaultAgentContextRefs } from '../features/agent-context/model/vaultAgentContext';
import { PluginSurface } from '../shared/plugins/PluginGate';
import { usePlugins } from '../shared/plugins/usePlugins';
import {
  subscribeAppEvent,
  type ModuleContextRef,
} from '../shared/platform/app-events';
import {
  vaultAppFromPath,
  vaultPath,
} from '../shared/routing/vaultRouting';

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

interface ModuleContextOverride {
  readonly locationKey: string;
  readonly refs: readonly ModuleContextRef[];
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
        <SharedRoutes />
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
        <ApplicationRoutes />
      </main>
      {/* Toasts use the registered global notification layer. */}
      <Toaster position="bottom-right" containerStyle={{ zIndex: 'var(--z-toast)' }} />
      <DesktopUpdateNotice />
      <CommandPalette />
      <PageOutline key={`outline-${String(vaultRevision)}`} />
      <PluginSurface pluginIds="ai-platform">
        {vaultAppFromPath(location.pathname) !== 'notebooks' && (
          <AgentChatLauncher key={`chat-${String(vaultRevision)}`} storageIdentity={user?.id || 'personal'} contextRefs={moduleContextRefs} />
        )}
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
