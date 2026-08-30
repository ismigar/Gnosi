export interface PageEtagConflictEventDetail {
  readonly currentEtag?: string;
  readonly expectedEtag?: string;
  readonly message?: string;
  readonly originalRequest: Request;
  readonly pageId: string;
}

export type RelationEventScalar =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

export interface RelationUnlinkedEventDetail {
  readonly field: string;
  readonly metadataKey: string;
  readonly nextValue: readonly string[];
  readonly pageId: string;
  readonly previousValue: readonly string[];
  readonly relationId?: RelationEventScalar;
  readonly relationTitle?: RelationEventScalar;
}

export interface RelationValueAppliedEventDetail {
  readonly metadataKey: string;
  readonly pageId: string;
  readonly value: unknown;
}

export interface AppErrorEventDetail {
  readonly error: unknown;
  readonly message: string;
  readonly scope: string;
  readonly status?: unknown;
}

export type OpenSettingsEventDetail =
  | null
  | string
  | {
      readonly pluginId?: string;
      readonly tab: string;
    };

export interface DocumentLocationEventDetail {
  readonly [key: string]: unknown;
  readonly highlightText?: unknown;
  readonly pageNumber?: unknown;
}

export interface OpenDocumentEventDetail {
  readonly documentKey: string;
  readonly kind: 'epub' | 'pdf' | 'snapshot';
  readonly location: DocumentLocationEventDetail | null;
  readonly src: string;
  readonly title: string;
}

export interface PageDeletedEventDetail {
  readonly pageId: string;
}

export interface ModuleContextRef {
  readonly id: string;
  readonly label: string;
  readonly ref: string;
  readonly scope?: Readonly<Record<string, unknown>>;
  readonly type: string;
}


export interface AppEventMap {
  readonly 'app-error': AppErrorEventDetail;
  readonly 'db-theme-changed': null;
  readonly 'gnosi-mail-dark-body-changed': null;
  readonly 'gnosi:config-changed': null;
  readonly 'gnosi:create-notebook': { readonly resourceIds: readonly string[] };
  readonly 'gnosi:ai-correct-page': null;
  readonly 'gnosi:floating-dock-change': { readonly isOpen: boolean };
  readonly 'gnosi:floating-panel-open': { readonly panelId: string };
  readonly 'gnosi:invalidatePreview': { readonly pageId?: string };
  readonly 'gnosi:imported': unknown;
  readonly 'gnosi:module-context': readonly ModuleContextRef[];
  readonly 'gnosi:open-pdf': OpenDocumentEventDetail;
  readonly 'gnosi:open-search': null;
  readonly 'gnosi:open-settings': null;
  readonly 'gnosi:open-tags': null;
  readonly 'gnosi:open-workspaces': null;
  readonly 'gnosi:quick-open-document': null;
  readonly 'gnosi:page-deleted': PageDeletedEventDetail;
  readonly 'gnosi:present': null;
  readonly 'gnosi:toggle-comments': null;
  readonly 'gnosi-ai-models-changed': { readonly source: string };
  readonly 'gnosi:relation-unlinked': RelationUnlinkedEventDetail;
  readonly 'gnosi:relation-value-applied': RelationValueAppliedEventDetail;
  readonly 'gnosi:vault-name-changed': null;
  readonly 'gnosi:vault-changed': {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  };
  readonly 'open-settings': OpenSettingsEventDetail;
  readonly pageEtagConflict: PageEtagConflictEventDetail;
}


type EventArguments<K extends keyof AppEventMap> =
  [AppEventMap[K]] extends [null] ? [] : [detail: AppEventMap[K]];

type AppSignalName = {
  [K in keyof AppEventMap]: [AppEventMap[K]] extends [null] ? K : never;
}[keyof AppEventMap];

/** Signals have no payload and accept legacy Event as well as CustomEvent. */
export function subscribeAppSignal(name: AppSignalName, listener: () => void): () => void {
  const target = runtimeEventTarget();
  if (!target) return () => undefined;
  target.addEventListener(name, listener);
  return () => { target.removeEventListener(name, listener); };
}


function runtimeEventTarget(): Window | null {
  return typeof window === 'undefined' ? null : window;
}


export function emitAppEvent<K extends keyof AppEventMap>(
  name: K,
  ...args: EventArguments<K>
): boolean {
  const target = runtimeEventTarget();
  if (!target || typeof CustomEvent === 'undefined') return false;
  const detail = (args.length ? args[0] : null) as AppEventMap[K];
  return target.dispatchEvent(new CustomEvent<AppEventMap[K]>(name, { detail }));
}


export function emitCancelableAppEvent<K extends keyof AppEventMap>(
  name: K,
  ...args: EventArguments<K>
): boolean {
  const target = runtimeEventTarget();
  if (!target || typeof CustomEvent === 'undefined') return false;
  const detail = (args.length ? args[0] : null) as AppEventMap[K];
  return target.dispatchEvent(new CustomEvent<AppEventMap[K]>(name, {
    cancelable: true,
    detail,
  }));
}


export function subscribeAppEvent<K extends keyof AppEventMap>(
  name: K,
  listener: (detail: AppEventMap[K], event: CustomEvent<AppEventMap[K]>) => void,
): () => void {
  const target = runtimeEventTarget();
  if (!target) return () => undefined;

  const handler: EventListener = (event) => {
    if (!(event instanceof CustomEvent)) return;
    const typedEvent = event as CustomEvent<AppEventMap[K]>;
    listener(typedEvent.detail, typedEvent);
  };
  target.addEventListener(name, handler);
  return () => {
    target.removeEventListener(name, handler);
  };
}
