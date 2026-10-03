import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { SkillInstructions } from './SkillInstructions';
import { SkillMarkdown } from './SkillMarkdown';
import { normalizeSkill } from './aiSettingsUtils';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('renders skill headings, emphasis, lists, inline identifiers and GFM tables', () => {
    const instructions = '# Coordinació\n\nText **important**.\n\n- Executa `team.plan`.\n\n| Fase | Estat |\n|---|---|\n| Lectura | Fet |';
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<SkillInstructions skill={normalizeSkill({ id: 'user.test', name: 'Test', instructions, origin: 'user' })} />);
    expect(host.querySelector('h1')?.textContent).toBe('Coordinació');
    expect(host.querySelector('.ai-skill-markdown strong')?.textContent).toBe('important');
    expect(host.querySelector('li code')?.textContent).toBe('team.plan');
    expect(host.querySelector('table tbody td')?.textContent).toBe('Lectura');
    expect(host.querySelector('pre')).toBeNull();
});

it('keeps intentional fenced code as code in the shared original comparison renderer', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<SkillMarkdown instructions={'## Contracte\n\n```json\n{"value": true}\n```'} />);
    expect(host.querySelector('h2')?.textContent).toBe('Contracte');
    expect(host.querySelector('pre code')?.textContent).toContain('{"value": true}');
});
