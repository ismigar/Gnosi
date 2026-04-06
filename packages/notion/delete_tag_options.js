
import https from 'https';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = '270268e5-2714-80ca-8b47-fa9f28904287';

function updateDatabase(databaseId, properties) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ properties });
        const options = {
            hostname: 'api.notion.com',
            port: 443,
            path: `/v1/databases/${databaseId}`,
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
    try {
        console.log("Removing options from 'Tags' property...");

        // To remove options, we send an empty array of options
        const properties = {
            "Tags": {
                "multi_select": {
                    "options": []
                }
            }
        };

        const response = await updateDatabase(DATABASE_ID, properties);
        console.log("SUCCESS: Database schema updated.");

    } catch (e) {
        console.error(`ERROR: ${e.message}`);
    }
})();
