import { describe, expect, it } from 'vitest';

import {
  hydrateMailMessageIdentity,
  isSameMailMessage,
  mailMessageIdentity,
  mailThreadIdentity,
  selectMailDisplayMessage,
} from './mailIdentity';


const first = {
  account: 'first@example.test',
  id: 'shared-id',
  imap_folder: 'INBOX',
  imap_uid: '42',
  source: 'imap',
  thread_id: 'shared-thread',
};


describe('mail structural identity', () => {
  it('separates colliding provider ids by account and folder', () => {
    const otherAccount = { ...first, account: 'second@example.test' };
    const otherFolder = { ...first, imap_folder: 'Archive' };

    expect(mailMessageIdentity(first)).not.toBe(mailMessageIdentity(otherAccount));
    expect(mailMessageIdentity(first)).not.toBe(mailMessageIdentity(otherFolder));
    expect(mailThreadIdentity(first)).not.toBe(mailThreadIdentity(otherAccount));
    expect(mailThreadIdentity(first)).not.toBe(mailThreadIdentity(otherFolder));
  });

  it('rejects stale viewer detail from another account with the same raw id', () => {
    const staleDetail = { ...first, account: 'first@example.test' };
    const nextSelection = { ...first, account: 'second@example.test' };

    expect(isSameMailMessage(staleDetail, nextSelection)).toBe(false);
    expect(isSameMailMessage(staleDetail, first)).toBe(true);
    expect(selectMailDisplayMessage(staleDetail, nextSelection))
      .toBe(nextSelection);
  });

  it('hydrates sparse detail identity without weakening account scope', () => {
    const detail = hydrateMailMessageIdentity(
      { id: 'shared-id' },
      first,
      first.account,
    );

    expect(isSameMailMessage(detail, first)).toBe(true);
    expect(selectMailDisplayMessage(detail, first)).toBe(detail);
    expect(isSameMailMessage(detail, {
      ...first,
      account: 'other@example.test',
    })).toBe(false);
  });

  it('accepts hydrated detail for an account-less matching selection', () => {
    const selected = {
      id: 'aggregate-id',
      imap_uid: '42',
      source: 'imap',
      thread_id: 'aggregate-thread',
    };
    const detail = {
      ...selected,
      account: 'resolved@example.test',
      imap_folder: 'Archive',
    };

    expect(selectMailDisplayMessage(detail, selected)).toBe(detail);
  });

  it('rejects hydrated detail that conflicts with a supplied discriminator', () => {
    const selected = {
      id: 'aggregate-id',
      imap_folder: 'INBOX',
      imap_uid: '42',
      source: 'imap',
      thread_id: 'aggregate-thread',
    };
    const conflictingDetail = {
      ...selected,
      account: 'resolved@example.test',
      imap_folder: 'Archive',
    };

    expect(selectMailDisplayMessage(conflictingDetail, selected)).toBe(selected);
  });
});
