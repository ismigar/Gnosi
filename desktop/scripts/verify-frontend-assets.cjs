const fs = require('node:fs');
const path = require('node:path');

module.exports = async function verifyFrontendAssets() {
  const dist = path.resolve(__dirname, '../../frontend/dist');
  const required = ['zotero-reader/host.html', 'zotero-reader/reader.js', 'zotero-reader/reader.css'];
  const missing = required.filter(file => !fs.existsSync(path.join(dist, file)));
  if (missing.length) {
    throw new Error(
      `Packaged PDF reader assets are missing: ${missing.join(', ')}. `
      + 'Run `bash scripts/runtime/build-zotero-reader.sh` and rebuild the frontend before packaging.',
    );
  }
};
