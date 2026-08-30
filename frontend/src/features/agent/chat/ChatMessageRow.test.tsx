import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { boundedCitations, boundedJob } from '../model/agentChatTransparency';
import { ChatMessageRow } from './ChatMessageRow';
import type { ChatMessageRowProps } from './chatMessageRowTypes';
import { messagePresentation } from './messagePresentation';

const locale = createInstance();
let container: HTMLDivElement;
let root: Root;
beforeAll(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await locale.init({ lng: 'en', fallbackLng: 'en', resources: {}, interpolation: { escapeValue: false } });
});
beforeEach(() => { vi.resetAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); });
function props(overrides: Partial<ChatMessageRowProps> = {}): ChatMessageRowProps {
  return {
    message: { content: 'answer', role: 'assistant', turnId: 'turn' }, index: 2,
    notebookId: '', readOnly: false, conversationMode: 'private_member', storageIdentity: 'me', agentName: 'Fixture',
    isLoading: false, isRewinding: false, detailsMessageIndex: null,
    confirmationTitle: () => 'Review action', setPendingConfirmation: vi.fn(), setPendingRewindIndex: vi.fn(), setDetailsMessageIndex: vi.fn(),
    focusComposerWith: vi.fn(), copyMessage: vi.fn<ChatMessageRowProps['copyMessage']>().mockResolvedValue(undefined),
    quoteMessage: vi.fn(), markMessage: vi.fn(), submitMessageFeedback: vi.fn<ChatMessageRowProps['submitMessageFeedback']>().mockResolvedValue(undefined),
    refreshMessageJob: vi.fn<ChatMessageRowProps['refreshMessageJob']>().mockResolvedValue(undefined), previousUserPrompt: () => 'original question', retryMessage: vi.fn(), ...overrides,
  };
}
async function render(p: ChatMessageRowProps) {
  await act(async () => { root.render(<I18nextProvider i18n={locale}><ChatMessageRow {...p} /></I18nextProvider>); await Promise.resolve(); });
}
function button(label: string): HTMLButtonElement {
  const result = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
async function click(label: string) {
  await act(async () => { button(label).click(); await Promise.resolve(); });
}

describe('live message presentation refinement', () => {
  it('retains complete content, private review details and opaque fields without storage truncation', () => {
    const message = { content: 'long'.repeat(6000), extra: { nested: 'kept' }, confirmation: { confirmation_id: 'action', client_scope: 'scope', details: { before: 'old', after: 'new' } }, llm: { model: 'fixture', strategy: { mode: 'balanced' } } };
    const view = messagePresentation(message);
    expect(view.content).toBe(message.content); expect(view.extra).toBe(message.extra); expect(view.confirmation?.details).toEqual(message.confirmation.details); expect(view.confirmation?.client_scope).toBe('scope'); expect(view.llm?.strategy?.mode).toBe('balanced');
  });
  it('refines malformed optional fields locally without modifying the original message', () => {
    const message = { content: 'text', attachments: [null, 1, { name: 'file', url: '/fixture/file' }, { name: 42 }], llm: false, undo: 'invalid', feedback: {}, retryable: true };
    const view = messagePresentation(message);
    expect(view.attachments).toEqual([{ name: 'file', url: '/fixture/file' }, { name: undefined, url: undefined }]); expect(view.llm).toBeUndefined(); expect(view.undo).toBeUndefined(); expect(view.feedback).toBeUndefined(); expect(message.attachments).toHaveLength(4);
  });
  it('preserves the plugin undo receiver without executing during presentation', () => {
    const undo = { available: true, count: 0, run() { this.count += 1; return this.count; } };
    const view = messagePresentation({ content: 'plugin', undo }); expect(undo.count).toBe(0); expect(view.undo?.run?.()).toBe(1); expect(undo.count).toBe(1);
  });
});

describe('typed message row', () => {
  it('preserves source order, verified versions and external/internal link attributes', async () => {
    const citations = boundedCitations({ sources: [
      { citation_id: 'web', title: 'External', href: 'https://example.org/evidence', version_status: 'exact' },
      { citation_id: 'local', title: 'Local', href: '/vault/page/note' },
      { citation_id: 'missing', title: 'Unlinked' },
    ], claims: [{ claim_id: 'claim', text: 'Grounded statement', citation_ids: ['web', 'local', 'missing'] }] });
    await render(props({ notebookId: 'notebook', message: { content: 'answer', role: 'assistant', citations } }));
    expect(container.querySelector('details')?.open).toBe(true); expect(container.textContent).toContain('1 grounded claim(s) · 3 source(s)');
    const links = Array.from(container.querySelectorAll('a'));
    expect(links.map(link => link.textContent)).toEqual(['External · version verified', 'Local']);
    expect(links[0]?.target).toBe('_blank'); expect(links[0]?.rel).toBe('noreferrer'); expect(links[1]?.getAttribute('href')).toBe('/vault/page/note'); expect(links[1]?.getAttribute('target')).toBeNull();
    expect(links[0]?.getAttribute('aria-label')).toContain('External'); expect(container.querySelector('span[title="This evidence has no direct link."]')?.textContent).toBe('Unlinked');
  });
  it('keeps confirmation review explicit and hides the review button for completed actions', async () => {
    const confirmation = { confirmation_id: 'a', status: 'pending', details: { before: 'old', after: 'new' }, client_scope: 'scope' };
    const p = props({ message: { content: 'confirm', confirmation } }); await render(p);
    const review = Array.from(container.querySelectorAll('button')).find(item => item.textContent === 'Review and confirm');
    if (!review) throw new Error('Missing review');
    expect(p.setPendingConfirmation).not.toHaveBeenCalled();
    await act(async () => { review.click(); await Promise.resolve(); });
    expect(p.setPendingConfirmation).toHaveBeenCalledWith(expect.objectContaining({ confirmation_id: 'a', client_scope: 'scope', details: confirmation.details }));
    await render({ ...p, message: { content: 'confirm', confirmation: { ...confirmation, status: 'completed' } } }); expect(container.textContent).not.toContain('Review and confirm');
  });
  it('shows attachment links/fallback names and the original author/model/timing labels', async () => {
    const p = props({ message: { content: 'answer', role: 'assistant', llm: { model: 'Model' }, processingMs: 1200, attachments: [{ name: 'a.txt', url: '/fixture/a' }, { name: 'b.txt' }, {}] } });
    await render(p); expect(container.textContent).toContain('Fixture - Model · 1.2 s'); expect(container.textContent).toContain('b.txt'); expect(container.textContent).toContain('file');
    expect(container.querySelector('a')?.target).toBe('_blank');
    await render({ ...p, message: { content: 'question', role: 'user', author_user_id: 'other' } }); expect(container.textContent).toContain('Member other');
    await render({ ...p, message: { content: 'question', role: 'user', author_user_id: 'me' } }); expect(container.textContent).toContain('You');
  });
  it('forwards copy, quote, prefill, retry, feedback and save without executing a new turn', async () => {
    const p = props({ message: { content: 'answer', role: 'assistant', turnId: 'turn', retryable: true, saved: true, feedback: 'up' } }); await render(p);
    await click('Copy message'); await click('Reply to message'); await click('Regenerate response'); await click('Retry response'); await click('Helpful response'); await click('Unhelpful response'); await click('Save message');
    expect(p.copyMessage).toHaveBeenCalledExactlyOnceWith('answer'); expect(p.quoteMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'answer' })); expect(p.focusComposerWith).toHaveBeenCalledExactlyOnceWith('original question'); expect(p.retryMessage).toHaveBeenCalledExactlyOnceWith(2);
    expect(p.submitMessageFeedback).toHaveBeenNthCalledWith(1, 2, 'up'); expect(p.submitMessageFeedback).toHaveBeenNthCalledWith(2, 2, 'down'); expect(p.markMessage).toHaveBeenCalledExactlyOnceWith(2, 'saved', false); expect(button('Helpful response').getAttribute('aria-pressed')).toBe('true');
    await render({ ...p, message: { content: 'question', role: 'user' } }); await click('Edit and resend'); expect(p.focusComposerWith).toHaveBeenLastCalledWith('question');
  });
  it('opens the rewind review for a turn and preserves direct plugin undo instead', async () => {
    const p = props(); await render(p); await click('Undo from this message'); expect(p.setPendingRewindIndex).toHaveBeenCalledExactlyOnceWith(2);
    const undo = { available: true, count: 0, run() { this.count += 1; } };
    await render({ ...p, message: { ...p.message, undo } }); await click('Undo last action'); expect(undo.count).toBe(1); expect(p.setPendingRewindIndex).toHaveBeenCalledTimes(1);
    await render({ ...p, isRewinding: true }); expect(button('Undo from this message').disabled).toBe(true);
  });
  it('hides editing/rewind in readonly mode and rewind in a shared conversation', async () => {
    const p = props({ readOnly: true }); await render(p);
    expect(container.querySelector('button[aria-label="Reply to message"]')).toBeNull(); expect(container.querySelector('button[aria-label="Undo from this message"]')).toBeNull(); expect(button('Copy message')).toBeDefined(); expect(button('Helpful response')).toBeDefined();
    await render({ ...p, readOnly: false, conversationMode: 'shared' }); expect(container.querySelector('button[aria-label="Undo from this message"]')).toBeNull(); expect(button('Reply to message')).toBeDefined();
  });
  it('toggles details and routes job actions to the correct message', async () => {
    const p = props({ message: { content: 'answer', role: 'assistant', job: boundedJob({ job_id: 'j', status: 'running', capabilities: { cancel: true } }) } });
    await render(p); await click('Message details'); expect(p.setDetailsMessageIndex).toHaveBeenCalledExactlyOnceWith(2);
    await render({ ...p, detailsMessageIndex: 2 }); expect(button('Message details').getAttribute('aria-expanded')).toBe('true');
    for (const label of ['Refresh', 'Cancel job']) {
      const action = Array.from(container.querySelectorAll('button')).find(item => item.textContent === label);
      if (!action) throw new Error(`Missing job action ${label}`);
      await act(async () => { action.click(); await Promise.resolve(); });
    }
    expect(p.refreshMessageJob).toHaveBeenNthCalledWith(1, 2, undefined);
    expect(p.refreshMessageJob).toHaveBeenNthCalledWith(2, 2, 'cancel');
    await click('Message details'); expect(p.setDetailsMessageIndex).toHaveBeenLastCalledWith(null);
  });
});
