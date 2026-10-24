import { defineConfig } from 'astro/config';
import fs from 'node:fs';

const bundle = JSON.parse(fs.readFileSync('bundle.json', 'utf8'));
const base = new URL(bundle.deployment_url || bundle.site.origin).pathname;

export default defineConfig({
  output: 'static', base, trailingSlash: 'never', build: { format: 'directory' },
  devToolbar: { enabled: false },
});
