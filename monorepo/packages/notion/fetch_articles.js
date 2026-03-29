
import { spawn } from 'child_process';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = '270268e5-2714-80ca-8b47-fa9f28904287';
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
                const respLine = lines.find(l => {
                    try {
                        const j = JSON.parse(l);
                        return j.id === id;
                    } catch (e) { return false; }
                });
                const response = JSON.parse(respLine);

                // The official server returns { content: [ { type: 'text', text: '...' } ] }
                if (response.result && response.result.content) {
                    const text = response.result.content[0].text;
                    resolve(JSON.parse(text));
                } else {
                    resolve(response);
                }
            } catch (e) {
                resolve({ error: 'Parse error', details: output });
            }
        }, 5000);
    });
}

(async () => {
    console.log("Fetching database pages...");
    const data = await callTool('API-post-database-query', { database_id: DATABASE_ID }, 1);

    if (data && data.results) {
        const pages = data.results;
        console.log(`Found ${pages.length} pages.`);

        for (const page of pages) {
            const title = page.properties?.Títol?.title?.[0]?.plain_text || "Untitled";
            const id = page.id;
            const idioma = page.properties?.Idioma?.select?.name || "ES";
            const altText = page.properties?.['Imatge Alt Text']?.rich_text?.[0]?.plain_text || "";
            const files = page.properties?.Imatge?.files || [];

            console.log(`| ${title.padEnd(30)} | ${id} | ${idioma} | ${altText ? 'OK' : 'PENDING'} | Files: ${files.length} |`);

            if (!altText && files.length > 0) {
                const url = files[0].file?.url || files[0].external?.url;
                // console.log(`  URL: ${url}`);
            }
        }
    } else {
        console.log("Error or empty results", data);
    }
})();
