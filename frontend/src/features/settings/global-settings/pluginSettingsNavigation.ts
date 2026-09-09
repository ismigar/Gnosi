import { BUILTIN_PLUGINS } from '../../../shared/plugins/registry';

/** Retain existing settings entry points while grouping their navigation under Plugins. */
export function pluginForSettingsTab(tab: string): string | null {
  if (tab === 'references') return 'resources';
  return BUILTIN_PLUGINS.find(plugin => plugin.settingsTab === tab)?.id ?? null;
}
