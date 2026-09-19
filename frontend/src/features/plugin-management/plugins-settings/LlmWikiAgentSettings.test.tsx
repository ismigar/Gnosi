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

it('shows the selected profile and opens the shared editors for it', () => {
    const select = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn();
    act(() => { root.render(<LlmWikiAgentSettings agentId="custom" agents={[
        { id: 'llm-wiki', name: 'Brain', enabled: true, ready: true },
        { id: 'custom', name: 'Research', enabled: true, ready: true },
    ]} busy={false} onSelect={select} onOpenAISettings={open} />); });
    const field = host.querySelector('select');
    expect(field?.value).toBe('custom');
    expect(field?.options).toHaveLength(2);
    act(() => { host.querySelectorAll('button')[0]?.click(); });
    expect(open).toHaveBeenLastCalledWith('agents', 'custom');
    act(() => { host.querySelectorAll('button')[1]?.click(); });
    expect(open).toHaveBeenLastCalledWith('skills');
    act(() => {
        if (field) { field.value = 'llm-wiki'; field.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    expect(select).toHaveBeenCalledWith('llm-wiki');
});

it('keeps a missing profile visible and prevents edits while saving', () => {
    act(() => { root.render(<LlmWikiAgentSettings agentId="removed" agents={[]} busy onSelect={vi.fn()} onOpenAISettings={vi.fn()} />); });
    expect(host.querySelector('select')?.value).toBe('removed');
    expect(host.textContent).toContain('settings.plugins.llm_wiki_agent_missing');
    expect(host.querySelector('select')?.disabled).toBe(true);
    expect([...host.querySelectorAll('button')].every(button => button.disabled)).toBe(true);
});
