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
