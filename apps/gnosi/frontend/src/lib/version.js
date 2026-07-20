// App version shown by the UI (Control Center).
//
// Single source of truth: frontend/package.json → "version" field.
// Vite injects it at build time as __APP_VERSION__ (see the block
// `define` in vite.config.js). The fallback covers environments without this define
// (e.g. tests with Vitest), where the identifier doesn't exist.
//
// To bump the version use scripts/bump-version.sh, which keeps
// synced in frontend/ and electron/ and creates the vX.Y.Z release tag.
export const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';
