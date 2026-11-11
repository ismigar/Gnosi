import { createServer } from '../../../../frontend/node_modules/vite/dist/node/index.js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
process.env.VITE_DEV_HTTPS = '0';
process.env.VITE_BACKEND_PORT = '9';
const baseline = process.env.GNOSI_MODAL_BASELINE;
const server = await createServer({
    root: path.join(root, 'frontend'), configFile: path.join(root, 'frontend/vite.config.js'),
    server: { host: '127.0.0.1', port: 5189, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:9' } } },
    plugins: baseline ? [{ name: 'immutable-modal-regression-baseline', enforce: 'pre', load(id) {
        if (id === path.join(root, 'frontend/src/features/vault/editor/TranslateLanguagesModal.tsx')) {
            return execFileSync('git', ['show', `${baseline}:frontend/src/features/vault/editor/TranslateLanguagesModal.tsx`], { cwd: root, encoding: 'utf8' });
        }
    } }] : [],
});
await server.listen();
console.log('Modal fixture ready on http://127.0.0.1:5189/tests/fixtures/modal-layers.html');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { void server.close().then(() => process.exit(0)); });
