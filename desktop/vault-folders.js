// @ts-check
const fs = require('node:fs');
const path = require('node:path');

/** Recognize existing libraries without reading cloud-backed file contents.
 * @param {string} folder
 */
function isVault(folder) {
  return fs.existsSync(path.join(folder, '.gnosi'))
    || fs.existsSync(path.join(folder, 'BD', 'vault_db_registry.json'));
}

/** A selected container takes precedence over legacy scaffolding at its root.
 * Direct selection of an existing single vault remains supported.
 * @param {string} folder
 * @returns {{vault: string, root: string}}
 */
function resolveVaultFolder(folder) {
  const entries = fs.readdirSync(folder, { withFileTypes: true });
  const children = entries.filter(entry => !entry.name.startsWith('.') && entry.isDirectory()
    && !entry.isSymbolicLink() && isVault(path.join(folder, entry.name)))
    .map(entry => entry.name).sort();
  if (children.length) {
    const primary = children.find(name => name.toLowerCase() === 'principal') || children[0] || 'Principal';
    return { root: folder, vault: path.join(folder, primary) };
  }
  // Preserve existing unmarked libraries containing notes. An empty folder is
  // a new container; its first library is created by the backend, not here.
  if (isVault(folder) || entries.some(entry => !entry.name.startsWith('.'))) {
    return { root: path.dirname(folder), vault: folder };
  }
  return { root: folder, vault: path.join(folder, 'Principal') };
}

module.exports = { resolveVaultFolder };
