import { useTranslation } from 'react-i18next';
import { SkillMarkdown } from './SkillMarkdown';
import type { NormalizedSkill } from './aiSettingsUtils';

export function SkillInstructions({ skill }: { skill: NormalizedSkill }) {
    const { t } = useTranslation();
    return <div>
        <strong>{t('settings.ai.resources.instructions')}</strong>
        <SkillMarkdown instructions={skill.instructions} />
    </div>;
}
