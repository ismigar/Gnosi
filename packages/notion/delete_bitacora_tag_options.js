
import https from 'https';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = "1ef268e5-2714-8046-a7bc-dc6a5d555eb7";

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
                    try {
                        resolve(JSON.parse(resBody));
                    } catch (e) {
                        resolve({});
                    }
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

async function deleteTagOptions() {
    console.log("Fetching database schema to get current options...");

    try {
        const database = await callNotion(`/databases/${DATABASE_ID}`, 'GET');
        const currentOptions = database.properties["Tags"].multi_select.options;

        console.log(`Found ${currentOptions.length} existing options.`);

        if (currentOptions.length === 0) {
            console.log("No options to delete.");
            return;
        }

        console.log("Updating database to remove all Tag options...");

        await callNotion(`/databases/${DATABASE_ID}`, 'PATCH', {
            properties: {
                "Tags": {
                    multi_select: {
                        options: []
                    }
                }
            }
        });
        console.log("Successfully removed all options from 'Tags' property.");
    } catch (error) {
        console.error("Error updating database schema:", error.message);
    }
}

deleteTagOptions();
