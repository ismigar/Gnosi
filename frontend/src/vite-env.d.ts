/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

type DesktopUpdateStatus = import('../../desktop/ipc-contract').DesktopUpdateStatus;
type DesktopUpdateState = import('../../desktop/ipc-contract').DesktopUpdateState;
type GnosiElectronApi = import('../../desktop/ipc-contract').CompatibleElectronApi;

interface Window {
  __vaultViewError?: {
    readonly componentStack: string | null;
    readonly message: string;
    readonly stack: string | null;
  };
  electronAPI?: GnosiElectronApi;
}
