
import fs from 'fs';
import https from 'https';
import { spawn } from 'child_process';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const CLI_PATH = '/usr/local/lib/node_modules/@notionhq/notion-mcp-server/bin/cli.mjs';

function callTool(method, params, id) {
    return new Promise((resolve) => {
        const proc = spawn('node', [CLI_PATH], {
            env: { ...process.env, NOTION_TOKEN }
        });

        let output = '';
        proc.stdout.on('data', (data) => output += data.toString());

        proc.stdin.write(JSON.stringify({
            jsonrpc: "2.0",
            method: "tools/call",
            params: { name: method, arguments: params },
            id
        }) + '\n');

        setTimeout(() => {
            proc.kill();
            try {
                const lines = output.split('\n').filter(l => l.trim().startsWith('{'));
                const respLine = lines.find(l => JSON.parse(l).id === id);
                const response = JSON.parse(respLine);
                const text = response.result.content[0].text;
                resolve(JSON.parse(text));
            } catch (e) { resolve(null); }
        }, 3000);
    });
}

function downloadImage(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to get image, status code: ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
}

(async () => {
    const pageId = process.argv[2];
    const dest = process.argv[3];

    console.log(`Fetching page ${pageId}...`);
    const page = await callTool('API-retrieve-a-page', { page_id: pageId }, 1);

    if (page && page.properties?.Imatge?.files?.[0]) {
        const url = page.properties.Imatge.files[0].file.url;
        console.log(`Downloading image...`);
        try {
            await downloadImage(url, dest);
            console.log(`SUCCESS: Image saved to ${dest}`);
        } catch (e) {
            console.error(`ERROR: ${e.message}`);
        }
    } else {
        console.error("No image found on page.");
    }
})();
