import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';

export type IdentityProfile = components['schemas']['IdentityReadResponse'];
type GeneratedIdentityUpdate = components['schemas']['IdentityProfile'];
export type IdentityUpdate = Partial<GeneratedIdentityUpdate>;
export type IdentitySave = components['schemas']['IdentitySaveResponse'];

const EMPTY_IDENTITY: GeneratedIdentityUpdate = {
  address: '',
  city: '',
  dni_nie: '',
  email: '',
  first_name: '',
  full_name: '',
  last_name: '',
  notes: '',
  phone: '',
  zip_code: '',
};

export async function fetchIdentity(
  signal?: AbortSignal,
): Promise<IdentityProfile> {
  return unwrapApiResult<IdentityProfile, unknown>(
    await apiClient.GET('/api/identity', { signal }),
  );
}

export async function saveIdentity(update: IdentityUpdate): Promise<IdentitySave> {
  return unwrapApiResult<IdentitySave, unknown>(
    await apiClient.POST('/api/identity', {
      body: { ...EMPTY_IDENTITY, ...update },
    }),
  );
}
