// Versió de l'app que mostra la UI (Control Center).
//
// Font única de veritat: frontend/package.json → camp "version".
// Vite la injecta en temps de build com a __APP_VERSION__ (vegeu el bloc
// `define` a vite.config.js). El fallback cobreix entorns sense aquest define
// (p. ex. tests amb Vitest), on l'identificador no existeix.
//
// Per pujar de versió fes servir scripts/bump-version.sh, que manté
// sincronitzats frontend/ i electron/ i crea el tag vX.Y.Z del release.
export const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';
