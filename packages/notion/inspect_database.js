
import https from 'https';
import fs from 'fs';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = '431979bd-26aa-4291-90b1-d728935006af';

function getDatabase(databaseId) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.notion.com',
            port: 443,
            path: `/v1/databases/${databaseId}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${NOTION_TOKEN}`,
                'Notion-Version': '2022-06-28'
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
        req.end();
    });
}

(async () => {
    try {
        console.log("Fetching database schema...");
        const db = await getDatabase(DATABASE_ID);

        // Save full output to file
        fs.writeFileSync('db_schema.json', JSON.stringify(db, null, 2));
        console.log("Database schema saved to db_schema.json");

        // Try to find properties that look like 'Tags'
        console.log("Properties found:");
        for (const [key, value] of Object.entries(db.properties)) {
            let typeInfo = "";
            if (value.type === 'select') {
                typeInfo = `Select (${value.select.options.length} options)`;
            } else if (value.type === 'multi_select') {
                typeInfo = `Multi-Select (${value.multi_select.options.length} options)`;
            } else {
                typeInfo = value.type;
            }
            console.log(`- ${key}: ${typeInfo}`);
        }

    } catch (e) {
        console.error(`ERROR: ${e.message}`);
    }
})();
