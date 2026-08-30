import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  USER_EMAIL_STORAGE_KEY,
  USER_ID_STORAGE_KEY,
} from '../../../shared/api/request-context';
import {
  removeStorage,
  writeStorage,
} from '../../../shared/platform/browser-storage';
import {
  buildCollaborationWebSocketUrl,
} from './collabProvider';
import { ensureBackendOrigin } from '../../../shared/platform/electron';


vi.mock('../../../shared/platform/electron', () => ({
  ensureBackendOrigin: vi.fn(),
}));


describe('collaboration WebSocket URL', () => {
  beforeEach(() => {
    removeStorage(USER_EMAIL_STORAGE_KEY);
    removeStorage(USER_ID_STORAGE_KEY);
    vi.mocked(ensureBackendOrigin).mockResolvedValue('https://gnosi.test');
  });

  afterEach(() => {
    removeStorage(USER_EMAIL_STORAGE_KEY);
    removeStorage(USER_ID_STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it('uses the backend origin and typed request-context identity', async () => {
    writeStorage(USER_ID_STORAGE_KEY, 'user 42');
    writeStorage(USER_EMAIL_STORAGE_KEY, 'persona@example.test');

    await expect(buildCollaborationWebSocketUrl('folder/page')).resolves.toBe(
      'wss://gnosi.test/api/vault/collab/folder%2Fpage'
      + '?user_id=user+42&name=persona%40example.test',
    );
  });

  it('keeps anonymous fallbacks when identity is absent', async () => {
    await expect(buildCollaborationWebSocketUrl('page')).resolves.toBe(
      'wss://gnosi.test/api/vault/collab/page'
      + '?user_id=anon&name=An%C3%B2nim',
    );
  });
});
