export class GnosiApiError extends Error {
  readonly payload: unknown;
  readonly response: Response;
  readonly status: number;

  constructor(response: Response, payload: unknown) {
    super(apiErrorMessage(payload, response.statusText));
    this.name = 'GnosiApiError';
    this.payload = payload;
    this.response = response;
    this.status = response.status;
  }
}


export function apiErrorDetail(error: unknown, fallback: string): string {
  return error instanceof GnosiApiError ? error.message : fallback;
}


function apiErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = payload.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (detail && typeof detail === 'object' && 'message' in detail) {
      const message = detail.message;
      if (typeof message === 'string' && message.trim()) return message;
    }
  }
  return fallback || 'API request failed';
}


export interface ApiResult<TData, TError = unknown> {
  readonly data?: TData;
  readonly error?: TError;
  readonly response: Response;
}


export function unwrapApiResult<TData, TError>(
  result: ApiResult<TData, TError>,
): TData {
  if (!result.response.ok || result.error !== undefined) {
    throw new GnosiApiError(result.response, result.error);
  }
  if (result.data === undefined) {
    throw new GnosiApiError(result.response, 'The API returned no response body');
  }
  return result.data;
}


export function assertApiSuccess<TError>(result: ApiResult<unknown, TError>): void {
  if (!result.response.ok || result.error !== undefined) {
    throw new GnosiApiError(result.response, result.error);
  }
}
