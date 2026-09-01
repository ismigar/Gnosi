import { notifyError } from '../../../../shared/notifications/notifyError';
export function reportEmbedError(message: string, error: unknown): void {
    notifyError('DbViewEmbed', error, message, { toast: false, persist: false });
}
