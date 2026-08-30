import { describe, expect, it, vi } from 'vitest';

import {
  RELATION_UNLINKED_EVENT,
  normalizeRelationValues,
  unlinkRelationFromRecord,
  withoutRelationValue,
} from './relationItemUtils';
import {
  subscribeAppEvent,
  type RelationUnlinkedEventDetail,
} from '../../shared/platform/app-events';

describe('relation item values', () => {
  it('normalizes arrays and legacy comma-separated values', () => {
    expect(
      normalizeRelationValues([' first ', '', null, 'second']),
    ).toEqual(['first', 'second']);
    expect(normalizeRelationValues('first, second, ')).toEqual([
      'first',
      'second',
    ]);
  });

  it('removes only the selected relation and keeps order', () => {
    expect(
      withoutRelationValue(['first', 'second', 'third'], 'second'),
    ).toEqual(['first', 'third']);
  });

  it('coerces nested values without flattening array items or mutating their sources', () => {
    const nested = { extension: { values: [null] } };
    const pair = [' first ', 'second'];
    const value: unknown = [nested, pair, null, undefined, [], [null], false, 0];

    expect(normalizeRelationValues(value)).toEqual(['[object Object]', 'first ,second', 'false', '0']);
    expect(normalizeRelationValues(nested)).toEqual(['[object Object]']);
    expect(normalizeRelationValues(null)).toEqual([]);
    expect(normalizeRelationValues({ toString: () => ' first, second ' })).toEqual(['first', 'second']);
    expect(withoutRelationValue(value, '[object Object]')).toEqual(['first ,second', 'false', '0']);
    expect(value).toEqual([nested, pair, null, undefined, [], [null], false, 0]);
    expect(pair).toEqual([' first ', 'second']);
    expect(Object.isFrozen(pair)).toBe(false);
  });

  it('propagates coercion failures without calling update', async () => {
    const error = new Error('Cannot coerce relation');
    const value: unknown = { toString: () => { throw error; } };
    const onUpdate = vi.fn();

    expect(() => normalizeRelationValues(value)).toThrow(error);
    await expect(unlinkRelationFromRecord({
      pageId: 'page-1', metadataKey: 'source', value, relationId: 'first', onUpdate,
    })).rejects.toBe(error);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('does not announce failed saves or change the input array', async () => {
    const error = new Error('Save failed');
    const value = [{ nested: [null] }, ['second']];
    const onUpdate = vi.fn().mockRejectedValue(error);
    const listener = vi.fn();
    const unsubscribe = subscribeAppEvent(RELATION_UNLINKED_EVENT, listener);

    try {
      await expect(unlinkRelationFromRecord({
        pageId: 'page-1', metadataKey: 'source', value, relationId: '[object Object]', onUpdate,
      })).rejects.toBe(error);
      expect(onUpdate).toHaveBeenCalledWith('page-1', { metadata: { source: ['second'] } });
      expect(listener).not.toHaveBeenCalled();
      expect(value).toEqual([{ nested: [null] }, ['second']]);
    } finally {
      unsubscribe();
    }
  });

  it('announces only after the mutable patch callback resolves', async () => {
    let finishSave: (() => void) | undefined;
    const saved = new Promise<void>((resolve) => { finishSave = resolve; });
    const value: unknown = [{ nested: [null] }, ['second']];
    const listener = vi.fn();
    const unsubscribe = subscribeAppEvent(RELATION_UNLINKED_EVENT, listener);
    const onUpdate = vi.fn((_pageId: string, patch: { metadata: Record<string, string[]> }) => {
      patch.metadata.source?.push('callback-added');
      return saved;
    });

    try {
      const operation = unlinkRelationFromRecord({
        pageId: 'page-1', metadataKey: 'source', value, relationId: '[object Object]', onUpdate,
      });
      expect(onUpdate).toHaveBeenCalledOnce();
      expect(listener).not.toHaveBeenCalled();
      finishSave?.();
      await expect(operation).resolves.toBe(true);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        previousValue: ['[object Object]', 'second'], nextValue: ['second', 'callback-added'],
      }), expect.objectContaining({ type: RELATION_UNLINKED_EVENT }));
      expect(value).toEqual([{ nested: [null] }, ['second']]);
    } finally {
      finishSave?.();
      unsubscribe();
    }
  });

  it('skips updates for missing identifiers and absent relations', async () => {
    const onUpdate = vi.fn();
    await expect(unlinkRelationFromRecord({
      pageId: '', metadataKey: 'source', value: ['first'], relationId: 'first', onUpdate,
    })).resolves.toBe(false);
    await expect(unlinkRelationFromRecord({
      pageId: 'page-1', metadataKey: 'source', value: [null, ['first']], relationId: 'missing', onUpdate,
    })).resolves.toBe(false);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('persists a partial metadata patch and announces an undoable operation', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const eventPromise = new Promise<RelationUnlinkedEventDetail>((resolve) => {
      const unsubscribe = subscribeAppEvent(
        RELATION_UNLINKED_EVENT,
        (detail) => {
          unsubscribe();
          resolve(detail);
        },
      );
    });

    await unlinkRelationFromRecord({
      pageId: 'page-1',
      field: 'Source',
      metadataKey: 'source_alias',
      value: ['source-1', 'source-2'],
      relationId: 'source-1',
      relationTitle: 'First source',
      onUpdate,
    });

    const detail = await eventPromise;
    expect(onUpdate).toHaveBeenCalledWith('page-1', {
      metadata: { source_alias: ['source-2'] },
    });
    expect(detail).toMatchObject({
      pageId: 'page-1',
      metadataKey: 'source_alias',
      previousValue: ['source-1', 'source-2'],
      nextValue: ['source-2'],
    });
  });
});
