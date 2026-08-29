/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

type DesktopUpdateStatus =
  | 'idle'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'manual-download'
  | 'error';

interface DesktopUpdateState {
  readonly installMode?: string;
  readonly percent?: number;
  readonly status: DesktopUpdateStatus;
  readonly userInitiated?: boolean;
  readonly version?: string;
}

interface GnosiElectronApi {
  readonly downloadUpdate?: () => Promise<DesktopUpdateState | null | undefined>;
  readonly getBackendURL?: () => Promise<string | null | undefined>;
  readonly getUpdateStatus?: () => Promise<DesktopUpdateState | null | undefined>;
  readonly installUpdate?: () => Promise<DesktopUpdateState | null | undefined>;
  readonly onOpenSettings?: (listener: () => void) => void;
  readonly onUpdateStatus?: (listener: (update: DesktopUpdateState) => void) => void;
  readonly openFormFiller?: (url: string, profile: unknown) => unknown;
  readonly removeUpdateListener?: () => void;
  readonly setApplicationMenu?: (
    labels: Readonly<Record<string, string>>,
  ) => Promise<unknown>;
}

interface Window {
  __vaultViewError?: {
    readonly componentStack: string | null;
    readonly message: string;
    readonly stack: string | null;
  };
  electronAPI?: GnosiElectronApi;
}
