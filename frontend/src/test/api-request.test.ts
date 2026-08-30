import { afterEach, describe, expect, it } from 'vitest';
import { defineStorageKey, readStorage, removeStorage, stringStorageCodec, writeStorage } from '../shared/platform/browser-storage';
import { requestAt, resetApiTestStorage, writeApiTestStorage } from './api-request';

const sessionKey = defineStorageKey('fixture.session', stringStorageCodec, 'session');
afterEach(() => { resetApiTestStorage(); removeStorage(sessionKey); });

describe('isolated API test support', () => {
  it('preserves exact keys and string values without schema coercion', () => {
    writeApiTestStorage('gnosi_active_vault', 'vault-a');
    writeApiTestStorage('gnosi_workspace_id', 'workspace-a');
    writeApiTestStorage('fixture.opaque', '{"text":"à🧠","flag":false}');
    expect(readStorage(defineStorageKey('gnosi_active_vault', stringStorageCodec))).toBe('vault-a');
    expect(readStorage(defineStorageKey('gnosi_workspace_id', stringStorageCodec))).toBe('workspace-a');
    expect(readStorage(defineStorageKey('fixture.opaque', stringStorageCodec))).toBe('{"text":"à🧠","flag":false}');
  });
  it('resets all persistent test keys idempotently without erasing session state', () => {
    writeApiTestStorage('fixture.first', 'one'); writeApiTestStorage('fixture.second', 'two'); writeStorage(sessionKey, 'keep');
    resetApiTestStorage(); resetApiTestStorage();
    expect(readStorage(defineStorageKey('fixture.first', stringStorageCodec))).toBeUndefined();
    expect(readStorage(defineStorageKey('fixture.second', stringStorageCodec))).toBeUndefined();
    expect(readStorage(sessionKey)).toBe('keep');
  });
  it('preserves an existing Request object and reports missing mock calls explicitly', () => {
    const request = new Request(`${window.location.origin}/api/health`);
    expect(requestAt([[request]], 0)).toBe(request);
    expect(() => requestAt([], 0)).toThrow('Expected fetch call 0');
  });
  it('resolves relative mock calls with their method and one-shot body intact', async () => {
    const request = requestAt([['/api/fixture', { method: 'POST', body: '{"exact":true}' }]], 0);
    expect(new URL(request.url).pathname).toBe('/api/fixture'); expect(request.method).toBe('POST');
    await expect(request.text()).resolves.toBe('{"exact":true}');
  });
});
