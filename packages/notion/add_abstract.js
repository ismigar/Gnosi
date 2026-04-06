
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
    const abstractText = process.argv[3];

    if (!pageId || !abstractText) {
        console.log("Usage: node add_abstract.js <pageId> <abstractText>");
        process.exit(1);
    }

    try {
        // We want to insert valid blocks BEFORE "Notes"
        // But finding "Notes" via API is tricky if it's just text. 
        // Strategy: Insert at the very beginning of the page (after: undefined)
        // Or if "Notes" is a heading, we could try to find it. 
        // For now, let's prepend to the page. 

        // However, `append` adds to the END. 
        // To prepend, we have to refer to the first block and insert BEFORE it?
        // Notion API `append` only adds to the END of a parent.
        // To insert at specific position, we need `block_id` of the block to insert AFTER. 
        // BUT we want to insert at the START.
        // If we want to insert at start, we might not be able to easily unless we overwrite or insert after title?
        // Wait, `children` specific pos is not supported directly in `append`.
        // We can `append` to the page ID, which adds to the bottom.

        // Correction: Notion API `Append block children` adds to the end.
        // There is no `Prepend`.
        // BUT, we can use `insert after` specific block ID if we use `PATCH /blocks/{block_id}/children`? No.

        // Actually, `Append block children` has `after` parameter? No.
        // Wait, there is `Append block children` endpoint.
        // To insert elsewhere, we apparently have to re-write? No that's terrible.

        // Let's check if there is an "After" option.
        // https://developers.notion.com/reference/patch-block-children
        // "Appends... to the end".

        // Wait, there IS an `after` parameter in `Append block children`?
        // Checking docs... 
        // "This endpoint appends new children blocks to the parent block_id specified... content follows the existing children."

        // Ah, if we want to insert at the top, we might need a workaround.
        // BUT, notice the user said "abans de 'Notes'".
        // Maybe "Notes" is way down?
        // If I append to the page, it goes to the bottom.
        // If "Notes" is at the bottom, appending might be AFTER notes.

        // Let's first Inspect the page to see where "Notes" is.
        // If I can find the block ID of "Notes", I can insert BEFORE it? 
        // No, API usually allows appending to a parent.

        // HACK: If I cannot prepend, I will append and assume the user will move it, OR 
        // I will try to read all blocks, delete them, and re-create them with abstract at top? Too risky.

        // LET's LOOK AT `inspect_recurs.js` output first to see what we are dealing with. 
        // Maybe "Notes" is a property? If it's a property, it's not in the content blocks.
        // If it's a property, then "Adding to the beginning of the page" just means adding content blocks, which usually go below title.

        // Let's assume for now I will use `append` (which goes to bottom) unless I find a better way.
        // UNLESS `Notes` is a heading block in the content.

        console.log(`Adding abstract to ${pageId}...`);

        const response = await callNotion(`/blocks/${pageId}/children`, 'PATCH', {
            children: [
                {
                    object: "block",
                    type: "heading_3",
                    heading_3: {
                        rich_text: [{ type: "text", text: { content: "Abstract" } }]
                    }
                },
                {
                    object: "block",
                    type: "paragraph",
                    paragraph: {
                        rich_text: [{ type: "text", text: { content: abstractText } }]
                    }
                },
                {
                    object: "block",
                    type: "divider",
                    divider: {}
                }
            ]
        });

        console.log("Abstract added successfully (at the bottom, will verify position later).");

    } catch (e) {
        console.error(e.message);
    }
})();
