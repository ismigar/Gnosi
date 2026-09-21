import { useTranslation } from 'react-i18next';
import type { LearnedSkill } from '../../shared/api/agent-learning';

export function SkillResourcesEditor({ skill, disabled, onChange }: {
    readonly skill: LearnedSkill; readonly disabled: boolean; readonly onChange: (value: Partial<LearnedSkill>) => void;
}) {
    const { t } = useTranslation();
    const examples = skill.examples || [];
    const resources = skill.resources || [];
    return <>
        <details><summary>{t('learning.examples')}</summary>
            {examples.map((example, index) => <div className="agent-learning__card" key={index}>
                <label>{t('learning.name')}<input className="gnosi-input" value={example.name} maxLength={160} disabled={disabled} onChange={event => { onChange({ examples: examples.map((item, i) => i === index ? { ...item, name: event.target.value } : item) }); }} /></label>
                <label>{t('learning.example_input')}<textarea className="gnosi-input" value={example.input} maxLength={8000} disabled={disabled} onChange={event => { onChange({ examples: examples.map((item, i) => i === index ? { ...item, input: event.target.value } : item) }); }} /></label>
                <label>{t('learning.example_output')}<textarea className="gnosi-input" value={example.expected} maxLength={8000} disabled={disabled} onChange={event => { onChange({ examples: examples.map((item, i) => i === index ? { ...item, expected: event.target.value } : item) }); }} /></label>
                <button className="btn-gnosi btn-gnosi-secondary" type="button" disabled={disabled} onClick={() => { onChange({ examples: examples.filter((_, i) => i !== index) }); }}>{t('common.remove')}</button>
            </div>)}
            <button className="btn-gnosi btn-gnosi-secondary" type="button" disabled={disabled || examples.length >= 8} onClick={() => { onChange({ examples: [...examples, { name: '', input: '', expected: '' }] }); }}>{t('learning.add_example')}</button>
        </details>
        <details><summary>{t('learning.templates')}</summary>
            {resources.map((resource, index) => <div className="agent-learning__card" key={index}>
                <label>{t('learning.file_name')}<input className="gnosi-input" value={resource.name} maxLength={120} disabled={disabled} onChange={event => { onChange({ resources: resources.map((item, i) => i === index ? { ...item, name: event.target.value } : item) }); }} /></label>
                <label>{t('learning.template_text')}<textarea className="gnosi-input" rows={4} value={resource.content} maxLength={16000} disabled={disabled} onChange={event => { onChange({ resources: resources.map((item, i) => i === index ? { ...item, content: event.target.value } : item) }); }} /></label>
                <button className="btn-gnosi btn-gnosi-secondary" type="button" disabled={disabled} onClick={() => { onChange({ resources: resources.filter((_, i) => i !== index) }); }}>{t('common.remove')}</button>
            </div>)}
            <button className="btn-gnosi btn-gnosi-secondary" type="button" disabled={disabled || resources.length >= 12} onClick={() => { onChange({ resources: [...resources, { name: 'template.md', content: '' }] }); }}>{t('learning.add_template')}</button>
        </details>
    </>;
}
