import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LlmWikiFieldAssignments } from './LlmWikiFieldAssignments';
import { EMPTY_LLM_WIKI_DRAFT, normalizeLlmWikiDraft, serializeLlmWikiDraft, type LlmWikiSource } from './llmWikiModel';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, options: { defaultValue: string }) => options.defaultValue }) }));
let host: HTMLDivElement;
let root: Root;
let latest: LlmWikiSource;
const initial: LlmWikiSource = {
    table_id: 'resources', dimension_mappings: {}, attachment_property_ids: [], include_body: false,
    language_property_id: '', relation_property_id: '', title_property_id: '', url_property_ids: [],
};
const brain = { id: 'brain', name: 'Brain', properties: [
    { id: 'tags', name: 'Tags', type: 'multi_select' },
    { id: 'done', name: 'Done', type: 'checkbox' },
    { id: 'score', name: 'Score', type: 'number' },
    { id: 'computed', name: 'Calculated', type: 'formula' },
] };
function Harness() {
    const [source, updateSource] = useState(initial);
    useEffect(() => { latest = source; }, [source]);
    return <LlmWikiFieldAssignments brainTable={brain} source={source} properties={[]}
        draft={{ ...EMPTY_LLM_WIKI_DRAFT, index_field_ids: ['tags'] }} serverState={null} updateSource={updateSource} />;
}
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div'); root = createRoot(host);
    act(() => { root.render(<Harness />); });
});
afterEach(() => { act(() => { root.unmount(); }); vi.unstubAllGlobals(); });
function select(label: string, value: string) {
    const element = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
    if (!element) throw new Error(`Missing ${label}`);
    act(() => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); });
}

it('adds a non-index field, removes a legacy field, and keeps false after save/reload', () => {
    expect(host.querySelector('option[value="computed"]')).toBeNull();
    select('Add field', 'done');
    expect(latest.assignment_field_ids).toEqual(['tags', 'done']);
    select('Done: Assignment', 'fixed');
    expect(latest.dimension_mappings.done?.fixed_value).toBe(false);
    const remove = host.querySelector<HTMLButtonElement>('button[aria-label="Remove field: Tags"]');
    act(() => { remove?.click(); });
    const saved = serializeLlmWikiDraft({ ...EMPTY_LLM_WIKI_DRAFT, index_field_ids: ['tags'], source_tables: [latest] });
    const restored = normalizeLlmWikiDraft(saved);
    expect(restored.index_field_ids).toEqual(['tags']);
    expect(restored.source_tables[0]?.assignment_field_ids).toEqual(['done']);
    expect(restored.source_tables[0]?.dimension_mappings.done?.fixed_value).toBe(false);
});

it('keeps a numeric zero and an explicitly empty assignment list', () => {
    select('Add field', 'score'); select('Score: Assignment', 'fixed');
    expect(latest.dimension_mappings.score?.fixed_value).toBe(0);
    for (const label of ['Tags', 'Score']) act(() => { host.querySelector<HTMLButtonElement>(`button[aria-label="Remove field: ${label}"]`)?.click(); });
    const draft = normalizeLlmWikiDraft(serializeLlmWikiDraft({ ...EMPTY_LLM_WIKI_DRAFT, source_tables: [latest] }));
    expect(draft.source_tables[0]?.assignment_field_ids).toEqual([]);
});

it('classifies idea type by default, supports explicit abstention, and protects workflow status', () => {
    const update = vi.fn((updater: (source: LlmWikiSource) => LlmWikiSource) => { latest = updater(initial); });
    act(() => { root.render(<LlmWikiFieldAssignments
        brainTable={{ ...brain, properties: [...brain.properties,
            { id: 'idea', name: 'Idea', type: 'select' }, { id: 'state', name: 'Workflow', type: 'status', role: 'status' }] }}
        draft={{ ...EMPTY_LLM_WIKI_DRAFT, brain_roles: { idea_type: 'idea' } }}
        source={{ ...initial, assignment_field_ids: ['state'] }} properties={[]} serverState={null} updateSource={update} />); });
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Idea: Assignment"]')?.value).toBe('ai');
    expect(host.querySelector('option[value="state"]')).toBeNull();
    expect(host.querySelector('select[aria-label="Workflow: Assignment"]')).toBeNull();
    select('Idea: Assignment', 'empty');
    expect(latest.assignment_field_ids).toEqual(['idea']);
    expect(latest.dimension_mappings.idea?.mode).toBe('empty');
});
