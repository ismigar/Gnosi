import { describe, expect, it } from 'vitest';
import { decodeMessages, decodeSubscribers, decodeCampaignPreview, parseCsv } from './serviceModels';

describe('website private service boundary', () => {
  it('parses quoted CSV without breaking subscriber identities or consent dates', () => {
    const rows = parseCsv('email,language,interests,consent_at\r\n"reader@example.invalid",ca,"care, philosophy",2026-10-24\r\n');
    expect(rows).toEqual([{ email: 'reader@example.invalid', language: 'ca', interests: 'care, philosophy', consent_at: '2026-10-24' }]);
    expect(() => parseCsv('name\nA')).toThrow();
    expect(() => parseCsv('email\n"open')).toThrow();
  });
  it('decodes message field snapshots and notification failures without treating them as lost submissions', () => {
    const result = decodeMessages({ items: [{ id: 1, form_id: 'contact', status: 'new', notification_status: 'pending', fields: [{ id: 'message', label: 'Message', value: 'Saved despite SMTP failure' }] }], total: 1 });
    expect(result.items[0]?.fields[0]?.value).toBe('Saved despite SMTP failure');
    expect(result.items[0]?.notificationStatus).toBe('pending');
    expect(result.total).toBe(1);
  });
  it('keeps unsubscribe state and list membership distinct', () => {
    const result = decodeSubscribers({ items: [{ id: 'sub', email: 'reader@example.invalid', status: 'unsubscribed', lists: [{ id: 'weekly', status: 'unsubscribed' }], consent_revision: 'v1' }], total: 1 });
    expect(result.items[0]?.status).toBe('unsubscribed');
    expect(result.items[0]?.lists).toEqual([{ id: 'weekly', status: 'unsubscribed' }]);
  });
  it('does not present the server zero-date sentinel as confirmed consent', () => {
    const result = decodeSubscribers({ items: [{ id: 'pending', status: 'pending', consent_at: '1970-01-01T00:00:00+00:00', consent_revision: '' }, { id: 'confirmed', status: 'unsubscribed', consent_at: '2026-10-24T13:00:00+00:00', consent_revision: 'v1' }, { id: 'imported-pending', status: 'pending', consent_at: '1970-01-01T00:00:00+00:00', consent_revision: 'v1' }] });
    expect(result.items[0]?.consentAt).toBe('');
    expect(result.items[1]?.consentAt).toBe('2026-10-24T13:00:00+00:00');
    expect(result.items[2]?.consentAt).toBe('');
  });
  it('requires a reviewed campaign identity and preserves the server-returned sanitized content', () => {
    expect(decodeCampaignPreview({ body_html: '<p>Unreviewed</p>' })).toBeNull();
    expect(decodeCampaignPreview({ preview_id: 'reviewed', body_html: '<p>Sanitized</p>', recipient_count: 2 })?.html).toBe('<p>Sanitized</p>');
  });
});
