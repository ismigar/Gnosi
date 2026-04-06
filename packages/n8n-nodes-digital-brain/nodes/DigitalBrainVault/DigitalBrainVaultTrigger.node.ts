import {
    ILoadOptionsFunctions,
    INodeExecutionData,
    INodePropertyOptions,
    INodeType,
    INodeTypeDescription,
    ITriggerFunctions,
    ITriggerResponse,
} from 'n8n-workflow';

type JsonMap = Record<string, any>;

const NOTION_DB_TO_TABLE: Record<string, string> = {
    '270268e5271480ca8b47fa9f28904287': 'articles',
    '22e268e527148061bdf0cc752b016e70': 'designs',
    '8c80f2a861b843b790da4f0e260b7db9': 'resources',
    '245268e52714801ab698cfa44429c2cb': 'collaborators',
    'ebe282f0a2e145afbd76cd2036b37882': 'social_media',
};

function normalizeId(value: string): string {
    return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveLocator(raw: unknown): string {
    if (typeof raw === 'string') {
        return raw;
    }
    if (raw && typeof raw === 'object') {
        const obj = raw as JsonMap;
        if (typeof obj.value === 'string') {
            return obj.value;
        }
    }
    return '';
}

function resolveTableId(databaseId: string): string {
    const key = normalizeId(databaseId);
    return NOTION_DB_TO_TABLE[key] || databaseId;
}

function sortOptions(options: INodePropertyOptions[]): INodePropertyOptions[] {
    return options.sort((left, right) => left.name.localeCompare(right.name, 'ca'));
}

function buildTablesUri(baseUrl: string, databaseId: string): string {
    if (!databaseId) {
        return `${baseUrl}/tables`;
    }

    return `${baseUrl}/tables?database_id=${encodeURIComponent(databaseId)}`;
}

function matchesDatabaseFilter(metadata: JsonMap, databaseId: string): boolean {
    if (!databaseId) {
        return true;
    }

    const mdDatabase = String(metadata.database_id || metadata.notion_database_id || '');
    if (!mdDatabase) {
        return false;
    }

    return normalizeId(mdDatabase) === normalizeId(databaseId);
}

function matchesDatabaseSelection(metadata: JsonMap, databaseId: string, databaseTableIds: Set<string>): boolean {
    if (!databaseId) {
        return true;
    }

    if (matchesDatabaseFilter(metadata, databaseId)) {
        return true;
    }

    const mdTable = String(metadata.database_table_id || metadata.table_id || '');
    return !!mdTable && databaseTableIds.has(normalizeId(mdTable));
}

function matchesTableFilter(metadata: JsonMap, tableId: string): boolean {
    if (!tableId) {
        return true;
    }

    const mdTable = String(metadata.database_table_id || metadata.table_id || '');
    if (!mdTable) {
        return false;
    }

    return normalizeId(mdTable) === normalizeId(tableId);
}

function isDerivedPage(metadata: JsonMap): boolean {
    if (!metadata || typeof metadata !== 'object') {
        return false;
    }

    const originalPageId = String(metadata.original_page_id || '').trim();
    if (originalPageId) {
        return true;
    }

    const originalIds = metadata.original_ids;
    if (Array.isArray(originalIds) && originalIds.length > 0) {
        return true;
    }

    const translationIds = metadata.translation_ids;
    if (Array.isArray(translationIds) && translationIds.length > 0) {
        return true;
    }

    return false;
}

function resolvePollMs(rawPollTimes: unknown, rawPollInterval: unknown): number {
    const direct = Number(rawPollInterval || 0);
    if (direct > 0) {
        return Math.max(5000, direct * 1000);
    }

    const pollTimes = (rawPollTimes || {}) as JsonMap;
    const first = Array.isArray(pollTimes.item) && pollTimes.item.length > 0 ? pollTimes.item[0] : {};
    const mode = String((first as JsonMap).mode || '').toLowerCase();

    if (mode === 'everyminute') {
        return 60_000;
    }
    if (mode === 'everyhour') {
        return 3_600_000;
    }
    if (mode === 'custom' && Number((first as JsonMap).value) > 0) {
        return Math.max(5000, Number((first as JsonMap).value) * 1000);
    }

    return 30_000;
}

function shouldEmitForEvent(eventName: string, isNew: boolean, isChanged: boolean): boolean {
    const e = String(eventName || '').toLowerCase();

    // Notion trigger legacy values include pagedUpdatedInDatabase / pageAddedInDatabase.
    if (e.includes('added')) {
        return isNew;
    }
    if (e.includes('updated')) {
        // Updated must only emit true edits on existing records.
        return isChanged;
    }

    // Default compatibility mode: emit on inserts and updates.
    return isNew || isChanged;
}

function makeRichText(text: string): Array<Record<string, any>> {
    return [
        {
            type: 'text',
            plain_text: text,
            text: { content: text },
            annotations: {
                bold: false,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
                color: 'default',
            },
            href: null as null,
        },
    ];
}

function metadataToNotionProperties(metadata: JsonMap, title: string): JsonMap {
    const properties: JsonMap = {
        Titol: {
            id: 'title',
            type: 'title',
            title: makeRichText(title || ''),
        },
    };

    for (const [key, value] of Object.entries(metadata || {})) {
        if (key === 'title' || key === 'id') {
            continue;
        }

        if (value === null || value === undefined) {
            continue;
        }

        if (key === 'estat' || key === 'status') {
            properties[key] = {
                type: 'status',
                status: value ? { name: String(value) } : null,
            };
            continue;
        }

        if (key === 'idioma' || key === 'language') {
            properties[key] = {
                type: 'select',
                select: value ? { name: String(value) } : null,
            };
            continue;
        }

        if (key === 'original_page_id' && typeof value === 'string' && value) {
            properties['Original'] = {
                type: 'relation',
                relation: [{ id: value }],
            };
            continue;
        }

        if (Array.isArray(value)) {
            const asStrings = value.map((v) => String(v));
            properties[key] = {
                type: 'multi_select',
                multi_select: asStrings.map((name) => ({ name })),
            };
            continue;
        }

        if (typeof value === 'boolean') {
            properties[key] = {
                type: 'checkbox',
                checkbox: value,
            };
            continue;
        }

        if (typeof value === 'number') {
            properties[key] = {
                type: 'number',
                number: value,
            };
            continue;
        }

        if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
            properties[key] = {
                type: 'url',
                url: value,
            };
            continue;
        }

        properties[key] = {
            type: 'rich_text',
            rich_text: makeRichText(String(value)),
        };
    }

    return properties;
}

function pageToNotionLike(page: JsonMap, databaseId: string): JsonMap {
    const metadata = (page.metadata || {}) as JsonMap;
    const title = page.title || metadata.title || '';
    return {
        object: 'page',
        id: page.id,
        parent: {
            type: 'database_id',
            database_id: databaseId,
        },
        properties: metadataToNotionProperties(metadata, title),
        last_edited_time: page.last_modified || null,
        created_time: metadata.created_at || null,
        gnosi: {
            metadata,
            content: page.content || '',
        },
    };
}

export class DigitalBrainVaultTrigger implements INodeType {
    methods = {
        loadOptions: {
            async getVaultDatabases(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
                const rawBaseUrl = this.getCurrentNodeParameter('baseUrl') || this.getNodeParameter('baseUrl');
                const baseUrl = String(rawBaseUrl || 'http://host.docker.internal:5002/api/vault').replace(/\/$/, '');
                const databases = (await this.helpers.request({
                    method: 'GET',
                    uri: `${baseUrl}/databases`,
                    json: true,
                })) as JsonMap[];

                return sortOptions(
                    (databases || [])
                        .map((database) => ({
                            name: String(database.name || database.id || 'Unnamed database'),
                            value: String(database.id || ''),
                            description: database.folder ? String(database.folder) : undefined,
                        }))
                        .filter((option) => !!option.value),
                );
            },

            async getVaultTables(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
                const rawBaseUrl = this.getCurrentNodeParameter('baseUrl') || this.getNodeParameter('baseUrl');
                const rawDatabaseId = this.getCurrentNodeParameter('databaseId') || this.getNodeParameter('databaseId');
                const baseUrl = String(rawBaseUrl || 'http://host.docker.internal:5002/api/vault').replace(/\/$/, '');
                const databaseId = resolveLocator(rawDatabaseId);
                const tables = (await this.helpers.request({
                    method: 'GET',
                    uri: buildTablesUri(baseUrl, databaseId),
                    json: true,
                })) as JsonMap[];

                return sortOptions(
                    (tables || [])
                        .map((table) => ({
                            name: String(table.name || table.id || 'Unnamed table'),
                            value: String(table.id || ''),
                            description: table.folder ? String(table.folder) : undefined,
                        }))
                        .filter((option) => !!option.value),
                );
            },
        },
    };

    description: INodeTypeDescription = {
        displayName: 'Gnosi Vault Trigger',
        name: 'gnosiVaultTrigger',
        icon: 'fa:bolt',
        group: ['trigger'],
        version: 1,
        description: 'Poll Gnosi Vault and emit Notion-like page events',
        defaults: {
            name: 'Gnosi Vault Trigger',
        },
        inputs: [],
        outputs: ['main'],
        properties: [
            {
                displayName: 'Base URL',
                name: 'baseUrl',
                type: 'string',
                default: 'http://host.docker.internal:5002/api/vault',
                description: 'Gnosi Vault API base URL',
            },
            {
                displayName: 'Database',
                name: 'databaseId',
                type: 'options',
                typeOptions: {
                    loadOptionsMethod: 'getVaultDatabases',
                },
                options: [],
                default: '',
                description: 'Database of the Vault registry to watch',
            },
            {
                displayName: 'Table',
                name: 'tableId',
                type: 'options',
                typeOptions: {
                    loadOptionsMethod: 'getVaultTables',
                    loadOptionsDependsOn: ['databaseId'],
                },
                options: [],
                default: '',
                description: 'Table to watch inside the selected database',
            },
            {
                displayName: 'Event',
                name: 'event',
                type: 'options',
                options: [
                    { name: 'Page Added', value: 'pageAdded' },
                    { name: 'Page Updated', value: 'pageUpdated' },
                    // Legacy Notion trigger values kept for migration compatibility.
                    { name: 'Page Added (Legacy)', value: 'pageAddedInDatabase' },
                    { name: 'Page Updated (Legacy)', value: 'pageUpdatedInDatabase' },
                    { name: 'Paged Updated (Legacy)', value: 'pagedUpdatedInDatabase' },
                ],
                default: 'pageUpdated',
            },
            {
                displayName: 'Poll Interval (Seconds)',
                name: 'pollInterval',
                type: 'number',
                typeOptions: {
                    minValue: 5,
                },
                default: 30,
            },
            {
                displayName: 'Simple',
                name: 'simple',
                type: 'boolean',
                default: false,
            },
            {
                displayName: 'Ignore Derived Pages',
                name: 'ignoreDerivedPages',
                type: 'boolean',
                default: false,
                description: 'Do not emit pages that reference an original page or translation ids',
            },
            {
                displayName: 'Require Gnosi ID',
                name: 'requireGnosiId',
                type: 'boolean',
                default: false,
                description: 'Emit only pages where metadata.id is present',
            },
        ],
    };

    async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
        const staticData = this.getWorkflowStaticData('node') as JsonMap;
        const baseUrl = (this.getNodeParameter('baseUrl') as string).replace(/\/$/, '');
        const rawDb = this.getNodeParameter('databaseId', '') as JsonMap | string;
        const rawTable = this.getNodeParameter('tableId', '') as JsonMap | string;
        const eventName = this.getNodeParameter('event', 'pageUpdated') as string;
        const rawPollTimes = this.getNodeParameter('pollTimes', { item: [{ mode: 'everyMinute' }] }) as JsonMap;
        const rawPollInterval = this.getNodeParameter('pollInterval', 30) as number;
        const ignoreDerivedPages = this.getNodeParameter('ignoreDerivedPages', false) as boolean;
        const requireGnosiId = this.getNodeParameter('requireGnosiId', false) as boolean;
        const notionDatabaseId = resolveLocator(rawDb);
        const explicitTableId = resolveLocator(rawTable);
        const localTable = explicitTableId || resolveTableId(notionDatabaseId);
        const pollInterval = resolvePollMs(rawPollTimes, rawPollInterval);

        const filterKey = normalizeId(`${notionDatabaseId}|${localTable}`) || 'default';
        const stateKey = `seen_${filterKey}`;
        const initKey = `init_${filterKey}`;
        const stampKey = `stamp_${filterKey}`;
        const seen = new Set<string>((staticData[stateKey] || []) as string[]);
        const seenStamps = ((staticData[stampKey] || {}) as JsonMap) || {};

        const doPoll = async () => {
            const tables = (await this.helpers.request({
                method: 'GET',
                uri: buildTablesUri(baseUrl, notionDatabaseId),
                json: true,
            })) as JsonMap[];
            const databaseTableIds = new Set(
                (tables || []).map((table) => normalizeId(String(table.id || ''))).filter(Boolean),
            );

            const pages = (await this.helpers.request({
                method: 'GET',
                uri: `${baseUrl}/pages`,
                json: true,
            })) as JsonMap[];

            const filtered = (pages || []).filter((page) => {
                const md = (page.metadata || {}) as JsonMap;
                if (!matchesDatabaseSelection(md, notionDatabaseId, databaseTableIds) || !matchesTableFilter(md, localTable)) {
                    return false;
                }

                if (ignoreDerivedPages && isDerivedPage(md)) {
                    return false;
                }

                if (requireGnosiId && !String(md.id || '').trim()) {
                    return false;
                }

                return true;
            });

            if (!staticData[initKey]) {
                for (const page of filtered) {
                    if (page.id) {
                        const pageId = String(page.id);
                        seen.add(pageId);
                        const stamp = String(page.last_modified || ((page.metadata || {}) as JsonMap).updated_at || '');
                        seenStamps[pageId] = stamp;
                    }
                }
                staticData[initKey] = true;
                staticData[stateKey] = Array.from(seen).slice(-5000);
                staticData[stampKey] = seenStamps;
                return;
            }

            for (const page of filtered) {
                const pageId = String(page.id || '');
                if (!pageId) {
                    continue;
                }

                const currentStamp = String(page.last_modified || ((page.metadata || {}) as JsonMap).updated_at || '');
                const isNew = !seen.has(pageId);
                const isChanged = !isNew && String(seenStamps[pageId] || '') !== currentStamp;

                if (!shouldEmitForEvent(eventName, isNew, isChanged)) {
                    continue;
                }

                seen.add(pageId);
                seenStamps[pageId] = currentStamp;
                const payload = pageToNotionLike(page, notionDatabaseId || localTable);
                const rows: INodeExecutionData[] = this.helpers.returnJsonArray(payload);
                this.emit([rows]);
            }

            staticData[stateKey] = Array.from(seen).slice(-5000);
            staticData[stampKey] = seenStamps;
        };

        await doPoll();
        const interval = setInterval(() => {
            doPoll().catch(() => {
                // Trigger polling must keep running even if one cycle fails.
            });
        }, pollInterval);

        return {
            closeFunction: async () => {
                clearInterval(interval);
            },
        };
    }
}
