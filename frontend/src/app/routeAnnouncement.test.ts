import { describe, expect, it } from 'vitest';
import { vaultAppFromPath } from '../shared/routing/vaultRouting';
import { routeAnnouncementLabel } from './routeAnnouncement';

describe('route announcements', () => {
  it.each([
    ['/', 'fs_picker.home', 'Home'],
    ['/vault/table/one', 'sidebar.nav_vault', 'Knowledge'],
    ['/vault-legacy', 'sidebar.nav_vault', 'Knowledge'],
    ['/notebooks/one', 'sidebar.nav_notebooks', 'Notebooks'],
    ['/notebooks-legacy', 'sidebar.nav_notebooks', 'Notebooks'],
    ['/graph', 'sidebar.nav_graph', 'Graph'],
    ['/contacts', 'sidebar.nav_contacts', 'Contacts'],
    ['/mail/inbox', 'sidebar.nav_mail', 'Mail'],
    ['/calendar', 'sidebar.nav_calendar', 'Calendar'],
    ['/reader', 'sidebar.nav_reader', 'Reader'],
    ['/social-dashboard', 'sidebar.nav_social', 'Social'],
    ['/composer', 'sidebar.nav_social', 'Social'],
    ['/media', 'sidebar.nav_media', 'Photos'],
    ['/planning', 'sidebar.nav_planning', 'Planning'],
    ['/literature', 'sidebar.nav_literature', 'Literature Search'],
    ['/dashboard', 'sidebar.nav_dashboard', 'Dashboard'],
    ['/scheduler', 'scheduler.title', 'Scheduler'],
    ['/@principal/knowledge/page/one', 'sidebar.nav_vault', 'Knowledge'],
    ['/@principal/automations', 'scheduler.title', 'Scheduler'],
    ['/@principal/social', 'sidebar.nav_social', 'Social'],
    ['/@principal/websites', 'fs_picker.home', 'Home'],
    ['/unknown', 'fs_picker.home', 'Home'],
    ['/dashboard/unknown', 'fs_picker.home', 'Home'],
  ])('preserves the accessible label for %s', (path, key, fallback) => {
    expect(routeAnnouncementLabel(path, vaultAppFromPath(path))).toEqual([key, fallback]);
  });
});
