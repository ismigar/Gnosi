import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Build-time allowlist: offline HTML, reviewed public icons and its compiled graph only. */
export function offlineShellPlugin() {
    let config;
    return {
        name: 'gnosi:offline-shell',
        apply: 'build',
        configResolved(value) { config = value; },
        writeBundle() {
            // Other asset bases remain supported by the main app. The standalone
            // companion is deployed at the server origin root, like the API.
            if (config.base !== '/') return;
            const out = path.resolve(config.root, config.build.outDir);
            const manifest = JSON.parse(fs.readFileSync(path.join(out, '.vite/manifest.json'), 'utf8'));
            if (!manifest['offline.html']) throw new Error('Missing offline entry');
            const files = new Set(['/offline.html', '/manifest.json', '/favicon.svg', '/app-icon-192.png', '/app-icon-512.png']);
            const visited = new Set();
            function visit(key) {
                if (visited.has(key)) return;
                visited.add(key);
                const item = manifest[key];
                if (!item) throw new Error(`Missing offline dependency: ${key}`);
                for (const asset of [item.file, ...(item.css || []), ...(item.assets || [])]) {
                    if (!asset || asset.startsWith('/') || asset.includes('..') || !asset.startsWith(`${config.build.assetsDir}/`)) {
                        throw new Error('Unexpected offline asset path');
                    }
                    files.add(`/${asset}`);
                }
                for (const imported of [...(item.imports || []), ...(item.dynamicImports || [])]) visit(imported);
            }
            visit('offline.html');
            const urls = [...files].sort();
            const hash = createHash('sha256');
            for (const url of urls) {
                hash.update(url);
                hash.update(fs.readFileSync(path.join(out, url.slice(1))));
            }
            const template = fs.readFileSync(path.join(config.publicDir, 'gnosi-offline-worker.js'), 'utf8');
            hash.update(template);
            const worker = template.replace('/* GNOSI_OFFLINE_FILES */ []', JSON.stringify(urls))
                .replace("/* GNOSI_OFFLINE_BUILD */ 'unbuilt'", JSON.stringify(hash.digest('hex').slice(0, 20)));
            fs.writeFileSync(path.join(out, 'gnosi-offline-worker.js'), worker);
        },
    };
}
