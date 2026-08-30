import { getCachedPageEtag } from '../shared/api/page-etag';
import {
  createPluginHostPage, fetchForUiPlugin, fetchPluginHostPage,
  fetchPluginSettings, patchPluginHostPage, updatePluginSettings,
  type PluginHostPagePatchInput,
} from '../shared/api/plugin-runtime';
import { fetchVaultPagesByTable, fetchVaultTables } from '../shared/api/vaults';
import { isRecord, stringValue, type HostMethod } from './host-model';

export const HOST_METHODS: Readonly<Record<string, HostMethod>> = {
    'vault.readPage': { perm: 'vault:read', run: async (args) => {
        const id = stringValue(args.pageId);
        const d = await fetchPluginHostPage(id);
        // Unified shape with the data sandbox: {pageId, title, content, metadata}.
        return { pageId: d.id, title: d.title, content: d.content, metadata: d.metadata };
    } },
    'vault.writePage': { perm: 'vault:write', run: async (args) => {
        const id = stringValue(args.pageId);
        // Partial update (PATCH preserves the frontmatter): content and/or metadata.
        const payload: PluginHostPagePatchInput = {};
        if (typeof args.content === 'string') payload.content = args.content;
        if (isRecord(args.metadata)) payload.metadata = args.metadata;
        await patchPluginHostPage(id, payload, { knownEtag: getCachedPageEtag(id) });
        return { pageId: id, written: typeof args.content === 'string' ? args.content.length : 0 };
    } },
    'vault.queryDB': { perm: 'vault:read', run: async (args) => {
        const id = stringValue(args.tableId);
        const limit = Math.max(1, Math.min(Number(args.limit) || 200, 1000));
        const response: unknown = await fetchVaultPagesByTable(id);
        const all = Array.isArray(response) ? response : [];
        // Templates (is_template) are not data: no other consumer of
        // by-table shows them as rows (DbViewEmbed, PageViewModal,
        // dashboard, sidebar). Without this filter a plugin would receive them
        // mixed in with the records — and `total`/`truncated` counted them.
        const records = all.filter((page) => (
            !isRecord(page)
            || !isRecord(page.metadata)
            || page.metadata.is_template !== true
        ));
        const rows = records.slice(0, limit).map((page) => {
            const record = isRecord(page) ? page : {};
            return {
                id: record.id,
                title: record.title,
                metadata: isRecord(record.metadata) ? record.metadata : {},
            };
        });
        return { tableId: id, rows, total: records.length, truncated: records.length > limit };
    } },
    'vault.listTables': { perm: 'vault:read', run: async () => {
        const response: unknown = await fetchVaultTables();
        const all = Array.isArray(response) ? response : [];
        return { tables: all.map((table) => {
            const record = isRecord(table) ? table : {};
            return {
                id: record.id,
                name: record.name || record.id,
                fields: Array.isArray(record.properties) ? record.properties.length : 0,
            };
        }) };
    } },
    'vault.createPage': { perm: 'vault:write', run: async (args) => {
        const response = await createPluginHostPage({
            title: typeof args.title === 'string' && args.title ? args.title : 'Sense títol',
            content: typeof args.content === 'string' ? args.content : '',
            metadata: {},
            ...(typeof args.parent_id === 'string' && args.parent_id
                ? { parent_id: args.parent_id }
                : {}),
        });
        return { pageId: response.id, title: response.title };
    } },
    'settings.get': { perm: 'settings', run: async (args, pluginId) => {
        const response = await fetchPluginSettings(pluginId);
        return { settings: response.settings };
    } },
    'settings.set': { perm: 'settings', run: async (args, pluginId) => {
        const response = await updatePluginSettings(
            pluginId,
            isRecord(args.settings) ? args.settings : {},
        );
        return { settings: response.settings };
    } },
    'network.fetch': { perm: 'network', run: async (args, pluginId) => {
        return fetchForUiPlugin(
            pluginId,
            typeof args.url === 'string' ? args.url : '',
            isRecord(args.opts) ? args.opts : {},
        );
    } },
};
