import { expect, test } from '@playwright/test';

import { integrationsDocumentRoute, mailApiPath } from '../../support/api-routes.ts';
import { installDisposableNetwork, seedDisposableBrowser } from '../../support/disposable-web.ts';

test('complete conversation opens the newest sent body and refreshes after a reply', async ({ context, page }) => {
  test.setTimeout(150_000);
  const audit = await installDisposableNetwork(context);
  await seedDisposableBrowser(context);
  await context.addInitScript(() => { localStorage.setItem('i18nextLng', 'en'); });
  const account = 'conversation@example.test';
  const folder = '[Gmail]/Tot el correu';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let replySent = false;
  let listReads = 0;
  const selected = {
    id: 'imap_42', imap_uid: '42', source: 'imap', account, imap_folder: 'INBOX',
    thread_id: 'imap_42', subject: 'Synthetic complete conversation',
    sender: 'Ada <ada@example.test>', recipient: account, type: 'Received',
    is_read: true, is_starred: false, timestamp: 1789034400, snippet: 'Latest received message',
  };
  const thread = Array.from({ length: 5 }, (_, index) => ({
    ...selected, id: `imap_${101 + index}`, imap_uid: String(101 + index),
    imap_folder: folder, thread_id: '123', timestamp: selected.timestamp + index * 60,
    sender: index % 2 === 0 ? account : `Participant ${index} <ada@example.test>`,
    recipient: index % 2 === 0 ? 'ada@example.test' : account,
    type: index % 2 === 0 ? 'Sent' : 'Received',
  }));
  await page.route(integrationsDocumentRoute, route => route.fulfill({ json: {
    mail_accounts: [{ email: account, provider: 'imap', display_name: 'Synthetic account', enabled: true }],
    default_mail: account,
  } }));
  await page.route(url => mailApiPath(url) !== null, route => {
    const url = new URL(route.request().url());
    const path = mailApiPath(url)!;
    if (path === '/api/mail/messages') {
      listReads += 1;
      return route.fulfill({ json: { messages: [selected], total: 1 } });
    }
    if (path === '/api/mail/threads/123') {
      return route.fulfill({ json: { messages: replySent ? [...thread, {
        ...thread[4], id: 'imap_106', imap_uid: '106', timestamp: selected.timestamp + 300,
      }] : thread } });
    }
    if (path.endsWith('/reply')) {
      expect(route.request().method()).toBe('POST');
      replySent = true;
      return route.fulfill({ json: { status: 'success' } });
    }
    if (/\/messages\/imap_\d+$/.test(path)) {
      const id = path.split('/').at(-1);
      const summary = id === selected.id ? { ...selected, thread_id: '123' }
        : id === 'imap_106' ? { ...thread[4], id, imap_uid: '106' }
          : thread.find(message => message.id === id);
      expect(summary).toBeDefined();
      expect(url.searchParams.get('folder')).toBe(id === selected.id ? 'INBOX' : folder);
      return route.fulfill({ json: {
        ...summary, attachments: [],
        body_text: id === 'imap_106' ? 'Reply just sent from the composer'
          : id === 'imap_105' ? 'My latest sent reply is visible' : `Body for ${id}`,
      } });
    }
    if (path === '/api/mail/events') return route.fulfill({
      contentType: 'text/event-stream', body: 'event: ready\ndata: {}\n\n',
    });
    if (path === '/api/mail/views' || path === '/api/mail/tags' || path.endsWith('/tags')) {
      return route.fulfill({ json: [] });
    }
    if (path === '/api/mail/folders') return route.fulfill({ json: { folders: [] } });
    if (path === '/api/mail/recipients/suggest') return route.fulfill({ json: { suggestions: [] } });
    if (path === '/api/mail/drafts') return route.fulfill({ json: { draft_id: 'synthetic-draft' } });
    return route.fulfill({ json: {} });
  });

  await page.goto('/@synthetic/mail', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const closeNotes = page.getByRole('button', { name: 'Close release notes' });
  await closeNotes.waitFor({ state: 'visible', timeout: 2_000 }).then(() => closeNotes.click()).catch(() => {});
  await page.getByText(selected.subject, { exact: true }).first().click({ timeout: 30_000 });
  const viewer = page.locator('[data-role="mail-viewer-scroll"]');
  await expect(viewer.getByText('My latest sent reply is visible', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(viewer.getByText('5 messages', { exact: true })).toBeVisible();
  await viewer.getByRole('button', { name: /Participant 1/ }).click();
  await expect(viewer.getByText('Body for imap_102', { exact: true })).toBeVisible();
  const readsBeforeReply = listReads;
  await page.getByRole('button', { name: 'Reply', exact: true }).first().click();
  const editor = page.locator('.mail-block-editor [contenteditable="true"]').first();
  await expect(editor).toBeVisible({ timeout: 60_000 });
  await editor.press('ControlOrMeta+Home');
  await page.keyboard.type('Synthetic reply');
  await page.getByRole('button', { name: 'Send email', exact: true }).click();
  await expect(viewer.getByText('Reply just sent from the composer', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(viewer.getByText('6 messages', { exact: true })).toBeVisible();
  expect(replySent).toBe(true);
  expect(listReads).toBeGreaterThan(readsBeforeReply);
  expect(errors).toEqual([]);
  expect(audit.externalRequests).toEqual([]);
  expect(audit.unknownApiRequests).toEqual([]);
});
