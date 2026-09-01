import { describe, expect, it, vi } from 'vitest';
import { coercePageProperty } from './propertyCoercion';
import { pageContextCallbacks } from './contextBridge';
import { inputValue, periodInput, planningSettings, previewTitle, relationInput } from './valueBoundaries';
import type { PageEditorProps } from './types';

describe('page context bridge', () => {
  const base: PageEditorProps = { noteFilename: 'fixture', EditorInner: () => null };
  it('forwards navigation and creation arguments without replacing metadata', () => {
    const open = vi.fn();
    const create = vi.fn();
    const context = pageContextCallbacks({ ...base, onOpenPage: open, onCreateRecord: create }, vi.fn());
    const metadata = { title: 'Fixture', extension: { preserve: true } };
    const template = { id: 'template', title: 'Template' };
    context.onOpenPage?.('destination');
    context.onCreateRecord?.('table', metadata, template);
    expect(open).toHaveBeenCalledWith('destination');
    expect(create).toHaveBeenCalledWith('table', metadata, template);
    expect(create.mock.calls[0]?.[1]).toBe(metadata);
  });
  it('keeps embedded view references intact and rejects malformed boundary inputs', () => {
    const open = vi.fn();
    const context = pageContextCallbacks({ ...base, onOpenPage: vi.fn() }, open);
    const block = { id: 'block', props: { view_id: 'view', heading_level: 1 } };
    context.onOpenPageViewModal?.('table', block);
    expect(open).toHaveBeenCalledWith('table', block);
    expect(() => context.onOpenPage?.({ invalid: true })).toThrow(TypeError);
    expect(() => context.onOpenPageViewModal?.(7)).toThrow(TypeError);
  });
});

describe('legacy property value boundaries', () => {
  it('validates unknown plugin settings and retains valid values and extension fields', () => {
    for (const value of [undefined, null, false, 7, 'invalid', []]) {
      expect(planningSettings(value)).toEqual({});
    }
    const extension = { preserve: true };
    const settings = { hours_per_day: 8, workday_start: '09:00', working_weekdays: [1, 2], holidays: ['2026-08-30'], task_table_id: 'tasks', extension };
    expect(planningSettings(settings)).toEqual(settings);
    expect(planningSettings(settings).extension).toBe(extension);
  });
  it('preserves string and rich option coercion behavior without normalizing saved values', () => {
    expect(coercePageProperty('ONE', 'select', { options: ['one'] })).toEqual({ value: 'one' });
    expect(coercePageProperty('', 'select', { options: [{ name: 'rich' }] })).toEqual({ value: '' });
    expect(coercePageProperty('plain', 'select', { options: [{ name: 'rich' }, 'plain'] })).toEqual({ value: 'plain' });
    // The shared legacy coercer calls .trim on a rich row when there is no exact match.
    expect(() => coercePageProperty('other', 'select', { options: [{ name: 'rich' }] })).toThrow(TypeError);
  });
  it('keeps primitive display coercion and relation normalization input', () => {
    expect(inputValue(0)).toBe('');
    expect(inputValue(false)).toBe('');
    expect(inputValue({ custom: true })).toBe('[object Object]');
    expect(relationInput(['page', 7, null])).toEqual(['page', 7, null]);
    expect(previewTitle({ title: ' Fixture ' })).toBe('Fixture');
  });
  it('retains structured periods and their extension fields', () => {
    const value = { start: '2026-08-30', end: '2026-08-31', durationValue: 2, extension: { preserve: true }, dependencies: [{ predecessorId: 'before', type: 'FS', lagMinutes: 0 }] };
    expect(periodInput(value)).toEqual(value);
  });
});
