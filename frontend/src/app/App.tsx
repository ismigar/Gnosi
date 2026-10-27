import { ApplicationRoutes, SharedRoutes } from './routes';
import { routeAnnouncementLabel } from './routeAnnouncement';
import { isPublicTokenPath } from '../shared/routing/publicRoutes';
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
import { ResourceProcessingMonitor } from '../features/literature';
import { NotebookCreateDialog } from '../features/notebooks';
import { MeetingRecorder, MeetingReminderWatcher } from '../features/meetings';

import { Toaster } from '../shared/notifications/toast';
import { AgentChatLauncher } from '../features/agent/AgentChatLauncher';

import PageOutline from './outline/PageOutline';
import CommandPalette from './navigation/CommandPalette';
import { useTheme } from '../shared/hooks/useTheme';
import { useFileLinkInterceptor } from './integration/useFileLinkInterceptor';
import { useFocusModality } from '../shared/hooks/useFocusModality';
import { useAppKeyboardScroll } from '../shared/hooks/useAppKeyboardScroll';
import { useAuth, type AuthContextValue } from '../shared/auth/auth-context';
import { LoginPage } from '../features/auth';
import { GraphLoadingState } from '../shared/ui/loading/GraphLoadingState';
import { DesktopUpdateNotice } from './desktop/DesktopUpdateNotice';
import { vaultAgentContextRefs } from '../features/agent-context/model/vaultAgentContext';
import { PluginSurface } from '../shared/plugins/PluginGate';
import { usePlugins } from '../shared/plugins/usePlugins';
import { PluginLoadingState } from '../shared/plugins/PluginLoadingState';
import {
  subscribeAppEvent,
  type ModuleContextRef,
} from '../shared/platform/app-events';
import {
  vaultAppFromPath,
  vaultPath,
} from '../shared/routing/vaultRouting';

interface ModuleContextOverride {
  readonly locationKey: string;
  readonly refs: readonly ModuleContextRef[];
}

function SessionRecoveryScreen({ recovery }: {
  readonly recovery: NonNullable<AuthContextValue['sessionRecovery']>;
}) {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState(false);
  const [failed, setFailed] = useState(false);
  const recover = async () => {
    if (retrying) return;
    setRetrying(true);
    setFailed(false);
    try {
      await recovery.recover();
    } catch {
      setFailed(true);
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-primary)]">
      <section className="flex max-w-lg flex-col items-center gap-4 px-6 text-center"
        aria-labelledby="session-recovery-title">
        <h1 id="session-recovery-title" className="text-xl font-semibold">
          {t('auth.session_recovery_title', 'This session is no longer valid')}
        </h1>
        <p>{t('auth.session_recovery_description', 'Clear this session and reload Gnosi to continue.')}</p>
        {failed && <p role="alert">{t('auth.session_recovery_error', 'The session could not be cleared. Please try again.')}</p>}
        <button type="button" className="btn-gnosi btn-gnosi-primary"
          disabled={retrying} aria-busy={retrying} onClick={() => { void recover(); }}>
          {retrying ? t('common.loading', 'Loading...') : t('auth.session_recovery_action', 'Clear session and retry')}
        </button>
      </section>
    </div>
  );
}

function ApplicationShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { effectiveTheme } = useTheme();
  const { user, gnosiMode, requireAuth, loading, sessionRecovery } = useAuth();
  const pluginState = usePlugins();
  const [moduleContextOverride, setModuleContextOverride] = useState<ModuleContextOverride | null>(null);
  const [bulkNotebookResources, setBulkNotebookResources] = useState<readonly string[] | null>(null);
  const [vaultRevision, setVaultRevision] = useState(0);
  const mainContentRef = useRef<HTMLElement | null>(null);
  useAppKeyboardScroll(mainContentRef, location.key);
  const routeAnnouncement = useMemo(() => {
    const label = routeAnnouncementLabel(location.pathname, vaultAppFromPath(location.pathname));
    return t('accessibility.route_loaded', '{{page}} loaded', {
      page: t(label[0], label[1]),
    });
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

  if (sessionRecovery) return <SessionRecoveryScreen recovery={sessionRecovery} />;

  // An explicit server denial is fresher than the startup health snapshot.
  // Otherwise preserve the normal organization/personal authentication gate.
  if (pluginState.authenticationRequired || ((gnosiMode === 'org' || requireAuth) && !user)) {
    return <LoginPage />;
  }

  // Optional surfaces are part of the shell contract. Wait for the active
  // Vault's explicit state so an old Vault can never flash a feature that is
  // disabled in the new one.
  if (!pluginState.loaded) return <PluginLoadingState state={pluginState} fullPage />;

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
      <ResourceProcessingMonitor key={`processing-${String(vaultRevision)}-${user?.id || 'personal'}`} />
      <DesktopUpdateNotice />
      <CommandPalette />
      <PageOutline key={`outline-${String(vaultRevision)}`} />
      <PluginSurface pluginIds="ai-platform">
        {vaultAppFromPath(location.pathname) !== 'notebooks' && (
          <AgentChatLauncher key={`chat-${String(vaultRevision)}`} storageIdentity={user?.id || 'personal'} contextRefs={moduleContextRefs} />
        )}
      </PluginSurface>
      <PluginSurface pluginIds="grounded-notebooks">
        {bulkNotebookResources !== null && (
          <Suspense fallback={null}>
            <NotebookCreateDialog
              key={`notebook-dialog-${String(vaultRevision)}`}
              isOpen
              initialResourceIds={bulkNotebookResources}
              onClose={() => { setBulkNotebookResources(null); }}
              onCreated={(notebook) => { void navigate(vaultPath('notebooks', notebook.id)); }}
            />
          </Suspense>
        )}
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

export default function App() {
  const location = useLocation();
  if (isPublicTokenPath(location.pathname)) {
    return <><SharedRoutes /><Toaster position="bottom-right" /></>;
  }
  return <ApplicationShell />;
}
