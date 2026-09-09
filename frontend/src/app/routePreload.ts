import { vaultAppFromPath } from '../shared/routing/vaultRouting';


// Routes and navigation share these loaders; preloading only fetches modules.
// It never mounts a screen or starts its data requests.
export const applicationRouteLoaders = {
  knowledge: () => import('../features/vault/VaultDashboard'),
  dashboard: () => import('../features/control-center/Dashboard'),
  social: () => import('../features/social/SocialDashboard'),
  composer: () => import('../features/social/ComposerPage'),
  media: () => import('../features/media/MediaCenter'),
  automations: () => import('../features/automations/SchedulerPage'),
  notebooks: () => import('../features/notebooks/NotebooksPage'),
  mail: () => import('../features/mail/MailPage'),
  calendar: () => import('../features/calendar/CalendarPage'),
  graph: () => import('../features/graph/GraphPage'),
  reader: () => import('../features/reader/ReaderDashboard'),
  contacts: () => import('../features/contacts/ContactsPage'),
  resources: () => import('../features/literature/LiteraturePage'),
  planning: () => import('../features/planning/ProjectPlanningPage'),
  document: () => import('../features/reader/zotero/ZoteroReaderTab')
    .then(module => ({ default: module.ZoteroReaderPage })),
};


export async function preloadApplicationRoute(pathname: string): Promise<void> {
  const path = pathname.split(/[?#]/, 1)[0] ?? '';
  const app = vaultAppFromPath(path);
  const key = path === '/dashboard' ? 'dashboard'
    : path === '/vault/pdf' || /^\/@[^/]+\/knowledge\/document\/?$/.test(path) ? 'document'
    : path === '/composer' || /^\/@[^/]+\/social\/compose(?:\/|$)/.test(path) ? 'composer'
    : app;
  if (!Object.hasOwn(applicationRouteLoaders, key)) return;
  try {
    await applicationRouteLoaders[key as keyof typeof applicationRouteLoaders]();
  } catch {
    // Speculative loading must not block startup or produce unhandled errors.
    // React.lazy still owns the actual navigation and its error handling.
  }
}
