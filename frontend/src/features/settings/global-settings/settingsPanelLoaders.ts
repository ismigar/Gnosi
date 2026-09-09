// The navigation and React.lazy share imports so pointer/keyboard intent can
// prepare a section without mounting its effects or loading account data.
export const settingsPanelLoaders = {
  account: () => import('../../auth/settings/Auth/AccountSettings'),
  accounts: () => import('./AccountsPanel').then(module => ({ default: module.AccountsPanel })),
  ai: () => import('./AiPanel').then(module => ({ default: module.AiPanel })),
  api: () => import('../../auth/settings/ApiTokensSettings'),
  menu: () => import('../AppSidebarSettings').then(module => ({ default: module.AppSidebarSettings })),
  graph: () => import('./GraphPanel').then(module => ({ default: module.GraphPanel })),
  profile: () => import('../identity/IdentityProfile'),
  notion: () => import('../../notion-import/NotionImportSettings'),
  plugins: () => import('../../plugin-management').then(module => ({ default: module.PluginsSettings })),
  reader: () => import('./ReaderPanel').then(module => ({ default: module.ReaderPanel })),
  social: () => import('./SocialPanel').then(module => ({ default: module.SocialPanel })),
  translate: () => import('./TranslationPanel').then(module => ({ default: module.TranslationPanel })),
  workspace: () => import('./WorkspacePanel').then(module => ({ default: module.WorkspacePanel })),
};

export function preloadSettingsPanel(tab: string): void {
  const key = ['calendar', 'contacts', 'mail'].includes(tab) ? 'accounts' : tab;
  if (!Object.hasOwn(settingsPanelLoaders, key)) return;
  void settingsPanelLoaders[key as keyof typeof settingsPanelLoaders]().catch(() => {});
}
