
import https from 'https';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = "8c80f2a8-61b8-43b7-90da-4f0e260b7db9"; // Recursos DB

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
                        resolve({});
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

async function fetchUntaggedSorts() {
    let hasMore = true;
    let cursor = undefined;
    let allPages = [];

    console.log("Fetching pages from Recursos...");

    while (hasMore) {
        try {
            const body = {
                filter: {
                    property: "Tags",
                    multi_select: {
                        is_empty: true,
                    },
                },
                start_cursor: cursor
            };

            const response = await callNotion(`/databases/${DATABASE_ID}/query`, 'POST', body);
            allPages = allPages.concat(response.results);
            hasMore = response.has_more;
            cursor = response.next_cursor;
        } catch (error) {
            console.error("Error fetching pages:", error.message);
            break;
        }
    }

    console.log(`Found ${allPages.length} pages without tags.`);

    const simplified = allPages.map(p => ({
        id: p.id,
        title: p.properties.Title?.title?.[0]?.plain_text || "Untitled"
    }));

    // Sort alphabetically by title
    simplified.sort((a, b) => a.title.localeCompare(b.title));

    console.log(JSON.stringify(simplified, null, 2));
}

fetchUntaggedSorts();
