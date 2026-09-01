/** Data-only contract shared by the checked preload and renderer declarations. */
export type DesktopUpdateStatus =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'manual-download'
  | 'error';

export interface DesktopUpdateState {
  readonly status: DesktopUpdateStatus;
  readonly installMode?: 'manual' | 'automatic';
  readonly percent?: number;
  readonly userInitiated?: boolean;
  readonly version?: string;
  readonly error?: string;
}

export interface BackendStatus {
  readonly running: boolean;
}

export type DesktopSubscription = () => void;
export type ApplicationMenuLabels = Readonly<Record<string, string>>;

/** Exact wire arguments, including the existing preload envelopes. */
export interface DesktopRequestMap {
  'get-app-version': { args: []; result: string };
  'get-backend-status': { args: []; result: BackendStatus };
  'get-backend-url': { args: []; result: string };
  'get-update-status': { args: []; result: DesktopUpdateState };
  'download-update': { args: []; result: DesktopUpdateState };
  'install-update': { args: []; result: DesktopUpdateState };
  'set-application-menu': {
    args: [payload?: { readonly labels?: ApplicationMenuLabels }];
    result: boolean;
  };
  'open-form-filler': {
    args: [payload: { readonly url: string; readonly profile: unknown }];
    result: void;
  };
}

export type DesktopRequestChannel = keyof DesktopRequestMap;
export type DesktopRequestArgs<K extends DesktopRequestChannel> = DesktopRequestMap[K]['args'];
export type DesktopRequestResult<K extends DesktopRequestChannel> = DesktopRequestMap[K]['result'];
export type DesktopRequestHandler<K extends DesktopRequestChannel> =
  (...args: DesktopRequestArgs<K>) => DesktopRequestResult<K> | Promise<DesktopRequestResult<K>>;
export type DesktopInvoke<K extends DesktopRequestChannel> =
  (...args: DesktopRequestArgs<K>) => Promise<DesktopRequestResult<K>>;
export type DesktopRequestHandlers = {
  readonly [K in DesktopRequestChannel]: DesktopRequestHandler<K>;
};

/** Only the native window capabilities used by the isolated form handler. */
export interface FormFillerWindow {
  readonly loadURL: (url: string) => Promise<void>;
  readonly webContents: {
    readonly getURL: () => string;
    readonly on: {
      (event: 'did-finish-load', listener: () => void): unknown;
      (
        event: 'will-navigate' | 'will-redirect',
        listener: (event: Pick<Electron.Event, 'preventDefault'>, url: string) => void,
      ): unknown;
    };
    readonly executeJavaScript: (script: string) => Promise<unknown>;
  };
}

export interface FormFillerDependencies {
  readonly createFormFillerWindow: (options: Electron.BrowserWindowConstructorOptions) => FormFillerWindow;
  readonly log: (...messages: string[]) => void;
}

/** Main owns mutable state, menu construction, backend IO and native actions. */
export interface DesktopIpcDependencies extends FormFillerDependencies {
  readonly ipcMain: Pick<Electron.IpcMain, 'handle'>;
  readonly mainWindows: ReadonlySet<Pick<Electron.BrowserWindow, 'isDestroyed' | 'webContents'>>;
  readonly isDev: boolean;
  readonly getAppVersion: () => string;
  readonly getBackendURL: () => string;
  readonly getBackendStatus: () => Promise<BackendStatus>;
  readonly getUpdateState: () => DesktopUpdateState;
  readonly publishUpdateState: (patch: Partial<DesktopUpdateState>) => void;
  readonly installApplicationMenu: (labels?: ApplicationMenuLabels) => void;
  readonly buildMacInstallerUrl: (version: string | undefined) => string;
  readonly openExternal: (url: string) => Promise<void>;
  readonly downloadUpdate: () => Promise<unknown>;
  readonly quitAndInstall: () => void;
}

export interface GnosiElectronApi {
  readonly getAppVersion: DesktopInvoke<'get-app-version'>;
  readonly getBackendStatus: DesktopInvoke<'get-backend-status'>;
  readonly getBackendURL: DesktopInvoke<'get-backend-url'>;
  readonly getUpdateStatus: DesktopInvoke<'get-update-status'>;
  readonly downloadUpdate: DesktopInvoke<'download-update'>;
  readonly installUpdate: DesktopInvoke<'install-update'>;
  readonly setApplicationMenu: (labels: ApplicationMenuLabels) => Promise<DesktopRequestResult<'set-application-menu'>>;
  readonly openFormFiller: (url: string, profile: unknown) => Promise<DesktopRequestResult<'open-form-filler'>>;
  readonly onUpdateStatus: (callback: (state: DesktopUpdateState) => void) => DesktopSubscription;
  readonly removeUpdateListener: () => void;
  readonly onOpenSettings: (callback: () => void) => DesktopSubscription;
  readonly removeOpenSettingsListener: () => void;
}

/** Older hosts and browser-only tests may provide only a subset of the bridge. */
export type CompatibleElectronApi = Partial<Omit<GnosiElectronApi,
  'getBackendURL' | 'getUpdateStatus' | 'downloadUpdate' | 'installUpdate'
  | 'onUpdateStatus' | 'onOpenSettings' | 'openFormFiller'
>> & {
  readonly getBackendURL?: () => Promise<string | null | undefined>;
  readonly getUpdateStatus?: () => Promise<DesktopUpdateState | null | undefined>;
  readonly downloadUpdate?: () => Promise<DesktopUpdateState | null | undefined>;
  readonly installUpdate?: () => Promise<DesktopUpdateState | null | undefined>;
  readonly onUpdateStatus?: (callback: (state: DesktopUpdateState) => void) => DesktopSubscription | void;
  readonly onOpenSettings?: (callback: () => void) => DesktopSubscription | void;
  readonly openFormFiller?: (url: string, profile: unknown) => unknown;
};
