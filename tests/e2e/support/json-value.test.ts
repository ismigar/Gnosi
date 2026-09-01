import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isJsonObject, requireJsonObject, requireStringList } from './json-value.ts';

test('JSON object validation rejects scalars, null and arrays without echoing values', () => {
  for (const value of [null, undefined, [], 'sensitive-marker', 1, false]) {
    assert.equal(isJsonObject(value), false);
    assert.throws(() => requireJsonObject(value), {
      message: 'Expected a JSON object in the test contract',
    });
  }
});

test('JSON object validation preserves the actual object and nested values', () => {
  const value = { nested: ['fixture'], additional: null };
  assert.equal(requireJsonObject(value), value);
  assert.equal(requireJsonObject(value).nested, value.nested);
});

test('string list validation accepts an empty list and preserves order', () => {
  assert.deepEqual(requireStringList([]), []);
  assert.deepEqual(requireStringList(['pdf', 'web', 'pdf']), ['pdf', 'web', 'pdf']);
});

test('string list validation rejects malformed roots and mixed elements', () => {
  for (const value of [null, undefined, {}, 'resource', [1], ['pdf', false]]) {
    assert.throws(() => requireStringList(value), /Expected .* in the test contract/);
  }
});
