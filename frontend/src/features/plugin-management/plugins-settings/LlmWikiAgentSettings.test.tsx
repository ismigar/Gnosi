import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LlmWikiAgentSettings } from './LlmWikiAgentSettings';

vi.mock('../../../shared/ui/settings/PrincipalAgentReference', () => ({ PrincipalAgentReference: ({ operation }: { operation: string }) => <span>{operation}</span> }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    root = createRoot(host);
});
afterEach(() => { act(() => { root.unmount(); }); vi.unstubAllGlobals(); });

it.each(['custom', 'principal', 'llm-wiki', ''])('uses the principal reference despite legacy selection %s', agentId => {
    const select = vi.fn();
    act(() => { root.render(<LlmWikiAgentSettings agentId={agentId} agents={[]} busy={false} onSelect={select} />); });
    expect(host.textContent).toBe('knowledge');
    expect(host.querySelector('select')).toBeNull();
    expect(select).not.toHaveBeenCalled();
});
