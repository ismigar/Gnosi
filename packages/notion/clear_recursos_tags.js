
import https from 'https';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = "8c80f2a8-61b8-43b7-90da-4f0e260b7db9";

function callNotion(path, method, body) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.notion.com',
            port: 443,
            path: `/v1${path}`,
            method: method,
            headers: {
                'Authorization': `Bearer ${NOTION_TOKEN}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let resBody = '';
            res.on('data', (chunk) => resBody += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(resBody));
                    } catch (e) {
                        resolve({}); // In case of empty body
                    }
                } else {
                    reject(new Error(`Status ${res.statusCode}: ${resBody}`));
                }
            });
        });

        req.on('error', (e) => reject(e));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function clearTags() {
    console.log("Fetching pages with tags in Recursos DB...");

    let hasMore = true;
    let cursor = undefined;
    let pagesToUpdate = [];

    while (hasMore) {
        try {
            const body = {
                filter: {
                    property: "Tags",
                    multi_select: {
                        is_not_empty: true,
                    },
                },
                start_cursor: cursor
            };

            const response = await callNotion(`/databases/${DATABASE_ID}/query`, 'POST', body);

            pagesToUpdate = pagesToUpdate.concat(response.results);
            hasMore = response.has_more;
            cursor = response.next_cursor;
        } catch (e) {
            console.error("Error fetching pages:", e.message);
            break;
        }
    }

    console.log(`Found ${pagesToUpdate.length} pages with tags.`);

    for (const page of pagesToUpdate) {
        let title = "Untitled";
        // 'Recursos' usually has a 'Title' property, but sometimes it depends heavily on the specific DB setup.
        // list_resources.js uses 'Title' property.
        if (page.properties.Title && page.properties.Title.title && page.properties.Title.title.length > 0) {
            title = page.properties.Title.title[0].plain_text;
        }

        console.log(`Clearing tags for page: ${page.id} - ${title}`);
        try {
            await callNotion(`/pages/${page.id}`, 'PATCH', {
                properties: {
                    Tags: {
                        multi_select: [],
                    },
                },
            });
            console.log("  Success.");
        } catch (error) {
            console.error(`  Error updating page ${page.id}:`, error.message);
        }
    }

    console.log("Finished clearing tags.");
}

clearTags();
