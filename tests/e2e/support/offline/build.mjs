/** Isolated acceptance build. Uses the real config and offlineShellPlugin. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../../../../frontend/node_modules/vite/dist/node/index.js';
import frontendConfig from '../../../../frontend/vite.config.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const frontend = path.join(root, 'frontend');
const fixture = path.join(root, '.tmp/gauntlet/obsidian-parity/offline-browser');
const publicDir = path.join(fixture, 'public');
fs.mkdirSync(publicDir, { recursive: true });
for (const name of ['manifest.json', 'gnosi-offline-worker.js', 'favicon.svg', 'app-icon-192.png', 'app-icon-512.png']) {
    fs.copyFileSync(path.join(frontend, 'public', name), path.join(publicDir, name));
}
const config = frontendConfig({ command: 'build', mode: 'production' });
await build({
    ...config, configFile: false, root: frontend, publicDir, base: '/',
    // This fixture contains the offline entry only. The main build still runs
    // its mandatory PDF/EPUB reader validator in the integrated acceptance gate.
    plugins: config.plugins.flat().filter(plugin => plugin.name !== 'gnosi:required-reader-assets'),
    build: { ...config.build, outDir: path.join(fixture, 'dist'), emptyOutDir: true,
        rolldownOptions: { ...config.build.rolldownOptions, input: { offline: path.join(frontend, 'offline.html') },
            // The main shell icon split expects the multi-entry shared factory.
            // A single-entry fixture uses automatic splitting to avoid a synthetic cycle.
            output: { ...config.build.rolldownOptions.output, codeSplitting: {} } }  },
});
