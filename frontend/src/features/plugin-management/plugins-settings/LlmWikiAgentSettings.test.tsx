import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LlmWikiAgentSettings } from './LlmWikiAgentSettings';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    root = createRoot(host);
});
afterEach(() => { act(() => { root.unmount(); }); vi.unstubAllGlobals(); });

it.each(['custom', 'principal'])('opens the shared editors for the selected %s profile', (agentId) => {
    const select = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn();
    act(() => { root.render(<LlmWikiAgentSettings agentId={agentId} agents={[
        { id: 'llm-wiki', name: 'Brain', enabled: true, ready: true },
        { id: agentId, name: 'Research', enabled: true, ready: true },
    ]} busy={false} onSelect={select} onOpenAISettings={open} />); });
    const field = host.querySelector('select');
    expect(field?.value).toBe(agentId);
    expect(field?.options).toHaveLength(2);
    act(() => { host.querySelectorAll('button')[0]?.click(); });
    expect(open).toHaveBeenLastCalledWith('agents', agentId);
    act(() => { host.querySelectorAll('button')[1]?.click(); });
    expect(open).toHaveBeenLastCalledWith('skills');
    act(() => {
        if (field) { field.value = 'llm-wiki'; field.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    expect(select).toHaveBeenCalledWith('llm-wiki');
});

it('offers principal assistant setup when no profile exists', () => {
    act(() => { root.render(<LlmWikiAgentSettings agentId="" agents={[]} busy={false} onSelect={vi.fn()} onOpenAISettings={vi.fn()} />); });
    expect(host.querySelector('select')?.value).toBe('');
    expect(host.textContent).toContain('settings.ai.assistant.setup');
    expect(host.textContent).not.toContain('settings.plugins.llm_wiki_agent_missing');
});

it('keeps a missing profile visible and prevents edits while saving', () => {
    act(() => { root.render(<LlmWikiAgentSettings agentId="removed" agents={[]} busy onSelect={vi.fn()} onOpenAISettings={vi.fn()} />); });
    expect(host.querySelector('select')?.value).toBe('removed');
    expect(host.textContent).toContain('settings.plugins.llm_wiki_agent_missing');
    expect(host.querySelector('select')?.disabled).toBe(true);
    expect([...host.querySelectorAll('button')].every(button => button.disabled)).toBe(true);
});
