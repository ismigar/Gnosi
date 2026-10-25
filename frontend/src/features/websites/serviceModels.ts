/** Decode the private service's bounded JSON boundary before rendering it. */
export interface ContactMessage { id: string; formId: string; language: string; createdAt: string; status: string; notificationStatus: string; email: string; fields: { id: string; label: string; value: string }[] }
export interface Subscriber { id: string; email: string; language: string; status: string; interests: string[]; lists: { id: string; status: string }[]; consentAt: string; consentRevision: string }
export interface Campaign { id: string; subject: string; language: string; status: string; paused: boolean; recipientCount: number; createdAt: string }
export interface QueueMessage { id: string; kind: string; email: string; status: string; attempts: number; error: string }
export interface CampaignPreview { id: string; subject: string; html: string; text: string; fromEmail: string; recipientCount: number; expiresAt: string }
export interface CapturedLink { index: number; action: 'confirm' | 'preferences' | 'unsubscribe'; url: string; language: string; listId: string; state: 'ready' | 'used' | 'expired' | 'unavailable' }
export interface CapturedMail { id: string; kind: string; email: string; fromEmail: string; replyTo: string; subject: string; createdAt: string; html: string; text: string; language: string; interests: string[]; links: CapturedLink[]; actionApplied?: boolean }
export function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
export function text(value: unknown): string { return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : typeof value === 'boolean' ? String(value) : ''; }
export function count(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
export function decodeMessages(value: unknown): { items: ContactMessage[]; total: number } {
  const body = record(value);
  return { total: count(body.total), items: list(body.items).map(item => { const row = record(item); return { id: text(row.id), formId: text(row.form_id), language: text(row.language), createdAt: text(row.created_at), status: text(row.status), notificationStatus: text(row.notification_status), email: text(row.email), fields: list(row.fields).map(field => { const value = record(field); return { id: text(value.id), label: text(value.label), value: text(value.value) }; }) }; }).filter(item => Boolean(item.id)) };
}
export function decodeSubscribers(value: unknown): { items: Subscriber[]; total: number } {
  const body = record(value);
  return { total: count(body.total), items: list(body.items).map(item => { const row = record(item); return { id: text(row.id), email: text(row.email), language: text(row.language), status: text(row.status), interests: list(row.interests).map(text), lists: list(row.lists).map(value => { const member = record(value); return { id: text(member.id), status: text(member.status) }; }), consentAt: text(row.consent_revision) && text(row.consent_at) !== '1970-01-01T00:00:00+00:00' ? text(row.consent_at) : '', consentRevision: text(row.consent_revision) }; }).filter(item => Boolean(item.id)) };
}
export function decodeCampaigns(value: unknown): Campaign[] { return list(record(value).items).map(item => { const row = record(item); return { id: text(row.id), subject: text(row.subject), language: text(row.language), status: text(row.status), paused: row.paused === true || row.paused === 1, recipientCount: count(row.recipient_count), createdAt: text(row.created_at) }; }).filter(item => Boolean(item.id)); }
export function decodeQueue(value: unknown): QueueMessage[] { return list(record(value).items).map(item => { const row = record(item); return { id: text(row.id), kind: text(row.kind), email: text(row.to_email), status: text(row.status), attempts: count(row.attempts), error: text(row.error_code) }; }).filter(item => Boolean(item.id)); }
export function decodeCampaignPreview(value: unknown): CampaignPreview | null { const body = record(value); const id = text(body.preview_id); return id ? { id, subject: text(body.subject), html: text(body.body_html), text: text(body.body_text), fromEmail: text(body.from_email), recipientCount: count(body.recipient_count), expiresAt: text(body.expires_at) } : null; }

export function decodeCapturedMail(value: unknown): CapturedMail | null {
  const body = record(value); const profile = record(body.subscriber);
  if (body.test_mode !== true || !/^[a-f0-9]{32}$/u.test(text(body.id)) || typeof body.body_text !== 'string' || typeof body.body_html !== 'string') return null;
  const links: CapturedLink[] = [];
  for (const item of list(body.links)) {
    const row = record(item); const action = row.action; const state = row.state;
    if ((action !== 'confirm' && action !== 'preferences' && action !== 'unsubscribe') || (state !== 'ready' && state !== 'used' && state !== 'expired' && state !== 'unavailable') || !Number.isInteger(row.index) || typeof row.index !== 'number' || row.index < 0) continue;
    try { const url = new URL(text(row.url)); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.pathname.endsWith('/api/newsletter.php')) continue; } catch { continue; }
    links.push({ index: row.index, action, state, url: text(row.url), language: text(row.language), listId: text(row.list_id) });
  }
  return { id: text(body.id), kind: text(body.kind), email: text(body.to_email), fromEmail: text(body.from_email), replyTo: text(body.reply_to), subject: text(body.subject), createdAt: text(body.created_at), html: body.body_html, text: body.body_text, language: text(profile.language), interests: list(profile.interests).map(text), links, actionApplied: typeof body.action_applied === 'boolean' ? body.action_applied : undefined };
}

/** Parse CSV imports without splitting quoted delimiters or quoted newlines. */
export function parseCsv(value: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '"') { if (quoted && value[index + 1] === '"') { cell += '"'; index++; } else quoted = !quoted; }
    else if (!quoted && character === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (character === '\n' || character === '\r')) { if (character === '\r' && value[index + 1] === '\n') index++; row.push(cell); if (row.some(item => item.trim())) rows.push(row); row = []; cell = ''; }
    else cell += character ?? '';
  }
  if (quoted) throw new Error('Invalid quoted CSV');
  row.push(cell); if (row.some(item => item.trim())) rows.push(row);
  const headers = rows.shift()?.map(item => item.replace(/^\uFEFF/u, '').trim()) ?? [];
  if (!headers.includes('email')) throw new Error('Missing email column');
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ''])));
}
