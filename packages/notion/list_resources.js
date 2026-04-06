
import https from 'https';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = '8c80f2a8-61b8-43b7-90da-4f0e260b7db9';

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
                    resolve({ results: [] }); // Fail graciously
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
        const cursor = process.argv[2];
        const body = { page_size: 10 };
        if (cursor) body.start_cursor = cursor;

        const response = await callNotion(`/databases/${DATABASE_ID}/query`, 'POST', body);

        for (const page of response.results) {
            const id = page.id;
            const title = page.properties.Title?.title?.[0]?.plain_text || "Untitled";
            const language = page.properties.Idioma?.select?.name || null;
            const authors = page.properties.Authors?.rich_text?.[0]?.plain_text || "";

            // Check if it has content (naive check: just assuming we need to process if we haven't tagged it as processed, 
            // but we don't have a tag for that. Let's output list for Agent to decide)

            console.log(`ID: ${id}`);
            console.log(`TITLE: ${title}`);
            console.log(`LANG: ${language}`);
            console.log(`AUTHORS: ${authors}`);
            console.log(`---`);
        }
        console.log(`NEXT_CURSOR: ${response.next_cursor}`);
    } catch (e) {
        console.error(e.message);
    }
})();
