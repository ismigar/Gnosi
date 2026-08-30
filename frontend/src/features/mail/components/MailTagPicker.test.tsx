import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MailTag, MailTagCreate } from '../../../shared/api/mail';
import MailTagPicker from './MailTagPicker';


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));


vi.mock('../../../hooks/useModalKeyboard', () => ({
  useModalKeyboard: vi.fn(),
}));


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


let container: HTMLDivElement | null = null;
let root: Root | null = null;


beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});


afterEach(() => {
  const mountedRoot = root;
  if (mountedRoot) {
    act(() => {
      mountedRoot.unmount();
    });
  }
  container?.remove();
  container = null;
  root = null;
});


function buttonWithText(text: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll('button')]
    .find((candidate) => candidate.textContent.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}


function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  );
  const boundSetter = descriptor?.set?.bind(input);
  if (!boundSetter) throw new Error('Native input setter is unavailable');
  boundSetter(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}


describe('MailTagPicker', () => {
  it('toggles, deletes, creates, and closes from an outside click', async () => {
    const tag: MailTag = {
      color: '#3b82f6',
      created_at: null,
      id: 'tag-1',
      name: 'Research',
    };
    const onClose = vi.fn<() => void>();
    const onCreateTag = vi.fn<(
      input: MailTagCreate,
    ) => Promise<unknown>>().mockResolvedValue(tag);
    const onDeleteTag = vi.fn<(id: string) => void>();
    const onToggleTag = vi.fn<(id: string) => void>();

    await act(async () => {
      root?.render(
        <MailTagPicker
          onClose={onClose}
          onCreateTag={onCreateTag}
          onDeleteTag={onDeleteTag}
          onToggleTag={onToggleTag}
          selectedTagIds={['tag-1']}
          tags={[tag]}
        />,
      );
      await Promise.resolve();
    });

    const label = [...document.body.querySelectorAll('span')]
      .find((candidate) => candidate.textContent === 'Research');
    if (!(label?.parentElement instanceof HTMLDivElement)) {
      throw new Error('Tag row was not rendered');
    }
    act(() => {
      label.parentElement?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onToggleTag).toHaveBeenCalledWith('tag-1');

    const deleteTrigger = document.body.querySelector(
      'button[title="Delete tag"]',
    );
    if (!(deleteTrigger instanceof HTMLButtonElement)) {
      throw new Error('Delete trigger was not rendered');
    }
    act(() => {
      deleteTrigger.click();
    });
    act(() => {
      buttonWithText('Delete').click();
    });
    expect(onDeleteTag).toHaveBeenCalledWith('tag-1');

    act(() => {
      buttonWithText('New tag').click();
    });
    const input = document.body.querySelector('input');
    const form = document.body.querySelector('form');
    if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) {
      throw new Error('Tag creation form was not rendered');
    }
    await act(async () => {
      setInputValue(input, 'Planning');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(onCreateTag).toHaveBeenCalledWith({
      color: '#3b82f6',
      name: 'Planning',
    });

    act(() => {
      container?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
