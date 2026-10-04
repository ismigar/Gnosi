import { act, useLayoutEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSettingsModels } from './useSettingsModels';
import type { AgentDraft, SettingsDraft } from './types';

const mocks = vi.hoisted(() => ({ models: vi.fn(), comparison: vi.fn(), usage: vi.fn() }));
vi.mock('../../../shared/api/ai', () => ({ fetchAiModels: mocks.models, fetchAiModelComparison: mocks.comparison,
    fetchAiUsage: mocks.usage, updateAiModels: vi.fn() }));
const bot = { id: 'principal', name: 'Principal', provider: 'openrouter', model: 'disabled',
    persona: 'Unsaved instructions', skill_ids: ['read'], reasoning_effort: 'high' as const };
const active = { ...bot, id: 'reader', model: 'active' };
let root: Root;
let host: HTMLDivElement;
let reload: (() => Promise<void>) | undefined;

function Harness() {
    const [draft, setDraft] = useState({ ai: { agents: [bot, active], active_agent_id: 'principal' } } as SettingsDraft);
    const [editingAgent, setEditingAgent] = useState<AgentDraft | null>(bot);
    const controller = useSettingsModels({ draft, setDraft,
        isOpen: true, setEditingAgent, setAiRegistry: vi.fn(), setAiUsage: vi.fn(), setConfirmConfig: vi.fn(),
        setEnforceBlock: vi.fn(), setMonthlyCostCap: vi.fn(), setSavingBudget: vi.fn(),
        t: ((key: string) => key) as Parameters<typeof useSettingsModels>[0]['t'],
    });
    useLayoutEffect(() => { reload = controller.loadAiRegistry; });
    return <output>{JSON.stringify({ draft, editingAgent })}</output>;
}
beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div'); root = createRoot(host);
    mocks.models.mockResolvedValue({ configured_models: [
        { provider: 'openrouter', model_id: 'disabled', enabled: false },
        { provider: 'openrouter', model_id: 'active', enabled: true },
    ] });
    mocks.comparison.mockResolvedValue({ models: [] });
    mocks.usage.mockResolvedValue({ cap_ccy: null, budget: {}, per_model: [] });
});
afterEach(() => { act(() => { root.unmount(); }); reload = undefined; vi.unstubAllGlobals(); });

it('clears disabled bindings in the open editor and draft, preserving edits and active routes', async () => {
    act(() => { root.render(<Harness />); });
    await act(async () => { await reload?.(); });
    const state = JSON.parse(host.textContent || '{}') as { editingAgent: AgentDraft; draft: SettingsDraft };
    expect(state.editingAgent).toEqual({ ...bot, provider: '', model: '', reasoning_effort: null });
    expect(state.draft.ai.agents).toEqual([{ ...bot, provider: '', model: '', reasoning_effort: null }, active]);
    expect(state.draft.ai.active_agent_id).toBe('principal');
});
