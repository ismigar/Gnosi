import { act, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentsPanel } from './AgentsPanel';
import type { AgentDraft } from './types';

vi.mock('./AIAgentForm', () => ({
  AIAgentForm: ({ agent }: { agent: AgentDraft }) => <input aria-label="Profile name" defaultValue={agent.name || ''} />,
}));
vi.mock('../../../shared/ui/previews/IconRenderer', () => ({ IconRenderer: () => null }));
let host: HTMLDivElement;
let root: Root;
const principal = { id: 'brain', name: 'Cervell', model: 'test', enabled: true };
function Harness({ editing = false, empty = false, onOpenActivity }: { editing?: boolean; empty?: boolean; onOpenActivity?: () => void }) {
  const [editingAgent, setEditingAgent] = useState<AgentDraft | null>(editing ? principal : null);
  const [agentEditorTarget, setAgentEditorTarget] = useState<HTMLDivElement | null>(null);
  const context = {
    draft: { ai: { agents: empty ? [] : [principal], active_agent_id: empty ? null : principal.id } },
    editingAgent, setEditingAgent, agentEditorTarget, setAgentEditorTarget,
    aiRegistry: [], aiResources: { skills: [], tools: [] },
    t: (key: string) => key, tn: (key: string) => key,
  } as unknown as ComponentProps<typeof AgentsPanel>['context'];
  return <AgentsPanel context={context} onOpenActivity={onOpenActivity} />;
}
function click(key: string) {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent === key);
  expect(button).toBeDefined();
  act(() => { button?.click(); });
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => { act(() => { root.unmount(); }); vi.unstubAllGlobals(); });
it.each([false, true])('opens an empty creation form with principal editing=%s', editing => {
  act(() => { root.render(<Harness editing={editing} />); });
  click('settings.ai.assistant.advanced');
  click('settings.ai.assistant.create_profile');
  expect(host.querySelector('[data-settings-editor-for="agent:new"]')).not.toBeNull();
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Profile name"]')?.value).toBe('');
  expect(host.querySelector('[data-settings-editor-for="agent:brain"]')).toBeNull();
  click('common.cancel');
  expect(host.querySelector('[data-settings-editor-for="agent:new"]')).toBeNull();
  expect(host.textContent).toContain('Cervell');
  click('settings.ai.assistant.create_profile');
  expect(host.querySelector('[data-settings-editor-for="agent:new"]')).not.toBeNull();
});

it('keeps first-time setup focused and allows cancellation and activity navigation', () => {
  const onOpenActivity = vi.fn();
  act(() => { root.render(<Harness empty onOpenActivity={onOpenActivity} />); });
  expect(host.textContent).not.toContain('settings.ai.assistant.advanced');
  click('settings.ai.assistant.setup');
  expect(host.querySelector('[data-settings-editor-for="agent:new"]')).not.toBeNull();
  expect(host.textContent).not.toContain('settings.ai.assistant.profiles_help');
  click('common.cancel');
  expect(host.querySelector('[data-settings-editor-for="agent:new"]')).toBeNull();
  click('activity.open_activity');
  expect(onOpenActivity).toHaveBeenCalledOnce();
});
