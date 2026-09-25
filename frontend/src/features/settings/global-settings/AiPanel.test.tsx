import { act, useState, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AiPanel } from './AiPanel';
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('./ModelConsumption', () => ({ ModelConsumption: () => null }));
vi.mock('./ModelBudget', () => ({ ModelBudget: () => null }));
vi.mock('./AgentsPanel', () => ({ AgentsPanel: ({ onSelectSkill }: { onSelectSkill: (id: string) => void }) => {
    const [name, setName] = useState('Saved name');
    return <><input aria-label="Draft name" value={name} onChange={event => { setName(event.target.value); }} />
        <button onClick={() => { setName('Unsaved name'); }}>Edit draft</button>
        <button onClick={() => { onSelectSkill('core.example'); }}>Open skill</button></>;
} }));
vi.mock('../AI/AIResourcesSettings', () => ({
    SkillsSettingsPanel: ({ selectedSkillId }: { selectedSkillId: string }) => <p>{selectedSkillId}</p>,
    ToolsSettingsPanel: () => null,
}));
function Harness() {
    const [aiSection, setAiSection] = useState('agents');
    const context = { aiSection, setAiSection, draft: { ai: { agents: [] } },
        role: 'admin', t: (key: string) => key, handleClose: vi.fn(),
    } as unknown as ComponentProps<typeof AiPanel>['context'];
    return <AiPanel context={context} />;
}
it('returns from the linked skill to the unsaved assistant draft', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    const root = createRoot(host);
    const click = (text: string) => {
        const button = [...host.querySelectorAll('button')].find(item => item.textContent === text);
        expect(button).toBeDefined();
        act(() => { button?.click(); });
    };
    try {
        act(() => { root.render(<Harness />); });
        click('Edit draft');
        click('Open skill');
        expect(host.textContent).toContain('core.example');
        expect(host.querySelector('input')?.closest('[hidden]')).not.toBeNull();
        click('settings.ai.resources.back_to_profile');
        expect(host.querySelector('input')?.value).toBe('Unsaved name');
        expect(host.querySelector('input')?.closest('[hidden]')).toBeNull();
    } finally {
        act(() => { root.unmount(); });
        vi.unstubAllGlobals();
    }
});
