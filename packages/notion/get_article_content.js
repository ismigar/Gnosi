
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
    if (!pageId) {
        console.error("Usage: node get_article_content.js <page_id>");
        process.exit(1);
    }

    try {
        // Get page title
        const page = await callNotion(`/pages/${pageId}`, 'GET');
        const title = page.properties?.Títol?.title?.[0]?.plain_text || "Untitled";

        // Get blocks
        const blocks = await callNotion(`/blocks/${pageId}/children?page_size=10`, 'GET');
        let content = `TITLE: ${title}\n\nCONTENT:\n`;

        for (const block of blocks.results) {
            if (block.type === 'paragraph' && block.paragraph.rich_text.length > 0) {
                content += block.paragraph.rich_text.map(t => t.plain_text).join('') + "\n\n";
            } else if (block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3') {
                const type = block.type;
                content += block[type].rich_text.map(t => t.plain_text).join('') + "\n";
            }
        }

        console.log(content);
    } catch (e) {
        console.error(`ERROR: ${e.message}`);
    }
})();
