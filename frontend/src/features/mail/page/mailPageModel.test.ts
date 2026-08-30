import { describe, expect, it } from 'vitest';

import type { IntegrationsDocument } from '../../../shared/api/integrations';
import type { MailCounts } from '../../../shared/api/mail';
import {
  adjacentMail,
  buildMailAccountCatalog,
  draftComposeData,
  mergeMailCounts,
  type MailPageMessage,
} from './mailPageModel';


describe('mailPageModel', () => {
  it('normalizes, deduplicates, and expands configured mail identities', () => {
    const document: IntegrationsDocument = {
      default_mail: 'main@example.test',
      emails: [{ username: 'imap@example.test' }],
      mail_accounts: [{
        aliases: [{ display_name: 'Editorial', email: 'alias@example.test' }],
        email: 'main@example.test',
      }, {
        email: 'MAIN@example.test',
      }, {
        email: 42,
      }],
    };

    const catalog = buildMailAccountCatalog(document);

    expect(catalog.accounts.map((account) => account.email ?? account.username))
      .toEqual(['main@example.test', 'imap@example.test']);
    expect(catalog.selectedAccount?.email).toBe('main@example.test');
    expect(catalog.defaultAccount?.email).toBe('main@example.test');
    expect(catalog.identities).toHaveLength(3);
    const alias = catalog.identities.at(1);
    expect(alias?.email).toBe('alias@example.test');
    expect(alias?.name).toBe('Editorial');
    expect(alias?.smtp_email).toBe('main@example.test');
  });

  it('keeps the historical fallback when no default account is configured', () => {
    const catalog = buildMailAccountCatalog({
      mail_accounts: [{ email: 'first@example.test' }],
    });

    expect(catalog.selectedAccount).toBeNull();
    expect(catalog.defaultAccount?.email).toBe('first@example.test');
  });

  it('merges folder counts across accounts', () => {
    const results: MailCounts[] = [{
      INBOX: { total: 4, unread: 2 },
      SENT: { total: 1, unread: 0 },
    }, {
      INBOX: { total: 3, unread: 1 },
    }];

    expect(mergeMailCounts(results)).toEqual({
      INBOX: { total: 7, unread: 3 },
      SENT: { total: 1, unread: 0 },
    });
  });

  it('selects adjacent messages and maps Vault drafts for composition', () => {
    const messages: MailPageMessage[] = [{ id: 'one' }, { id: 'two' }];
    expect(adjacentMail(messages, 'one')?.id).toBe('two');
    expect(adjacentMail(messages, 'two')?.id).toBe('one');
    expect(adjacentMail(messages, 'missing')).toBeNull();

    expect(draftComposeData({
      body_text: 'Body',
      cc: ['copy@example.test', 'other@example.test'],
      id: 'draft',
      recipient: ['reader@example.test'],
      subject: '(Esborrany)',
    })).toEqual({
      _draftId: 'draft',
      initialBody: 'Body',
      initialCc: ['copy@example.test', 'other@example.test'],
      initialSubject: '',
      initialTo: ['reader@example.test'],
    });
  });
});
