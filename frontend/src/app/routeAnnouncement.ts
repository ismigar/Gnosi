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

// Keep legacy prefix fallbacks after the canonical app lookup. All other
// recognized legacy routes already resolve to the same app label.
export function routeAnnouncementLabel(path: string, app: string): readonly [string, string] {
  return APP_ANNOUNCEMENT_LABELS[app]
    ?? (path.startsWith('/vault') ? APP_ANNOUNCEMENT_LABELS.knowledge
      : path.startsWith('/notebooks') ? APP_ANNOUNCEMENT_LABELS.notebooks
      : path === '/dashboard' ? ['sidebar.nav_dashboard', 'Dashboard'] : undefined)
    ?? ['fs_picker.home', 'Home'];
}
