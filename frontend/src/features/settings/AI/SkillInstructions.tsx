import { useTranslation } from 'react-i18next';
import type { NormalizedSkill } from './aiSettingsUtils';
import { useSkillInstructions } from './skillInstructionTranslation';

export function SkillInstructions({ skill }: { skill: NormalizedSkill }) {
    const { t, i18n } = useTranslation();
    const translation = useSkillInstructions(skill, i18n.resolvedLanguage || i18n.language);
    return <div>
        <strong>{t('settings.ai.resources.instructions')}</strong>
        <pre>{skill.instructions}</pre>
        <div className="ai-resource-card__actions" style={{ padding: 0 }}>
            <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={translation.loading} onClick={translation.translate}>
                {t(translation.loading ? 'settings.ai.resources.instructions_translating' : 'settings.ai.resources.instructions_translate')}
            </button>
        </div>
        {translation.error && <p role="status" className="ai-resource-muted">{t(translation.authenticationError ? 'settings.ai.resources.instructions_translation_authentication' : translation.rateLimited ? 'settings.ai.resources.instructions_translation_rate_limit' : 'settings.ai.resources.instructions_translation_error')}</p>}
        {translation.text && <div><p className="ai-resource-muted">{t('settings.ai.resources.instructions_translation_readonly')}</p><pre>{translation.text}</pre></div>}
    </div>;
}
