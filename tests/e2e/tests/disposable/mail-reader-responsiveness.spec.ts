import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { integrationsDocumentRoute, mailApiPath } from '../../support/api-routes.ts';
import { installDisposableNetwork, seedDisposableBrowser } from '../../support/disposable-web.ts';


test('reader reuses a Gmail body, preserves its scope, retries failures and cancels stale selections', async ({ context, page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const audit = await installDisposableNetwork(context);
  await seedDisposableBrowser(context);
  await context.addInitScript(() => { localStorage.setItem('i18nextLng', 'en'); });
  const account = 'reader@example.test';
  const errors: string[] = [];
  const consoleMessages: { type: string; text: string }[] = [];
  const detailGets: { id: string; folder: string | null; email: string | null }[] = [];
  const assetGets: { pathname: string; folder: string | null; email: string | null }[] = [];
  const mutations: { pathname: string; folder: string | null; email: string | null }[] = [];
  const failedRequests: { pathname: string; error: string | null }[] = [];
  const lateDeliveries: string[] = [];
  let initialFrame: { title: string; body: string | null; readyState: string | null } | null = null;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleMessages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on('requestfailed', request => {
    const pathname = mailApiPath(new URL(request.url()));
    if (pathname) failedRequests.push({ pathname, error: request.failure()?.errorText ?? null });
  });
  let releaseThread: () => void = () => undefined;
  const threadGate = new Promise<void>(resolve => { releaseThread = resolve; });
  let releaseSlowBody: () => void = () => undefined;
  const slowBodyGate = new Promise<void>(resolve => { releaseSlowBody = resolve; });
  let threadReads = 0;
  let unavailableReads = 0;
  let lateDeliveryAttempted = false;
  const selected = {
    id: 'imap_42', imap_uid: '42', source: 'imap', account, imap_folder: 'INBOX',
    thread_id: 'imap_42', subject: 'Synthetic responsive Gmail conversation',
    sender: 'Ada <ada@example.test>', recipient: account, type: 'Received',
    date: '2026-10-17T08:00:00Z', timestamp: 1_792_224_000,
    is_read: false, is_starred: false, has_attachments: true, snippet: 'Available Gmail preview',
  };
  const unavailable = {
    ...selected, id: 'imap_77', imap_uid: '77', thread_id: 'imap_77', is_read: true,
    subject: 'Synthetic message with a retry', snippet: 'Preview survives a body failure', timestamp: selected.timestamp - 60,
  };
  const slow = {
    ...selected, id: 'imap_88', imap_uid: '88', thread_id: 'imap_88', is_read: true,
    subject: 'Synthetic pending body', timestamp: selected.timestamp - 120,
  };
  const replacement = {
    ...selected, id: 'imap_99', imap_uid: '99', thread_id: 'imap_99', is_read: true,
    subject: 'Synthetic replacement message', timestamp: selected.timestamp - 180,
  };
  const summaries = [selected, unavailable, slow, replacement];
  await page.route(integrationsDocumentRoute, route => route.fulfill({ json: {
    mail_accounts: [{ email: account, provider: 'imap', enabled: true }], default_mail: account,
  } }));
  await page.route(url => mailApiPath(url) !== null, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = mailApiPath(url)!;
    const scope = { folder: url.searchParams.get('folder'), email: url.searchParams.get('email') };
    if (pathname === '/api/mail/messages') return route.fulfill({ json: { messages: summaries, total: summaries.length } });
    if (pathname === '/api/mail/counts') return route.fulfill({ json: {
      INBOX: { total: 4, unread: 1 }, ARCHIVE: { total: 0, unread: 0 }, all: { total: 4, unread: 1 },
    } });
    if (pathname === '/api/mail/threads/gmail-thread') {
      threadReads += 1;
      await threadGate;
      return route.fulfill({ json: { messages: [{
        ...selected, id: 'imap_901', imap_uid: '901', imap_folder: '[Gmail]/All Mail',
        sender: 'Alias summary <ada@example.test>', account: ' READER@example.test ',
        internet_message_id: '<synthetic-delivery@example.test>', gm_thrid: '123', thread_id: 'gmail-thread',
      }] } });
    }
    if (request.method() === 'POST' && (pathname.endsWith('/read') || pathname.endsWith('/archive'))) {
      mutations.push({ pathname, ...scope });
      return route.fulfill({ json: { status: 'success' } });
    }
    if (pathname.endsWith('/cid/logo')) {
      assetGets.push({ pathname, ...scope });
      return route.fulfill({ contentType: 'image/png', body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5WjBkAAAAASUVORK5CYII=', 'base64',
      ) });
    }
    if (/\/messages\/imap_\d+$/.test(pathname)) {
      const id = pathname.split('/').at(-1)!;
      detailGets.push({ id, ...scope });
      if (id === selected.id) return route.fulfill({ json: {
        ...selected, thread_id: 'gmail-thread', gm_thrid: '123', internet_message_id: '<synthetic-delivery@example.test>',
        body_html: '<p>Synthetic Gmail body stays available</p><img alt="Synthetic logo" src="cid:logo">',
        attachments: [{ attachment_id: 'part', filename: 'synthetic.txt', content_type: 'text/plain', size: 12 }],
      } });
      if (id === unavailable.id) {
        unavailableReads += 1;
        if (unavailableReads === 1) return route.fulfill({ status: 503, json: { detail: 'Synthetic unavailable body' } });
        return route.fulfill({ json: { ...unavailable, body_text: 'Synthetic message recovered after retry', attachments: [] } });
      }
      if (id === slow.id) {
        await slowBodyGate;
        await route.fulfill({ json: { ...slow, body_text: 'Late synthetic body must stay hidden', attachments: [] } })
          .catch((error: unknown) => { lateDeliveries.push(String(error)); });
        lateDeliveryAttempted = true;
        return;
      }
      if (id === replacement.id) return route.fulfill({ json: {
        ...replacement, body_text: 'The replacement body remains selected', attachments: [],
      } });
      return route.fulfill({ status: 500, json: { detail: 'Unexpected duplicate All Mail body request' } });
    }
    if (pathname === '/api/mail/events') return route.fulfill({
      contentType: 'text/event-stream', body: 'event: ready\ndata: {}\n\n',
    });
    if (pathname === '/api/mail/views' || pathname === '/api/mail/tags' || pathname.endsWith('/tags')) {
      return route.fulfill({ json: [] });
    }
    if (pathname === '/api/mail/folders') return route.fulfill({ json: { folders: [] } });
    return route.fulfill({ json: {} });
  });

  try {
    await page.goto('/@synthetic/mail', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const closeNotes = page.getByRole('button', { name: 'Close release notes' });
    await closeNotes.waitFor({ state: 'visible', timeout: 2_000 }).then(() => closeNotes.click()).catch(() => {});
    const list = page.locator('[data-role="mail-list-scroll"]');
    await list.getByText(selected.subject, { exact: true }).click({ timeout: 30_000 });
    await page.mouse.move(1200, 80);
    const detail = page.locator('.mail-workspace__detail');
    const viewer = detail.locator('[data-role="mail-viewer-scroll"]');
    await expect(viewer.locator('iframe')).toBeVisible({ timeout: 20_000 });
    initialFrame = await viewer.locator('iframe').evaluate((frame: HTMLIFrameElement) => ({
      title: frame.title, body: frame.contentDocument?.body.textContent ?? null,
      readyState: frame.contentDocument?.readyState ?? null,
    }));
    await expect(viewer.frameLocator('iframe').getByText('Synthetic Gmail body stays available', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => threadReads).toBe(1);
    await expect.poll(() => mutations.filter(item => item.pathname.endsWith('/read')).length).toBe(1);
    releaseThread();
    await expect(viewer.getByRole('button', { name: /Alias summary/ })).toBeVisible();
    await expect(viewer.frameLocator('iframe').getByText('Synthetic Gmail body stays available', { exact: true })).toBeVisible();
    await expect(viewer.locator('[data-mail-body-loading]')).toHaveCount(0);
    expect(detailGets).toEqual([{ id: selected.id, folder: 'INBOX', email: account }]);
    expect(mutations).toEqual([{ pathname: `/api/mail/messages/${selected.id}/read`, folder: 'INBOX', email: account }]);
    await expect.poll(() => assetGets.length).toBeGreaterThan(0);
    expect(assetGets.every(item => item.pathname === `/api/mail/messages/${selected.id}/cid/logo`
      && item.folder === 'INBOX' && item.email === account)).toBe(true);
    const download = viewer.getByRole('link', { name: /synthetic\.txt/ });
    const downloadUrl = new URL(await download.getAttribute('href') || '', page.url());
    expect(mailApiPath(downloadUrl)).toBe(`/api/mail/messages/${selected.id}/attachments/part`);
    expect(downloadUrl.searchParams.get('folder')).toBe('INBOX');
    expect(downloadUrl.searchParams.get('email')).toBe(account);
    await page.screenshot({ path: testInfo.outputPath('reader-gmail-alias.png') });

    await detail.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect.poll(() => mutations.filter(item => item.pathname.endsWith('/archive'))).toEqual([
      { pathname: `/api/mail/messages/${selected.id}/archive`, folder: 'INBOX', email: account },
    ]);
    const failure = viewer.locator('[data-mail-reader-error="message"]');
    await expect(failure).toContainText('The message could not be loaded. Try again.');
    await expect(viewer).toContainText(unavailable.snippet);
    await expect(viewer.locator('[data-mail-body-loading]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('reader-body-retry.png') });
    await failure.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(viewer).toContainText('Synthetic message recovered after retry');
    await expect(failure).toHaveCount(0);
    expect(unavailableReads).toBe(2);

    await list.locator('[data-mail-index]').filter({ hasText: slow.subject }).getByText('Ada', { exact: true }).click();
    await page.mouse.move(1200, 80);
    await expect.poll(() => detailGets.filter(item => item.id === slow.id).length).toBe(1);
    await list.locator('[data-mail-index]').filter({ hasText: replacement.subject }).getByText('Ada', { exact: true }).click();
    await page.mouse.move(1200, 80);
    await expect(viewer).toContainText('The replacement body remains selected');
    await expect.poll(() => failedRequests.some(item => item.pathname === `/api/mail/messages/${slow.id}`)).toBe(true);
    releaseSlowBody();
    await expect.poll(() => lateDeliveryAttempted).toBe(true);
    await expect(viewer).not.toContainText('Late synthetic body must stay hidden');
    await expect(viewer.locator('[data-mail-reader-error]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('reader-replacement.png') });
    expect(detailGets.some(item => item.id === 'imap_901')).toBe(false);
    expect(errors).toEqual([]);
    expect(audit.externalRequests).toEqual([]);
    expect(audit.unknownApiRequests).toEqual([]);
  } finally {
    releaseThread();
    releaseSlowBody();
    const evidencePath = testInfo.outputPath('reader-browser-audit.json');
    await mkdir(path.dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, JSON.stringify({
      detailGets, assetGets, mutations, threadReads, unavailableReads, failedRequests,
      lateDeliveries, initialFrame, consoleMessages, pageErrors: errors, audit,
    }, null, 2));
    await testInfo.attach('reader-browser-audit', { path: evidencePath, contentType: 'application/json' });
  }
});
