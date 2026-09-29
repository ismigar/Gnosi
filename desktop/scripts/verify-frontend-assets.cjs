const fs = require('node:fs');
const path = require('node:path');

const requiredReaderAssets = [
  'host.html', 'reader.js', 'reader.css',
  'pdf/build/pdf.mjs', 'pdf/build/pdf.worker.mjs',
  'pdf/web/viewer.html', 'pdf/web/viewer.css',
  'locales/en-US/zotero.ftl', 'locales/en-US/reader.ftl',
];

function verifyReaderAssets(frontendDirectory) {
  const missing = requiredReaderAssets.filter(file => {
    try {
      const stat = fs.statSync(path.join(frontendDirectory, 'zotero-reader', file));
      return !stat.isFile() || stat.size === 0;
    } catch {
      return true;
    }
  });
  if (missing.length) {
    throw new Error(
      `PDF reader assets are missing or empty in ${frontendDirectory}: ${missing.join(', ')}. `
      + 'Run `bash scripts/runtime/build-zotero-reader.sh` before building the frontend.',
    );
  }
}

module.exports = async function verifyFrontendAssets() {
  verifyReaderAssets(path.resolve(__dirname, '../../frontend/dist'));
};
module.exports.verifyReaderAssets = verifyReaderAssets;
