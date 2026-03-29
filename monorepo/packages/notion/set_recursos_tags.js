
import https from 'https';

const NOTION_TOKEN = process.env.NOTION_TOKEN;

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
                    resolve(JSON.parse(resBody));
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

(async () => {
    const pageId = process.argv[2];
    const tagsInput = process.argv[3]; // "Tag1,Tag2"

    if (!pageId || !tagsInput) {
        console.error("Usage: node set_recursos_tags.js <page_id> <tag1,tag2>");
        process.exit(1);
    }

    const tagNames = tagsInput.split(',').map(t => t.trim());
    const tagOptions = tagNames.map(name => ({ name }));

    console.log(`Setting tags for ${pageId}: ${JSON.stringify(tagNames)}...`);

    try {
        await callNotion(`/pages/${pageId}`, 'PATCH', {
            properties: {
                Tags: {
                    multi_select: tagOptions
                }
            }
        });
        console.log("SUCCESS: Tags updated.");
    } catch (e) {
        console.error(`ERROR: ${e.message}`);
    }
})();
