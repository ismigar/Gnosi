
import https from 'https';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
// ID will be filled after search
const DATABASE_ID = process.argv[2];

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
                resolve(JSON.parse(resBody));
            });
        });

        req.on('error', (e) => reject(e));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function inspectRecurs() {
    if (!DATABASE_ID) {
        console.log("Please provide DB ID");
        return;
    }

    // Get one page
    const response = await callNotion(`/databases/${DATABASE_ID}/query`, 'POST', { page_size: 1 });

    if (response.results && response.results.length > 0) {
        const page = response.results[0];
        console.log("Page ID:", page.id);
        console.log("Properties:", JSON.stringify(page.properties, null, 2));

        // Get content to see where "Notes" is
        const blocks = await callNotion(`/blocks/${page.id}/children?page_size=20`, 'GET');
        console.log("Blocks:", JSON.stringify(blocks.results, null, 2));
    } else {
        console.log("No pages found in DB");
    }
}

inspectRecurs();
