import { GnosiToggle } from './SettingsPrimitives';
import { Loader2 } from 'lucide-react';
import { formatCost } from './formatting';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'aiUsage' | 'enforceBlock' | 'monthlyCostCap' | 'saveAiBudget' | 'savingBudget' | 'setEnforceBlock' | 'setMonthlyCostCap' | 't'> };

export function ModelBudget({ context }: Props) {
  const { aiUsage, enforceBlock, monthlyCostCap, saveAiBudget, savingBudget, setEnforceBlock, setMonthlyCostCap, t } = context;
  return (<div style={{ marginTop: '24px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
    <h4 style={{ marginBottom: '14px', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
      <strong>{t('settings.ai.budget_title', 'Control de despesa i consum')}</strong>
    </h4>

    {aiUsage && (
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        padding: '16px',
        marginBottom: '16px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {t('settings.ai.current_consumption', 'Consum actual del mes')} ({aiUsage.period})
          </span>
          <strong style={{ fontSize: '0.95rem', color: aiUsage.over_cap ? 'var(--color-danger, #ef4444)' : 'var(--text-primary)' }}>
            {formatCost(aiUsage.spent_ccy, aiUsage.currency.symbol || '€', 2)}
            {aiUsage.cap_ccy ? ` d'un límit de ${formatCost(aiUsage.cap_ccy, aiUsage.currency.symbol || '€', 2)}` : ''}
          </strong>
        </div>

        {(aiUsage.cap_ccy ?? 0) > 0 && (
          <div style={{ width: '100%', height: '8px', background: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{
              width: `${String(Math.min(100, Math.round((aiUsage.ratio || 0) * 100)))}%`,
              height: '100%',
              background: aiUsage.over_cap
                ? 'var(--color-danger, #ef4444)'
                : ((aiUsage.ratio ?? 0) > 0.8 ? 'var(--color-warning, #f59e0b)' : 'var(--color-primary, #3b82f6)'),
              transition: 'width 0.3s ease'
            }} />
          </div>
        )}

        {aiUsage.over_cap && (
          <div style={{ marginTop: '8px', fontSize: '0.8rem', color: 'var(--color-danger, #ef4444)', fontWeight: 600 }}>
            ⚠️ {t('settings.ai.budget_exceeded', 'S\'ha superat el límit mensual de cost!')}
          </div>
        )}
      </div>
    )}

    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div>
        <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '6px' }}>
          {t('settings.ai.monthly_cap_label', 'Topall mensual de cost (€ / $)')}
        </label>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00 (Sense límit)"
            className="gnosi-input"
            style={{ width: '180px' }}
            value={monthlyCostCap}
            onChange={(e) => { setMonthlyCostCap(e.target.value); }}
            onBlur={() => { void saveAiBudget(monthlyCostCap, enforceBlock); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
          />
          {savingBudget && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Loader2 size={14} className="animate-spin" />
            </span>
          )}
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginTop: '4px', display: 'block' }}>
          {t('settings.ai.cap_help', 'Deixa a 0 o en blanc per no establir cap límit mensual.')}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
        <div>
          <strong style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
            {t('settings.ai.enforce_block_title', 'Bloquejar l\'accés en superar el límit')}
          </strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {t('settings.ai.enforce_block_desc', 'Quan es superi el topall mensual, es bloquejaran les peticions d\'IA.')}
          </span>
        </div>
        <GnosiToggle
          active={enforceBlock}
          onChange={(val) => {
            setEnforceBlock(Boolean(val));
            void saveAiBudget(monthlyCostCap, Boolean(val));
          }}
        />
      </div>
    </div>
  </div>);
}
