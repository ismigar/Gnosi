import { transportFetch } from './transports';


export type LegacyResponseType = 'arraybuffer' | 'blob' | 'json' | 'text';

export interface LegacyUploadProgress {
  readonly loaded: number;
  readonly progress?: number;
  readonly total?: number;
}

export interface LegacyRequestConfig {
  readonly [key: string]: unknown;
  data?: unknown;
  headers?: Record<string, string>;
  method?: string;
  onUploadProgress?: (event: LegacyUploadProgress) => void;
  params?: Record<string, unknown>;
  responseType?: LegacyResponseType;
  signal?: AbortSignal;
  timeout?: number;
  url?: string;
}

export interface LegacyResponseHeaders {
  readonly [name: string]: string | ((name: string) => string | null);
  get(name: string): string | null;
}

export interface LegacyHttpResponse<TData = unknown> {
  readonly config: LegacyRequestConfig;
  readonly data: TData;
  readonly headers: LegacyResponseHeaders;
  readonly request: Response | XMLHttpRequest;
  readonly status: number;
  readonly statusText: string;
}

type Fulfilled<T> = (value: T) => Promise<T> | T;
type Rejected<T> = (reason: unknown) => Promise<T> | T;

interface Interceptor<T> {
  readonly fulfilled: Fulfilled<T>;
  readonly rejected?: Rejected<T>;
}

class InterceptorManager<T> {
  private readonly handlers = new Map<number, Interceptor<T>>();
  private nextId = 0;

  use(fulfilled: Fulfilled<T>, rejected?: Rejected<T>): number {
    const id = this.nextId;
    this.nextId += 1;
    this.handlers.set(id, { fulfilled, rejected });
    return id;
  }

  eject(id: number): void {
    this.handlers.delete(id);
  }

  entries(): readonly Interceptor<T>[] {
    return [...this.handlers.values()];
  }
}

export class LegacyHttpError<TData = unknown> extends Error {
  readonly code?: string;
  readonly config: LegacyRequestConfig;
  readonly isAxiosError = true;
  readonly response?: LegacyHttpResponse<TData>;

  constructor(
    message: string,
    config: LegacyRequestConfig,
    options: {
      readonly cause?: unknown;
      readonly code?: string;
      readonly response?: LegacyHttpResponse<TData>;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = options.code === 'ERR_CANCELED' ? 'CanceledError' : 'LegacyHttpError';
    this.code = options.code;
    this.config = config;
    this.response = options.response;
  }
}

const requestInterceptors = new InterceptorManager<LegacyRequestConfig>();
const responseInterceptors = new InterceptorManager<LegacyHttpResponse>();

export const legacyHttpDefaults: { timeout: number } = { timeout: 0 };


function normalizeHeaders(input: unknown): Record<string, string> {
  if (input instanceof Headers) return Object.fromEntries(input.entries());
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input)
      .filter((entry): entry is [string, string | number | boolean] =>
        ['boolean', 'number', 'string'].includes(typeof entry[1]),
      )
      .map(([name, value]) => [name, String(value)]),
  );
}


function responseHeaders(headers: Headers): LegacyResponseHeaders {
  const values = Object.fromEntries(headers.entries()) as LegacyResponseHeaders;
  Object.defineProperty(values, 'get', {
    enumerable: false,
    value: (name: string) => headers.get(name),
  });
  return values;
}


function queryValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (
    typeof value === 'boolean'
    || typeof value === 'bigint'
    || typeof value === 'number'
  ) {
    return String(value);
  }
  if (typeof value === 'symbol') return value.description ?? '';
  if (typeof value === 'function') return value.name;
  return JSON.stringify(value);
}


function withQuery(url: string, params: Record<string, unknown> | undefined): string {
  if (!params) return url;
  const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(url);
  const base = typeof location === 'undefined' ? 'http://localhost' : location.origin;
  const parsed = new URL(url, base);
  for (const [name, rawValue] of Object.entries(params)) {
    if (rawValue === undefined) continue;
    parsed.searchParams.delete(name);
    if (Array.isArray(rawValue)) {
      for (const item of rawValue) parsed.searchParams.append(name, queryValue(item));
    } else {
      parsed.searchParams.append(name, queryValue(rawValue));
    }
  }
  return absolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
}


function requestBody(
  method: string,
  data: unknown,
  headers: Headers,
): XMLHttpRequestBodyInit | undefined {
  if (method === 'GET' || method === 'HEAD' || data === undefined) return undefined;
  if (
    typeof data === 'string'
    || data instanceof Blob
    || data instanceof FormData
    || data instanceof URLSearchParams
    || data instanceof ArrayBuffer
  ) {
    if (data instanceof FormData) headers.delete('Content-Type');
    return data;
  }
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return JSON.stringify(data);
}


async function responseData(response: Response, type = 'json'): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  if (type === 'arraybuffer') return response.arrayBuffer();
  if (type === 'blob') return response.blob();
  if (type === 'text') return response.text();
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}


function cancellationError(config: LegacyRequestConfig, cause?: unknown): LegacyHttpError {
  return new LegacyHttpError('canceled', config, { cause, code: 'ERR_CANCELED' });
}


function timeoutMessage(timeout: number): string {
  return `timeout of ${String(timeout)}ms exceeded`;
}


function statusCodeMessage(status: number): string {
  return `Request failed with status code ${String(status)}`;
}


function timeoutSignal(
  config: LegacyRequestConfig,
): { readonly cleanup: () => void; readonly signal?: AbortSignal } {
  const timeout = config.timeout ?? legacyHttpDefaults.timeout;
  if (!config.signal && !timeout) return { cleanup: () => undefined };
  const controller = new AbortController();
  const abortFromCaller = () => {
    controller.abort(config.signal?.reason);
  };
  config.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = timeout && timeout > 0
    ? setTimeout(() => {
        controller.abort(new Error(timeoutMessage(timeout)));
      }, timeout)
    : undefined;
  return {
    cleanup: () => {
      if (timer !== undefined) clearTimeout(timer);
      config.signal?.removeEventListener('abort', abortFromCaller);
    },
    signal: controller.signal,
  };
}


async function executeFetch(config: LegacyRequestConfig): Promise<LegacyHttpResponse> {
  const method = (config.method || 'GET').toUpperCase();
  const url = withQuery(config.url || '', config.params);
  const headers = new Headers(normalizeHeaders(config.headers));
  const body = requestBody(method, config.data, headers);
  const combined = timeoutSignal(config);
  try {
    const raw = await transportFetch(url, {
      body,
      credentials: 'include',
      headers,
      method,
      signal: combined.signal,
    });
    const parsed = await responseData(raw, config.responseType);
    const response: LegacyHttpResponse = {
      config,
      data: parsed,
      headers: responseHeaders(raw.headers),
      request: raw,
      status: raw.status,
      statusText: raw.statusText,
    };
    if (!raw.ok) {
      throw new LegacyHttpError(
        statusCodeMessage(raw.status),
        config,
        { response },
      );
    }
    return response;
  } catch (error) {
    if (error instanceof LegacyHttpError) throw error;
    if (config.signal?.aborted) throw cancellationError(config, error);
    if (combined.signal?.aborted) {
      throw new LegacyHttpError(
        timeoutMessage(config.timeout ?? legacyHttpDefaults.timeout),
        config,
        { cause: error, code: 'ECONNABORTED' },
      );
    }
    throw new LegacyHttpError('Network Error', config, { cause: error, code: 'ERR_NETWORK' });
  } finally {
    combined.cleanup();
  }
}


function executeUpload(config: LegacyRequestConfig): Promise<LegacyHttpResponse> {
  return new Promise((resolve, reject) => {
    const method = (config.method || 'POST').toUpperCase();
    const xhr = new XMLHttpRequest();
    xhr.open(method, withQuery(config.url || '', config.params));
    xhr.withCredentials = true;
    const timeout = config.timeout ?? legacyHttpDefaults.timeout;
    if (timeout > 0) xhr.timeout = timeout;
    const headers = new Headers(normalizeHeaders(config.headers));
    const body = requestBody(method, config.data, headers);
    headers.forEach((value, name) => {
      xhr.setRequestHeader(name, value);
    });
    if (config.responseType === 'blob' || config.responseType === 'arraybuffer') {
      xhr.responseType = config.responseType;
    }
    xhr.upload.onprogress = (event) => {
      config.onUploadProgress?.({
        loaded: event.loaded,
        ...(event.lengthComputable
          ? { progress: event.loaded / event.total, total: event.total }
          : {}),
      });
    };
    config.signal?.addEventListener('abort', () => {
      xhr.abort();
    }, { once: true });
    xhr.onerror = () => {
      reject(new LegacyHttpError('Network Error', config, { code: 'ERR_NETWORK' }));
    };
    xhr.onabort = () => {
      reject(cancellationError(config));
    };
    xhr.ontimeout = () => {
      reject(new LegacyHttpError(timeoutMessage(timeout), config, {
        code: 'ECONNABORTED',
      }));
    };
    xhr.onload = () => {
      const headerValues = new Headers();
      for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
        const separator = line.indexOf(':');
        if (separator > 0) {
          headerValues.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
        }
      }
      let data: unknown = xhr.response;
      if (!config.responseType || config.responseType === 'json') {
        const text = xhr.responseText;
        try {
          data = text ? JSON.parse(text) as unknown : undefined;
        } catch {
          data = text;
        }
      } else if (config.responseType === 'text') {
        data = xhr.responseText;
      }
      const response: LegacyHttpResponse = {
        config,
        data,
        headers: responseHeaders(headerValues),
        request: xhr,
        status: xhr.status,
        statusText: xhr.statusText,
      };
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new LegacyHttpError(statusCodeMessage(xhr.status), config, {
          response,
        }));
        return;
      }
      resolve(response);
    };
    xhr.send(body ?? null);
  });
}


async function applyRequestInterceptors(
  initial: LegacyRequestConfig,
): Promise<LegacyRequestConfig> {
  let promise = Promise.resolve(initial);
  for (const interceptor of [...requestInterceptors.entries()].reverse()) {
    promise = promise.then(interceptor.fulfilled, interceptor.rejected);
  }
  return promise;
}


function applyResponseInterceptors(
  initial: Promise<LegacyHttpResponse>,
): Promise<LegacyHttpResponse> {
  let promise = initial;
  for (const interceptor of responseInterceptors.entries()) {
    promise = promise.then(interceptor.fulfilled, interceptor.rejected);
  }
  return promise;
}


export async function legacyRequest(
  initial: LegacyRequestConfig,
): Promise<LegacyHttpResponse> {
  const config = await applyRequestInterceptors({ ...initial });
  const operation = config.onUploadProgress ? executeUpload(config) : executeFetch(config);
  return applyResponseInterceptors(operation);
}


interface LegacyHttpClient {
  (config: LegacyRequestConfig): Promise<LegacyHttpResponse>;
  readonly defaults: typeof legacyHttpDefaults;
  delete(url: string, config?: LegacyRequestConfig): Promise<LegacyHttpResponse>;
  get(url: string, config?: LegacyRequestConfig): Promise<LegacyHttpResponse>;
  readonly interceptors: {
    readonly request: InterceptorManager<LegacyRequestConfig>;
    readonly response: InterceptorManager<LegacyHttpResponse>;
  };
  isCancel(error: unknown): boolean;
  patch(url: string, data?: unknown, config?: LegacyRequestConfig): Promise<LegacyHttpResponse>;
  post(url: string, data?: unknown, config?: LegacyRequestConfig): Promise<LegacyHttpResponse>;
  put(url: string, data?: unknown, config?: LegacyRequestConfig): Promise<LegacyHttpResponse>;
  request(config: LegacyRequestConfig): Promise<LegacyHttpResponse>;
}

const legacyHttp: LegacyHttpClient = Object.assign(
  (config: LegacyRequestConfig) => legacyRequest(config),
  {
    defaults: legacyHttpDefaults,
    delete: (url: string, config: LegacyRequestConfig = {}) =>
      legacyRequest({ ...config, method: 'DELETE', url }),
    get: (url: string, config: LegacyRequestConfig = {}) =>
      legacyRequest({ ...config, method: 'GET', url }),
    interceptors: {
      request: requestInterceptors,
      response: responseInterceptors,
    },
    isCancel: (error: unknown) =>
      error instanceof LegacyHttpError && error.code === 'ERR_CANCELED',
    patch: (url: string, data?: unknown, config: LegacyRequestConfig = {}) =>
      legacyRequest({ ...config, data, method: 'PATCH', url }),
    post: (url: string, data?: unknown, config: LegacyRequestConfig = {}) =>
      legacyRequest({ ...config, data, method: 'POST', url }),
    put: (url: string, data?: unknown, config: LegacyRequestConfig = {}) =>
      legacyRequest({ ...config, data, method: 'PUT', url }),
    request: (config: LegacyRequestConfig) => legacyRequest(config),
  },
);

export default legacyHttp;
