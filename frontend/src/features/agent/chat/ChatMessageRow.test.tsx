import { activateVault } from '../../../shared/routing/vaultRouting';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { boundedCitations, boundedJob } from '../model/agentChatTransparency';
import { ChatMessageRow } from './ChatMessageRow';
import type { ChatMessageRowProps } from './chatMessageRowTypes';
import { messagePresentation } from './messagePresentation';
import ca from '../../../shared/i18n/locales/ca/translation.json';
import en from '../../../shared/i18n/locales/en/translation.json';
import es from '../../../shared/i18n/locales/es/translation.json';
import fr from '../../../shared/i18n/locales/fr/translation.json';

const savedResult = vi.hoisted(() => vi.fn<(input: { title: string; content: string }) => Promise<{ id: string }>>());
vi.mock('../../../shared/api/vault-page-mutations', () => ({ createVaultPage: savedResult }));
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
    notebookId: '', readOnly: false, conversationMode: 'private_member', storageIdentity: 'me', profiles: [],
    isLoading: false, isRewinding: false, showTurnRewind: true, detailsMessageIndex: null,
    confirmationTitle: () => 'Review action', setPendingConfirmation: vi.fn(), setPendingRewindIndex: vi.fn(), setDetailsMessageIndex: vi.fn(),
    focusComposerWith: vi.fn(), copyMessage: vi.fn<ChatMessageRowProps['copyMessage']>().mockResolvedValue(undefined),
    quoteMessage: vi.fn(), markMessage: vi.fn(), submitMessageFeedback: vi.fn<ChatMessageRowProps['submitMessageFeedback']>().mockResolvedValue(undefined),
    refreshMessageJob: vi.fn<ChatMessageRowProps['refreshMessageJob']>().mockResolvedValue(undefined), previousUserPrompt: () => 'original question', retryMessage: vi.fn(), ...overrides,
  };
}
async function render(p: ChatMessageRowProps, i18n = locale) {
  await act(async () => { root.render(<I18nextProvider i18n={i18n}><ChatMessageRow {...p} /></I18nextProvider>); await Promise.resolve(); });
}
function button(label: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')].find(item => (item.getAttribute('aria-label') || item.textContent) === label);
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
  it('renders assistant tables in a scoped result and opens a saved page using its canonical vault route', async () => {
    activateVault({ id: 'vault-a', slug: 'historia', name: 'Història' }, { notify: false });
    savedResult.mockResolvedValue({ id: 'saved/page' });
    const content = '| Sample | Value |\n| --- | --- |\n| A | 12 |';
    await render(props({ message: { role: 'assistant', content } }));
    expect(container.querySelector('.chat-result table')).not.toBeNull();
    expect([...container.querySelectorAll('.chat-result th')].map(cell => cell.textContent)).toEqual(['Sample', 'Value']);
    const save = button('Save as page');
    expect(save.textContent).toBe('');
    save.focus();
    await click('Save as page');
    expect(savedResult).toHaveBeenCalledWith({ title: 'Assistant result', content });
    const link = container.querySelector<HTMLAnchorElement>('a[aria-label="Open saved page"]');
    expect(link?.getAttribute('href')).toBe('/@historia/knowledge/page/saved%2Fpage');
    expect(link?.textContent).toBe('');
    expect(document.activeElement).toBe(link);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Page saved');
    await render(props({ message: { role: 'user', content } }));
    expect(container.querySelector('.chat-result')).toBeNull();
    expect(container.textContent).toContain('| Sample | Value |');
  });
  it.each(Object.entries({ ca, en, es, fr }))('names the compact actions and their states in %s', async (language, translation) => {
    const i18n = createInstance();
    await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation } } });
    savedResult.mockResolvedValue({ id: 'page' });
    const p = props({ message: { role: 'assistant', content: 'Sample', llm: { model: 'Fixture' }, retryable: true } });
    await render(p, i18n);
    for (const label of [translation.chat.copy_message, translation.chat.save_result, translation.chat.retry_response, translation.chat.save_message]) {
      expect(button(label).title).toBe(label);
      expect(button(label).textContent).toBe('');
    }
    expect(button(translation.chat.task_details).getAttribute('aria-expanded')).toBe('false');
    await click(translation.chat.save_result);
    const open = container.querySelector('a[aria-label]');
    expect(open?.getAttribute('aria-label')).toBe(translation.chat.open_result);
    expect(open?.getAttribute('title')).toBe(translation.chat.open_result);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(translation.chat.result_saved);
  });
  it('keeps a failed save retryable, prevents double creation and leaves other controls focused', async () => {
    savedResult.mockRejectedValueOnce(new Error('Offline'));
    const p = props(); await render(p); await click('Save as page');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not save');
    let complete: ((value: { id: string }) => void) | undefined;
    savedResult.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const save = button('Save as page');
    await act(async () => { save.click(); save.click(); await Promise.resolve(); });
    expect(savedResult).toHaveBeenCalledTimes(2);
    expect(save.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    button('Copy message').focus();
    await act(async () => { complete?.({ id: 'page' }); await Promise.resolve(); });
    expect(document.activeElement).toBe(button('Copy message'));
  });
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
    const p = props({ message: { content: 'answer', role: 'assistant', assistant_profile: { id: 'fixture', name: 'Fixture' }, llm: { model: 'Model' }, processingMs: 1200, attachments: [{ name: 'a.txt', url: '/fixture/a' }, { name: 'b.txt' }, {}] } });
    await render(p); expect(container.textContent).toContain('Fixture - Model · 1.2 s'); expect(container.textContent).toContain('b.txt'); expect(container.textContent).toContain('file');
    expect(container.querySelector('a')?.target).toBe('_blank');
    await render({ ...p, message: { content: 'question', role: 'user', author_user_id: 'other' } }); expect(container.textContent).toContain('Member other');
    await render({ ...p, message: { content: 'question', role: 'user', author_user_id: 'me' } }); expect(container.textContent).toContain('You');
  });
  it.each(Object.entries({ ca, en, es, fr }))('keeps the footer and editable quotation tied to each message in %s', async (language, translation) => {
    const i18n = createInstance();
    await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation } } });
    const builtin = { id: 'builtin.resources.default', name: 'Literature assistance', managed_by: 'builtin:resources' };
    const localName = translation.settings.ai.assistant.builtin_profiles.resources;
    const cases = [
      { message: { role: 'assistant', content: 'result', assistant_profile: builtin, llm: { model: 'model-a' } }, footer: localName + ' - model-a', quote: localName },
      { message: { role: 'assistant', content: 'result', assistant_profile: { ...builtin, name: 'My name' } }, footer: 'My name', quote: 'My name' },
      { message: { role: 'assistant', content: 'result', llm: { model: 'model-b' } }, footer: translation.chat.assistant_author + ' - model-b', quote: translation.chat.assistant_author + ' - model-b' },
      { message: { role: 'user', content: 'result', author_user_id: 'other' }, footer: i18n.t('notebooks.member_message', { member: 'other' }), quote: i18n.t('notebooks.member_message', { member: 'other' }) },
      { message: { role: 'system', content: 'result' }, footer: translation.chat.system_author, quote: translation.chat.system_author },
    ];
    for (const item of cases) {
      const p = props({ message: item.message });
      await render(p, i18n);
      expect(container.querySelector('.chat-message > span:last-child')?.textContent).toBe(item.footer);
      await click(translation.chat.reply_to_message);
      expect(p.quoteMessage).toHaveBeenCalledExactlyOnceWith('result', item.quote);
    }
  });
  it('forwards copy, quote, prefill, retry, feedback and save without executing a new turn', async () => {
    const p = props({ message: { content: 'answer', role: 'assistant', turnId: 'turn', retryable: true, saved: true, feedback: 'up' } }); await render(p);
    await click('Copy message'); await click('Reply to message'); expect(container.querySelector('button[aria-label="Regenerate response"]')).toBeNull(); await click('Retry response'); await click('Helpful response'); await click('Unhelpful response'); await click('Bookmark message');
    expect(p.copyMessage).toHaveBeenCalledExactlyOnceWith('answer'); expect(p.quoteMessage).toHaveBeenCalledExactlyOnceWith('answer', 'Assistant'); expect(p.focusComposerWith).not.toHaveBeenCalled(); expect(p.retryMessage).toHaveBeenCalledExactlyOnceWith(2);
    expect(p.submitMessageFeedback).toHaveBeenNthCalledWith(1, 2, 'up'); expect(p.submitMessageFeedback).toHaveBeenNthCalledWith(2, 2, 'down'); expect(p.markMessage).toHaveBeenCalledExactlyOnceWith(2, 'saved', false); expect(button('Helpful response').getAttribute('aria-pressed')).toBe('true');
    await render({ ...p, message: { content: 'answer', role: 'assistant' } });
    expect(container.querySelector('button[aria-label="Retry response"]')).toBeNull(); await click('Regenerate response');
    expect(p.focusComposerWith).toHaveBeenCalledExactlyOnceWith('original question');
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
  it('opens one activity disclosure above the answer and routes its job actions to that message', async () => {
    const p = props({ message: { content: 'answer', role: 'assistant', job: boundedJob({ job_id: 'j', status: 'running', capabilities: { cancel: true } }) } });
    await render(p);
    const activity = button('Task activity');
    expect(container.querySelector('button[aria-label="Message details"]')).toBeNull();
    expect(container.textContent).not.toContain('Cancel job');
    const answer = container.querySelector('.chat-result');
    if (!answer) throw new Error('Missing answer');
    expect(Boolean(activity.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(document.getElementById(activity.getAttribute('aria-controls') ?? '')?.hidden).toBe(true);
    await click('Task activity'); expect(p.setDetailsMessageIndex).toHaveBeenCalledExactlyOnceWith(2);
    await render({ ...p, detailsMessageIndex: 2 }); expect(button('Task activity').getAttribute('aria-expanded')).toBe('true');
    for (const label of ['Refresh', 'Cancel job']) {
      const action = Array.from(container.querySelectorAll('button')).find(item => item.textContent === label);
      if (!action) throw new Error(`Missing job action ${label}`);
      await act(async () => { action.click(); await Promise.resolve(); });
    }
    expect(p.refreshMessageJob).toHaveBeenNthCalledWith(1, 2, undefined);
    expect(p.refreshMessageJob).toHaveBeenNthCalledWith(2, 2, 'cancel');
    await click('Task activity'); expect(p.setDetailsMessageIndex).toHaveBeenLastCalledWith(null);
    await render(props({ message: { role: 'user', content: 'Question' } }));
    expect(container.querySelector('button[aria-label="Message details"]')).toBeNull();
    await render(props({ message: { role: 'user', content: 'See attachment', attachments: [{ name: 'sample.txt' }] } }));
    expect(button('Message details')).toBeDefined();
  });
});
