import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chatStreamRoute, integrationsDocumentRoute, mailApiPath } from './api-routes.ts';

test('mail fixtures preserve endpoint suffixes in legacy and scoped routes', () => {
  for (const prefix of ['/api/mail', '/api/v1/vaults/fixture/mail', '/api/v1/vaults/fixture%20space/mail']) {
    const url = new URL(`${prefix}/messages/imap_777/reply?folder=Clients`, 'http://127.0.0.1:5199');
    assert.equal(mailApiPath(url), '/api/mail/messages/imap_777/reply');
    assert.equal(url.searchParams.get('folder'), 'Clients');
  }
  for (const path of ['/src/shared/api/mail.ts', '/api/mailboxes/messages',
    '/api/v1/vaults//mail/events', '/other/api/mail/messages', '/api/chat']) {
    assert.equal(mailApiPath(new URL(path, 'http://127.0.0.1:5199')), null);
  }
});

test('integration mocks match only the API document, not source modules or other endpoints', () => {
  for (const path of ['/api/integrations', '/api/integrations?fixture=1']) {
    assert.equal(integrationsDocumentRoute(new URL(path, 'http://127.0.0.1:5199')), true);
  }
  for (const path of ['/src/shared/api/integrations.ts', '/api/integrations/default_mail',
    '/other/api/integrations', '/api/integrations-test']) {
    assert.equal(integrationsDocumentRoute(new URL(path, 'http://127.0.0.1:5199')), false);
  }
});

test('intercepts legacy and vault-scoped chat, retaining encoded slugs and queries', () => {
  for (const path of ['/api/chat', '/api/chat?fixture=1',
    '/api/v1/vaults/acceptance-vault/ai/chat', '/api/v1/vaults/recerca%20personal/ai/chat?fixture=1']) {
    assert.equal(chatStreamRoute(new URL(path, 'http://127.0.0.1:5199')), true);
  }
});

test('does not hide session, replay, confirmation or unrelated requests', () => {
  for (const path of ['/api/chats', '/api/chat/sessions/a/b', '/api/chat/streams/id',
    '/api/chat/confirmations', '/api/v1/vaults//ai/chat',
    '/api/v1/vaults/fixture/ai/chat/streams/id', '/api/v1/vaults/fixture/other/chat',
    '/elsewhere/api/chat', '/api/notebooks']) {
    assert.equal(chatStreamRoute(new URL(path, 'http://127.0.0.1:5199')), false);
  }
});
