import { test, expect, type Page } from '@playwright/test';

const account = { id: 'offline-synthetic-account', email: 'offline@example.invalid', workspaces: [{ id: 'offline-workspace', name: 'Fixture', role: 'owner' }] } as const;
const vault = { id: 'offline-vault', name: 'Fixture', slug: 'offline', path: '/synthetic', active: true };
const passphrase = 'disposable offline passphrase';

async function unlock(page: Page) {
    await page.getByLabel('Offline passphrase', { exact: true }).fill(passphrase);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
}

test('encrypted opt-in notes survive an offline startup and synchronize with conflict review', async ({ page, context }, testInfo) => {
    const errors: string[] = [];
    context.on('weberror', error => { errors.push(error.error().message); });
    let content = '# Original synthetic secret';
    let etag = 'version-1';
    const writes: { content: string; expected_etag: string; force: boolean }[] = [];
    const unknown: string[] = [];
    let apiReads = 0;
    await context.addInitScript(({ account, vault }) => {
        if (location.origin !== 'http://127.0.0.1:5198' || localStorage.getItem('offline-fixture-initialized')) return;
        localStorage.setItem('offline-fixture-initialized', '1');
        localStorage.setItem('gnosi_user_id', account.id);
        localStorage.setItem('gnosi_user_email', account.email);
        localStorage.setItem('gnosi_workspace_id', account.workspaces[0].id);
        localStorage.setItem('gnosi_active_vault', vault.id);
        localStorage.setItem('db-theme', 'light');
    }, { account, vault });
    await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== 'http://127.0.0.1:5198') { unknown.push(request.url()); await route.abort(); return; }
        if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
        apiReads += 1;
        expect(request.headers()['x-gnosi-expected-user-id']).toBe(account.id);
        expect(request.headers()['x-vault-id']).toBe(vault.id);
        expect(request.headers()['x-workspace-id']).toBe(account.workspaces[0].id);
        const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname === '/api/auth/me') return json(account);
        if (url.pathname === '/api/vaults') return json({ vaults: [vault], active_path: '/synthetic' });
        if (url.pathname === '/api/vault/sidebar/tree') return json([
            { id: 'chosen-note', title: 'Synthetic private note', metadata: {} },
            { id: 'second-note', title: 'Another selected note', metadata: {} },
            { id: 'unselected-note', title: 'Do not cache', metadata: {} },
        ]);
        if (url.pathname === '/api/vault/pages/second-note' && request.method() === 'GET') {
            return json({ id: 'second-note', title: 'Another selected note', content: '# Another selected body', etag: 'second-1', metadata: {}, folder: '' });
        }
        if (url.pathname === '/api/vault/pages/chosen-note') {
            if (request.method() === 'PATCH') {
                const body = request.postDataJSON() as { content: string; expected_etag: string; force: boolean };
                writes.push(body);
                if (body.expected_etag !== etag || body.force) return json({ detail: { error: 'etag_mismatch' } }, 409);
                content = body.content;
                etag = 'version-3';
            }
            return json({ id: 'chosen-note', title: 'Synthetic private note', content, etag, metadata: {}, folder: '' });
        }
        unknown.push(request.url());
        await route.abort();
    });
    await page.goto('/offline.html');
    await expect(page.getByText('Offline startup ready.', { exact: false })).toBeVisible();
    await page.getByLabel('Offline passphrase', { exact: true }).fill(passphrase);
    await page.getByLabel('Repeat passphrase').fill(passphrase);
    await page.getByRole('button', { name: 'Create encrypted collection' }).click();
    await page.getByRole('button', { name: 'Load notes from server' }).click();
    await page.getByRole('listitem').filter({ hasText: 'Synthetic private note' }).getByRole('button', { name: 'Add offline' }).click();
    await page.getByRole('listitem').filter({ hasText: 'Another selected note' }).getByRole('button', { name: 'Add offline' }).click();
    const editor = page.getByLabel('Markdown source');
    await expect(editor).toHaveValue(content);
    await editor.fill('# Locally edited synthetic secret');
    await page.getByRole('button', { name: 'Save locally', exact: true }).click();
    await expect(page.getByText('Saved locally and encrypted on this device.')).toBeVisible();
    const database = await page.evaluate(async () => {
        const request = indexedDB.open('gnosi-offline-v1', 1);
        const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        const value = db.transaction('encrypted').objectStore('encrypted').getAll();
        const data = await new Promise<unknown>((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
        db.close();
        return JSON.stringify(data);
    });
    expect(database).not.toContain('synthetic secret');
    expect(database).not.toContain('Synthetic private note');
    expect(database).not.toContain(account.id);
    const beforeOffline = apiReads;
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Unlock this device’s notes' })).toBeVisible();
    await unlock(page);
    await expect(editor).toHaveValue('# Locally edited synthetic secret');
    await editor.fill('# Edited during real browser offline mode');
    await page.getByRole('button', { name: 'Save locally', exact: true }).click();
    await expect(page.getByText('Saved locally and encrypted on this device.')).toBeVisible();
    await page.close();
    page = await context.newPage();
    await page.goto('/offline.html');
    await unlock(page);
    await expect(page.getByLabel('Markdown source')).toHaveValue('# Edited during real browser offline mode');
    expect(apiReads).toBe(beforeOffline);
    await context.setOffline(false);
    content = '# Concurrent server version';
    etag = 'version-2';
    await page.getByRole('button', { name: 'Sync this note', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review changes', exact: true })).toBeVisible();
    expect(writes).toHaveLength(0);
    await expect(page.getByText('# Concurrent server version', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Merge versions', exact: true }).fill('# Explicit combined version');
    await page.getByRole('navigation', { name: 'Offline notes' }).getByRole('button').filter({ hasText: 'Another selected note' }).click();
    await expect(page.getByLabel('Markdown source')).toHaveValue('# Another selected body');
    await page.getByRole('navigation', { name: 'Offline notes' }).getByRole('button').filter({ hasText: 'Synthetic private note' }).click();
    await expect(page.getByRole('textbox', { name: 'Merge versions', exact: true })).toHaveValue('# Explicit combined version');
    const closeGuard = await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
    });
    expect(closeGuard).toBe(true);
    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Discard unsaved edits and lock', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Merge versions', exact: true })).toHaveValue('# Explicit combined version');
    await page.screenshot({ path: testInfo.outputPath('unsaved-merge-lock-warning.png'), fullPage: true });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Merge versions', exact: true })).toHaveValue('# Explicit combined version');
    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await page.getByRole('button', { name: 'Discard unsaved edits and lock', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unlock this device’s notes' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Merge versions', exact: true })).toHaveCount(0);
    await unlock(page);
    await expect(page.getByRole('textbox', { name: 'Merge versions', exact: true })).toHaveValue('# Edited during real browser offline mode');
    expect(writes).toHaveLength(0);
    await page.getByRole('textbox', { name: 'Merge versions', exact: true }).fill('# Explicit combined version');
    await page.getByRole('button', { name: 'Save merged version to server' }).click();
    await expect(page.getByText('This note is synchronized.')).toBeVisible();
    expect(writes).toEqual([{ content: '# Explicit combined version', expected_etag: 'version-2', force: false }]);
    await page.screenshot({ path: testInfo.outputPath('offline-mobile.png'), fullPage: true });
    const cached = await page.evaluate(async () => {
        const names = await caches.keys();
        const urls: string[] = [];
        for (const name of names) for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
        return urls;
    });
    expect(cached).toContain('http://127.0.0.1:5198/offline.html');
    expect(cached.some(url => url.includes('/api/'))).toBe(false);
    expect(cached.some(url => url.endsWith('/'))).toBe(false);
    const other = await context.newPage();
    await other.goto('/offline.html');
    await other.evaluate(() => { localStorage.setItem('gnosi_user_id', 'another-account'); });
    await expect(page.getByRole('heading', { name: 'Unlock this device’s notes' })).toBeVisible();
    await expect(page.getByText('Synthetic private note', { exact: true })).toHaveCount(0);
    await unlock(page);
    await expect(page.getByRole('alert')).toContainText('Account, workspace or Vault changed.');
    await expect(page.getByLabel('Markdown source')).toHaveCount(0);
    expect(unknown).toEqual([]);
    expect(errors).toEqual([]);
});
