import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Contact } from '../../../shared/api/contacts';
import { buildContactIntegrationCatalog } from '../contactIntegrationCatalog';
import ContactList from './ContactList';


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


const contact: Contact = {
  address: null,
  addresses: [],
  apple_resource_id: null,
  company: 'Analytical Engines',
  created_at: null,
  email: 'ada@example.test',
  emails: [],
  google_resource_name: null,
  id: 'contact-1',
  job_title: null,
  last_synced_at: null,
  name: 'Ada Lovelace',
  notes: null,
  phone: null,
  phones: [],
  photo_url: null,
  source: 'local',
  tags: [],
  type: 'personal',
  updated_at: null,
  workspace_id: 'personal',
};


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


describe('ContactList', () => {
  it('preserves filtering and contact selection callbacks', () => {
    const onFilterChange = vi.fn();
    const onSelect = vi.fn();
    act(() => {
      root.render(
        <ContactList
          contacts={[contact]}
          filter={{ search: '', type: '' }}
          onFilterChange={onFilterChange}
          onSelect={onSelect}
        />,
      );
    });

    const search = container.querySelector('input');
    if (!(search instanceof HTMLInputElement)) {
      throw new Error('Contact search input was not rendered');
    }
    act(() => {
      setInputValue(search, 'Ada');
      container.querySelector<HTMLButtonElement>('button')?.click();
    });

    expect(onFilterChange).toHaveBeenCalledWith({ search: 'Ada', type: '' });
    expect(onSelect).toHaveBeenCalledWith(contact);
  });

  it('normalizes contact accounts and the cross-provider default', () => {
    expect(buildContactIntegrationCatalog({
      contacts: [{ email: 'carddav@example.test' }],
      default_contacts: 'mail@example.test',
      mail_accounts: [{ email: 'mail@example.test' }],
    })).toEqual({
      accounts: [{ email: 'carddav@example.test' }],
      defaultAccount: { email: 'mail@example.test' },
    });
  });
});
