
import https from 'https';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = '8c80f2a8-61b8-43b7-90da-4f0e260b7db9';

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
        console.log("Adding new options to 'Tags' property in Recursos DB...");

        const tags = [
            "Afectivitat",
            "Autors clàssics",
            "Cultura i educació",
            "Discerniment",
            "Economia i sistema",
            "Epistemologia",
            "Ètica",
            "Fenomenología",
            "Filosofia de la religió",
            "Filosofia política",
            "Llenguatge i lògica",
            "Metodologia",
            "Pensament contemporani",
            "Relacions humanes",
            "Societat i justícia",
            "Violència control i poder"
        ];

        const colors = [
            'default', 'gray', 'brown', 'orange', 'yellow',
            'green', 'blue', 'purple', 'pink', 'red'
        ];

        const options = tags.map((name, index) => ({
            name: name,
            color: colors[index % colors.length]
        }));

        const properties = {
            "Tags": {
                "multi_select": {
                    "options": options
                }
            }
        };

        const response = await updateDatabase(DATABASE_ID, properties);
        console.log("SUCCESS: Database schema updated.");

    } catch (e) {
        console.error(`ERROR: ${e.message}`);
    }
})();
