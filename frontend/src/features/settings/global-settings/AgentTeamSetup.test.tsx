import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentTeamSetup } from './AgentTeamSetup';
import { TEAM_SKILL } from '../../../shared/ai/agentTeams';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { resolvedLanguage: 'ca' }, t: (key: string, values?: { name?: string }) => values?.name ? `${key}:${values.name}` : key }) }));
let host: HTMLDivElement;
let root: Root;
const apply = vi.fn();
const agents = [{ id: 'd', name: 'director', model: 'large', persona: 'Original', skill_ids: ['read'] }, { id: 'w', name: 'worker', model: 'small', persona: 'Keep', skill_ids: ['write'] }];
beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div'); root = createRoot(host);
    act(() => { root.render(<AgentTeamSetup agents={agents} principalId="d" registry={[]} onApply={apply} />); });
});
afterEach(() => { act(() => { root.unmount(); }); vi.unstubAllGlobals(); });
function click(text: string) {
    const button = [...host.querySelectorAll('button')].find(item => item.textContent === text);
    expect(button).toBeDefined(); act(() => { button?.click(); });
}
it('reviews three steps before changing the draft and keeps agent settings', () => {
    click('agent_team.setup');
    const member = host.querySelector<HTMLElement>('[aria-label="agent_team.member:worker"]');
    expect(member).not.toBeNull(); act(() => { member?.click(); });
    click('agent_team.next'); click('agent_team.next');
    expect(host.textContent).toContain('agent_team.review_help');
    expect(apply).not.toHaveBeenCalled();
    click('agent_team.apply');
    expect(apply).toHaveBeenCalledOnce();
    const updated = apply.mock.calls[0]?.[0] as typeof agents;
    expect(updated[0]).toMatchObject({ persona: 'Original', model: 'large', skill_ids: ['read', TEAM_SKILL], team: { enabled: true, director_id: 'd' } });
    expect(updated[1]).toEqual(agents[1]);
});
it('cancelling leaves the configuration untouched', () => {
    click('agent_team.setup'); click('common.cancel');
    expect(apply).not.toHaveBeenCalled();
});
