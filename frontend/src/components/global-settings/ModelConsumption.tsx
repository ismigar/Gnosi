import { Activity } from 'lucide-react';
import { History } from 'lucide-react';
import { formatCost } from './formatting';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'aiRegistry' | 'aiSection' | 'aiUsage' | 'setIsUsageHistoryOpen' | 't'> };

export function ModelConsumption({ context }: Props) {
  const { aiRegistry, aiSection, aiUsage, setIsUsageHistoryOpen, t } = context;
  return (aiSection === 'models' && aiRegistry.length > 0 && (() => {
    const curSymbol = aiUsage?.currency.symbol || '€';
    const curRate = aiUsage?.currency.usd_rate || 0.86;

    const formatTokens = (val: unknown) => {
      const num = Number(val || 0);
      if (num <= 0) return '0';
      if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
      if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
      return num.toLocaleString();
    };

    const activeModelsWithCosts = aiRegistry.map(model => {
      const usage = (aiUsage?.per_model || []).find(
        u => u.provider === model.provider && u.model_id === model.model_id
      ) || { in: 0, out: 0, cost_usd: 0 };

      const isFree = Boolean(model.is_local) || model.is_free || ((model.cost_in || 0) === 0 && (model.cost_out || 0) === 0);
      const costInPer1M = isFree ? 0 : (model.cost_in || 0);
      const costOutPer1M = isFree ? 0 : (model.cost_out || 0);

      const inCostUsd = isFree ? 0 : (usage.in * costInPer1M) / 1000000;
      const outCostUsd = isFree ? 0 : (usage.out * costOutPer1M) / 1000000;
      const modelTotalCostUsd = isFree ? 0 : (inCostUsd + outCostUsd);

      const inCostCcy = inCostUsd * curRate;
      const outCostCcy = outCostUsd * curRate;
      const modelTotalCostCcy = modelTotalCostUsd * curRate;

      return {
        ...model,
        usage,
        isFree,
        inCostCcy,
        outCostCcy,
        modelTotalCostCcy
      };
    });

    const totalActiveCost = activeModelsWithCosts.reduce((acc, m) => acc + m.modelTotalCostCcy, 0);

    return (
      <div style={{ marginTop: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
              <strong>{t('settings.ai.monthly_consumption', 'Consum mensual per model')}</strong>
            </h4>
            <button
              type="button"
              className="btn-gnosi-secondary"
              onClick={() => { setIsUsageHistoryOpen(true); }}
              style={{ fontSize: '0.78rem', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '8px' }}
            >
              <History size={14} />
              {t('settings.ai.view_history', 'Històric de consum')}
            </button>
          </div>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {t('settings.ai.monthly_total', 'Total consum mensual')}: <strong style={{ color: 'var(--text-primary)' }}>{formatCost(totalActiveCost, curSymbol, 2)}</strong>
          </span>
        </div>

        <div className="ai-resource-list" style={{ border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden', gap: 0 }}>
          {activeModelsWithCosts.map((model, index) => (
            <article key={model.model_id} className="ai-resource-card" style={{ border: 'none', borderRadius: 0, borderBottom: index < activeModelsWithCosts.length - 1 ? '1px solid var(--border-color)' : 'none', marginBottom: 0 }}>
              <div className="ai-resource-card__main" style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <Activity size={18} style={{ marginTop: '2px' }} />
                  <span className="ai-resource-card__copy">
                    <span className="ai-resource-card__heading">
                      <strong>{model.name || model.model_id}</strong>
                      {model.enabled === false && (
                        <span style={{ marginLeft: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                          ({t('settings.ai.disabled_badge', 'Inactiu')})
                        </span>
                      )}
                      {model.profile && (
                        <span className={`model-profile-badge ${model.profile}`} style={{ marginLeft: '10px', fontSize: '0.8rem', padding: '2px 8px', borderRadius: '10px', background: 'var(--bg-secondary)' }}>
                          {({
                            worker: '🟢',
                            administrative: '🔵',
                            documentalist: '📑',
                            allrounder: '🟡',
                            expert: '🟣',
                            unrated: '⚪',
                          } as Record<string, string>)[model.profile] || '⚪'} {t(`model_comparison.profiles.${model.profile}`, model.profile)}
                        </span>
                      )}
                    </span>
                    <span className="ai-resource-card__meta">
                      {model.provider && <span style={{ textTransform: 'capitalize' }}>{model.provider}</span>}
                      <span>{model.model_id}</span>
                    </span>
                  </span>
                </div>

                <div style={{ textAlign: 'right', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  <div>
                    <span>{t('settings.ai.in_tokens', 'Entrada')}: <strong>{formatTokens(model.usage.in)}</strong> ({formatCost(model.inCostCcy, curSymbol, 2)})</span>
                    <span style={{ margin: '0 6px' }}>•</span>
                    <span>{t('settings.ai.out_tokens', 'Sortida')}: <strong>{formatTokens(model.usage.out)}</strong> ({formatCost(model.outCostCcy, curSymbol, 2)})</span>
                  </div>
                  <div style={{ marginTop: '3px' }}>
                    <strong style={{ color: 'var(--text-primary)', fontSize: '0.88rem' }}>
                      {t('settings.ai.model_total', 'Cost total')}: {formatCost(model.modelTotalCostCcy, curSymbol, 2)}
                    </strong>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    );
  })());
}
