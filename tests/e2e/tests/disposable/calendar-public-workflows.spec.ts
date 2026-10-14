import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Route } from '@playwright/test';
import type { components } from '../../../../frontend/src/generated/openapi';
import { installDisposableNetwork, seedDisposableBrowser, type DisposableNetworkAudit } from '../../support/disposable-web.ts';

type Schemas = components['schemas'];
const form: Schemas['PublicFormResponse'] = {
  title: 'Workshop registration', description: 'Tell us how to contact you.',
  fields: [
    { key: 'q0', label: 'Your name', kind: 'title', required: true, help: '', options: [] },
    { key: 'q1', label: 'Email address', kind: 'email', required: true, help: '', options: [] },
    { key: 'q2', label: 'Track', kind: 'select', required: true, help: '', options: ['Design', 'Engineering'] },
  ],
};
const info: Schemas['BookingPublicInfo'] = {
  title: 'Design consultation', timezone: 'Europe/Madrid', duration_minutes: 30,
  first_date: '2030-10-15', last_date: '2030-10-30',
};
const slots: Schemas['BookingSlotsResponse'] = {
  timezone: info.timezone, date: info.first_date,
  slots: [{ start: '2030-10-15T09:00:00Z', end: '2030-10-15T09:30:00Z' }],
};
const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});

let audit: DisposableNetworkAudit = { externalRequests: [], unknownApiRequests: [] };
test.beforeEach(async ({ context }) => {
  audit = await installDisposableNetwork(context);
  await context.addInitScript(() => {
    localStorage.setItem('i18nextLng', 'en');
    localStorage.setItem('gnosi_active_vault', 'private-visitor-vault');
    localStorage.setItem('gnosi_workspace_id', 'private-visitor-workspace');
  });
});
test.afterEach(() => {
  expect(audit.externalRequests).toEqual([]);
  expect(audit.unknownApiRequests).toEqual([]);
});

test('a public form submits typed answers without a visitor session or vault', async ({ context, page }, testInfo) => {
  const requests: Schemas['FormSubmitRequest'][] = [];
  await context.route('**/api/forms/public/synthetic-form**', async route => {
    const headers = route.request().headers();
    expect(headers['x-vault-id']).toBeUndefined();
    expect(headers['x-workspace-id']).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
    if (route.request().method() === 'POST') {
      requests.push(JSON.parse(route.request().postData() ?? '{}') as Schemas['FormSubmitRequest']);
      return json(route, { status: 'accepted' });
    }
    return json(route, form);
  });
  await page.goto('/forms/synthetic-form');
  await expect(page.getByRole('heading', { name: form.title })).toBeVisible();
  await page.getByLabel('Your name', { exact: false }).fill('Ada Example');
  await page.getByLabel('Email address', { exact: false }).fill('ada@example.test');
  await page.getByLabel('Track', { exact: false }).selectOption('Engineering');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('public-form.png'), fullPage: true });
  await page.getByRole('button', { name: 'Send response' }).click();
  await expect(page.getByRole('heading', { name: 'Response received' })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]?.values).toEqual({ q0: 'Ada Example', q1: 'ada@example.test', q2: 'Engineering' });
  expect(requests[0]?.request_id.length).toBeGreaterThanOrEqual(16);
});

test('a revoked public form reveals no questions', async ({ context, page }) => {
  await context.route('**/api/forms/public/revoked', route => json(route, { detail: 'Unavailable' }, 404));
  await page.goto('/forms/revoked');
  await expect(page.getByRole('alert')).toContainText('unavailable');
  await expect(page.getByRole('button', { name: 'Send response' })).toHaveCount(0);
});

test('table owners publish a finite form and cannot open a link without a deadline', async ({ context, page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => { pageErrors.push(error.message); });
  await seedDisposableBrowser(context);
  await context.addInitScript(() => { localStorage.setItem('i18nextLng', 'en'); });
  const tableId = 'synthetic-form-table';
  const published: Schemas['FormResponse'] = {
    ...form, id: 'legacy', table_id: tableId, title: 'Legacy form', url: '/forms/legacy',
    expires_at: null, revoked: false, created_at: '2026-10-13T00:00:00Z',
  };
  const requests: Schemas['FormCreateRequest'][] = [];
  await context.route('**/api/config/interface', route => json(route,
    { currency: 'EUR', date_format: 'locale', decimal_symbol: ',', language: 'en' }));
  await context.route('**/api/config/editor', route => json(route, { settings: {} }));
  await context.route(`**/api/vault/pages/by-table/${tableId}**`, route => json(route, []));
  await context.route('**/api/vault/views/main', route => json(route, { status: 'success' }));
  await context.route('**/api/vault/global-index', route => json(route, {}));
  await context.route('**/api/vault/alias-index', route => json(route, {}));
  await context.route('**/api/vault/plugins', route => json(route,
    { disabled: [], enabled_builtin: ['share-links'], enabled_third_party: [], settings: {} }));
  await context.route('**/api/vault/registry', route => json(route, {
    databases: [], tables: [{ id: tableId, name: 'Signup requests', properties: [] }],
    views: [{ id: 'main', table_id: tableId, name: 'Table', type: 'table', is_main: true }],
  }));
  await context.route(url => url.pathname === '/api/forms' || url.pathname.startsWith('/api/forms/'), route => {
    if (route.request().method() === 'POST') {
      const request = JSON.parse(route.request().postData() ?? '{}') as Schemas['FormCreateRequest'];
      requests.push(request);
      return json(route, { ...published, id: 'new', title: request.title, url: '/forms/finite', expires_at: '2099-01-01T00:00:00Z' });
    }
    if (new URL(route.request().url()).pathname.endsWith('/fields')) return json(route,
      { fields: [{ ref: 'title', label: 'Title', kind: 'title', options: [] }] });
    return json(route, { forms: [published] });
  });
  await page.goto(`/@synthetic/knowledge/table/${tableId}/view/main`);
  const close = page.getByRole('button', { name: /close release notes/i });
  await close.waitFor({ state: 'visible', timeout: 1_000 }).then(() => close.click()).catch(() => {});
  await page.getByRole('button', { name: 'Public forms', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Public forms/ });
  await expect(dialog.getByText('Legacy form', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open form' })).toHaveCount(0);
  const lifetime = dialog.getByRole('combobox', { name: 'Link lifetime', exact: true });
  await expect(lifetime.locator('option')).toHaveCount(4);
  expect(await lifetime.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
    .toEqual(['7', '30', '90', '365']);
  await lifetime.selectOption('365');
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('form-owner-expiry.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Publish form', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('The form is ready');
  expect(requests).toHaveLength(1);
  expect(requests[0]?.expires_in_days).toBe(365);
  await expect(dialog.getByRole('link', { name: 'Open form' })).toHaveAttribute('href', '/forms/finite');
  expect(pageErrors).toEqual([]);
});

test('a booking retry keeps its identity and confirms a single reservation', async ({ context, page }, testInfo) => {
  const requests: Schemas['BookingReservationRequest'][] = [];
  await context.route('**/api/booking/public/synthetic-booking**', async route => {
    if (route.request().method() === 'POST') {
      const request = JSON.parse(route.request().postData() ?? '{}') as Schemas['BookingReservationRequest'];
      requests.push(request);
      if (requests.length === 1) return route.abort('failed');
      return json(route, { id: 'confirmed-reservation', status: 'confirmed', start: request.start, end: slots.slots[0]?.end });
    }
    return json(route, new URL(route.request().url()).pathname.endsWith('/slots') ? slots : info);
  });
  await page.goto('/book/synthetic-booking');
  await expect(page.getByRole('heading', { name: info.title })).toBeVisible();
  await page.locator('fieldset button').first().click();
  await page.getByLabel('Your name', { exact: true }).fill('Ada Example');
  await page.getByLabel('Email', { exact: true }).fill('ada@example.test');
  await page.locator('fieldset button[aria-pressed="true"]').evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished));
  });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('public-booking.png'), fullPage: true });
  await page.getByRole('button', { name: 'Confirm reservation' }).click();
  await expect(page.getByRole('alert')).toContainText('not confirmed');
  await expect(page.getByLabel('Your name', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry the same request' }).click();
  await expect(page.getByRole('status')).toContainText('reservation is confirmed');
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
});

test('unverifiable availability never offers a booking slot', async ({ context, page }) => {
  await context.route('**/api/booking/public/calendar-unavailable**', route => {
    if (new URL(route.request().url()).pathname.endsWith('/slots')) return json(route, { detail: 'Cannot verify' }, 503);
    return json(route, info);
  });
  await page.goto('/book/calendar-unavailable');
  await expect(page.getByRole('alert')).toContainText('could not be verified');
  await expect(page.locator('fieldset button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm reservation' })).toBeDisabled();
});

test('the calendar exposes a provider video link in the event inspector', async ({ context, page }, testInfo) => {
  await seedDisposableBrowser(context);
  const start = new Date(); start.setHours(12, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60_000);
  const event: Schemas['CalendarEventResponse'] = {
    id: 'synthetic-call', calendar_id: 'work', account: 'synthetic@example.test', provider: 'google',
    title: 'Synthetic video appointment', calendar_name: 'Work', source: 'synthetic@example.test - Work',
    start: start.toISOString(), end: end.toISOString(), all_day: false,
    description: '', location: '', status: 'confirmed', color: '#1d4ed8', link: '',
    join_url: 'https://meet.google.com/abc-defg-hij', is_read_only: true, attendees: [],
  };
  await context.route('**/api/calendar/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/events')) return json(route, [event]);
    if (path.endsWith('/calendars')) return json(route, [{ id: 'work', name: 'Work', account: event.account, provider: 'google', access_role: 'reader' }]);
    return route.fallback();
  });
  await page.goto('/@synthetic/calendar');
  const close = page.getByRole('button', { name: /close release notes|tanca les notes|cerrar las notas|fermer les notes/i });
  await close.waitFor({ state: 'visible', timeout: 1_000 }).then(() => close.click()).catch(() => {});
  await page.getByText(event.title, { exact: true }).first().click();
  const join = page.getByRole('link', { name: /join video call|entra a la videotrucada/i });
  await expect(join).toBeVisible();
  await expect(join).toHaveAttribute('href', event.join_url);
  await expect(join).toHaveAttribute('rel', 'noopener noreferrer');
  const localTime = await page.evaluate(value => {
    const date = new Date(value);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }, event.start);
  await expect(page.locator('input[type="time"]').first()).toHaveValue(localTime);
  await expect(page.locator('input[type="time"]').first()).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('calendar-video-call.png'), fullPage: true });
});

test('a CalDAV title autosave preserves the original provider text', async ({ context, page }, testInfo) => {
  await seedDisposableBrowser(context);
  const start = new Date(); start.setHours(12, 0, 0, 0);
  const event: Schemas['CalendarEventResponse'] = {
    id: 'synthetic-text-save', calendar_id: 'work', account: 'synthetic@example.test', provider: 'caldav',
    title: 'Original appointment', calendar_name: 'Work', source: 'synthetic@example.test - Work',
    start: start.toISOString(), end: new Date(start.getTime() + 30 * 60_000).toISOString(), all_day: false,
    description: '  Provider agenda\n  ', location: '  Room one  ', status: 'confirmed', color: '#1d4ed8', link: '', join_url: '',
    etag: '"one"', resource_url: 'https://calendar.example.test/work/event.ics', is_read_only: false, attendees: [],
  };
  const writes: Schemas['CalendarEventPatchRequest'][] = [];
  await context.route('**/api/calendar/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'PATCH' && path.includes('/events/')) {
      writes.push(JSON.parse(route.request().postData() ?? '{}') as Schemas['CalendarEventPatchRequest']);
      return json(route, { status: 'success', etag: '"two"', resource_url: event.resource_url });
    }
    if (path.endsWith('/events')) return json(route, [event]);
    if (path.endsWith('/calendars')) return json(route, [{ id: 'work', name: 'Work', account: event.account, provider: 'caldav', access_role: 'owner' }]);
    return route.fallback();
  });
  await page.goto('/@synthetic/calendar');
  const close = page.getByRole('button', { name: /close release notes|tanca les notes|cerrar las notas|fermer les notes/i });
  await close.waitFor({ state: 'visible', timeout: 1_000 }).then(() => close.click()).catch(() => {});
  await page.getByText(event.title, { exact: true }).first().click();
  const title = page.locator('input[required][type="text"]');
  await expect(title).toHaveValue(event.title);
  await expect(title).toBeFocused();
  await title.fill('Updated appointment');
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual(expect.objectContaining({
    provider: 'caldav', summary: 'Updated appointment', description: event.description, location: event.location, etag: '"one"',
  }));
  await page.screenshot({ path: testInfo.outputPath('caldav-text-autosave.png'), fullPage: true });
});

test('same-named CalDAV calendars remain distinct creation destinations', async ({ context, page }, testInfo) => {
  await seedDisposableBrowser(context);
  await context.route('**/api/config/interface', route => json(route,
    { currency: 'EUR', date_format: 'locale', decimal_symbol: ',', language: 'en' }));
  const account = 'synthetic@example.test';
  const calendars: Schemas['CalendarListItemResponse'][] = ['/home/work-a/', '/home/work-b/'].map(id => ({
    id, account, name: 'Work', provider: 'caldav', access_role: 'owner',
  }));
  const creates: { calendarId: string | null; body: Schemas['CalendarEventCreateRequest'] }[] = [];
  const patches: Schemas['CalendarEventPatchRequest'][] = [];
  const deletes: string[] = [];
  await context.route('**/api/calendar/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/calendars')) return json(route, calendars);
    if (url.pathname.includes('/events/') && route.request().method() === 'PATCH') {
      patches.push(JSON.parse(route.request().postData() ?? '{}') as Schemas['CalendarEventPatchRequest']);
      return json(route, { status: 'success', etag: '"two"' });
    }
    if (url.pathname.includes('/events/') && route.request().method() === 'DELETE') {
      deletes.push(url.searchParams.get('provider') ?? '');
      return json(route, { status: 'success' });
    }
    if (url.pathname.endsWith('/events') && route.request().method() === 'POST') {
      creates.push({ calendarId: url.searchParams.get('calendar_id'),
        body: JSON.parse(route.request().postData() ?? '{}') as Schemas['CalendarEventCreateRequest'] });
      return json(route, { id: 'synthetic-created', etag: '"one"' });
    }
    if (url.pathname.endsWith('/events')) return json(route, []);
    return route.fallback();
  });
  await page.goto('/@synthetic/calendar');
  const close = page.getByRole('button', { name: /close release notes|tanca les notes|cerrar las notas|fermer les notes/i });
  await close.waitFor({ state: 'visible', timeout: 1_000 }).then(() => close.click()).catch(() => {});
  await page.locator('.fc-daygrid-day.fc-day-today .fc-daygrid-day-frame').click({ position: { x: 30, y: 65 } });
  const destination = page.getByRole('combobox', { name: /^(Calendar|Calendari|Calendario|Calendrier)$/ });
  await expect(destination.locator('option')).toHaveCount(2);
  const options = await destination.locator('option').evaluateAll(items => items.map(item => ({
    value: (item as HTMLOptionElement).value, label: item.textContent ?? '',
  })));
  expect(new Set(options.map(option => option.value)).size).toBe(2);
  expect(new Set(options.map(option => option.label)).size).toBe(2);
  const selected = options.find(option => option.label.includes('/home/work-b/'));
  expect(selected).toBeDefined();
  await destination.selectOption(selected?.value ?? '');
  const title = page.locator('input[required][type="text"]');
  await title.click();
  await expect(title).toBeFocused();
  await title.fill('Second work calendar');
  await expect.poll(() => creates.length).toBe(1);
  expect(creates[0]).toEqual(expect.objectContaining({ calendarId: '/home/work-b/',
    body: expect.objectContaining({ provider: 'caldav', summary: 'Second work calendar' }),
  }));
  await page.screenshot({ path: testInfo.outputPath('caldav-distinct-destinations.png'), fullPage: true });
  await title.fill('Updated second work calendar');
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toEqual(expect.objectContaining({ provider: 'caldav', summary: 'Updated second work calendar' }));
  await page.getByRole('button', { name: /^(Delete|Eliminar)$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^(Delete|Eliminar)$/ }).click();
  await expect.poll(() => deletes).toEqual(['caldav']);
});

for (const surface of ['form', 'booking'] as const) {
  test(`the public ${surface} remains accessible on a narrow dark screen`, async ({ context, page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await context.addInitScript(() => { localStorage.setItem('db-theme', 'system'); });
    if (surface === 'form') {
      await context.route('**/api/forms/public/mobile-form', route => json(route, form));
      await page.goto('/forms/mobile-form');
      await expect(page.getByRole('heading', { name: form.title })).toBeVisible();
    } else {
      await context.route('**/api/booking/public/mobile-booking**', route => json(route,
        new URL(route.request().url()).pathname.endsWith('/slots') ? slots : info));
      await page.goto('/book/mobile-booking');
      await expect(page.locator('fieldset button')).toHaveCount(1);
    }
    await expect(page.locator('html')).toHaveClass(/dark/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`public-${surface}-mobile-dark.png`), fullPage: true });
  });
}
