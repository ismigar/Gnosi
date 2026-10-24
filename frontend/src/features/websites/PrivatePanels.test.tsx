import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import type { SiteConfig, ServiceSettings, ServiceSettingsResponse } from '../../shared/api/sites';
import { CampaignsPanel, MessagesPanel, SubscribersPanel, PrivateSettingsEditor, type PrivateCall } from './PrivatePanels';

vi.mock('react-i18next', () => { const t = (key: string) => key; return { useTranslation: () => ({ t, i18n: { language: 'en' } }) }; });
const site: SiteConfig = { id: 'site', name: 'Synthetic site', origin: 'https://example.invalid', schema_version: 1, revision: 1, legacy_pilot: false, languages: ['ca', 'es'], default_language: 'ca', forms: [] };
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const tick = async () => { await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve(); }); await settle(); };
function button(container: HTMLElement, value: string) { const found = [...container.querySelectorAll('button')].find(element => element.textContent === value); if (!found) throw new Error(`Missing button ${value}`); return found; }
function input(container: HTMLElement, label: string) { const element = [...container.querySelectorAll('label')].find(item => item.querySelector('span')?.textContent === label)?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea'); if (!element) throw new Error('Missing input'); return element; }
function change(element: HTMLInputElement | HTMLTextAreaElement, value: string) { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set?.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('website private service management', () => {
  it('shows the saved contact and failed notification independently', async () => {
    const call = vi.fn<PrivateCall>().mockResolvedValue({ items: [{ id: 'message', email: 'reader@example.invalid', form_id: 'contact', status: 'new', notification_status: 'rejected', fields: [{ id: 'body', label: 'Message', value: 'Stored even when SMTP failed' }] }], total: 1 });
    const view = mountTestComponent(<MessagesPanel site={site} call={call} />); await tick();
    const row = [...view.container.querySelectorAll('button')].find(element => element.textContent.includes('reader@example.invalid'));
    act(() => { row?.click(); });
    expect(view.container.textContent).toContain('Stored even when SMTP failed');
    expect(view.container.textContent).toContain('websites.states.rejected');
    expect(view.container.querySelector('a')?.getAttribute('href')).toBe('mailto:reader%40example.invalid');
  });

  it('queues only a reviewed campaign and invalidates it when the audience or content changes', async () => {
    const call = vi.fn<PrivateCall>().mockImplementation((name) => Promise.resolve(name === 'campaign_preview' ? { preview_id: 'reviewed', subject: 'News', body_html: '<p>Server sanitized</p>', body_text: 'Server sanitized', from_email: 'sender@example.invalid', recipient_count: 1 } : name === 'campaign_queue' ? { queued: 1 } : { items: [] }));
    const view = mountTestComponent(<CampaignsPanel site={site} call={call} />); await tick();
    act(() => { change(input(view.container, 'websites.subject'), 'News'); });
    act(() => { change(input(view.container, 'websites.htmlBody'), '<p>News</p>'); });
    act(() => { button(view.container, 'websites.reviewCampaign').click(); }); await settle();
    const frame = view.container.querySelector('iframe');
    expect(frame?.getAttribute('sandbox')).toBe('');
    expect(frame?.getAttribute('srcdoc')).toContain('Server sanitized');
    expect(view.container.textContent).toContain('sender@example.invalid');
    expect(button(view.container, 'websites.queueCampaign').disabled).toBe(false);
    act(() => { change(input(view.container, 'websites.interests'), 'changed'); });
    expect(button(view.container, 'websites.queueCampaign').disabled).toBe(true);
    act(() => { button(view.container, 'websites.reviewCampaign').click(); }); await settle();
    act(() => { button(view.container, 'websites.queueCampaign').click(); }); await settle();
    expect(call).toHaveBeenCalledWith('campaign_queue', { preview_id: 'reviewed', scheduled_at: null });
  });

  it('preserves edited private settings when saving fails', async () => {
    const value: ServiceSettingsResponse = { configured: true, test_mode: true, smtp_host: '', smtp_port: 587, smtp_username: '', smtp_security: 'starttls', sender_email: '', sender_name: '', password_configured: true, applied: true, apply_error: null, forms: {} };
    const load = vi.fn().mockResolvedValue(value); const save = vi.fn().mockRejectedValue(new Error('unavailable'));
    const view = mountTestComponent(<PrivateSettingsEditor site={site} load={load} save={save} />); await settle();
    act(() => { change(input(view.container, 'websites.smtpHost'), 'smtp.example.invalid'); });
    act(() => { button(view.container, 'websites.savePrivateSettings').click(); }); await settle();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe('websites.settingsFailed');
    expect(input(view.container, 'websites.smtpHost').value).toBe('smtp.example.invalid');
  });

  it('keeps recipient delimiters while typing and saves both addresses immediately', async () => {
    const contactSite = { ...site, forms: [{ id: 'contact', name: 'Contact', revision: 1, enabled: false, privacy_url: '', require_privacy: false, fields: [] }] };
    const value: ServiceSettingsResponse = { configured: true, test_mode: true, smtp_host: '', smtp_port: 587, smtp_username: '', smtp_security: 'starttls', sender_email: '', sender_name: '', password_configured: false, applied: true, apply_error: null, forms: {} };
    const load = vi.fn().mockResolvedValue(value); const save = vi.fn<(settings: ServiceSettings) => Promise<ServiceSettingsResponse>>().mockResolvedValue(value);
    const view = mountTestComponent(<PrivateSettingsEditor site={contactSite} load={load} save={save} />); await settle();
    const field = input(view.container, 'websites.recipients');
    let expected = '';
    for (const character of 'first@example.invalid\nsecond@example.invalid') {
      expected += character;
      act(() => { change(field, field.value + character); });
      expect(field.value).toBe(expected);
    }
    act(() => { button(view.container, 'websites.savePrivateSettings').click(); }); await settle();
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0]?.forms?.contact?.recipients).toEqual(['first@example.invalid', 'second@example.invalid']);
  });

  it('keeps typed campaign interest delimiters and reviews both interests', async () => {
    const call = vi.fn<PrivateCall>().mockResolvedValue({ items: [] });
    const view = mountTestComponent(<CampaignsPanel site={site} call={call} />); await tick();
    act(() => { change(input(view.container, 'websites.subject'), 'News'); });
    act(() => { change(input(view.container, 'websites.htmlBody'), '<p>News</p>'); });
    const field = input(view.container, 'websites.interests');
    let expected = '';
    for (const character of 'first,second') {
      expected += character;
      act(() => { change(field, field.value + character); });
      expect(field.value).toBe(expected);
    }
    act(() => { button(view.container, 'websites.reviewCampaign').click(); }); await settle();
    expect(call).toHaveBeenCalledWith('campaign_preview', expect.objectContaining({ interests: ['first', 'second'] }));
  });

  it('exposes subscriber import as a focusable native button wired to its file input', async () => {
    const call = vi.fn<PrivateCall>().mockResolvedValue({ items: [], total: 0 });
    const view = mountTestComponent(<SubscribersPanel site={site} call={call} />); await tick();
    const trigger = button(view.container, 'websites.importCsv');
    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error('Missing file input');
    const open = vi.spyOn(fileInput, 'click').mockImplementation(() => undefined);
    act(() => { trigger.focus(); });
    expect(document.activeElement).toBe(trigger);
    expect(trigger.tabIndex).toBe(0);
    expect(trigger.type).toBe('button');
    act(() => { trigger.click(); });
    expect(open).toHaveBeenCalledOnce();
  });

  it.each([['websites.interests', 'new-audience'], ['websites.htmlBody', '<p>New content</p>']])('discards a late campaign review after editing %s and queues only the fresh review', async (label, value) => {
    let finish: (value: unknown) => void = () => undefined;
    const call = vi.fn<PrivateCall>().mockImplementation(name => name === 'campaign_preview' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(name === 'campaign_queue' ? { queued: 1 } : { items: [] }));
    const view = mountTestComponent(<CampaignsPanel site={site} call={call} />); await tick();
    act(() => { change(input(view.container, 'websites.subject'), 'First subject'); });
    act(() => { change(input(view.container, 'websites.htmlBody'), '<p>First body</p>'); });
    act(() => { button(view.container, 'websites.reviewCampaign').click(); }); await settle();
    act(() => { change(input(view.container, label), value); });
    act(() => { finish({ preview_id: 'obsolete-review', subject: 'First subject', body_html: '<p>Obsolete review</p>', body_text: 'First body', from_email: 'sender@example.invalid', recipient_count: 1 }); }); await settle();
    expect(input(view.container, label).value).toBe(value);
    expect(button(view.container, 'websites.queueCampaign').disabled).toBe(true);
    expect(view.container.querySelector('iframe')).toBeNull();
    expect(call.mock.calls.some(([name]) => name === 'campaign_queue')).toBe(false);
    act(() => { button(view.container, 'websites.reviewCampaign').click(); }); await settle();
    act(() => { finish({ preview_id: 'fresh-review', subject: 'First subject', body_html: '<p>Fresh review</p>', body_text: 'New draft', from_email: 'sender@example.invalid', recipient_count: 2 }); }); await settle();
    expect(button(view.container, 'websites.queueCampaign').disabled).toBe(false);
    act(() => { button(view.container, 'websites.queueCampaign').click(); }); await settle();
    expect(call).toHaveBeenCalledWith('campaign_queue', { preview_id: 'fresh-review', scheduled_at: null });
    expect(call).not.toHaveBeenCalledWith('campaign_queue', expect.objectContaining({ preview_id: 'obsolete-review' }));
  });
});
