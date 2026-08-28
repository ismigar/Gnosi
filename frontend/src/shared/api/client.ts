import createFetchClient from 'openapi-fetch';
import createReactQueryClient from 'openapi-react-query';

import type { paths } from '../../generated/openapi';
import { requestContextMiddleware } from './request-context';
import { transportFetch } from './transports';


export const apiClient = createFetchClient<paths>({
  baseUrl: typeof location === 'undefined' ? 'http://localhost' : location.origin,
  credentials: 'include',
  fetch: transportFetch,
});

apiClient.use(requestContextMiddleware);

export const $api = createReactQueryClient(apiClient);
