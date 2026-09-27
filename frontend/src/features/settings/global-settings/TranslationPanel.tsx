import { Languages } from 'lucide-react';
import { PrincipalAgentReference } from '../../../shared/ui/settings/PrincipalAgentReference';
import { Section } from '../../../shared/ui/settings/SettingsPrimitives';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 't'> };

export function TranslationPanel({ context: { t } }: Props) {
  return <Section title={t('translate_settings.section_title')} icon={Languages}>
    <p className="settings-desc">{t('translate_settings.intro')}</p>
    <PrincipalAgentReference operation="translation" />
    <p className="settings-desc">{t('translate_settings.usage_hint')}</p>
    <p className="settings-desc">{t('translate_settings.legacy_notice')}</p>
  </Section>;
}
