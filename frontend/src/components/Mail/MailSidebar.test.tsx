import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MailSidebar from './MailSidebar';


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));


vi.mock('../../hooks/useMailTags', () => ({
  useMailTags: () => ({
    tags: [{
      color: '#3b82f6',
      created_at: null,
      id: 'tag-1',
      name: 'Research',
    }],
  }),
}));


vi.mock('../../hooks/useMailViews', () => ({
  useMailViews: () => ({
    createView: vi.fn(),
    deleteView: vi.fn(),
    updateView: vi.fn(),
    views: [],
  }),
}));


vi.mock('./MailViewEditor', () => ({ default: () => null }));


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


let container: HTMLDivElement;
let root: Root;


beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});


afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});


function buttonWithText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
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


describe('MailSidebar', () => {
  it('preserves account, folder, search, compose, and tag callbacks', () => {
    const onCompose = vi.fn<() => void>();
    const onSearch = vi.fn<(value: string) => void>();
    const onSelectAccount = vi.fn();
    const onSelectFolder = vi.fn<(folder: string) => void>();
    const onSelectTag = vi.fn<(tagId: string | null) => void>();

    act(() => {
      root.render(
        <MailSidebar
          accounts={[
            { email: 'one@example.test' },
            { email: 'two@example.test' },
          ]}
          activeCategory={null}
          activeFolder="INBOX"
          activeTagId={null}
          counts={{ INBOX: { unread: 4 } }}
          onCompose={onCompose}
          onSearch={onSearch}
          onSelectAccount={onSelectAccount}
          onSelectCategory={vi.fn()}
          onSelectFolder={onSelectFolder}
          onSelectTag={onSelectTag}
          selectedAccount={{ email: 'one@example.test' }}
        />,
      );
    });

    expect(container.textContent).toContain('4');
    act(() => {
      buttonWithText('one@example.test').click();
    });
    act(() => {
      buttonWithText('two@example.test').click();
      buttonWithText('mail.inbox').click();
      buttonWithText('Research').click();
      container.querySelector<HTMLButtonElement>('button[title="Compose"]')?.click();
    });
    expect(onSelectAccount).toHaveBeenCalledWith({ email: 'two@example.test' });
    expect(onSelectFolder).toHaveBeenCalledWith('INBOX');
    expect(onSelectTag).toHaveBeenCalledWith('tag-1');
    expect(onCompose).toHaveBeenCalledOnce();

    const search = container.querySelector('input[placeholder="mail.search"]');
    if (!(search instanceof HTMLInputElement)) {
      throw new Error('Mail search input was not rendered');
    }
    act(() => {
      setInputValue(search, 'agenda');
    });
    expect(onSearch).toHaveBeenCalledWith('agenda');
  });
});
