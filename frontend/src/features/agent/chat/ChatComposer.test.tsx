import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatComposer } from './ChatComposer';
import type { ChatComposerProps } from './chatComposerTypes';
import { CHAT_ATTACHMENT_ACCEPT } from './composerModel';

const locale = createInstance();
let container: HTMLDivElement;
let root: Root;
beforeAll(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await locale.init({ lng: 'en', fallbackLng: 'en', resources: {}, interpolation: { escapeValue: false } });
});
beforeEach(() => { vi.resetAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); });
function props(overrides: Partial<ChatComposerProps> = {}): ChatComposerProps {
  return {
    readOnly: false, embedded: false, isLoading: false, agentHasModel: true,
    isUploadingAttachment: false, showMentionMenu: false, showSessionsView: false,
    inputValue: 'question', inputRef: { current: null }, fileInputRef: { current: null },
    messagesContainerRef: { current: document.createElement('div') }, attachments: [], contextRefs: [], mentionResults: [],
    setInputValue: vi.fn(), setShowSessionsView: vi.fn(),
    handleSubmit: vi.fn<ChatComposerProps['handleSubmit']>(async event => { event.preventDefault(); await Promise.resolve(); }),
    handlePickAttachment: vi.fn(), handleAttachmentInputChange: vi.fn(async () => { await Promise.resolve(); }),
    removeAttachment: vi.fn(), applyMention: vi.fn(), createNewSession: vi.fn(), ...overrides,
  };
}
async function render(value: ChatComposerProps) {
  await act(async () => { root.render(<I18nextProvider i18n={locale}><ChatComposer {...value} /></I18nextProvider>); await Promise.resolve(); });
}
function element(selector: string): HTMLElement {
  const result = container.querySelector<HTMLElement>(selector);
  if (!result) throw new Error(`Missing ${selector}`);
  return result;
}
function button(selector: string): HTMLButtonElement {
  const result = element(selector);
  if (!(result instanceof HTMLButtonElement)) throw new Error(`Not a button: ${selector}`);
  return result;
}
async function dispatch(target: HTMLElement, event: Event) {
  await act(async () => { target.dispatchEvent(event); await Promise.resolve(); });
}
async function click(label: string) {
  await act(async () => { button(`button[aria-label="${label}"]`).click(); await Promise.resolve(); });
}

describe('typed chat composer', () => {
  it('renders the read-only explanation without any editable controls', async () => {
    await render(props({ readOnly: true }));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('An editor role is required');
    expect(container.querySelector('form')).toBeNull(); expect(container.querySelector('textarea')).toBeNull(); expect(container.querySelector('input')).toBeNull();
  });
  it('keeps embedded mode minimal while preserving the hidden attachment input', async () => {
    const p = props({ embedded: true }); await render(p);
    expect(p.inputRef.current?.placeholder).toBe('Ask a question about these sources...');
    expect(container.querySelector('button[aria-label="Attach files"]')).toBeNull(); expect(container.querySelector('button[aria-label="Sessions"]')).toBeNull();
    expect(p.fileInputRef.current?.accept).toBe(CHAT_ATTACHMENT_ACCEPT); expect(p.fileInputRef.current?.multiple).toBe(true);
  });
  it.each([{ inputValue: '  ' }, { isLoading: true }, { agentHasModel: false }])('disables submission for %j', async overrides => {
    await render(props(overrides)); expect(button('button[type="submit"]').disabled).toBe(true);
  });
  it('allows an attachment-only form and preserves its context label and removal callback', async () => {
    const p = props({ inputValue: ' ', attachments: [{ id: 'a', name: 'a.txt', path: '/fixture/a', url: null, size: 1, type: 'text/plain' }], contextRefs: [{ id: 'page', ref: 'page:page', type: 'page', label: 'Research' }] });
    await render(p); expect(button('button[type="submit"]').disabled).toBe(false); expect(container.textContent).toContain('Research context');
    await click('Remove attachment a.txt'); expect(p.removeAttachment).toHaveBeenCalledExactlyOnceWith('a');
  });
  it('forwards form submission and plain Enter once, with native submission prevented', async () => {
    const p = props(); await render(p);
    const submit = new Event('submit', { bubbles: true, cancelable: true }); await dispatch(element('form'), submit);
    expect(submit.defaultPrevented).toBe(true); expect(p.handleSubmit).toHaveBeenCalledTimes(1);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); await dispatch(element('textarea'), enter);
    expect(enter.defaultPrevented).toBe(true); expect(p.handleSubmit).toHaveBeenCalledTimes(2);
  });
  it('keeps Shift+Enter native and prevents it from reaching a parent keyboard handler', async () => {
    const p = props(); const parentKey = vi.fn();
    await act(async () => { root.render(<I18nextProvider i18n={locale}><div onKeyDown={parentKey}><ChatComposer {...p} /></div></I18nextProvider>); await Promise.resolve(); });
    const enter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }); await dispatch(element('textarea'), enter);
    expect(enter.defaultPrevented).toBe(false); expect(parentKey).not.toHaveBeenCalled(); expect(p.handleSubmit).not.toHaveBeenCalled();
  });
  it('scrolls the conversation for unmodified arrows in an empty composer only', async () => {
    const scroll = vi.fn(); const scrollContainer = document.createElement('div'); scrollContainer.scrollBy = scroll;
    const p = props({ inputValue: '', messagesContainerRef: { current: scrollContainer } }); await render(p);
    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }); await dispatch(element('textarea'), up);
    expect(up.defaultPrevented).toBe(true); expect(scroll).toHaveBeenCalledExactlyOnceWith({ top: -120, behavior: 'smooth' });
    const shifted = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true }); await dispatch(element('textarea'), shifted);
    expect(shifted.defaultPrevented).toBe(false); expect(scroll).toHaveBeenCalledTimes(1);
    await render({ ...p, inputValue: 'text' }); const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }); await dispatch(element('textarea'), down);
    expect(down.defaultPrevented).toBe(false); expect(scroll).toHaveBeenCalledTimes(1);
  });
  it('picks mentions on mouse-down without blurring the composer', async () => {
    const mention = { id: 'p', type: 'page', label: 'Page', search: 'page', subtitle: 'Page' };
    const p = props({ showMentionMenu: true, mentionResults: [mention] }); await render(p); p.inputRef.current?.focus();
    const button = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Page'));
    if (!button) throw new Error('Missing mention button');
    const mouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true }); await dispatch(button, mouse);
    expect(mouse.defaultPrevented).toBe(true); expect(p.applyMention).toHaveBeenCalledExactlyOnceWith(mention); expect(document.activeElement).toBe(p.inputRef.current);
  });
  it('keeps attachment picking, upload forwarding and session controls separate from submission', async () => {
    const p = props(); await render(p); await click('Attach files'); expect(p.handlePickAttachment).toHaveBeenCalledOnce();
    await dispatch(element('input[type="file"]'), new Event('change', { bubbles: true })); expect(p.handleAttachmentInputChange).toHaveBeenCalledOnce();
    await click('New session'); expect(p.createNewSession).toHaveBeenCalledOnce();
    await click('Sessions'); expect(p.setShowSessionsView).toHaveBeenCalledOnce(); expect(p.handleSubmit).not.toHaveBeenCalled();
    await render({ ...p, isUploadingAttachment: true, isLoading: true });
    expect(button('button[aria-label="Attach files"]').disabled).toBe(true); expect(button('button[aria-label="New session"]').disabled).toBe(true);
  });
});
