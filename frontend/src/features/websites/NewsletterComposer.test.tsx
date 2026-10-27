import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import type { NewsletterDraft, NewsletterState, ServiceResponse, SiteConfig } from '../../shared/api/sites';
import { GnosiApiError } from '../../shared/api/errors';
import { NewsletterComposer, type NewsletterActions } from './NewsletterComposer';
import type { PrivateCall } from './PrivatePanels';

vi.mock('react-i18next', () => { const t = (key: string, options?: { title?: string }) => options?.title ? `${key}:${options.title}` : key; return { useTranslation: () => ({ t }) }; });
const site: SiteConfig = { id: 'site', name: 'Synthetic site', origin: 'https://example.invalid', schema_version: 1, revision: 1, legacy_pilot: false, languages: ['ca', 'es'], default_language: 'ca' };
const initial: NewsletterState = { fingerprint: 'published-one', draft: { revision: 1, subject: 'News', mode: 'contents', template: 'digest', language: 'ca', list_id: 'default', interests: '', introduction: '', paths: [], body_html: '', body_text: '', scheduled_at: '' }, contents: [{ path: '/ca/one', title: 'One', summary: 'Published first', language: 'ca' }, { path: '/ca/two', title: 'Two', summary: 'Published second', language: 'ca' }, { path: '/es/uno', title: 'Uno', summary: 'Publicado', language: 'es' }] };
const reviewed: ServiceResponse = { test_mode: true, data: { preview_id: 'reviewed', subject: 'News', body_html: '<p>Server-sanitized template</p>', body_text: 'Text with published URL', from_email: 'sender@example.invalid', recipient_count: 1 } };
const settle = async () => { await act(async () => { for (let step = 0; step < 6; step++) await Promise.resolve(); }); };
function button(container: HTMLElement, label: string) { const element = [...container.querySelectorAll('button')].find(value => value.textContent === label || value.getAttribute('aria-label') === label); if (!element) throw new Error(`Missing button ${label}`); return element; }
function field(container: HTMLElement, label: string) { const element = [...container.querySelectorAll('label')].find(value => value.querySelector('span')?.textContent === label)?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select'); if (!element) throw new Error(`Missing field ${label}`); return element; }
function change(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) { const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }
function fixture(state = initial) {
  const actions: NewsletterActions = { load: vi.fn().mockResolvedValue(structuredClone(state)), save: vi.fn<(value: NewsletterDraft) => Promise<NewsletterDraft>>().mockImplementation(value => Promise.resolve({ ...value, revision: value.revision + 1 })), review: vi.fn().mockResolvedValue(reviewed), queue: vi.fn().mockResolvedValue({ data: { queued: 1 } }) };
  const call = vi.fn<PrivateCall>().mockResolvedValue({ queued: 1 }); const onQueued = vi.fn();
  const view = mountTestComponent(<NewsletterComposer site={site} actions={actions} onQueued={onQueued} />);
  return { ...view, actions, call, onQueued };
}
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('published newsletter composer', () => {
  it('filters published entries by language and search, deduplicates and preserves explicit ordering', async () => {
    const view = fixture(); await settle();
    expect(view.container.textContent).not.toContain('Publicado');
    act(() => { button(view.container, 'websites.newsletterAddTitle:One').click(); });
    expect(view.container.querySelector('[aria-label="websites.newsletterAddTitle:One"]')).toBeNull();
    act(() => { button(view.container, 'websites.newsletterAddTitle:Two').click(); });
    act(() => { button(view.container, 'websites.moveDown').click(); });
    act(() => { button(view.container, 'websites.reviewCampaign').click(); }); await settle();
    const request = vi.mocked(view.actions.review).mock.calls[0]?.[0];
    expect(request?.fingerprint).toBe('published-one');
    expect(request?.draft.paths).toEqual(['/ca/two', '/ca/one']);
    expect(view.call).not.toHaveBeenCalled();
  });

  it('autosaves raw delimiters and restores the draft without a save button', async () => {
    const view = fixture(); await settle();
    act(() => { change(field(view.container, 'websites.interests'), 'first,'); change(field(view.container, 'websites.newsletterIntroduction'), 'A personal introduction'); });
    await act(async () => { vi.advanceTimersByTime(650); await Promise.resolve(); }); await settle();
    expect(view.actions.save).toHaveBeenCalledOnce();
    expect(view.actions.save).toHaveBeenCalledWith(expect.objectContaining({ revision: 1, interests: 'first,', introduction: 'A personal introduction' }));
    expect(field(view.container, 'websites.interests').value).toBe('first,');
    expect([...view.container.querySelectorAll('button')].some(value => /save|desa/iu.test(value.textContent))).toBe(false);
  });

  it('reviews generated HTML and text before queue and invalidates the review on template, order or schedule changes', async () => {
    const view = fixture({ ...initial, draft: { ...initial.draft, paths: ['/ca/one'] } }); await settle();
    expect(button(view.container, 'websites.queueCampaign').disabled).toBe(true);
    act(() => { button(view.container, 'websites.reviewCampaign').click(); }); await settle();
    expect(view.container.querySelector('iframe')?.getAttribute('sandbox')).toBe('');
    expect(view.container.querySelector('iframe')?.getAttribute('srcdoc')).toContain('Server-sanitized template');
    expect(view.container.textContent).toContain('Text with published URL');
    expect(button(view.container, 'websites.queueCampaign').disabled).toBe(false);
    act(() => { change(field(view.container, 'websites.newsletterTemplate'), 'featured'); });
    expect(button(view.container, 'websites.queueCampaign').disabled).toBe(true);
    act(() => { button(view.container, 'websites.reviewCampaign').click(); }); await settle();
    act(() => { button(view.container, 'websites.queueCampaign').click(); }); await settle();
    expect(view.actions.queue).toHaveBeenCalledWith({ preview_id: 'reviewed', scheduled_at: null });
    expect(view.onQueued).toHaveBeenCalledOnce();
  });

  it('retains unpublished selections visibly and refuses review until they are removed or replaced', async () => {
    const view = fixture({ ...initial, draft: { ...initial.draft, paths: ['/ca/withdrawn'] } }); await settle();
    expect(view.container.textContent).toContain('/ca/withdrawn');
    expect(view.container.textContent).toContain('websites.newsletterSelectionUnavailable');
    expect(button(view.container, 'websites.reviewCampaign').disabled).toBe(true);
    act(() => { button(view.container, 'websites.remove').click(); });
    act(() => { change(field(view.container, 'websites.language'), 'es'); });
    expect(view.container.textContent).toContain('Publicado');
    expect(view.container.textContent).not.toContain('Published first');
  });

  it('keeps fields and blocks preview when autosave fails', async () => {
    const view = fixture({ ...initial, draft: { ...initial.draft, paths: ['/ca/one'] } }); await settle();
    vi.mocked(view.actions.save).mockRejectedValue(new Error('conflict'));
    act(() => { change(field(view.container, 'websites.subject'), 'Preserve my changes'); });
    act(() => { button(view.container, 'websites.reviewCampaign').click(); }); await settle();
    expect(view.actions.review).not.toHaveBeenCalled();
    expect(field(view.container, 'websites.subject').value).toBe('Preserve my changes');
    expect(button(view.container, 'websites.queueCampaign').disabled).toBe(true);
  });

  it('discards a late review after editing and leaves queue disabled', async () => {
    const view = fixture({ ...initial, draft: { ...initial.draft, paths: ['/ca/one'] } }); await settle();
    let resolve: (value: ServiceResponse) => void = () => undefined;
    vi.mocked(view.actions.review).mockImplementation(() => new Promise(finish => { resolve = finish; }));
    act(() => { button(view.container, 'websites.reviewCampaign').click(); }); await settle();
    act(() => { change(field(view.container, 'websites.subject'), 'Changed during review'); });
    await act(async () => { resolve(reviewed); await Promise.resolve(); }); await settle();
    expect(view.container.querySelector('iframe')).toBeNull();
    expect(button(view.container, 'websites.queueCampaign').disabled).toBe(true);
  });

  it('locks editing during refresh so a late load cannot overwrite new inputs', async () => {
    const view = fixture(); await settle();
    await act(async () => { vi.advanceTimersByTime(650); await Promise.resolve(); }); await settle();
    let finish: (value: NewsletterState) => void = () => undefined;
    vi.mocked(view.actions.load).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    act(() => { button(view.container, 'common.refresh').click(); }); await settle();
    expect(view.container.querySelector('fieldset')?.disabled).toBe(true);
    await act(async () => { finish(structuredClone(initial)); await Promise.resolve(); }); await settle();
    expect(view.container.querySelector('fieldset')?.disabled).toBe(false);
  });

  it('requires a fresh review when queue reports a changed publication', async () => {
    const view = fixture({ ...initial, draft: { ...initial.draft, paths: ['/ca/one'] } }); await settle();
    act(() => { button(view.container, 'websites.reviewCampaign').click(); }); await settle();
    vi.mocked(view.actions.queue).mockRejectedValue(new GnosiApiError(new Response(null, { status: 409 }), { detail: 'Published contents changed' }));
    act(() => { button(view.container, 'websites.queueCampaign').click(); }); await settle();
    expect(button(view.container, 'websites.queueCampaign').disabled).toBe(true);
    expect(view.container.textContent).toContain('websites.newsletterReviewFailed');
    expect(view.onQueued).not.toHaveBeenCalled();
  });
});
