import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchMailRecipientSuggestions } from '../../../shared/api/mail';
import {
  AddressInput,
  type AddressInputProps,
} from './MailAddressInput';


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: string,
      values: Readonly<Record<string, string>> = {},
    ) => Object.entries(values).reduce(
      (text, [name, value]) => text.replace(`{{${name}}}`, value),
      fallback ?? key,
    ),
  }),
}));


vi.mock('../../../shared/api/mail', () => ({
  fetchMailRecipientSuggestions: vi.fn(),
}));


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


let container: HTMLDivElement | null = null;
let root: Root | null = null;


beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
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
  vi.useRealTimers();
});


async function renderInput(
  props: Partial<AddressInputProps> = {},
): Promise<HTMLInputElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <AddressInput
        accountEmail="owner@example.test"
        label="To"
        onChange={vi.fn()}
        placeholder="Recipients"
        value=""
        {...props}
      />,
    );
    await Promise.resolve();
  });
  const input = container.querySelector('input');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('Address input was not rendered');
  }
  return input;
}


async function typeAndDebounce(
  input: HTMLInputElement,
  value: string,
): Promise<void> {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    );
    const boundSetter = descriptor?.set?.bind(input);
    if (!boundSetter) throw new Error('Native input setter is unavailable');
    boundSetter(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => {
    vi.advanceTimersByTime(280);
    await Promise.resolve();
  });
}


describe('AddressInput', () => {
  it('normalizes separators and loads suggestions after the debounce', async () => {
    const onChange = vi.fn<(value: string) => void>();
    vi.mocked(fetchMailRecipientSuggestions).mockResolvedValue({
      group_suggestions: [{
        email: 'grace@example.test',
        freq: 1,
        name: 'Grace',
        source: 'mail',
      }],
      suggestions: [{
        email: 'bob@example.test',
        freq: 3,
        name: 'Bob',
        source: 'mail',
      }],
    });
    const input = await renderInput({ onChange });

    await typeAndDebounce(input, 'ada@example.test; bo');

    expect(onChange).toHaveBeenCalledWith('ada@example.test, bo');
    expect(fetchMailRecipientSuggestions).toHaveBeenCalledWith(
      'bo',
      'owner@example.test',
    );
    expect(container?.textContent).toContain('Bob');
    expect(container?.textContent).toContain('Grace');
    expect(container?.textContent).toContain('Usual group');
  });

  it('keeps failures silent and omits an empty account selector', async () => {
    vi.mocked(fetchMailRecipientSuggestions).mockRejectedValue(
      new Error('offline'),
    );
    const input = await renderInput({ accountEmail: '' });

    await typeAndDebounce(input, 'ad');

    expect(fetchMailRecipientSuggestions).toHaveBeenCalledWith('ad', undefined);
    expect(container?.querySelector('[class*="z-modal-dropdown"]')).toBeNull();
  });
});
