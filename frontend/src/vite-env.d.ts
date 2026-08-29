/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface GnosiElectronApi {
  readonly downloadUpdate?: () => Promise<unknown>;
  readonly getBackendURL?: () => Promise<string | null | undefined>;
  readonly installUpdate?: () => Promise<unknown>;
  readonly onOpenSettings?: (listener: () => void) => void;
  readonly openFormFiller?: (url: string, profile: unknown) => unknown;
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
