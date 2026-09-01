import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';

export type Contact = components['schemas']['ContactResponse'];
export type ContactWriteInput = components['schemas']['ContactWriteRequest'];
export type ContactDelete = components['schemas']['ContactDeleteResponse'];
export type ContactSyncInput = components['schemas']['ContactSyncRequest'];
export type ContactSync = components['schemas']['ContactSyncResponse'];
export type ContactSyncStatus =
  components['schemas']['ContactSyncStatusResponse'];

export interface ContactQuery {
  readonly search?: string;
  readonly source?: string;
  readonly type?: string;
}

export async function fetchContacts(
  query: ContactQuery = {},
  signal?: AbortSignal,
): Promise<Contact[]> {
  return unwrapApiResult<Contact[], unknown>(
    await apiClient.GET('/api/contacts', {
      params: {
        query: {
          search: query.search,
          source: query.source,
          type: query.type,
        },
      },
      signal,
    }),
  );
}

export async function fetchContact(
  contactId: string,
  signal?: AbortSignal,
): Promise<Contact> {
  return unwrapApiResult<Contact, unknown>(
    await apiClient.GET('/api/contacts/{contact_id}', {
      params: { path: { contact_id: contactId } },
      signal,
    }),
  );
}

export async function createContact(input: ContactWriteInput): Promise<Contact> {
  return unwrapApiResult<Contact, unknown>(
    await apiClient.POST('/api/contacts', { body: input }),
  );
}

export async function updateContact(
  contactId: string,
  input: ContactWriteInput,
): Promise<Contact> {
  return unwrapApiResult<Contact, unknown>(
    await apiClient.PUT('/api/contacts/{contact_id}', {
      body: input,
      params: { path: { contact_id: contactId } },
    }),
  );
}

export async function deleteContact(contactId: string): Promise<ContactDelete> {
  return unwrapApiResult<ContactDelete, unknown>(
    await apiClient.DELETE('/api/contacts/{contact_id}', {
      params: { path: { contact_id: contactId } },
    }),
  );
}

export async function syncContacts(
  input: ContactSyncInput | null = null,
): Promise<ContactSync> {
  return unwrapApiResult<ContactSync, unknown>(
    await apiClient.POST('/api/contacts/sync', { body: input }),
  );
}

export async function fetchContactSyncStatus(
  signal?: AbortSignal,
): Promise<ContactSyncStatus> {
  return unwrapApiResult<ContactSyncStatus, unknown>(
    await apiClient.GET('/api/contacts/sync/status', { signal }),
  );
}
