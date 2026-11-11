import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as api from '../../shared/api/sites';
import { RecordWebsitePublicationDialog } from './RecordWebsitePublicationDialog';

const context = { userId: 'operator', userEmail: '', workspaceId: 'test', vaultId: 'vault' };
const translate = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock('../../shared/hooks/useRequestContext', () => ({ useRequestContext: () => context }));
vi.mock('../../shared/api/request-context', () => ({ currentRequestContext: () => ({ userEmail: context.userEmail, userId: context.userId, vaultId: context.vaultId, workspaceId: context.workspaceId }) }));
vi.mock('../../shared/hooks/useModalKeyboard', () => ({ useModalKeyboard: () => undefined }));
vi.mock('../../shared/api/sites', () => ({ recordWebsiteDestinations: vi.fn(), reviewRecordWebsite: vi.fn(), publishSite: vi.fn(), siteJobs: vi.fn() }));
const destination = { site_id: 'site', site_name: 'Example', target_id: 'local', target_name: 'Local', url: 'http://127.0.0.1:9999', environment: 'staging', published_page_ids: [] };
const preview = { id: 'review', site_id: 'site', target_id: 'local', fingerprint: 'hash', expires_at: '2099-01-01', changes: [{ kind: 'create' as const, title: 'Current article', path: '/ca/article' }, { kind: 'withdraw' as const, title: 'Other pending change', path: '/ca/other' }] };
let root: Root | undefined;
let host: HTMLDivElement;
beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => { root?.unmount(); }); host.remove(); vi.clearAllMocks(); });
async function render(destinations = [destination]) {
  vi.mocked(api.recordWebsiteDestinations).mockResolvedValue(destinations);
  vi.mocked(api.reviewRecordWebsite).mockResolvedValue(preview);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const close = vi.fn();
  await act(async () => { root?.render(<RecordWebsitePublicationDialog pageId="article" title="Current article" onClose={close} />); await Promise.resolve(); });
  return close;
}
function button(key: string) {
  return [...document.querySelectorAll('button')].find(value => value.textContent === key) as HTMLButtonElement;
}
async function click(key: string) { await act(async () => { button(key).click(); await Promise.resolve(); }); }

describe('contextual website publication', () => {
  it('reviews destination and complete website delta before explicit confirmation', async () => {
    await render();
    expect(api.publishSite).not.toHaveBeenCalled();
    await click('websites.reviewChanges');
    expect(api.reviewRecordWebsite).toHaveBeenCalledWith('site', 'article', 'local', 'publish', context);
    expect(document.body.textContent).toContain('Other pending change');
    expect(document.body.textContent).toContain('recordWebsite.wholeSite');
    expect(api.publishSite).not.toHaveBeenCalled();
    vi.mocked(api.publishSite).mockResolvedValue({ id: 'job', site_id: 'site', target_id: 'local', status: 'queued' } as api.SiteJob);
    await click('recordWebsite.confirm');
    expect(api.publishSite).toHaveBeenCalledWith('site', 'review', null, context);
    expect(document.body.textContent).toContain('websites.states.queued');
    expect(document.body.textContent).not.toContain('websites.states.completed');
  });
  it('cancel after review performs no publication', async () => {
    const close = await render();
    await click('websites.reviewChanges');
    await click('common.cancel');
    expect(close).toHaveBeenCalledOnce(); expect(api.publishSite).not.toHaveBeenCalled();
  });
  it('requires explicit hosting choice with multiple destinations and invalidates the review on change', async () => {
    await render([destination, { ...destination, target_id: 'remote', target_name: 'Remote' }]);
    expect(button('websites.reviewChanges').disabled).toBe(true);
    const select = document.querySelector('select') as HTMLSelectElement;
    await act(async () => { select.value = 'site:local'; select.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });
    await click('websites.reviewChanges');
    expect(button('recordWebsite.confirm')).toBeDefined();
    await act(async () => { select.value = 'site:remote'; select.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });
    expect(button('recordWebsite.confirm')).toBeUndefined();
  });
  it('requires another review after a rejected stale confirmation', async () => {
    await render(); await click('websites.reviewChanges');
    vi.mocked(api.publishSite).mockRejectedValue(new Error('stale review'));
    await click('recordWebsite.confirm');
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(button('recordWebsite.confirm')).toBeUndefined();
  });
  it('does not offer a publication for an unbound record', async () => {
    await render([]);
    expect(document.body.textContent).toContain('recordWebsite.noDestinations');
    expect(button('websites.reviewChanges')).toBeUndefined();
  });
});
