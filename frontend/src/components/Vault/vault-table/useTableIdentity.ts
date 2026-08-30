import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../context/auth-context';
import { useLocaleSettings } from '../../../hooks/useLocaleSettings';
import { usePlugins } from '../../../plugins/usePlugins';
import { fetchLlmWikiConfig } from '../../../shared/api/brain';
import type { TableLlmWikiConfig, TableLlmWikiJobs } from './fieldConfig';
import { isRecord, nestedRecords, resourceJobs } from './fieldConfig';

import { keyboardOwnership } from './keyboardOwnership';

type Inputs = Record<never, never>;

export function useTableIdentity(_inputs: Inputs) {
  const { isEnabled: isPluginEnabled, getPluginSettings } = usePlugins();
  const projectPlanningEnabled = isPluginEnabled('project-planning');
  const projectPlanningSettings = getPluginSettings('project-planning');
  const [wikiState, setWikiState] = useState<{
    reader: typeof isPluginEnabled;
    config: TableLlmWikiConfig | null;
  }>(() => ({ reader: isPluginEnabled, config: null }));
  // Reset only the configuration owned by a disabled plugin. Keeping this
  // transition with its input prevents a stale config from surviving a reset;
  // enabled refreshes still retain the previous config until the request ends.
  if (wikiState.reader !== isPluginEnabled) {
    setWikiState({
      reader: isPluginEnabled,
      config: isPluginEnabled('llm-wiki') ? wikiState.config : null,
    });
  }
  const llmWikiConfig = wikiState.config;
  const [llmWikiJobs, setLlmWikiJobs] = useState<TableLlmWikiJobs>({});
  useEffect(() => {
    let alive = true;
    if (!isPluginEnabled('llm-wiki')) {
      return () => { alive = false; };
    }
    fetchLlmWikiConfig()
      .then((response) => {
        if (!alive) return;
        const config = isRecord(response.config)
          ? {
            ...response.config,
            processed_resources: nestedRecords(response.processed_resources),
          }
          : null;
        setWikiState({ reader: isPluginEnabled, config });
        setLlmWikiJobs(resourceJobs(response.resource_statuses));
      })
      .catch((error: unknown) => {
        if (alive) setWikiState({ reader: isPluginEnabled, config: null });
        console.warn('Could not load the LLM Wiki table configuration:', error);
      });
    return () => { alive = false; };
  }, [isPluginEnabled]);
  const { t, i18n } = useTranslation();
  const gridInstanceId = useId();
  const gridInstanceIdRef = useRef(`vault-grid-${gridInstanceId}`);
  const claimKeyboard = useCallback(() => { keyboardOwnership.owner = gridInstanceIdRef.current; }, []);
  useEffect(() => () => {
    if (keyboardOwnership.owner === gridInstanceIdRef.current) keyboardOwnership.owner = null;
  }, []);
  const { user: currentUser } = useAuth();
  const localeSettings = useLocaleSettings();
  return { isPluginEnabled, projectPlanningEnabled, projectPlanningSettings, llmWikiConfig, llmWikiJobs, setLlmWikiJobs, t, i18n, gridInstanceIdRef, claimKeyboard, currentUser, localeSettings };
}
