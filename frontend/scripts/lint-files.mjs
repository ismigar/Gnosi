import { ESLint } from 'eslint';
import { writeFileSync } from 'node:fs';

const manifest = process.argv[2];
if (!manifest) throw new Error('A temporary discovery manifest path is required');

// Use ESLint's own directory traversal, config lookup and ignores. This pass
// ONLY enumerates paths: an empty processor avoids parsing/type-checking every
// file at once. Its results never count as lint success and never enter a cache.
// lint.mjs sends every discovered file to the unmodified ESLint CLI afterward.
const discovery = new ESLint({
  cache: false,
  // ESLint deletes cacheLocation when caching is off. Confine that operation
  // to the parent's temporary directory, preserving the real .eslintcache.
  cacheLocation: `${manifest}.cache`,
  concurrency: 'off',
  overrideConfig: {
    processor: {
      meta: { name: 'gnosi-lint-discovery', version: '1' },
      preprocess: () => [],
      postprocess: () => [],
    },
  },
});
const results = await discovery.lintFiles(['.']);
writeFileSync(manifest, JSON.stringify(results.map(result => result.filePath).sort()));
