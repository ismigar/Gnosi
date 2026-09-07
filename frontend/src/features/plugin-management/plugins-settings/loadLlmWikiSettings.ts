import { fetchPluginLlmWikiConfig } from '../../../shared/api/plugins';
import { fetchVaultTables } from '../../../shared/api/vaults';

/** Bound essential loading even when a shared cached request ignores cancellation. */
export async function loadLlmWikiSettings() {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            Promise.all([
                fetchVaultTables(undefined, controller.signal),
                fetchPluginLlmWikiConfig(controller.signal),
            ]),
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => {
                    reject(new Error('Configuration loading timed out'));
                    controller.abort();
                }, 15_000);
            }),
        ]);
    } finally {
        clearTimeout(timer);
        controller.abort();
    }
}
