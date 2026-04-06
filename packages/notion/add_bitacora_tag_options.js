
import https from 'https';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = "1ef268e5-2714-8046-a7bc-dc6a5d555eb7"; // Bitàcora DB ID

const TAG_OPTIONS = [
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

const COLORS = [
    "default",
    "gray",
    "brown",
    "orange",
    "yellow",
    "green",
    "blue",
    "purple",
    "pink",
    "red",
];

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

async function addTagOptions() {
    console.log(`Preparing to add ${TAG_OPTIONS.length} options to 'Tags' property in Bitacora DB...`);

    // Prepare the options array with colors
    const options = TAG_OPTIONS.map((name, index) => ({
        name: name,
        color: COLORS[index % COLORS.length],
    }));

    console.log("Planned options:", options);

    try {
        await callNotion(`/databases/${DATABASE_ID}`, 'PATCH', {
            properties: {
                "Tags": {
                    multi_select: {
                        options: options
                    }
                }
            }
        });
        console.log("Successfully added options to 'Tags' property.");
    } catch (error) {
        console.error("Error updating database schema:", error.message);
    }
}

addTagOptions();
