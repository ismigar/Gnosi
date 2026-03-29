
import https from 'https';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = '270268e5-2714-80ca-8b47-fa9f28904287';

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
    try {
        const data = await callNotion(`/databases/${DATABASE_ID}/query`, 'POST', {});
        const untagged = [];

        for (const page of data.results) {
            const title = page.properties?.Títol?.title?.[0]?.plain_text || "Untitled";
            const tags = page.properties?.Tags?.multi_select || [];
            if (tags.length === 0) {
                untagged.push({ id: page.id, title });
            }
        }

        console.log(JSON.stringify(untagged, null, 2));
    } catch (e) {
        console.error(`ERROR: ${e.message}`);
    }
})();
