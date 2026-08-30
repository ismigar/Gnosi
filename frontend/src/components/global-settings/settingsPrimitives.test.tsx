import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GnosiToggle, InlineEditorPlacement } from './SettingsPrimitives';
import { PasswordInput } from './PasswordInput';
import { AgentIconSelect } from './AgentIconSelect';
import { readStorage, writeStorage, snippetsKey, syncErrorsKey, configurePluginKey } from './settingsStorage';
import { defineStorageKey, stringStorageCodec, listStorageKeyNames, removeStorage } from '../../shared/platform/browser-storage';
import { dispatchWindowEvent } from '../../shared/platform/browser-events';

const rawSnippets = defineStorageKey('gnosi_mail_snippets', stringStorageCodec);
const rawSyncErrors = defineStorageKey('gnosi_mail_sync_errors', stringStorageCodec);
const localPluginRequest = defineStorageKey('gnosi:configure-plugin', stringStorageCodec);

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  for (const area of ['local', 'session'] as const) {
    for (const name of listStorageKeyNames(area)) removeStorage(defineStorageKey(name, stringStorageCodec, area));
  }
  vi.unstubAllGlobals();
});

function element<T extends Element>(selector: string, type: { new(): T }): T {
  const node = container.querySelector(selector);
  if (!(node instanceof type)) throw new Error(`Missing ${selector}`);
  return node;
}

describe('public settings primitives', () => {
  it('passes the activation event for click, Space and Enter without submitting', () => {
    const change = vi.fn();
    act(() => { root.render(<GnosiToggle active label="Toggle" onChange={change} />); });
    const toggle = element('[role=switch]', HTMLDivElement);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.tabIndex).toBe(0);
    act(() => { toggle.click(); });
    for (const key of [' ', 'Enter']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      act(() => { toggle.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(true);
    }
    expect(change).toHaveBeenCalledTimes(3);
    expect(change.mock.calls[0]?.[0]).toHaveProperty('type', 'click');
    act(() => { toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    expect(change).toHaveBeenCalledTimes(3);
  });
  it('keeps display-only switches out of the focus order', () => {
    const change = vi.fn();
    act(() => { root.render(<GnosiToggle display active onChange={change} scale={0.6} />); });
    const toggle = element('.gnosi-toggle', HTMLDivElement);
    expect(toggle.getAttribute('aria-hidden')).toBe('true');
    expect(toggle.hasAttribute('role')).toBe(false);
    expect(toggle.style.transform).toBe('scale(0.6)');
    act(() => { toggle.click(); });
    expect(change).not.toHaveBeenCalled();
  });
  it('waits for an attached editor anchor and keeps input identity while typing', () => {
    function Harness() {
      const [target, setTarget] = useState<HTMLDivElement | null>(null);
      const [text, setText] = useState('Draft');
      return <><div ref={setTarget} data-anchor /><InlineEditorPlacement target={target} waitForTarget><input value={text} onChange={event => { setText(event.target.value); }} /></InlineEditorPlacement></>;
    }
    act(() => { root.render(<Harness />); });
    const input = element('[data-anchor] input', HTMLInputElement);
    input.focus();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Updated');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(element('input', HTMLInputElement)).toBe(input);
    expect(input.value).toBe('Updated');
    expect(document.activeElement).toBe(input);
    act(() => { root.render(<InlineEditorPlacement waitForTarget><input /></InlineEditorPlacement>); });
    expect(container.querySelector('input')).toBeNull();
  });
  it('toggles password visibility without changing the value or submitting', () => {
    const submit = vi.fn((event: React.SyntheticEvent<HTMLFormElement>) => { event.preventDefault(); });
    act(() => { root.render(<form onSubmit={submit}><PasswordInput value="fixture-secret" onChange={vi.fn()} name="fixture-password" autoComplete="new-password" /></form>); });
    const input = element('input', HTMLInputElement);
    expect(input.type).toBe('password');
    act(() => { element('button', HTMLButtonElement).click(); });
    expect(input.type).toBe('text');
    expect(input.value).toBe('fixture-secret');
    expect(input.autocomplete).toBe('new-password');
    expect(submit).not.toHaveBeenCalled();
  });
  it('selects an agent icon and closes on Escape without changing selection', () => {
    const change = vi.fn();
    act(() => { root.render(<AgentIconSelect value="lucide:Brain:blue" onChange={change} label="Icon" searchPlaceholder="Search" noResultsLabel="None" />); });
    act(() => { element('[aria-haspopup=listbox]', HTMLButtonElement).click(); });
    expect(element('[role=listbox]', HTMLDivElement)).toBeTruthy();
    act(() => { element('[role=option][aria-label=Bot]', HTMLButtonElement).click(); });
    expect(change).toHaveBeenCalledWith('lucide:Bot:blue');
    expect(container.querySelector('[role=listbox]')).toBeNull();
    act(() => { element('[aria-haspopup=listbox]', HTMLButtonElement).click(); });
    act(() => { dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(container.querySelector('[role=listbox]')).toBeNull();
    expect(change).toHaveBeenCalledTimes(1);
  });
});

describe('settings storage contracts', () => {
  it('preserves snippet keys, Unicode and explicitly empty lists', () => {
    const snippets = [{ id: 'snip_1', title: 'Salutació', content: 'Hola\n🧠' }];
    expect(writeStorage(snippetsKey, snippets)).toBe(true);
    expect(readStorage(rawSnippets)).toBe(JSON.stringify(snippets));
    expect(readStorage(snippetsKey)).toEqual(snippets);
    writeStorage(snippetsKey, []);
    expect(readStorage(snippetsKey)).toEqual([]);
  });
  it('rejects malformed saved collections without throwing', () => {
    writeStorage(rawSnippets, '{broken');
    writeStorage(rawSyncErrors, '[42]');
    expect(readStorage(snippetsKey)).toBeUndefined();
    expect(readStorage(syncErrorsKey)).toBeUndefined();
    writeStorage(rawSyncErrors, '["fixture@example.invalid"]');
    expect(readStorage(syncErrorsKey)).toEqual(['fixture@example.invalid']);
  });
  it('keeps plugin requests in the session storage channel', () => {
    writeStorage(configurePluginKey, 'resources');
    expect(readStorage(configurePluginKey)).toBe('resources');
    expect(readStorage(localPluginRequest)).toBeUndefined();
  });
});
