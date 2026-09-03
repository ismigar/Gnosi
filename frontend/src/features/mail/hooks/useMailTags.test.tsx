import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GnosiApiError } from '../../../shared/api/errors';
import * as mailApi from '../../../shared/api/mail';
import type { MailTag } from '../../../shared/api/mail';
import { mailMessageIdentity, type MailIdentityMessage } from '../mailIdentity';
import {
  MailTagsProvider,
  useMailTags,
  type MailTagsContextValue,
} from './useMailTags';


vi.mock('../../../shared/api/mail', () => ({
  createMailTag: vi.fn(),
  deleteMailTag: vi.fn(),
  fetchMailMessageTags: vi.fn(),
  fetchMailTags: vi.fn(),
  fetchTaggedMailMessages: vi.fn(),
  fetchTagsForMailMessages: vi.fn(),
  fetchTagsForScopedMailMessages: vi.fn(),
  setMailMessageTags: vi.fn(),
  updateMailTag: vi.fn(),
}));


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


interface HookValueRef {
  current: MailTagsContextValue | null;
}


const hookValueRef: HookValueRef = { current: null };
let container: HTMLDivElement | null = null;
let root: Root | null = null;


beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mailApi.fetchMailTags).mockResolvedValue([]);
  hookValueRef.current = null;
});


afterEach(async () => {
  const mountedRoot = root;
  if (mountedRoot) {
    await act(async () => {
      mountedRoot.unmount();
      await Promise.resolve();
    });
  }
  container?.remove();
  container = null;
  root = null;
});


function Probe({ valueRef }: { readonly valueRef: HookValueRef }): null {
  const value = useMailTags();
  useEffect(() => {
    valueRef.current = value;
  }, [value, valueRef]);
  return null;
}


async function renderHook(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MailTagsProvider>
        <Probe valueRef={hookValueRef} />
      </MailTagsProvider>,
    );
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}


function currentHook(): MailTagsContextValue {
  const value = hookValueRef.current;
  if (!value) throw new Error('Mail tags hook did not mount');
  return value;
}


function tag(id: string, name: string, color: string): MailTag {
  return { color, created_at: null, id, name };
}


function message(
  account: string,
  folder = 'INBOX',
): MailIdentityMessage {
  return {
    account,
    id: 'message-1',
    imap_folder: folder,
    imap_uid: '42',
    source: 'imap',
  };
}


function httpError(): GnosiApiError {
  return new GnosiApiError(
    new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    }),
    { detail: 'backend failure' },
  );
}


describe('useMailTags', () => {
  it('keeps state and mutation behavior through typed mail helpers', async () => {
    const initial = tag('tag-1', 'Initial', '#111111');
    const created = tag('tag-2', 'Created', '#222222');
    const updated = { ...created, name: 'Updated' };
    vi.mocked(mailApi.fetchMailTags).mockResolvedValue([initial]);
    vi.mocked(mailApi.createMailTag).mockResolvedValue(created);
    vi.mocked(mailApi.updateMailTag).mockResolvedValue(updated);
    vi.mocked(mailApi.deleteMailTag).mockResolvedValue(undefined);
    vi.mocked(mailApi.setMailMessageTags).mockResolvedValue({
      status: 'success',
      tag_ids: ['tag-2'],
    });

    await renderHook();
    expect(currentHook().loading).toBe(false);
    expect(currentHook().tags).toEqual([initial]);

    await act(async () => {
      await currentHook().createTag({ name: 'Created', color: '#222222' });
    });
    expect(mailApi.createMailTag).toHaveBeenCalledWith({
      color: '#222222',
      name: 'Created',
    });
    expect(currentHook().tags).toEqual([initial, created]);

    await act(async () => {
      await currentHook().updateTag('tag-2', {
        color: '#222222',
        name: 'Updated',
      });
    });
    expect(currentHook().tags).toEqual([initial, updated]);

    const scopedMessage = message('ada@example.test');
    await currentHook().setMessageTags(scopedMessage, ['tag-2'], {
      account_email: 'ada@example.test',
      date: '2026-08-29',
      sender: 'Grace',
      subject: 'Research',
    });
    expect(mailApi.setMailMessageTags).toHaveBeenCalledWith('message-1', {
      account_email: 'ada@example.test',
      date_str: '2026-08-29',
      identity_scope: {
        account_email: 'ada@example.test',
        imap_folder: 'INBOX',
        imap_uid: '42',
        source: 'imap',
      },
      sender: 'Grace',
      subject: 'Research',
      tag_ids: ['tag-2'],
    });

    await act(async () => {
      await currentHook().deleteTag('tag-1');
    });
    expect(currentHook().tags).toEqual([updated]);
  });

  it('preserves HTTP fallbacks and rethrows network failures', async () => {
    await renderHook();
    vi.mocked(mailApi.fetchMailMessageTags).mockRejectedValueOnce(httpError());
    vi.mocked(mailApi.fetchTaggedMailMessages).mockRejectedValueOnce(httpError());
    vi.mocked(mailApi.fetchTagsForScopedMailMessages).mockRejectedValueOnce(httpError());

    const scopedMessage = message('ada@example.test');
    await expect(currentHook().getMessageTags(scopedMessage)).resolves.toEqual([]);
    await expect(currentHook().getTaggedMessages('tag-1')).resolves.toEqual({
      messages: [],
      tag: null,
    });
    await expect(currentHook().getBatchMessageTags([scopedMessage]))
      .resolves.toEqual({ [mailMessageIdentity(scopedMessage)]: [] });

    const networkError = new Error('network unavailable');
    vi.mocked(mailApi.fetchMailMessageTags).mockRejectedValueOnce(networkError);
    await expect(currentHook().getMessageTags({
      ...scopedMessage,
      id: 'message-2',
      imap_uid: '43',
    }))
      .rejects.toBe(networkError);
  });

  it('keeps colliding raw ids isolated by the returned composite key', async () => {
    const first = message('first@example.test', 'INBOX');
    const second = message('second@example.test', 'Archive');
    vi.mocked(mailApi.fetchTagsForScopedMailMessages).mockResolvedValue({
      [mailMessageIdentity(first)]: ['tag-a'],
      [mailMessageIdentity(second)]: ['tag-b'],
    });
    await renderHook();

    await expect(currentHook().getBatchMessageTags([first, second])).resolves.toEqual({
      [mailMessageIdentity(first)]: ['tag-a'],
      [mailMessageIdentity(second)]: ['tag-b'],
    });
    expect(mailApi.fetchTagsForScopedMailMessages).toHaveBeenCalledWith([
      {
        account_email: 'first@example.test',
        imap_folder: 'INBOX',
        imap_uid: '42',
        message_id: 'message-1',
        source: 'imap',
      },
      {
        account_email: 'second@example.test',
        imap_folder: 'Archive',
        imap_uid: '42',
        message_id: 'message-1',
        source: 'imap',
      },
    ]);
  });

  it('keeps legacy mutation messages for HTTP failures', async () => {
    await renderHook();
    vi.mocked(mailApi.createMailTag).mockRejectedValueOnce(httpError());

    await expect(currentHook().createTag({
      color: '#000000',
      name: 'Broken',
    })).rejects.toThrow('Error creant etiqueta');
  });
});
