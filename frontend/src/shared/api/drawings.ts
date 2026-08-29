import { apiClient } from './client';
import { GnosiApiError, unwrapApiResult } from './errors';
import { transportFetch } from './transports';


export interface DrawingSummary {
  readonly id: string;
  readonly last_modified: string;
  readonly size: number;
  readonly title: string;
  readonly [key: string]: unknown;
}


export type DrawingDocument = Record<string, unknown>;


export interface DrawingSaveInput {
  readonly data: DrawingDocument;
  readonly metadata?: Record<string, unknown>;
  readonly title: string;
}


export interface DrawingSaveResponse {
  readonly id: string;
  readonly status: string;
}


export interface DrawingDeleteResponse {
  readonly deleted_at: string | null;
  readonly id: string;
  readonly status: string;
  readonly title: string;
  readonly [key: string]: unknown;
}


export interface HandwritingWarmupResponse {
  readonly loaded: boolean;
  readonly warming: boolean;
}


export interface HandwritingRecognitionResponse {
  readonly corrected: boolean;
  readonly lines: string[];
  readonly model: string;
  readonly raw: string;
  readonly text: string;
}


export interface HandwritingRecognitionOptions {
  readonly correct?: boolean;
  readonly language?: string;
  readonly signal?: AbortSignal;
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}


function isDrawingSummary(value: unknown): value is DrawingSummary {
  return (
    isRecord(value)
    && typeof value.id === 'string'
    && typeof value.last_modified === 'string'
    && typeof value.size === 'number'
    && typeof value.title === 'string'
  );
}


function isDrawingSaveResponse(value: unknown): value is DrawingSaveResponse {
  return (
    isRecord(value)
    && typeof value.id === 'string'
    && typeof value.status === 'string'
  );
}


function isDrawingDeleteResponse(
  value: unknown,
): value is DrawingDeleteResponse {
  return (
    isRecord(value)
    && typeof value.id === 'string'
    && typeof value.status === 'string'
    && (value.deleted_at === null || typeof value.deleted_at === 'string')
    && typeof value.title === 'string'
  );
}


function isHandwritingWarmupResponse(
  value: unknown,
): value is HandwritingWarmupResponse {
  return (
    isRecord(value)
    && typeof value.loaded === 'boolean'
    && typeof value.warming === 'boolean'
  );
}


function isHandwritingRecognitionResponse(
  value: unknown,
): value is HandwritingRecognitionResponse {
  return (
    isRecord(value)
    && typeof value.corrected === 'boolean'
    && Array.isArray(value.lines)
    && value.lines.every((line) => typeof line === 'string')
    && typeof value.model === 'string'
    && typeof value.raw === 'string'
    && typeof value.text === 'string'
  );
}


function invalidResponse(response: Response, message: string): never {
  throw new GnosiApiError(response, message);
}


export async function listDrawings(
  signal?: AbortSignal,
): Promise<DrawingSummary[]> {
  const result = await apiClient.GET('/api/vault/drawings', { signal });
  const payload = unwrapApiResult<unknown, unknown>(result);
  if (!Array.isArray(payload) || !payload.every(isDrawingSummary)) {
    return invalidResponse(result.response, 'The API returned an invalid drawing list');
  }
  return payload;
}


export async function fetchDrawing(
  drawingId: string,
  signal?: AbortSignal,
): Promise<DrawingDocument> {
  const result = await apiClient.GET('/api/vault/drawings/{drawing_id}', {
    params: { path: { drawing_id: drawingId } },
    signal,
  });
  const payload = unwrapApiResult<unknown, unknown>(result);
  if (!isRecord(payload)) {
    return invalidResponse(result.response, 'The API returned an invalid drawing');
  }
  return payload;
}


export async function saveDrawing(
  drawingId: string,
  input: DrawingSaveInput,
  signal?: AbortSignal,
): Promise<DrawingSaveResponse> {
  const result = await apiClient.PUT('/api/vault/drawings/{drawing_id}', {
    body: {
      data: input.data,
      metadata: input.metadata ?? {},
      title: input.title,
    },
    params: { path: { drawing_id: drawingId } },
    signal,
  });
  const payload = unwrapApiResult<unknown, unknown>(result);
  if (!isDrawingSaveResponse(payload)) {
    return invalidResponse(result.response, 'The API returned an invalid drawing save');
  }
  return payload;
}


export async function deleteDrawing(
  drawingId: string,
  signal?: AbortSignal,
): Promise<DrawingDeleteResponse> {
  const result = await apiClient.DELETE('/api/vault/drawings/{drawing_id}', {
    params: { path: { drawing_id: drawingId } },
    signal,
  });
  const payload = unwrapApiResult<unknown, unknown>(result);
  if (!isDrawingDeleteResponse(payload)) {
    return invalidResponse(result.response, 'The API returned an invalid drawing deletion');
  }
  return payload;
}


export async function warmupHandwriting(
  signal?: AbortSignal,
): Promise<HandwritingWarmupResponse> {
  const result = await apiClient.POST('/api/vault/handwriting/warmup', { signal });
  const payload = unwrapApiResult<unknown, unknown>(result);
  if (!isHandwritingWarmupResponse(payload)) {
    return invalidResponse(
      result.response,
      'The API returned an invalid handwriting warmup',
    );
  }
  return payload;
}


export async function recognizeHandwriting(
  image: Blob,
  options: HandwritingRecognitionOptions = {},
): Promise<HandwritingRecognitionResponse> {
  const body = new FormData();
  body.set('image', image, 'ink.png');
  if (options.correct !== undefined) {
    body.set('correct', String(options.correct));
  }
  if (options.language) body.set('language', options.language);

  const response = await transportFetch('/api/vault/handwriting/recognize', {
    body,
    method: 'POST',
    signal: options.signal,
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new GnosiApiError(response, payload);
  if (!isHandwritingRecognitionResponse(payload)) {
    return invalidResponse(
      response,
      'The API returned an invalid handwriting recognition',
    );
  }
  return payload;
}
