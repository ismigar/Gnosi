import { describe, expect, it } from 'vitest';

import {
  canUseMailBody,
  hydrateMailMessageIdentity,
  isSameMailMessage,
  isSameMailMessageContent,
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
    expect(mailMessageIdentity(first)).not.toBe(mailMessageIdentity({ ...first, imap_folder: ' INBOX ' }));
  });

  it('shares content across IMAP folders only for a nonempty matching account and Internet Message-ID', () => {
    const selected = { ...first, internet_message_id: '<delivery@example.test>' };
    const alias = { ...selected, account: ' FIRST@example.test ', id: 'imap_901', imap_folder: '[Gmail]/All Mail', imap_uid: '901' };
    expect(isSameMailMessageContent(alias, selected)).toBe(true);
    expect(isSameMailMessage(alias, selected)).toBe(false);
    expect(isSameMailMessageContent({ ...alias, account: 'other@example.test' }, selected)).toBe(false);
    expect(isSameMailMessageContent({ ...alias, internet_message_id: ' ' }, selected)).toBe(false);
    expect(isSameMailMessageContent({ ...alias, internet_message_id: '<other@example.test>' }, selected)).toBe(false);
    expect(isSameMailMessageContent({ ...alias, account: null }, { ...selected, account: null })).toBe(false);
    expect(isSameMailMessageContent({ ...alias, source: 'vault' }, selected)).toBe(false);
  });

  it('rejects stale viewer detail from another account with the same raw id', () => {
    const staleDetail = { ...first, account: 'first@example.test' };
    const nextSelection = { ...first, account: 'second@example.test' };

    expect(isSameMailMessage(staleDetail, nextSelection)).toBe(false);
    expect(isSameMailMessage(staleDetail, first)).toBe(true);
    expect(selectMailDisplayMessage(staleDetail, nextSelection))
      .toBe(nextSelection);
  });

  it('rejects a reused Internet Message-ID when Gmail identifies a different thread', () => {
    const selected = { ...first, internet_message_id: '<reused@example.test>', gm_thrid: '123' };
    const alias = { ...selected, id: 'imap_901', imap_folder: '[Gmail]/All Mail', imap_uid: '901' };
    expect(isSameMailMessageContent(alias, selected)).toBe(true);
    expect(isSameMailMessageContent({ ...alias, gm_thrid: '456' }, selected)).toBe(false);
    expect(isSameMailMessageContent({ ...alias, gm_thrid: null }, selected)).toBe(true);
  });

  it('keeps action identity scoped to the UID while refusing contradictory content IDs', () => {
    const before = { ...first, internet_message_id: '<before@example.test>' };
    const replacement = { ...first, internet_message_id: '<replacement@example.test>' };
    expect(isSameMailMessage(before, replacement)).toBe(true);
    expect(isSameMailMessageContent(before, replacement)).toBe(false);
    expect(isSameMailMessageContent(replacement, before)).toBe(false);
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

  it('uses an explicit detail account alias before hydrating the selected account', () => {
    const detail = hydrateMailMessageIdentity({ id: first.id, account_email: 'other@example.test' }, first);
    expect(canUseMailBody(first, detail, '')).toBe(false);
    expect(canUseMailBody(first, { ...first, account_email: 'other@example.test' }, '')).toBe(false);
    expect(canUseMailBody(first, { ...first, account_email: ' FIRST@example.test ' }, '')).toBe(true);
  });

  it('keeps sparse mailbox and inferred provider discriminators exact', () => {
    const sparse = { ...first, imap_folder: 'Projects', imap_uid: undefined };
    expect(canUseMailBody(sparse, { ...first, imap_folder: 'Projects' }, '')).toBe(true);
    expect(canUseMailBody(sparse, { ...first, imap_folder: 'projects' }, '')).toBe(false);
    expect(canUseMailBody(sparse, { ...first, imap_folder: ' Projects ' }, '')).toBe(false);
    const inferred = { ...first, id: 'imap_42', source: undefined, imap_folder: undefined };
    expect(canUseMailBody(inferred, { ...first, id: 'imap_42' }, '')).toBe(true);
    expect(canUseMailBody(inferred, { ...first, id: 'imap_42', source: 'microsoft' }, '')).toBe(false);
  });

  it('preserves numeric IMAP ID aliases while rejecting contradictory response IDs', () => {
    const selected = { ...first, id: '42' };
    expect(canUseMailBody(selected, { ...first, id: 'imap_42' }, '')).toBe(true);
    expect(canUseMailBody({ ...selected, imap_uid: undefined }, { ...first, id: 'imap_42' }, '')).toBe(true);
    expect(canUseMailBody({ ...first, id: 'imap_42' }, { ...first, id: 'imap_99' }, '')).toBe(false);
    expect(canUseMailBody({ ...first, id: 'imap_42' }, { ...first, id: 'opaque-other-id' }, '')).toBe(false);
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

  it('accepts a missing folder hydrated within a known account and rejects account collisions', () => {
    const selected = { ...first, imap_folder: undefined };
    const detail = { ...first, imap_folder: 'Inbox/Personal' };
    expect(selectMailDisplayMessage(detail, selected)).toBe(detail);
    expect(isSameMailMessageContent(selected, detail)).toBe(true);
    expect(selectMailDisplayMessage({ ...detail, account: 'other@example.test' }, selected)).toBe(selected);
    expect(isSameMailMessageContent(selected, { ...detail, account: 'other@example.test' })).toBe(false);
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
