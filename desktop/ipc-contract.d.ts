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
export type DesktopRequestChannel =
  | 'get-app-version'
  | 'get-backend-status'
  | 'get-backend-url'
  | 'get-update-status'
  | 'download-update'
  | 'install-update'
  | 'set-application-menu'
  | 'open-form-filler';

export interface GnosiElectronApi {
  readonly getAppVersion: () => Promise<string>;
  readonly getBackendStatus: () => Promise<BackendStatus>;
  readonly getBackendURL: () => Promise<string>;
  readonly getUpdateStatus: () => Promise<DesktopUpdateState>;
  readonly downloadUpdate: () => Promise<DesktopUpdateState>;
  readonly installUpdate: () => Promise<DesktopUpdateState>;
  readonly setApplicationMenu: (labels: Readonly<Record<string, string>>) => Promise<boolean>;
  readonly openFormFiller: (url: string, profile: unknown) => Promise<void>;
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
