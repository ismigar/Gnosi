import { BUILTIN_PLUGINS } from '../../../shared/plugins/registry';

/** Retain existing settings entry points while grouping their navigation under Plugins. */
export function pluginForSettingsTab(tab: string): string | null {
  if (tab === 'references') return 'resources';
  return BUILTIN_PLUGINS.find(plugin => plugin.settingsTab === tab)?.id ?? null;
}

/** These editors use the plugin settings API; other destinations use the global draft. */
export function pluginConfigurationForSettingsTab(tab: string): string | null {
  const pluginId = pluginForSettingsTab(tab);
  return pluginId && ['genograms', 'daily-notes', 'llm-wiki', 'project-planning', 'resources', 'web-clipper'].includes(pluginId)
    ? pluginId : null;
}
