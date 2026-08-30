import { notifyError } from '../../../lib/notifyError';
export function reportEmbedError(message: string, error: unknown): void {
    notifyError('DbViewEmbed', error, message, { toast: false, persist: false });
}
