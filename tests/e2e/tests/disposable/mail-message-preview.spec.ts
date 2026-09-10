import { expect, test } from '@playwright/test';
import { integrationsDocumentRoute, mailApiPath } from '../../support/api-routes.ts';
import { installDisposableNetwork, seedDisposableBrowser } from '../../support/disposable-web.ts';

for (const format of ['plain', 'html'] as const) {
  test(`mail popup scrolls through the complete ${format} message`, async ({ context, page }, testInfo) => {
    test.setTimeout(90_000);
    const audit = await installDisposableNetwork(context);
    await seedDisposableBrowser(context);
    await context.addInitScript(() => { localStorage.setItem('i18nextLng', 'en'); });
    const account = 'preview@example.test';
    const selected = {
      id: 'imap_42', imap_uid: '42', source: 'imap', account, imap_folder: 'INBOX',
      thread_id: 'imap_42', subject: 'Full message hover preview',
      sender: 'Ada <ada@example.test>', recipient: account, type: 'Received',
      is_read: false, is_starred: false, timestamp: 1789034400, snippet: 'Truncated list excerpt',
    };
    const paragraphs = [
      ...Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1}: complete message content.`),
      'End of the complete message',
    ];
    let detailReads = 0;
    let readMutations = 0;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(integrationsDocumentRoute, route => route.fulfill({ json: {
      mail_accounts: [{ email: account, provider: 'imap', enabled: true }], default_mail: account,
    } }));
    await page.route(url => mailApiPath(url) !== null, route => {
      const url = new URL(route.request().url());
      const path = mailApiPath(url)!;
      if (path === '/api/mail/messages') return route.fulfill({ json: { messages: [selected], total: 1 } });
      if (path === '/api/mail/messages/imap_42') {
        detailReads += 1;
        expect(url.searchParams.get('email')).toBe(account);
        expect(url.searchParams.get('folder')).toBe('INBOX');
        return route.fulfill({ json: {
          ...selected, body_text: format === 'plain' ? paragraphs.join('\n\n') : '',
          body_html: format === 'html' ? paragraphs.map(text => `<p>${text}</p>`).join('') : null,
        } });
      }
      if (path.endsWith('/read')) readMutations += 1;
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
    const subject = page.getByText(selected.subject, { exact: true });
    await expect(subject).toBeVisible({ timeout: 30_000 });
    expect(detailReads).toBe(0);
    await subject.hover();
    const popup = page.getByRole('dialog', { name: selected.subject });
    await expect(popup).toBeVisible({ timeout: 20_000 });
    const scroll = popup.locator('[data-role="mail-preview-scroll"]');
    await popup.hover();
    await expect.poll(() => scroll.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    if (format === 'html') {
      await expect(popup.frameLocator('iframe').getByText(paragraphs.at(-1)!, { exact: true })).toBeAttached();
    } else await expect(scroll).toContainText(paragraphs.at(-1)!);
    expect(detailReads).toBe(1);
    await scroll.hover();
    await page.mouse.wheel(0, 800);
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await scroll.focus();
    await page.keyboard.press('End');
    await expect.poll(() => scroll.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThan(2);
    await expect(popup).toBeVisible();
    expect(await popup.evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight && box.right <= innerWidth;
    })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`complete-${format}-preview.png`) });
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
    expect(readMutations).toBe(0);
    expect(errors).toEqual([]);
    expect(audit.externalRequests).toEqual([]);
    expect(audit.unknownApiRequests).toEqual([]);
  });
}
