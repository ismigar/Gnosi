import { groupEnabledModelRoutes } from '../AI/aiSettingsUtils';
import { useAIResources } from '../AI/useAIResources';
import { useMemo } from 'react';
import { useSettingsAccounts } from './useSettingsAccounts';
import { useSettingsCollections } from './useSettingsCollections';
import { useSettingsGraph } from './useSettingsGraph';
import { useSettingsLifecycle } from './useSettingsLifecycle';
import { useSettingsLoaders } from './useSettingsLoaders';
import { useSettingsMailEffects } from './useSettingsMailEffects';
import { useSettingsModels } from './useSettingsModels';
import { useSettingsPersistence } from './useSettingsPersistence';
import { useSettingsReader } from './useSettingsReader';
import { useSettingsSnippets } from './useSettingsSnippets';
import { useSettingsSocial } from './useSettingsSocial';
import { useSettingsState } from './useSettingsState';
import { useSettingsTranslation } from './useSettingsTranslation';
import type { GlobalSettingsModalProps } from './types';

export function useGlobalSettingsController(props: GlobalSettingsModalProps) {
  const state = { initialTab: 'general', initialPluginId: null, sidebarNavigation: null, ...props, ...useSettingsState(props), ...useSettingsCollections() };
  const { isOpen, activeTab, draft, aiRegistry } = state;
  const aiResources = useAIResources(isOpen && activeTab === 'ai');
  const graph = useSettingsGraph(state);
  const social = useSettingsSocial(state);
  const snippets = useSettingsSnippets(state);
  const loaders = useSettingsLoaders(state);
  const models = useSettingsModels(state);
  const reader = useSettingsReader(state);
  const translation = useSettingsTranslation(state);
  const accounts = useSettingsAccounts({ ...state, ...loaders });
  const mail = useSettingsMailEffects(state);
  const persistence = useSettingsPersistence({ ...state, ...mail });
  useSettingsLifecycle({ ...state, ...loaders, ...models, ...reader, ...social });
  const podcastProvider = draft.settings.reader?.podcast?.provider || '';
  const podcastModelId = draft.settings.reader?.podcast?.model || '';
  const podcastModelRoutes = useMemo(() => groupEnabledModelRoutes(aiRegistry, { provider: podcastProvider, model: podcastModelId }), [aiRegistry, podcastProvider, podcastModelId]);
  return { ...state, ...graph, ...social, ...snippets, ...loaders, ...models, ...reader, ...translation, ...accounts, ...mail, ...persistence, aiResources, podcastModelRoutes };
}
export type SettingsController = ReturnType<typeof useGlobalSettingsController>;
