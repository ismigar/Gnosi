
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
                    console.log(`Error ${res.statusCode}: ${resBody}`);
                    resolve({});
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
    if (!pageId) { console.log("Need page ID"); return; }

    console.log(`Inspecting Page: ${pageId}`);

    // Get Blocks
    const blocks = await callNotion(`/blocks/${pageId}/children?page_size=100`, 'GET');

    let content = "";
    if (blocks.results) {
        for (const block of blocks.results) {
            if (block.type === 'paragraph' && block.paragraph.rich_text.length > 0) {
                content += block.paragraph.rich_text.map(t => t.plain_text).join('') + "\n";
            }
            // Add other types if needed
        }
    }

    console.log("CONTENT START:");
    console.log(content.substring(0, 1000)); // First 1000 chars
    console.log("CONTENT END");
})();
