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


const PYDANTIC_DETAIL_INSPECTION_LIMIT = 12;
const PYDANTIC_MESSAGE_LIMIT = 3;
const PYDANTIC_MESSAGE_MAX_LENGTH = 160;


function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function boundedValidationMessage(value: unknown): string | null {
  if (!isRecord(value) || typeof value.msg !== 'string') return null;
  const message = value.msg.trim().replace(/\s+/gu, ' ');
  if (!message) return null;
  if (message.length <= PYDANTIC_MESSAGE_MAX_LENGTH) return message;
  return `${message.slice(0, PYDANTIC_MESSAGE_MAX_LENGTH - 1)}…`;
}


function pydanticValidationMessage(detail: unknown): string | null {
  if (!Array.isArray(detail)) return null;
  const messages: string[] = [];
  const inspectedItems = Math.min(
    detail.length,
    PYDANTIC_DETAIL_INSPECTION_LIMIT,
  );
  for (let index = 0; index < inspectedItems; index += 1) {
    const message = boundedValidationMessage(detail[index]);
    if (message === null) continue;
    messages.push(message);
    if (messages.length === PYDANTIC_MESSAGE_LIMIT) break;
  }
  return messages.length > 0 ? messages.join('; ') : null;
}


function apiErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = payload.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    const validationMessage = pydanticValidationMessage(detail);
    if (validationMessage !== null) return validationMessage;
    if (isRecord(detail) && 'message' in detail) {
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
