import { useTranslation } from 'react-i18next';
import type { NormalizedSkill } from './aiSettingsUtils';

export function SkillInstructions({ skill }: { skill: NormalizedSkill }) {
    const { t } = useTranslation();
    return <div>
        <strong>{t('settings.ai.resources.instructions')}</strong>
        <pre>{skill.instructions}</pre>
    </div>;
}
