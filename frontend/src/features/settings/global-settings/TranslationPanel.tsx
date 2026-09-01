import { Check } from 'lucide-react';
import { FormGroup } from '../../../shared/ui/settings/SettingsPrimitives';
import { Info } from 'lucide-react';
import { Languages } from 'lucide-react';
import { PasswordInput } from './PasswordInput';
import { Section } from '../../../shared/ui/settings/SettingsPrimitives';
import { TranslateSaveIndicator } from './TranslateSaveIndicator';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'handleDeleteDeeplKey' | 'setTranslateState' | 't' | 'translateState'> };

export function TranslationPanel({ context }: Props) {
  const { handleDeleteDeeplKey, setTranslateState, t, translateState } = context;
  return (<Section
    title={t('translate_settings.section_title') || 'Serveis de traducció'}
    icon={Languages}
  >
    <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '24px' }}>
      {t('translate_settings.intro') || "Configura els proveïdors usats pel botó \"Traduir fila\". DeepL cobreix la majoria d'idiomes; Softcatalà s'usa per al català (DeepL no el suporta)."}
    </div>

    {/* DeepL */}
    <FormGroup
      label={t('translate_settings.deepl_label')}
      description={t('translate_settings.deepl_desc') || "Es desa al Keychain de macOS, no al fitxer .env_shared. Aconsegueix-ne una a deepl.com/pro-api."}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {translateState.deepl_has_value && !translateState.deepl_input && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderRadius: '12px',
            background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)',
            fontSize: '0.85rem', color: 'var(--text-primary)'
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
              <Check size={16} style={{ color: 'var(--status-success)' }} />
              {t('translate_settings.deepl_configured') || 'API key configurada al Keychain'}
            </span>
            <button
              type="button"
              onClick={() => { void handleDeleteDeeplKey(); }}
              disabled={translateState.saving_deepl}
              style={{
                padding: '4px 12px', fontSize: '0.78rem', fontWeight: 700,
                border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px',
                background: 'transparent', color: 'var(--status-error)', cursor: 'pointer',
                opacity: translateState.saving_deepl ? 0.5 : 1,
              }}
            >
              {t('common.delete') || 'Eliminar'}
            </button>
          </div>
        )}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <PasswordInput
              value={translateState.deepl_input}
              onChange={e => { setTranslateState(s => ({ ...s, deepl_input: e.target.value, saved_deepl: false })); }}
              placeholder={translateState.deepl_has_value
                ? (t('translate_settings.deepl_placeholder_replace') || 'Introdueix una clau nova per substituir')
                : (t('translate_settings.deepl_placeholder') || 'Enganxa la teva DeepL API key…')}
              name="deepl-api-key"
              autoComplete="new-password"
            />
          </div>
          <TranslateSaveIndicator saving={translateState.saving_deepl} saved={translateState.saved_deepl} t={t} />
        </div>
      </div>
    </FormGroup>

    {/* Softcatalà */}
    <FormGroup
      label={t('translate_settings.softcatala_label')}
      description={t('translate_settings.softcatala_desc') || "Endpoint del servei de traducció de Softcatalà (català). Es desa al .env local de Gnosi. Buida = usa el valor per defecte."}
    >
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <input
          type="text"
          className="gnosi-input"
          value={translateState.softcatala_url}
          onChange={e => { setTranslateState(s => ({ ...s, softcatala_url: e.target.value, saved_softcatala: false })); }}
          placeholder="https://www.softcatala.org/api/traductor/traduir"
          style={{ flex: 1 }}
        />
        <TranslateSaveIndicator saving={translateState.saving_softcatala} saved={translateState.saved_softcatala} t={t} />
      </div>
    </FormGroup>

    <div style={{
      marginTop: '20px', padding: '16px 20px', borderRadius: '14px',
      background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)',
      display: 'flex', gap: '14px', alignItems: 'flex-start'
    }}>
      <Info size={18} style={{ color: 'var(--gnosi-blue)', flexShrink: 0, marginTop: '2px' }} />
      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        {t('translate_settings.usage_hint') || "Aquests valors els consumeix l'endpoint /api/vault/skills/translate-row. Després de desar la clau de DeepL pot caldre reiniciar el backend perquè el Keychain es recarregui."}
      </div>
    </div>
  </Section>);
}
