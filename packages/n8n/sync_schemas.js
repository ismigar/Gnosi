require('dotenv').config();
const { Client } = require('@notionhq/client');
const fs = require('fs');
const https = require('https'); // For custom Fetch if needed or just use built-in fetch

// --- CONFIGURATION ---
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DRUPAL_URL = process.env.DRUPAL_URL;
const DRUPAL_USER = process.env.DRUPAL_USER;
const DRUPAL_PASS = process.env.DRUPAL_PASS;
const OUTPUT_FILE = 'final_mapping.json';

const ENTITY_MAP = {
    'Articles': 'Article',
    'Dissenys': 'Disseny',
    'Col·laboradores': 'Col·laboradora',
    'Recursos': 'Recurs'
};

const FIELD_ALIASES = {
    'imagen': ['field_image', 'image', 'picture', 'photo'],
    'image': ['field_image', 'imagen'],
    'imatge': ['field_image', 'image'],
    'imatge destacada': ['field_image', 'image'],
    'títol': ['title'],
    'titulo': ['title'],
    'title': ['title', 'label'],
    'nom': ['title', 'name', 'field_name'],
    'name': ['title', 'name', 'field_name'],
    'descripció': ['body', 'field_description', 'description'],
    'description': ['body', 'field_description'],
    'cos': ['body', 'content'],
    'body': ['body', 'content', 'cos'],
    'etiquetes': ['field_tags', 'tags'],
    'tags': ['field_tags', 'etiquetes'],
    'data': ['field_date', 'date', 'created'],
    'date': ['field_date', 'data'],
    'llibre/revista': ['field_llibre_revista'],
    'materials': ['field_materials']
};

const TRANSLATE_TYPES = ['title', 'rich_text', 'text_with_summary', 'string', 'text_long', 'string_long'];

// --- HELPERS ---

function normalize(str) {
    if (!str) return '';
    return str.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, '');
}

async function fetchDrupalJsonApi(endpoint) {
    const authHeader = 'Basic ' + Buffer.from(`${DRUPAL_USER}:${DRUPAL_PASS}`).toString('base64');
    const url = `${DRUPAL_URL}/jsonapi${endpoint}`;

    const response = await fetch(url, {
        headers: {
            'Authorization': authHeader,
            'Accept': 'application/vnd.api+json'
        }
    });

    if (!response.ok) {
        if (response.status === 404) return { data: [] }; // Handle missing endpoints gracefully
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }

    return await response.json();
}

// --- MAIN LOGIC ---

async function main() {
    if (!NOTION_TOKEN || !DRUPAL_URL || !DRUPAL_USER || !DRUPAL_PASS) {
        console.error('Error: Missing environment variables (NOTION_TOKEN, DRUPAL_URL, DRUPAL_USER, DRUPAL_PASS).');
        process.exit(1);
    }

    console.log('--- STARTING SYNC ---');

    try {
        // 1. FETCH NOTION
        console.log('1. Fetching Notion Databases...');
        const notion = new Client({ auth: NOTION_TOKEN });
        const notionSchemas = {};

        let hasMore = true;
        let startCursor = undefined;
        let allNotionObjects = [];

        while (hasMore) {
            const response = await notion.search({
                start_cursor: startCursor,
                page_size: 100
            });
            allNotionObjects = allNotionObjects.concat(response.results);
            hasMore = response.has_more;
            startCursor = response.next_cursor;
        }

        for (const obj of allNotionObjects) {
            if (!obj.title || !Array.isArray(obj.title) || !obj.properties) continue;

            const titleObj = obj.title;
            const title = (titleObj && titleObj.length > 0) ? titleObj[0].plain_text : 'Untitled';

            // Only keep if it is in our target map
            if (ENTITY_MAP[title]) {
                console.log(`   Found Notion DB: ${title}`);
                notionSchemas[title] = {
                    id: obj.id,
                    properties: obj.properties
                };
            }
        }


        // 2. FETCH DRUPAL
        console.log('2. Fetching Drupal Content Types...');
        const drupalSchemas = {};

        // Get Types
        const typesData = await fetchDrupalJsonApi('/node_type/node_type');
        for (const type of typesData.data) {
            const typeId = type.attributes.drupal_internal__type;
            // Search by label or ID to match our ENTITY_MAP values
            // Our ENTITY_MAP values are 'Article', 'Disseny', etc. (Labels usually, or machine names?)
            // Let's store by machine name for lookup, but try to match Label.
            // Actually, user inputs in ENTITY_MAP are Drupal LABELS presumably?
            // Let's store both maps.

            const label = type.attributes.name || type.attributes.label || typeId;

            // We need to match the VALUES of ENTITY_MAP.
            // Check if this label matches any value in ENTITY_MAP
            const isTarget = Object.values(ENTITY_MAP).some(target => normalize(target) === normalize(label) || normalize(target) === normalize(typeId));

            if (isTarget) {
                console.log(`   Found Drupal Type: 【${label}】 (${typeId})`);
                drupalSchemas[typeId] = { // Key by machine name for field mapping consistency
                    label: label,
                    id: type.id,
                    properties: {}
                };
            }
        }

        // Get Fields
        console.log('   Fetching Drupal Fields...');
        let fieldsUrl = '/field_config/field_config';
        let nextLink = fieldsUrl;

        while (nextLink) {
            const endpoint = nextLink.includes(DRUPAL_URL) ? nextLink.replace(`${DRUPAL_URL}/jsonapi`, '') : nextLink;
            const fieldsData = await fetchDrupalJsonApi(endpoint);

            for (const field of fieldsData.data) {
                const bundle = field.attributes.bundle;
                if (drupalSchemas[bundle]) {
                    drupalSchemas[bundle].properties[field.attributes.field_name] = {
                        name: field.attributes.field_name,
                        label: field.attributes.label,
                        type: field.attributes.field_type
                    };
                }
            }
            nextLink = fieldsData.links?.next?.href;
        }

        // Add 'title' manually to all Drupal schemas
        for (const key in drupalSchemas) {
            drupalSchemas[key].properties['title'] = { name: 'title', label: 'Title', type: 'string' };
        }


        // 3. MAP AND CLEAN
        console.log('3. Mapping and Cleaning...');
        const finalMapping = {};

        for (const [notionDbName, drupalTarget] of Object.entries(ENTITY_MAP)) {
            if (!notionSchemas[notionDbName]) {
                console.warn(`! Warning: Notion DB '${notionDbName}' not found.`);
                continue;
            }

            // Find Drupal schema by label roughly matching target
            const drupalSchemaKey = Object.keys(drupalSchemas).find(key =>
                normalize(drupalSchemas[key].label) === normalize(drupalTarget) ||
                normalize(key) === normalize(drupalTarget)
            );

            if (!drupalSchemaKey) {
                console.warn(`! Warning: Drupal Type '${drupalTarget}' not found.`);
                continue;
            }

            const dSchema = drupalSchemas[drupalSchemaKey];
            const nSchema = notionSchemas[notionDbName];

            finalMapping[notionDbName] = {
                notion_db_id: nSchema.id,
                drupal_type: drupalSchemaKey,
                fields: {}
            };

            const dProps = Object.values(dSchema.properties);

            for (const [nPropName, nProp] of Object.entries(nSchema.properties)) {
                // Find Match
                const normNotion = normalize(nPropName);
                let matchedField = null;

                // Direct Match
                matchedField = dProps.find(p => normalize(p.label) === normNotion || normalize(p.name) === normNotion);

                // Alias Match
                if (!matchedField) {
                    for (const [alias, targets] of Object.entries(FIELD_ALIASES)) {
                        if (normalize(alias) === normNotion) {
                            for (const target of targets) {
                                matchedField = dProps.find(p => p.name === target || normalize(p.label) === normalize(target));
                                if (matchedField) break;
                            }
                        }
                        if (matchedField) break;
                    }
                }

                if (matchedField) {
                    finalMapping[notionDbName].fields[nPropName] = {
                        notion_type: nProp.type,
                        should_translate: TRANSLATE_TYPES.includes(matchedField.type) || nProp.type === 'title' || nProp.type === 'rich_text',
                        drupal_field: matchedField.name,
                        drupal_label: matchedField.label
                    };
                }
            }
        }

        // 4. SAVE
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalMapping, null, 2));
        console.log(`--- DONE ---`);
        console.log(`Saved clean mapping to: ${OUTPUT_FILE}`);

    } catch (error) {
        console.error('CRITICAL ERROR:', error);
        process.exit(1);
    }
}

main();
