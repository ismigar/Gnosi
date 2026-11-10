import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import { buildRecordActions } from './recordActions';
const t = ((key: string, fallback?: string) => fallback || key) as TFunction;
const base = () => ({ note: { id: 'record', metadata: {} }, schema: {}, tableId: 'resources', isPluginEnabled: () => true, processingConfigured: false, executingButtonKey: null, t, language: 'ca', execute: vi.fn(), setPendingAction: vi.fn() });
const schema = { Text: 'text', Text_config: { translatable: true }, Social: 'text', Social_config: { system: true } };
describe('table-specific record actions', () => {
  it('does not offer actions from other tables', () => {
    expect(buildRecordActions(base())).toEqual([]);
    expect(buildRecordActions({ ...base(), schema }).map(item => item.key)).toEqual(['translate_row', 'publish_social']);
    expect(buildRecordActions({ ...base(), processingConfigured: true }).map(item => item.key)).toEqual(['process_resource']);
  });
  it('respects plugins, disabled functionalities, retired actions and translated records', () => {
    const functionalities = [{ id: 'disabled', action: 'set_fields', enabled: false }, { id: 'retired', action: 'sync_drupal' }, { id: 'translate', action: 'translate_row' }, { id: 'social', action: 'publish_social' }, { id: 'brain', action: 'process_resource' }];
    expect(buildRecordActions({ ...base(), schema, functionalities, processingConfigured: true, isPluginEnabled: () => false })).toEqual([]);
    expect(buildRecordActions({ ...base(), schema, functionalities, processingConfigured: true, note: { id: 'translated', metadata: { translation_lang: 'en' } } })).toEqual([]);
  });
  it('preserves configured labels/config and does not duplicate built-ins', () => {
    const input = { ...base(), schema, functionalities: [{ id: 'custom', action: 'translate_row', label: 'Translate title', config: { target: 'title' } }] };
    const actions = buildRecordActions(input);
    expect(actions.map(item => item.key)).toEqual(['functionality:custom', 'publish_social']);
    actions[0]?.onClick?.();
    expect(input.setPendingAction).toHaveBeenCalledWith({ noteId: 'record', action: 'translate_row', fieldConfig: { button_action: 'translate_row', button_config: { target: 'title' } } });
  });
  it('keeps rules and running operations disabled without replacing their labels', () => {
    const input = { ...base(), schema: { Status: 'select', Status_config: { role: 'status' } }, note: { id: 'record', metadata: { Status: 'Draft' } }, functionalities: [{ id: 'publish', action: 'publish_social', label: 'Publish' }], actionRules: { publish_social: { requires: [{ role: 'status', not_in: ['Draft'], reason: 'Needs review' }] } }, processingConfigured: true, job: { running: true } };
    const actions = buildRecordActions(input);
    expect(actions[0]).toMatchObject({ label: 'Publish', disabled: true, disabledReason: 'Needs review' });
    expect(actions[1]).toMatchObject({ disabled: true, label: 'Processing…' });
    actions.forEach(item => item.onClick?.());
    expect(input.setPendingAction).not.toHaveBeenCalled();
  });
  it('binds processing to its table and resumes interrupted jobs without force', () => {
    const input = { ...base(), processingConfigured: true, processed: 1234, job: { phase: 'error' } };
    buildRecordActions(input)[0]?.onClick?.();
    expect(input.setPendingAction).toHaveBeenLastCalledWith({ noteId: 'record', action: 'process_resource', sourceTableId: 'resources', force: false });
    buildRecordActions({ ...input, job: { phase: 'done' } })[0]?.onClick?.();
    expect(input.setPendingAction).toHaveBeenLastCalledWith({ noteId: 'record', action: 'process_resource', sourceTableId: 'resources', force: true });
  });
  it('dispatches each configured operation with its own config and busy state', () => {
    const input = { ...base(), functionalities: [{ id: 'assign', action: 'set_fields', config: { assignments: [{ field: 'Status', value: 'Done' }] } }, { id: 'skill', action: 'run_skill' }], executingButtonKey: 'record_skill' };
    const actions = buildRecordActions(input);
    actions.forEach(item => item.onClick?.());
    expect(input.execute).toHaveBeenCalledTimes(1);
    expect(input.execute).toHaveBeenCalledWith(expect.objectContaining({ id: 'assign', config: { assignments: [{ field: 'Status', value: 'Done' }] } }));
    expect(actions[1]?.disabled).toBe(true);
  });
});


describe('configured website record actions', () => {
  it('uses actual destinations and active publication receipts', () => {
    const input = base();
    expect(buildRecordActions(input).some(item => item.key === 'publish_website')).toBe(false);
    const destinations = [{ site_id: 'site', site_name: 'Example', target_id: 'local', target_name: 'Local', environment: 'staging', url: '', published_page_ids: [input.note.id] }];
    const actions = buildRecordActions({ ...input, websiteDestinations: destinations });
    expect(actions.map(item => item.key)).toEqual(['publish_website', 'withdraw_website']);
    actions[1]?.onClick?.();
    expect(input.setPendingAction).toHaveBeenCalledWith(expect.objectContaining({ noteId: input.note.id, action: 'withdraw_website' }));
    expect(buildRecordActions({ ...input, websiteDestinations: destinations, isPluginEnabled: () => false })).toEqual([]);
  });
});
