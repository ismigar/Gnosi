import type { AiModelRegistryEntry } from '../../../shared/api/ai';
import type { SettingsModel, SettingsAgent } from './types';
import { emitAppEvent } from '../../../shared/platform/app-events';
import { fetchAiModelComparison } from '../../../shared/api/ai';
import { fetchAiModels } from '../../../shared/api/ai';
import { fetchAiUsage } from '../../../shared/api/ai';
import { registryEntryMatchesModel } from '../model-comparison/modelComparisonRegistry';
import { toast } from '../../../shared/notifications/toast';
import { updateAiModels } from '../../../shared/api/ai';
import { useEffect, useEffectEvent } from 'react';
import { subscribeAppEvent } from '../../../shared/platform/app-events';
import type { SettingsState } from './stateTypes';

type Input = SettingsState;

export function useSettingsModels(state: Input) {
  const { isOpen, setAiRegistry, setAiUsage, setConfirmConfig, setDraft, setEditingAgent, setEnforceBlock, setMonthlyCostCap, setSavingBudget, t, tn } = state;
  const loadAiRegistry = async () => {
    // Feeds the agent-creation model dropdown. Only enabled rows: a disabled
    // model in the registry is not a valid target for a new agent.
    try {
      const [payload, comparisonPayload, usageData] = await Promise.all([
        fetchAiModels(),
        fetchAiModelComparison(),
        fetchAiUsage()
      ]);

      const comparisonModels = comparisonPayload.models;
      setAiUsage(usageData);
      setMonthlyCostCap(usageData.cap_ccy !== null ? usageData.cap_ccy : (typeof usageData.budget.monthly_cost_cap === 'number' || typeof usageData.budget.monthly_cost_cap === 'string' ? usageData.budget.monthly_cost_cap : ''));
      setEnforceBlock(Boolean(usageData.budget.enforce_block));
      const usageModels = usageData.per_model;

      const configuredMap = new Map<string, AiModelRegistryEntry>();
      for (const modelEntry of (payload.configured_models)) {
        if (modelEntry.model_id) {
          configuredMap.set(`${modelEntry.provider}:${modelEntry.model_id}`, modelEntry);
        }
      }

      for (const u of usageModels) {
        const key = `${u.provider}:${u.model_id}`;
        if (!configuredMap.has(key) && (u.in > 0 || u.out > 0 || u.cost_usd > 0)) {
          configuredMap.set(key, {
            provider: u.provider,
            model_id: u.model_id,
            enabled: false,
            cost_in: 0,
            cost_out: 0,
          });
        }
      }

      const configured: SettingsModel[] = [];
      for (const configuredModel of configuredMap.values()) {
        const matched = comparisonModels.find(cm => registryEntryMatchesModel(configuredModel, cm));
        const costIn = (matched && matched.input_price !== null)
          ? matched.input_price
          : (configuredModel.cost_in || 0);
        const costOut = (matched && matched.output_price !== null)
          ? matched.output_price
          : (configuredModel.cost_out || 0);
        const isFree = Boolean(configuredModel.is_local) || Boolean(matched?.is_free) || (costIn === 0 && costOut === 0);

        const usage = usageModels.find(
          u => u.provider === configuredModel.provider && u.model_id === configuredModel.model_id
        );
        const hasUsage = usage && (usage.in > 0 || usage.out > 0 || usage.cost_usd > 0);

        if (configuredModel.enabled !== false || hasUsage) {
          configured.push({
            ...configuredModel,
            name: matched?.name || configuredModel.model_id,
            creator: matched?.creator || configuredModel.provider || '',
            profile: matched?.profile || 'unrated',
            cost_in: costIn,
            cost_out: costOut,
            is_free: isFree,
          });
        }
      }

      setAiRegistry(configured);
    } catch (err) { console.error("Error loading AI model registry:", err); }
  };

  const saveAiBudget = async (newCap: string | number, newEnforceBlock: boolean) => {
    setSavingBudget(true);
    try {
      const payload = await fetchAiModels();
      // Preserve capability, context, and quality metadata. The budget
      // control changes policy only; reducing each row to an identity
      // used to rewrite tool-capable models as tool-less.
      const currentModels = payload.configured_models;
      const currentBudget = payload.budget;

      const updatedBudget = {
        ...currentBudget,
        monthly_cost_cap: newCap !== '' ? parseFloat(String(newCap)) : 0,
        enforce_block: newEnforceBlock
      };

      await updateAiModels({ models: currentModels, budget: updatedBudget });

      setAiUsage(await fetchAiUsage());
      emitAppEvent('gnosi-ai-models-changed', { source: 'budget-settings' });
    } catch (err) {
      console.error('Error saving AI budget:', err);
      toast.error(t('settings.ai.budget_save_error', 'Error en desar el límit de pressupost'));
    } finally {
      setSavingBudget(false);
    }
  };

  const reloadRegistry = useEffectEvent(() => { void loadAiRegistry(); });
  useEffect(() => {
    if (!isOpen) return undefined;
    return subscribeAppEvent('gnosi-ai-models-changed', () => { reloadRegistry(); });
  }, [isOpen]);

  const handleDeleteAIAgent = (agent: SettingsAgent) => {
    setConfirmConfig({
      isOpen: true,
      title: tn('ai.delete_agent_title'),
      message: tn('ai.delete_agent_msg', { name: agent.name }),
      onConfirm: () => {
        setDraft(prev => ({
          ...prev,
          ai: {
            ...prev.ai,
            agents: prev.ai.agents.filter(item => item.id !== agent.id)
          }
        }));
        setEditingAgent(current => current?.id === agent.id ? null : current);
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };
  return { handleDeleteAIAgent, loadAiRegistry, saveAiBudget };
}
