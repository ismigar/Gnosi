import createFetchClient from 'openapi-fetch';
import type { paths } from '../../generated/openapi';
import { transportFetch } from './transports';

/** Public link tokens are the only credential; never forward a visitor's vault or session. */
export const publicApiClient = createFetchClient<paths>({
  baseUrl: typeof location === 'undefined' ? 'http://localhost' : location.origin,
  credentials: 'omit',
  cache: 'no-store',
  referrerPolicy: 'no-referrer',
  fetch: transportFetch,
});
