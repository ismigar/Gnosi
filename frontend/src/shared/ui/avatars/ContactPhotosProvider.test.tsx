import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { fetchContacts } from '../../api/contacts';
import { contactQueryKeys } from '../../api/useContactsData';
import { ContactAvatar } from './ContactAvatar';
import { ContactPhotosProvider } from './ContactPhotosProvider';

vi.mock('../../api/contacts', () => ({ fetchContacts: vi.fn() }));
const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

beforeEach(() => {
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(fetchContacts).mockReset();
});

afterEach(() => {
  act(() => { root.unmount(); });
  client.clear();
  container.remove();
  delete reactGlobal.IS_REACT_ACT_ENVIRONMENT;
});

async function renderAvatars() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ContactPhotosProvider>
          {Array.from({ length: 20 }, (_, index) => <ContactAvatar email="ada@gmail.com" key={index} name="Ada" />)}
        </ContactPhotosProvider>
      </QueryClientProvider>,
    );
    await Promise.resolve();
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}

it('shares one query and updates every avatar after contact sync invalidation', async () => {
  vi.mocked(fetchContacts).mockResolvedValue([]);
  await renderAvatars();
  expect(fetchContacts).toHaveBeenCalledOnce();
  expect(container.querySelectorAll('img')).toHaveLength(0);
  vi.mocked(fetchContacts).mockResolvedValue([{
    id: 'ada', workspace_id: 'personal', name: 'Ada', type: 'personal',
    email: 'ada@gmail.com', emails: [], photo_url: 'https://photos.test/ada.jpg',
    source: 'google', phone: null, company: null, job_title: null, address: null,
    notes: null, google_resource_name: 'people/ada', apple_resource_id: null,
    last_synced_at: null, tags: [], phones: [], addresses: [], created_at: null, updated_at: null,
  }]);
  await act(async () => {
    await client.invalidateQueries({ queryKey: contactQueryKeys.all });
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(container.querySelectorAll('img')).toHaveLength(20);
  expect(fetchContacts).toHaveBeenCalledTimes(2);
});

it('renders mail initials while the optional address book is unavailable', async () => {
  vi.mocked(fetchContacts).mockRejectedValue(new Error('Offline'));
  await renderAvatars();
  expect(container.querySelectorAll('img')).toHaveLength(0);
  expect(container.textContent).toBe('A'.repeat(20));
});
