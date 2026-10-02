import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SkillUsage } from './AISkillUsage';
import { normalizeSkill } from './aiSettingsUtils';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
it('starts from existing assignments without writes and autosaves an agent toggle', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const assignAgentSkills = vi.fn().mockResolvedValue(['other']);
    const saveAutomation = vi.fn(); const changed = vi.fn();
    try {
        await act(async () => { root.render(<SkillUsage skill={normalizeSkill({ id: 'user.copy', name: 'Copy' })}
            source={normalizeSkill({ id: 'source', name: 'Original' })} principalAgentId="main"
            agents={[{ id: 'main', name: 'Main', skill_ids: ['other'] }, { id: 'helper', name: 'Knowledge', managed_by: 'builtin:llm-wiki', skill_ids: ['source', 'other'] }]}
            resources={{ automations: [{ id: 'schedule', name: 'Schedule', skill_id: 'source', agent_id: 'helper' }], assignAgentSkills, saveAutomation }} onAgentsChanged={changed} />); await Promise.resolve(); });
        const buttons = [...host.querySelectorAll<HTMLElement>('[role="switch"]')];
        expect(buttons.map(button => button.getAttribute('aria-checked'))).toEqual(['false', 'true', 'true']);
        expect(assignAgentSkills).not.toHaveBeenCalled(); expect(saveAutomation).not.toHaveBeenCalled();
        expect(host.textContent).not.toContain('common.save');
        expect(host.textContent).toContain('settings.ai.assistant.builtin_profiles.llm-wiki');
        expect(host.textContent).toContain('Main');
        await act(async () => { buttons[1]?.click(); await Promise.resolve(); });
        expect(assignAgentSkills).toHaveBeenCalledWith('helper', [], { sourceId: 'source', targetId: 'user.copy', keepSource: false, removeTarget: true });
        expect(buttons[1]?.getAttribute('aria-checked')).toBe('false');
        expect(changed).toHaveBeenCalled(); expect(host.textContent).toContain('skill_autosave.saved');
        assignAgentSkills.mockRejectedValueOnce(new Error('Offline'));
        await act(async () => { buttons[1]?.click(); await Promise.resolve(); });
        expect(buttons[1]?.getAttribute('aria-checked')).toBe('false'); expect(host.textContent).toContain('Offline');
        await act(async () => { buttons[2]?.click(); await Promise.resolve(); });
        expect(saveAutomation).toHaveBeenCalledTimes(1);
        expect(saveAutomation.mock.calls[0]?.[0]).toMatchObject({ id: 'schedule', skill_id: 'source' });
        expect(buttons[2]?.getAttribute('aria-checked')).toBe('false');
        await act(async () => { buttons[2]?.click(); await Promise.resolve(); });
        expect(saveAutomation.mock.calls[1]?.[0]).toMatchObject({ skill_id: 'user.copy' });
        expect(buttons[2]?.getAttribute('aria-checked')).toBe('true');
    } finally { await act(async () => { root.unmount(); await Promise.resolve(); }); host.remove(); vi.unstubAllGlobals(); }
});
