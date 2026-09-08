import { fetchPluginLlmWikiConfig } from '../../../shared/api/plugins';
import { fetchVaultTables } from '../../../shared/api/vaults';

const CONFIGURATION_TIMEOUT_MS = 45_000;

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
                }, CONFIGURATION_TIMEOUT_MS);
            }),
        ]);
    } finally {
        clearTimeout(timer);
        controller.abort();
    }
}
