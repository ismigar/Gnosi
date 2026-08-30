import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import HomePage from '../pages/HomePage';
import { GraphLoadingState } from '../components/GraphLoadingState';
import { PluginRoute } from '../components/PluginGate';
import { activateVaultSlug, getActiveVaultSlug, legacyBrowserPathToCanonical, vaultAppFromPath } from '../lib/vaultRouting';

// ── Lazily loaded routes (code-splitting) ──────────────────────────
// Every heavy page drags in large libraries (BlockEditor→blocknote/tiptap,
// GraphPage→sigma/graphology, MailPage→react-pdf, CalendarPage→fullcalendar,
// MediaCenter→framer-motion). Importing them with React.lazy takes them out of the bundle
// initial: the browser only downloads the route's chunk when it's navigated to.
// HomePage stays EAGER because it's the most common startup (without a flash of
// Suspense at the start).
const GraphPage = lazy(() => import('../pages/GraphPage'));
const Dashboard = lazy(() => import('../pages/Dashboard'));
const SocialDashboard = lazy(() => import('../pages/SocialDashboard'));
const CalendarPage = lazy(() => import('../pages/CalendarPage'));
const VaultDashboard = lazy(() => import('../pages/VaultDashboard'));
const ZoteroReaderPage = lazy(() =>
  import('../components/Vault/ZoteroReaderTab').then((m) => ({ default: m.ZoteroReaderPage })),
);
const ReaderDashboard = lazy(() => import('../pages/ReaderDashboard'));
const MailPage = lazy(() => import('../pages/MailPage'));
const MediaCenter = lazy(() => import('../pages/MediaCenter'));
const ContactsPage = lazy(() => import('../pages/ContactsPage'));
const SchedulerPage = lazy(() => import('../pages/SchedulerPage'));
const ComposerPage = lazy(() => import('../pages/ComposerPage'));
const SharedPage = lazy(() => import('../pages/SharedPage'));
const ProjectPlanningPage = lazy(() => import('../pages/ProjectPlanningPage'));
const LiteraturePage = lazy(() => import('../pages/LiteraturePage'));
const NotebooksPage = lazy(() => import('../pages/NotebooksPage'));
interface VaultRouteScopeProps {
  readonly children: ReactNode;
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

export function SharedRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/s/:token" element={<SharedPage />} />
          </Routes>
        </Suspense>
  );
}

export function ApplicationRoutes() {
  return (
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
  );
}
