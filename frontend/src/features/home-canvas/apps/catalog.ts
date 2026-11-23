interface OptionalBlockDefinition {
    readonly kind: string;
    readonly titleKey: string;
    readonly appKey: string;
    readonly plugins: readonly string[];
    readonly route: string;
}

export const OPTIONAL_BLOCKS = [
    { kind: 'contacts', titleKey: 'home_canvas.apps.contacts.title', appKey: 'sidebar.nav_contacts', plugins: ['contacts'], route: '/contacts' },
    { kind: 'mail', titleKey: 'home_canvas.apps.mail.title', appKey: 'sidebar.nav_mail', plugins: ['mail'], route: '/mail' },
    { kind: 'feeds', titleKey: 'home_canvas.apps.feeds.title', appKey: 'sidebar.nav_reader', plugins: ['feeds-reader'], route: '/reader' },
    { kind: 'resources', titleKey: 'home_canvas.apps.resources.title', appKey: 'sidebar.nav_literature', plugins: ['resources'], route: '/literature' },
    { kind: 'notebooks', titleKey: 'home_canvas.apps.notebooks.title', appKey: 'sidebar.nav_notebooks', plugins: ['grounded-notebooks'], route: '/notebooks' },
    { kind: 'planning', titleKey: 'home_canvas.apps.planning.title', appKey: 'sidebar.nav_planning', plugins: ['project-planning'], route: '/planning' },
    { kind: 'social', titleKey: 'home_canvas.apps.social.title', appKey: 'sidebar.nav_social', plugins: ['social-publishing'], route: '/social-dashboard/calendar' },
    { kind: 'media', titleKey: 'home_canvas.apps.media.title', appKey: 'sidebar.nav_media', plugins: ['social-publishing'], route: '/media' },
    { kind: 'websites', titleKey: 'home_canvas.apps.websites.title', appKey: 'websites.title', plugins: ['web-publishing'], route: '/websites' },
    { kind: 'automations', titleKey: 'home_canvas.apps.automations.title', appKey: 'settings.plugins.catalog.automations.name', plugins: ['automations'], route: '/scheduler' },
    { kind: 'control', titleKey: 'home_canvas.apps.control.title', appKey: 'home.module_dashboard_title', plugins: [], route: '/dashboard' },
    { kind: 'settings', titleKey: 'home_canvas.apps.settings.title', appKey: 'sidebar.nav_settings', plugins: [], route: '' },
    { kind: 'assistant', titleKey: 'home_canvas.apps.assistant.title', appKey: 'learning.assistant', plugins: ['ai-platform'], route: '' },
    { kind: 'bookmarks', titleKey: 'home_canvas.apps.bookmarks.title', appKey: 'bookmarks.title', plugins: [], route: '/vault' },
] as const satisfies readonly OptionalBlockDefinition[];

export type OptionalBlockKind = (typeof OPTIONAL_BLOCKS)[number]['kind'];
