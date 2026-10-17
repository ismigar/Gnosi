import { expect, test } from '@playwright/test';

import { integrationsDocumentRoute, mailApiPath } from '../../support/api-routes.ts';
import { installDisposableNetwork, seedDisposableBrowser } from '../../support/disposable-web.ts';

test('all mail and archive scroll through every page and search beyond loaded summaries', async ({ context, page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const audit = await installDisposableNetwork(context);
  await seedDisposableBrowser(context);
  await context.addInitScript(() => { localStorage.setItem('i18nextLng', 'en'); });
  const account = 'archive@example.test';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const reads: { folder: string; offset: number; search: string }[] = [];
  const messages = Array.from({ length: 121 }, (_, index) => ({
    id: `imap_${index + 1}`, imap_uid: String(index + 1), source: 'imap', account,
    imap_folder: index < 60 ? 'INBOX' : 'Archive', archived: index >= 60,
    thread_id: `fixture-thread-${index}`, subject: `Synthetic archived mail ${index + 1}`,
    date: '2026-10-17T08:00:00Z', timestamp: 1_792_224_000 - index * 60,
    sender: 'Ada <ada@example.test>', recipient: account, type: 'Received',
    is_read: true, is_starred: false, has_attachments: false, snippet: 'Ordinary summary',
  }));
  await page.route(integrationsDocumentRoute, route => route.fulfill({ json: {
    mail_accounts: [{ email: account, provider: 'imap', enabled: true }], default_mail: account,
  } }));
  await page.route(url => mailApiPath(url) !== null, route => {
    const url = new URL(route.request().url());
    const path = mailApiPath(url)!;
    if (path === '/api/mail/messages') {
      const folder = url.searchParams.get('folder') || 'INBOX';
      const offset = Number(url.searchParams.get('offset') || 0);
      const search = url.searchParams.get('search') || '';
      reads.push({ folder, offset, search });
      const matching = search ? [messages[120]]
        : folder === 'all' ? messages
          : folder === 'ARCHIVE' ? messages.filter(message => message.archived)
            : [messages[0]];
      return route.fulfill({ json: {
        messages: matching.slice(offset, offset + 50), total: matching.length, next_page_token: null,
      } });
    }
    if (path === '/api/mail/counts') return route.fulfill({ json: {
      INBOX: { total: 60, unread: 0 }, ARCHIVE: { total: 61, unread: 0 }, all: { total: 121, unread: 0 },
    } });
    if (path === '/api/mail/events') return route.fulfill({
      contentType: 'text/event-stream', body: 'event: ready\ndata: {}\n\n',
    });
    if (path === '/api/mail/views' || path === '/api/mail/tags' || path.endsWith('/tags')) {
      return route.fulfill({ json: [] });
    }
    if (path === '/api/mail/folders') return route.fulfill({ json: { folders: [] } });
    return route.fulfill({ json: {} });
  });

  await page.goto('/@synthetic/mail', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const closeNotes = page.getByRole('button', { name: 'Close release notes' });
  await closeNotes.waitFor({ state: 'visible', timeout: 2_000 }).then(() => closeNotes.click()).catch(() => {});
  await expect(page.getByText(messages[0]!.subject, { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'All mail', exact: true }).click();
  const scroll = page.locator('[data-role="mail-list-scroll"]');
  const rows = scroll.locator('[data-mail-index]');
  await expect(rows).toHaveCount(50);
  const geometry = await scroll.evaluate(element => {
    const sentinel = element.querySelector('[data-role="mail-list-sentinel"]');
    return {
      scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
      sentinelInside: sentinel?.parentElement === element,
      sentinelBelowViewport: Boolean(sentinel && sentinel.getBoundingClientRect().top > element.getBoundingClientRect().bottom),
    };
  });
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  expect(geometry.sentinelInside).toBe(true);
  expect(geometry.sentinelBelowViewport).toBe(true);
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(rows).toHaveCount(100);
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(rows).toHaveCount(121);
  expect(reads.filter(read => read.folder === 'all').map(read => read.offset)).toEqual([0, 50, 100]);
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(scroll.getByText(messages[120]!.subject, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('complete-all-mail.png') });

  await page.getByRole('button', { name: 'Archive', exact: true }).filter({ hasText: /^Archive$/ }).click();
  await expect(rows).toHaveCount(50);
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible();
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(rows).toHaveCount(61);
  expect(reads.filter(read => read.folder === 'ARCHIVE').map(read => read.offset)).toEqual([0, 50]);
  await expect(scroll.getByText(messages[120]!.subject, { exact: true })).toBeVisible();

  await page.getByPlaceholder('Search', { exact: true }).fill('Body match beyond first page');
  await expect.poll(() => reads.some(read => read.search === 'Body match beyond first page')).toBe(true);
  await expect(rows).toHaveCount(1);
  await expect(scroll.getByText(messages[120]!.subject, { exact: true })).toBeVisible();
  await testInfo.attach('scroll-geometry-and-provider-requests', {
    body: JSON.stringify({ geometry, reads }, null, 2), contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(audit.externalRequests).toEqual([]);
  expect(audit.unknownApiRequests).toEqual([]);
});

for (const failureAt of ['initial', 'page'] as const) {
  test(`healthy archive pagination survives another account's ${failureAt} failure and targeted retry`, async ({ context, page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const audit = await installDisposableNetwork(context);
    await seedDisposableBrowser(context);
    await context.addInitScript(() => { localStorage.setItem('i18nextLng', 'en'); });
    const healthy = 'healthy@example.test';
    const unavailable = 'unavailable@example.test';
    const errors: string[] = [];
    const reads: { email: string; folder: string; offset: number; token: string | null; force: boolean }[] = [];
    let geometry: { inside: boolean; belowViewport: boolean; scrollHeight: number; clientHeight: number } | null = null;
    let recovered = false;
    page.on('pageerror', error => errors.push(error.message));
    const messages = (email: string, count: number) => Array.from({ length: count }, (_, index) => ({
      id: `imap_${index + 1}`, imap_uid: String(index + 1), source: 'imap', account: email,
      imap_folder: 'Archive', archived: true, thread_id: `thread-${index + 1}`,
      subject: `${email} archived ${index + 1}`, sender: 'Ada <ada@example.test>', recipient: email,
      date: '2026-10-17T08:00:00Z', timestamp: 1_792_224_000 - index * 60,
      is_read: true, is_starred: false, has_attachments: false, snippet: 'Synthetic archived summary',
    }));
    const healthyMessages = messages(healthy, 121);
    const unavailableMessages = messages(unavailable, failureAt === 'initial' ? 1 : 121);
    await page.route(integrationsDocumentRoute, route => route.fulfill({ json: {
      mail_accounts: [healthy, unavailable].map(email => ({ email, provider: 'imap', enabled: true })),
    } }));
    await page.route(url => mailApiPath(url) !== null, route => {
      const url = new URL(route.request().url());
      const pathname = mailApiPath(url)!;
      const email = url.searchParams.get('email') || '';
      if (pathname === '/api/mail/messages') {
        const folder = url.searchParams.get('folder') || 'INBOX';
        const offset = Number(url.searchParams.get('offset') || 0);
        const token = url.searchParams.get('page_token');
        reads.push({ email, folder, offset, token, force: url.searchParams.get('force') === 'true' });
        if (folder !== 'ARCHIVE') return route.fulfill({ json: { messages: [], total: 0, next_page_token: null } });
        if (email === unavailable && !recovered && (failureAt === 'initial' || offset === 50)) {
          return route.fulfill({ status: 503, json: { detail: 'Synthetic unavailable archive account' } });
        }
        const all = email === healthy ? healthyMessages : unavailableMessages;
        return route.fulfill({ json: {
          messages: all.slice(offset, offset + 50), total: all.length,
          next_page_token: offset + 50 < all.length ? `${email}-page-${offset + 50}` : null,
        } });
      }
      if (pathname === '/api/mail/counts') return route.fulfill({ json: {
        INBOX: { total: 0, unread: 0 }, ARCHIVE: { total: email === healthy ? 121 : unavailableMessages.length, unread: 0 },
      } });
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
      await expect(page.getByRole('switch', { name: `Show mail from ${unavailable}` })).toBeChecked({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Archive', exact: true }).click();
      const scroll = page.locator('[data-role="mail-list-scroll"]');
      const rows = scroll.locator('[data-mail-index]');
      await expect(rows).toHaveCount(failureAt === 'initial' ? 50 : 100);
      geometry = await scroll.evaluate(element => {
        const sentinel = element.querySelector('[data-role="mail-list-sentinel"]');
        return {
          inside: sentinel?.parentElement === element,
          belowViewport: Boolean(sentinel && sentinel.getBoundingClientRect().top > element.getBoundingClientRect().bottom),
          scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
        };
      });
      expect(geometry.inside).toBe(true);
      expect(geometry.belowViewport).toBe(true);
      expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
      await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(rows).toHaveCount(failureAt === 'initial' ? 100 : 150);
      await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(rows).toHaveCount(failureAt === 'initial' ? 121 : 171);
      const banner = page.locator('[data-mail-partial-status="unavailable"]');
      await expect(banner).toBeVisible();
      expect(reads.filter(read => read.folder === 'ARCHIVE' && read.email === healthy).map(read => read.offset)).toEqual([0, 50, 100]);
      expect(reads.filter(read => read.folder === 'ARCHIVE' && read.email === unavailable).map(read => read.offset))
        .toEqual(failureAt === 'initial' ? [0] : [0, 50]);
      await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(scroll.getByText(`${healthy} archived 121`, { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`healthy-archive-${failureAt}-failure.png`) });
      recovered = true;
      await banner.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(rows).toHaveCount(failureAt === 'initial' ? 122 : 221);
      expect(reads.filter(read => read.folder === 'ARCHIVE' && read.email === healthy)).toHaveLength(3);
      expect(reads.filter(read => read.folder === 'ARCHIVE' && read.email === unavailable).at(-1)).toEqual({
        email: unavailable, folder: 'ARCHIVE', offset: failureAt === 'initial' ? 0 : 50,
        token: failureAt === 'initial' ? null : `${unavailable}-page-50`, force: failureAt === 'initial',
      });
      if (failureAt === 'page') {
        await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
        await expect(rows).toHaveCount(242);
      }
      await expect(banner).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`archive-${failureAt}-recovered.png`) });
      expect(errors).toEqual([]);
      expect(audit.externalRequests).toEqual([]);
      expect(audit.unknownApiRequests).toEqual([]);
    } finally {
      await testInfo.attach('partial-account-pagination-requests', {
        body: JSON.stringify({ failureAt, geometry, reads, errors, audit }, null, 2), contentType: 'application/json',
      });
    }
  });
}
