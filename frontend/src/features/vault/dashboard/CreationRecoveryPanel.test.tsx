import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installBrowserLocks } from '../../../../tests/browser-locks';
import { CreationRecoveryPanel } from './CreationRecoveryPanel';
import { createRecoverablePage, pendingPageCreations } from '../../../shared/api/page-creation-recovery';
import { resetApiTestStorage, requestAt, writeApiTestStorage } from '../../../../tests/api-request';
import { emitAppEvent } from '../../../shared/platform/app-events';

beforeEach(installBrowserLocks);
afterEach(() => { resetApiTestStorage(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const locale = createInstance();
  await locale.init({ lng: 'en', resources: { en: { translation: { creation_recovery: {
    title: 'Pending creations', check: 'Check result', open: 'Open page', unknown: 'Unknown result',
    pending: 'Still running', completed: 'Completed', unconfirmed: 'Not checked', check_failed: 'Check failed',
    not_found: 'Request not found yet',
    unknown_saved: 'Page saved; related updates unconfirmed', open_saved: 'Open saved page',
    resume: 'Complete pending steps', resuming: 'Completing steps',
  } } } } });
  const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('connection lost'));
  vi.stubGlobal('fetch', fetchMock);
  await expect(createRecoverablePage({ title: 'QA lost response', content: '', metadata: {}, force: false, is_database: false })).rejects.toThrow();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onOpen = vi.fn(() => Promise.resolve());
  await act(async () => { root.render(<I18nextProvider i18n={locale}><CreationRecoveryPanel onOpen={onOpen} /></I18nextProvider>); await Promise.resolve(); });
  const check = async () => {
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Check result"]');
    if (!button) throw new Error('Missing refresh action');
    await act(async () => { button.click(); await Promise.resolve(); });
  };
  const cleanup = async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); };
  return { fetchMock, container, onOpen, check, cleanup };
}

it('recovers a completed page with a read and opens it without another creation', async () => {
  const ui = await setup();
  try {
    expect(ui.container.textContent).toContain('QA lost response');
    ui.fetchMock.mockResolvedValueOnce(Response.json({ status: 'completed', page_id: 'created-id',
      result: { id: 'created-id', title: 'QA lost response', metadata: {}, content: '', folder: '', status: 'created', message: '' } }));
    await ui.check();
    const open = [...ui.container.querySelectorAll('button')].find(button => button.textContent === 'Open page');
    expect(open).toBeDefined();
    await act(async () => { open?.click(); await Promise.resolve(); });
    expect(ui.onOpen).toHaveBeenCalledExactlyOnceWith('created-id');
    expect(pendingPageCreations()).toHaveLength(0);
    expect(ui.fetchMock).toHaveBeenCalledTimes(2);
    expect(requestAt(ui.fetchMock.mock.calls, 1).method).toBe('GET');
  } finally { await ui.cleanup(); }
});

it.each(['pending', 'unknown'])('keeps %s visible without an open or creation action', async status => {
  const ui = await setup();
  try {
    ui.fetchMock.mockResolvedValueOnce(Response.json({ status, page_id: 'id', result: null }));
    await ui.check();
    expect(ui.container.textContent).toContain(status === 'pending' ? 'Still running' : 'Unknown result');
    expect([...ui.container.querySelectorAll('button')].some(button => button.textContent === 'Open page')).toBe(false);
    expect(pendingPageCreations()).toHaveLength(1);
    expect(ui.fetchMock).toHaveBeenCalledTimes(2);
  } finally { await ui.cleanup(); }
});

it('opens a verified saved page while retaining the uncertain request identity', async () => {
  const ui = await setup();
  try {
    ui.fetchMock.mockResolvedValueOnce(Response.json({ status: 'unknown', page_available: true, page_id: 'saved-id', result: null }));
    await ui.check();
    expect(ui.container.textContent).toContain('Page saved; related updates unconfirmed');
    const open = [...ui.container.querySelectorAll('button')].find(button => button.textContent === 'Open saved page');
    expect(open).toBeDefined();
    await act(async () => { open?.click(); await Promise.resolve(); });
    expect(ui.onOpen).toHaveBeenCalledExactlyOnceWith('saved-id');
    expect(pendingPageCreations()).toHaveLength(1);
    expect(ui.fetchMock).toHaveBeenCalledTimes(2);
  } finally { await ui.cleanup(); }
});

it('resumes the original request once and offers the completed page', async () => {
  const ui = await setup();
  try {
    const key = pendingPageCreations()[0]?.key;
    ui.fetchMock.mockResolvedValueOnce(Response.json({ status: 'unknown', page_available: true,
      can_resume: true, page_id: 'saved-id', result: null, steps: [] }));
    await ui.check();
    const resume = [...ui.container.querySelectorAll('button')].find(button => button.textContent === 'Complete pending steps');
    expect(resume).toBeDefined();
    let finish: ((response: Response) => void) | undefined;
    ui.fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    await act(async () => { resume?.click(); resume?.click(); await Promise.resolve(); });
    expect(ui.fetchMock).toHaveBeenCalledTimes(3);
    expect(resume?.disabled).toBe(true);
    const sent = requestAt(ui.fetchMock.mock.calls, 2);
    expect(sent.method).toBe('POST');
    expect(sent.url).toContain(`/creation-requests/${key}/resume`);
    await act(async () => {
      finish?.(Response.json({ status: 'created', id: 'saved-id', title: 'QA lost response',
        metadata: {}, content: '', folder: '', message: 'Page created' }));
      await Promise.resolve();
    });
    expect(ui.container.textContent).toContain('Completed');
    expect(pendingPageCreations()[0]?.key).toBe(key);
    const open = [...ui.container.querySelectorAll('button')].find(button => button.textContent === 'Open page');
    await act(async () => { open?.click(); await Promise.resolve(); });
    expect(ui.onOpen).toHaveBeenCalledExactlyOnceWith('saved-id');
    expect(pendingPageCreations()).toHaveLength(0);
  } finally { await ui.cleanup(); }
});

it('preserves the request identity when continuation is rejected', async () => {
  const ui = await setup();
  try {
    const key = pendingPageCreations()[0]?.key;
    ui.fetchMock.mockResolvedValueOnce(Response.json({ status: 'unknown', page_available: true,
      can_resume: true, page_id: 'saved-id', result: null, steps: [] }));
    await ui.check();
    ui.fetchMock.mockResolvedValueOnce(Response.json({ detail: 'Configuration changed' }, { status: 409 }));
    const resume = [...ui.container.querySelectorAll('button')].find(button => button.textContent === 'Complete pending steps');
    await act(async () => { resume?.click(); await Promise.resolve(); });
    expect(ui.container.querySelector('[role="alert"]')?.textContent).toBe('Check failed');
    expect(pendingPageCreations()[0]?.key).toBe(key);
    expect(ui.onOpen).not.toHaveBeenCalled();
  } finally { await ui.cleanup(); }
});

it('ignores a continuation response after switching vaults', async () => {
  const ui = await setup();
  try {
    ui.fetchMock.mockResolvedValueOnce(Response.json({ status: 'unknown', page_available: true,
      can_resume: true, page_id: 'saved-id', result: null, steps: [] }));
    await ui.check();
    let finish: (response: Response) => void = () => undefined;
    let started: () => void = () => undefined;
    const fetching = new Promise<void>(resolve => { started = resolve; });
    ui.fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; started(); }));
    const resume = [...ui.container.querySelectorAll('button')].find(button => button.textContent === 'Complete pending steps');
    await act(async () => {
      resume?.click(); await fetching;
      writeApiTestStorage('gnosi_active_vault', 'other');
      emitAppEvent('gnosi:vault-changed', { id: 'other', name: 'Other', slug: 'other' });
      finish(Response.json({ status: 'created', id: 'old-id', title: 'QA lost response',
        metadata: {}, content: '', folder: '', message: 'Page created' }));
    });
    expect(ui.container.textContent).not.toContain('QA lost response');
    expect(ui.onOpen).not.toHaveBeenCalled();
  } finally { await ui.cleanup(); }
});

it('retains the same identity when a request has not reached the backend yet', async () => {
  const ui = await setup();
  try {
    ui.fetchMock.mockResolvedValueOnce(Response.json({ detail: 'Not found' }, { status: 404 }));
    await ui.check();
    expect(ui.container.textContent).toContain('Request not found yet');
    expect(pendingPageCreations()).toHaveLength(1);
    expect(ui.container.querySelectorAll('button')).toHaveLength(1);
    expect(ui.onOpen).not.toHaveBeenCalled();
    expect(ui.fetchMock).toHaveBeenCalledTimes(2);
  } finally { await ui.cleanup(); }
});

it('does not show a recovered page from a vault that changed while checking', async () => {
  const ui = await setup();
  try {
    let finish: (response: Response) => void = () => undefined;
    let started: () => void = () => undefined;
    const fetching = new Promise<void>(resolve => { started = resolve; });
    ui.fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; started(); }));
    await act(async () => {
      ui.container.querySelector<HTMLButtonElement>('[aria-label="Check result"]')?.click();
      await fetching;
      writeApiTestStorage('gnosi_active_vault', 'other');
      emitAppEvent('gnosi:vault-changed', { id: 'other', name: 'Other', slug: 'other' });
      finish(Response.json({ status: 'completed', page_id: 'old-id', result: { id: 'old-id' } }));
    });
    expect(ui.container.textContent).not.toContain('QA lost response');
    expect(ui.onOpen).not.toHaveBeenCalled();
  } finally { await ui.cleanup(); }
});
