import { writeStorage, configurePluginKey } from './settingsStorage';
import { BookOpen } from 'lucide-react';
import { Section } from './SettingsPrimitives';
import { Trans } from 'react-i18next';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'activeTab' | 'setActiveTab' | 'setIsAdvancedOpen' | 't'> };

export function ReferencesPanel({ context }: Props) {
  const { activeTab, setActiveTab, setIsAdvancedOpen, t } = context;
  return (activeTab === 'references' && (
    <Section title={t('settings.tabs.references') || 'Referències'} icon={BookOpen}>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: '16px', lineHeight: 1.5 }}>
        <Trans i18nKey="settings.references.intro" components={{ b: <strong /> }} />
      </p>
      <div style={{ marginBottom: '16px', padding: '18px 20px', background: 'var(--settings-sidebar-bg)', borderRadius: '16px', border: '1px solid var(--settings-border)' }}>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 0 }}>
          {t('literature.settings.references_moved')}
        </p>
        <button
          type="button"
          className="btn-gnosi btn-gnosi-primary"
          onClick={() => {
            writeStorage(configurePluginKey, 'resources');
            setIsAdvancedOpen(true);
            setActiveTab('plugins');
          }}
        >
          {t('literature.settings.open_resources_plugin')}
        </button>
      </div>
    </Section>
  ));
}
