import type { Middleware } from 'openapi-fetch';


type JsonObject = Record<string, unknown>;


interface EtagConflictDetail {
  readonly current_etag?: string;
  readonly error: 'etag_mismatch' | 'etag_mismatch_force';
  readonly expected_etag?: string;
  readonly message?: string;
}


export interface PageEtagConflictEventDetail {
  readonly currentEtag?: string;
  readonly expectedEtag?: string;
  readonly message?: string;
  readonly originalRequest: Request;
  readonly pageId: string;
}


const conflictByPage = new Map<string, EtagConflictDetail>();
const etagByPage = new Map<string, string>();
const PAGE_PATH_PATTERNS = [
  /^\/api\/vault\/pages\/([^/]+)\/?$/,
  /^\/api\/v1\/vaults\/[^/]+\/knowledge\/pages\/([^/]+)\/?$/,
] as const;


function asJsonObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}


function pageIdFromUrl(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url, 'http://localhost').pathname;
  } catch {
    return null;
  }

  for (const pattern of PAGE_PATH_PATTERNS) {
    const encodedPageId = pathname.match(pattern)?.[1];
    if (!encodedPageId) continue;
    try {
      return decodeURIComponent(encodedPageId);
    } catch {
      return encodedPageId;
    }
  }
  return null;
}


function isPageMutation(request: Request): boolean {
  return request.method === 'PATCH' || request.method === 'PUT';
}


async function requestJson(request: Request): Promise<JsonObject | null> {
  if (!request.headers.get('content-type')?.toLowerCase().includes('json')) {
    return null;
  }
  try {
    return asJsonObject(await request.clone().json());
  } catch {
    return null;
  }
}


async function responseJson(response: Response): Promise<JsonObject | null> {
  try {
    return asJsonObject(await response.clone().json());
  } catch {
    return null;
  }
}


function requestWithJson(request: Request, body: JsonObject): Request {
  const headers = new Headers(request.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return new Request(request, {
    body: JSON.stringify(body),
    headers,
  });
}


function conflictResponse(detail: EtagConflictDetail): Response {
  return Response.json(
    { detail },
    { status: 409, statusText: 'Conflict' },
  );
}


function responseEtag(payload: JsonObject | null): string | null {
  const etag = payload?.etag;
  return typeof etag === 'string' && etag ? etag : null;
}


function etagConflict(payload: JsonObject | null): EtagConflictDetail | null {
  const detail = asJsonObject(payload?.detail);
  if (!detail) return null;
  const error = detail.error;
  if (error !== 'etag_mismatch' && error !== 'etag_mismatch_force') return null;
  return {
    current_etag:
      typeof detail.current_etag === 'string' ? detail.current_etag : undefined,
    error,
    expected_etag:
      typeof detail.expected_etag === 'string' ? detail.expected_etag : undefined,
    message: typeof detail.message === 'string' ? detail.message : undefined,
  };
}


function dispatchPreviewInvalidation(pageId: string): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('gnosi:invalidatePreview', { detail: { pageId } }),
  );
}


function dispatchConflict(
  pageId: string,
  detail: EtagConflictDetail,
  request: Request,
): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  const eventDetail: PageEtagConflictEventDetail = {
    currentEtag: detail.current_etag,
    expectedEtag: detail.expected_etag,
    message: detail.message,
    originalRequest: request,
    pageId,
  };
  window.dispatchEvent(new CustomEvent('pageEtagConflict', { detail: eventDetail }));
}


async function prepareMutation(request: Request, pageId: string): Promise<Request | Response> {
  const body = await requestJson(request);
  if (!body) return request;

  const pendingConflict = conflictByPage.get(pageId);
  const isExplicitResolution = Boolean(body.force) || 'expected_etag' in body;
  if (pendingConflict && !isExplicitResolution) {
    dispatchConflict(pageId, pendingConflict, request);
    return conflictResponse(pendingConflict);
  }

  const etag = etagByPage.get(pageId);
  if (!etag || isExplicitResolution) return request;
  return requestWithJson(request, { ...body, expected_etag: etag });
}


export const pageEtagMiddleware: Middleware = {
  async onRequest({ request }) {
    if (!isPageMutation(request)) return request;
    const pageId = pageIdFromUrl(request.url);
    return pageId ? prepareMutation(request, pageId) : request;
  },

  async onResponse({ request, response }) {
    const pageId = pageIdFromUrl(request.url);
    if (!pageId) return undefined;

    const payload = await responseJson(response);
    if (response.ok) {
      const etag = responseEtag(payload);
      if (etag) etagByPage.set(pageId, etag);
      conflictByPage.delete(pageId);
      if (isPageMutation(request)) dispatchPreviewInvalidation(pageId);
      return undefined;
    }

    const conflict = etagConflict(payload);
    if (!conflict || !isPageMutation(request)) return undefined;
    if (conflict.current_etag) etagByPage.set(pageId, conflict.current_etag);
    conflictByPage.set(pageId, conflict);
    dispatchConflict(pageId, conflict, request);
    return undefined;
  },
};


export function clearPageEtag(pageId: string): void {
  if (!pageId) return;
  conflictByPage.delete(pageId);
  etagByPage.delete(pageId);
}


export function getCachedPageEtag(pageId: string): string | null {
  return etagByPage.get(pageId) ?? null;
}
