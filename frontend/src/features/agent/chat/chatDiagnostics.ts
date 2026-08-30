import { notifyError } from '../../../shared/notifications/notifyError';

/** Legacy background chat failures only logged locally; do not add API writes or toasts. */
export function logChatError(scope: string, error: unknown): void {
  notifyError(scope, error, undefined, { toast: false, persist: false });
}
