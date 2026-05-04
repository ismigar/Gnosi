import {
    IExecuteFunctions,
    ILoadOptionsFunctions,
    INodeExecutionData,
    INodePropertyOptions,
    INodeType,
    INodeTypeDescription,
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

function resolveResourceLocator(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value && typeof value === 'object') {
        const obj = value as JsonMap;
        if (typeof obj.value === 'string') {
            return obj.value;
        }
    }
    return '';
}

function tableFromDatabase(databaseId: string): string {
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
        if (key === 'title' || key === 'id' || value === null || value === undefined) {
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
            properties[key] = {
                type: 'multi_select',
                multi_select: value.map((v) => ({ name: String(v) })),
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

function propertyValueToMetadata(property: JsonMap): [string, any] | null {
    const rawKey = String(property.key || '');
    if (!rawKey) {
        return null;
    }

    const label = rawKey.split('|')[0].trim();
    const key = label
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();

    if ('statusValue' in property) {
        return [key || 'status', property.statusValue];
    }
    if ('selectValue' in property) {
        return [key || 'idioma', property.selectValue];
    }
    if ('textContent' in property) {
        return [key || 'text', property.textContent];
    }
    if ('urlValue' in property) {
        return [key || 'url', property.urlValue];
    }
    if ('relationValue' in property) {
        const relation = Array.isArray(property.relationValue) ? property.relationValue : [];
        if (relation.length > 0) {
            return ['original_page_id', relation[0]];
        }
        return ['original_page_id', null];
    }

    return null;
}

function extractMetadataFromProperties(propertiesUi: JsonMap): JsonMap {
    const metadata: JsonMap = {};
    const values = ((propertiesUi || {}).propertyValues || []) as JsonMap[];

    for (const property of values) {
        const entry = propertyValueToMetadata(property);
        if (!entry) {
            continue;
        }
        const [key, value] = entry;
        if (value !== undefined) {
            metadata[key] = value;
        }
    }

    return metadata;
}

function extractMetadataFromFormProperties(formProperties: JsonMap): JsonMap {
    const metadata: JsonMap = {};
    const values = ((formProperties || {}).propertyValues || []) as JsonMap[];

    for (const property of values) {
        const key = String(property.key || '').trim();
        const type = String(property.type || 'text').toLowerCase();
        if (!key) {
            continue;
        }

        if (type === 'status') {
            metadata[key] = String(property.statusValue || '');
            continue;
        }

        if (type === 'select') {
            metadata[key] = String(property.selectValue || '');
            continue;
        }

        if (type === 'url') {
            metadata[key] = String(property.urlValue || '');
            continue;
        }

        if (type === 'relation') {
            metadata[key] = String(property.relationValue || '');
            continue;
        }

        if (type === 'number') {
            const parsed = Number(property.numberValue);
            if (!Number.isNaN(parsed)) {
                metadata[key] = parsed;
            }
            continue;
        }

        if (type === 'checkbox') {
            metadata[key] = !!property.checkboxValue;
            continue;
        }

        metadata[key] = String(property.textValue || '');
    }

    return metadata;
}

function markdownToNotionBlocks(markdown: string): JsonMap[] {
    const lines = String(markdown || '').split('\n');
    const blocks: JsonMap[] = [];

    for (const line of lines) {
        const text = line.trim();
        if (!text) {
            continue;
        }

        let type = 'paragraph';
        let content = text;

        if (text.startsWith('### ')) {
            type = 'heading_3';
            content = text.slice(4);
        } else if (text.startsWith('## ')) {
            type = 'heading_2';
            content = text.slice(3);
        } else if (text.startsWith('# ')) {
            type = 'heading_1';
            content = text.slice(2);
        } else if (text.startsWith('- ')) {
            type = 'bulleted_list_item';
            content = text.slice(2);
        }

        blocks.push({
            object: 'block',
            id: `gnosi_${Math.random().toString(36).slice(2, 10)}`,
            type,
            [type]: {
                rich_text: makeRichText(content),
            },
        });
    }

    return blocks;
}

export class DigitalBrainVault implements INodeType {
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

                const options = (databases || []).map((database) => ({
                    name: String(database.name || database.id || ''),
                    value: String(database.id || ''),
                    description: String(database.folder || ''),
                }));

                return sortOptions(options.filter((option) => !!option.value));
            },

            async getVaultTables(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
                const rawBaseUrl = this.getCurrentNodeParameter('baseUrl') || this.getNodeParameter('baseUrl');
                const baseUrl = String(rawBaseUrl || 'http://host.docker.internal:5002/api/vault').replace(/\/$/, '');

                const rawDatabaseId = this.getCurrentNodeParameter('databaseId') || this.getNodeParameter('databaseId');
                const databaseId = resolveResourceLocator(rawDatabaseId);
                const uri = buildTablesUri(baseUrl, databaseId);

                let tables = (await this.helpers.request({
                    method: 'GET',
                    uri,
                    json: true,
                })) as JsonMap[];

                if (databaseId && (!Array.isArray(tables) || tables.length === 0)) {
                    const allTables = (await this.helpers.request({
                        method: 'GET',
                        uri: `${baseUrl}/tables`,
                        json: true,
                    })) as JsonMap[];

                    tables = (allTables || []).filter((table) => {
                        const tableDatabaseId = String(table.database_id || table.databaseId || '');
                        return normalizeId(tableDatabaseId) === normalizeId(databaseId);
                    });
                }

                const options = (tables || []).map((table) => ({
                    name: String(table.name || table.id || ''),
                    value: String(table.id || ''),
                    description: String(table.folder || ''),
                }));

                return sortOptions(options.filter((option) => !!option.value));
            },

            async getVaultPropertyKeys(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
                const rawBaseUrl = this.getCurrentNodeParameter('baseUrl') || this.getNodeParameter('baseUrl');
                const baseUrl = String(rawBaseUrl || 'http://host.docker.internal:5002/api/vault').replace(/\/$/, '');

                const rawDatabaseId = this.getCurrentNodeParameter('databaseId') || this.getNodeParameter('databaseId');
                const databaseId = resolveResourceLocator(rawDatabaseId);

                const rawTableId = this.getCurrentNodeParameter('tableId') || this.getNodeParameter('tableId');
                const tableId = resolveResourceLocator(rawTableId);

                let tables = (await this.helpers.request({
                    method: 'GET',
                    uri: buildTablesUri(baseUrl, databaseId),
                    json: true,
                })) as JsonMap[];

                if ((!Array.isArray(tables) || tables.length === 0) && databaseId) {
                    const allTables = (await this.helpers.request({
                        method: 'GET',
                        uri: `${baseUrl}/tables`,
                        json: true,
                    })) as JsonMap[];

                    tables = (allTables || []).filter((table) => {
                        const tableDatabaseId = String(table.database_id || table.databaseId || '');
                        return normalizeId(tableDatabaseId) === normalizeId(databaseId);
                    });
                }

                if (tableId) {
                    tables = (tables || []).filter((table) => normalizeId(String(table.id || '')) === normalizeId(tableId));
                }

                const keys = new Set<string>();
                for (const table of tables || []) {
                    const props = Array.isArray(table.properties) ? table.properties : [];
                    for (const prop of props) {
                        const name = String((prop as JsonMap).name || '').trim();
                        if (name) {
                            keys.add(name);
                        }
                    }
                }

                const options = Array.from(keys).map((key) => ({
                    name: key,
                    value: key,
                }));

                return sortOptions(options);
            },
        },
    };

    description: INodeTypeDescription = {
        displayName: 'Gnosi Vault',
        name: 'gnosiVault',
        icon: 'fa:brain',
        group: ['transform'],
        version: 1,
        description: 'Interact with the Gnosi Vault API',
        defaults: {
            name: 'Gnosi Vault',
        },
        inputs: ['main'],
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
                displayName: 'Resource',
                name: 'resource',
                type: 'options',
                noDataExpression: true,
                options: [
                    {
                        name: 'Database Page',
                        value: 'databasePage',
                    },
                    {
                        name: 'Block',
                        value: 'block',
                    },
                ],
                default: 'databasePage',
            },
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                options: [
                    {
                        name: 'Create',
                        value: 'create',
                        description: 'Create a page',
                        action: 'Create',
                    },
                    {
                        name: 'Update',
                        value: 'update',
                        description: 'Update a page',
                        action: 'Update',
                    },
                    {
                        name: 'Get',
                        value: 'get',
                        description: 'Get a page by ID',
                        action: 'Get',
                    },
                    {
                        name: 'Get All',
                        value: 'getAll',
                        description: 'List and filter pages',
                        action: 'Get all',
                    },
                ],
                default: 'create',
                description: 'Operation for selected resource',
            },
            {
                displayName: 'Database ID',
                name: 'databaseId',
                type: 'options',
                typeOptions: {
                    loadOptionsMethod: 'getVaultDatabases',
                },
                displayOptions: {
                    show: {
                        resource: ['databasePage'],
                    },
                },
                options: [],
                default: '',
                description: 'Vault database id',
            },
            {
                displayName: 'Table ID',
                name: 'tableId',
                type: 'options',
                typeOptions: {
                    loadOptionsMethod: 'getVaultTables',
                    loadOptionsDependsOn: ['databaseId'],
                },
                displayOptions: {
                    show: {
                        resource: ['databasePage'],
                        operation: ['create', 'update'],
                    },
                },
                options: [],
                default: '',
                description: 'Vault table id',
            },
            {
                displayName: 'Page ID',
                name: 'pageId',
                type: 'json',
                displayOptions: {
                    show: {
                        resource: ['databasePage'],
                        operation: ['update', 'get'],
                    },
                },
                default: '{"value":""}',
                description: 'Page identifier (resource locator compatible)',
            },
            {
                displayName: 'Block ID',
                name: 'blockId',
                type: 'json',
                displayOptions: {
                    show: {
                        resource: ['block'],
                    },
                },
                default: '{"value":""}',
                description: 'Page/block id for block operations',
            },
            {
                displayName: 'Title',
                name: 'title',
                type: 'string',
                displayOptions: {
                    show: {
                        resource: ['databasePage'],
                        operation: ['create', 'update'],
                    },
                },
                default: '',
                description: 'Title used in create/update operations',
            },
            {
                displayName: 'Properties Input',
                name: 'propertiesInputMode',
                type: 'options',
                displayOptions: {
                    show: {
                        resource: ['databasePage'],
                        operation: ['create', 'update'],
                    },
                },
                options: [
                    {
                        name: 'JSON',
                        value: 'json',
                    },
                    {
                        name: 'Form',
                        value: 'form',
                    },
                ],
                default: 'json',
                description: 'Choose whether to define properties as JSON or with form fields',
            },
            {
                displayName: 'Properties UI',
                name: 'propertiesUi',
                type: 'json',
                displayOptions: {
                    show: {
                        resource: ['databasePage'],
                        operation: ['create', 'update'],
                        propertiesInputMode: ['json'],
                    },
                },
                default: '{"propertyValues":[]}',
                description: 'Notion-compatible property payload',
            },
            {
                displayName: 'Properties Form',
                name: 'formProperties',
                type: 'fixedCollection',
                displayOptions: {
                    show: {
                        resource: ['databasePage'],
                        operation: ['create', 'update'],
                        propertiesInputMode: ['form'],
                    },
                },
                typeOptions: {
                    multipleValues: true,
                },
                default: {},
                options: [
                    {
                        name: 'propertyValues',
                        displayName: 'Property',
                        values: [
                            {
                                displayName: 'Key',
                                name: 'key',
                                type: 'options',
                                typeOptions: {
                                    loadOptionsMethod: 'getVaultPropertyKeys',
                                },
                                options: [],
                                default: '',
                                description: 'Metadata property key from selected table schema',
                            },
                            {
                                displayName: 'Type',
                                name: 'type',
                                type: 'options',
                                options: [
                                    { name: 'Text', value: 'text' },
                                    { name: 'Number', value: 'number' },
                                    { name: 'Checkbox', value: 'checkbox' },
                                    { name: 'Select', value: 'select' },
                                    { name: 'Status', value: 'status' },
                                    { name: 'URL', value: 'url' },
                                    { name: 'Relation (Page ID)', value: 'relation' },
                                ],
                                default: 'text',
                            },
                            {
                                displayName: 'Text Value',
                                name: 'textValue',
                                type: 'string',
                                displayOptions: {
                                    show: {
                                        type: ['text'],
                                    },
                                },
                                default: '',
                            },
                            {
                                displayName: 'Number Value',
                                name: 'numberValue',
                                type: 'number',
                                displayOptions: {
                                    show: {
                                        type: ['number'],
                                    },
                                },
                                default: 0,
                            },
                            {
                                displayName: 'Checkbox Value',
                                name: 'checkboxValue',
                                type: 'boolean',
                                displayOptions: {
                                    show: {
                                        type: ['checkbox'],
                                    },
                                },
                                default: false,
                            },
                            {
                                displayName: 'Select Value',
                                name: 'selectValue',
                                type: 'string',
                                displayOptions: {
                                    show: {
                                        type: ['select'],
                                    },
                                },
                                default: '',
                            },
                            {
                                displayName: 'Status Value',
                                name: 'statusValue',
                                type: 'string',
                                displayOptions: {
                                    show: {
                                        type: ['status'],
                                    },
                                },
                                default: '',
                            },
                            {
                                displayName: 'URL Value',
                                name: 'urlValue',
                                type: 'string',
                                displayOptions: {
                                    show: {
                                        type: ['url'],
                                    },
                                },
                                default: '',
                            },
                            {
                                displayName: 'Relation Value',
                                name: 'relationValue',
                                type: 'string',
                                displayOptions: {
                                    show: {
                                        type: ['relation'],
                                    },
                                },
                                default: '',
                                description: 'Related page id',
                            },
                        ],
                    },
                ],
                description: 'Define properties using form fields',
            },
            {
                displayName: 'Filters',
                name: 'filters',
                type: 'json',
                displayOptions: {
                    show: {
                        resource: ['databasePage'],
                        operation: ['getAll'],
                    },
                },
                default: '{"conditions":[]}',
                description: 'Optional Notion-like filters object',
            },
            {
                displayName: 'Content',
                name: 'content',
                type: 'string',
                typeOptions: {
                    rows: 5,
                },
                displayOptions: {
                    show: {
                        resource: ['databasePage'],
                        operation: ['create', 'update'],
                    },
                },
                default: '',
                description: 'Optional markdown content',
            },
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        for (let i = 0; i < items.length; i++) {
            try {
                let responseData: JsonMap | JsonMap[] = {};
                const baseUrl = (this.getNodeParameter('baseUrl', i) as string).replace(/\/$/, '');
                const resource = this.getNodeParameter('resource', i) as string;
                const operation = this.getNodeParameter('operation', i, 'create') as string;

                if (resource === 'databasePage') {
                    const rawDatabaseId = this.getNodeParameter('databaseId', i, '') as JsonMap | string;
                    const databaseId = resolveResourceLocator(rawDatabaseId);
                    const rawTableId = this.getNodeParameter('tableId', i, '') as JsonMap | string;
                    const selectedTable = resolveResourceLocator(rawTableId);
                    const localTable = selectedTable || tableFromDatabase(databaseId);

                    if (operation === 'create') {
                        const title = this.getNodeParameter('title', i, '') as string;
                        const content = this.getNodeParameter('content', i, '') as string;
                        const propertiesInputMode = this.getNodeParameter('propertiesInputMode', i, 'json') as string;
                        const metadata =
                            propertiesInputMode === 'form'
                                ? extractMetadataFromFormProperties(
                                      this.getNodeParameter('formProperties', i, {}) as JsonMap,
                                  )
                                : extractMetadataFromProperties(
                                      this.getNodeParameter('propertiesUi', i, { propertyValues: [] }) as JsonMap,
                                  );
                        const effectiveTitle = title || String(metadata.title || 'Sense títol');

                        if (localTable) {
                            metadata.database_table_id = localTable;
                        }

                        const created = (await this.helpers.request({
                            method: 'POST',
                            uri: `${baseUrl}/pages`,
                            body: { title: effectiveTitle, content, metadata },
                            json: true,
                        })) as JsonMap;

                        responseData = pageToNotionLike(created, databaseId || localTable);
                    } else if (operation === 'update') {
                        const rawPageId = this.getNodeParameter('pageId', i, { value: '' }) as JsonMap | string;
                        const pageId = resolveResourceLocator(rawPageId);
                        const title = this.getNodeParameter('title', i, '') as string;
                        const content = this.getNodeParameter('content', i, '') as string;
                        const propertiesInputMode = this.getNodeParameter('propertiesInputMode', i, 'json') as string;
                        const metadata =
                            propertiesInputMode === 'form'
                                ? extractMetadataFromFormProperties(
                                      this.getNodeParameter('formProperties', i, {}) as JsonMap,
                                  )
                                : extractMetadataFromProperties(
                                      this.getNodeParameter('propertiesUi', i, { propertyValues: [] }) as JsonMap,
                                  );
                        if (localTable) {
                            metadata.database_table_id = localTable;
                        }

                        // Notion update nodes often set only properties; avoid wiping title/content.
                        const patchBody: JsonMap = { metadata };
                        if (title && title.trim()) {
                            patchBody.title = title;
                        }
                        if (content && content.trim()) {
                            patchBody.content = content;
                        }

                        const updated = (await this.helpers.request({
                            method: 'PATCH',
                            uri: `${baseUrl}/pages/${pageId}`,
                            body: patchBody,
                            json: true,
                        })) as JsonMap;

                        responseData = pageToNotionLike(updated, databaseId || localTable);
                    } else if (operation === 'get') {
                        const rawPageId = this.getNodeParameter('pageId', i, { value: '' }) as JsonMap | string;
                        const pageId = resolveResourceLocator(rawPageId);
                        const page = (await this.helpers.request({
                            method: 'GET',
                            uri: `${baseUrl}/pages/${pageId}`,
                            json: true,
                        })) as JsonMap;

                        responseData = pageToNotionLike(page, databaseId || localTable);
                    } else if (operation === 'getAll') {
                        const filters = this.getNodeParameter('filters', i, { conditions: [] }) as JsonMap;
                        const allPages = (await this.helpers.request({
                            method: 'GET',
                            uri: `${baseUrl}/pages`,
                            json: true,
                        })) as JsonMap[];

                        let filtered = (allPages || []).filter((page) => {
                            const md = (page.metadata || {}) as JsonMap;
                            if (!localTable) {
                                return true;
                            }
                            return md.database_table_id === localTable || md.table_id === localTable;
                        });

                        const conditions = ((filters || {}).conditions || []) as JsonMap[];
                        for (const condition of conditions) {
                            const key = String(condition.key || '');
                            const cmp = String(condition.condition || '').toLowerCase();
                            const relationValue = String(condition.relationValue || '');

                            if (key.toLowerCase().includes('original') && cmp === 'contains' && relationValue) {
                                filtered = filtered.filter((page) => {
                                    const md = (page.metadata || {}) as JsonMap;
                                    return String(md.original_page_id || '') === relationValue;
                                });
                            }
                        }

                        responseData = filtered.map((page) => pageToNotionLike(page, databaseId || localTable));
                    }
                } else if (resource === 'block' && operation === 'getAll') {
                    const rawBlockId = this.getNodeParameter('blockId', i, { value: '' }) as JsonMap | string;
                    const blockId = resolveResourceLocator(rawBlockId);
                    const page = (await this.helpers.request({
                        method: 'GET',
                        uri: `${baseUrl}/pages/${blockId}`,
                        json: true,
                    })) as JsonMap;

                    responseData = markdownToNotionBlocks(String(page.content || ''));
                }

                const executionData = this.helpers.constructExecutionMetaData(
                    this.helpers.returnJsonArray(responseData as any),
                    { itemData: { item: i } },
                );
                returnData.push(...executionData);
            } catch (error: any) {
                if (this.continueOnFail()) {
                    const executionData = this.helpers.constructExecutionMetaData(
                        this.helpers.returnJsonArray({ error: error?.message || 'Unknown error' }),
                        { itemData: { item: i } },
                    );
                    returnData.push(...executionData);
                    continue;
                }
                throw error;
            }
        }

        return [returnData];
    }
}
