
import https from 'https';
import fs from 'fs';

const NOTION_TOKEN = process.env.NOTION_TOKEN;

function updatePageProperties(pageId, properties) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ properties });
        const options = {
            hostname: 'api.notion.com',
            port: 443,
            path: `/v1/pages/${pageId}`,
            method: 'PATCH',
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
                    resolve(JSON.parse(resBody));
                } else {
                    reject(new Error(`Status ${res.statusCode}: ${resBody}`));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(body);
        req.end();
    });
}

(async () => {
    const pageId = process.argv[2];
    const propertyName = process.argv[3];
    // Read content from stdin or a file to avoid shell escaping issues
    const content = process.argv.slice(4).join(' ');

    console.log(`Updating page ${pageId} property "${propertyName}"...`);
    try {
        const props = {
            [propertyName]: {
                rich_text: [{ text: { content } }]
            }
        };
        await updatePageProperties(pageId, props);
        console.log("SUCCESS: Page updated.");
    } catch (e) {
        console.error(`ERROR: ${e.message}`);
    }
})();
