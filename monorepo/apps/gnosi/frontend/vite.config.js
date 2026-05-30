import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Directori d'aquest fitxer (ESM no té __dirname).
const rootDir = path.dirname(fileURLToPath(import.meta.url));

// ── HTTPS local per a dev (opcional, exigit pels Office Add-ins) ─────────────
// Resol la config HTTPS UNA sola vegada i la memoritza a process.env.
//
// Per què la memòria: Vite reinicia el dev server DINS DEL MATEIX procés quan
// creu que vite.config.js ha canviat. En bind mounts de Docker/Mac amb polling
// (usePolling + CHOKIDAR_USEPOLLING), glitches de mtime disparen reinicis
// espuris; si en cada reinici rellegíssim el FS, fs.existsSync(certs)
// parpellejava false↔true (el volum encara s'assenta) i el server saltava
// HTTP↔HTTPS → el frontend "no responia" (un client HTTP contra un server
// HTTPS rep "Empty reply"). Memoritzant el resultat, tots els reinicis
// reutilitzen el mateix protocol: zero parpelleig.
//
// La decisió, en ordre:
//   VITE_DEV_HTTPS = true|1  → exigeix HTTPS (falla clar si falten els certs)
//                    false|0 → força HTTP
//                    (sense definir) → auto: HTTPS si hi ha certs, si no HTTP
// IMPORTANT: posa VITE_DEV_HTTPS només a un .env LOCAL, mai al docker-compose
// (es sincronitza per git i trencaria l'altre Mac, que no té certs —
// frontend/certs/ està a .gitignore). Genera els certs amb sh/setup-https-dev.sh
// (mkcert). Recorda: després de generar o esborrar certs, reinicia el
// contenidor (docker restart gnosi_frontend) perquè la memòria es refresqui.
function resolveDevHttps(env) {
  const CACHE = "__GNOSI_DEV_HTTPS_CACHE";
  const cached = process.env[CACHE];
  if (cached) {
    const c = JSON.parse(cached);
    return c.cert
      ? { cert: Buffer.from(c.cert, "base64"), key: Buffer.from(c.key, "base64") }
      : undefined;
  }

  const flag = String(env.VITE_DEV_HTTPS ?? "").trim().toLowerCase();
  const forced =
    flag === "true" || flag === "1"
      ? true
      : flag === "false" || flag === "0"
        ? false
        : null;

  const certFile = path.join(rootDir, "certs", "localhost.pem");
  const keyFile = path.join(rootDir, "certs", "localhost-key.pem");

  let https; // undefined → HTTP
  if (forced !== false) {
    try {
      https = { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
    } catch (err) {
      if (forced === true) {
        // Falla SOROLLOSA en comptes de caure en silenci a HTTP (això era el
        // que provocava el parpelleig). Missatge accionable.
        throw new Error(
          `[vite] VITE_DEV_HTTPS=true però no s'han pogut llegir els certs a ` +
            `${path.join(rootDir, "certs")} (${err.code || err.message}). ` +
            `Genera'ls amb sh/setup-https-dev.sh o posa VITE_DEV_HTTPS=false.`,
        );
      }
      https = undefined; // auto sense certs → HTTP (cas normal a l'altre Mac)
    }
  }

  process.env[CACHE] = JSON.stringify(
    https
      ? { cert: https.cert.toString("base64"), key: https.key.toString("base64") }
      : {},
  );
  return https;
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };

  const backendPort = env.VITE_BACKEND_PORT || "5002";
  const frontendPort = env.VITE_FRONTEND_PORT || "5173";

  return {
    plugins: [react()],
    base: env.VITE_BASE_PATH || "./",
    server: {
      host: true, // Ensure it listens on 0.0.0.0
      port: Number(frontendPort),
      strictPort: true,
      // undefined → HTTP (per defecte); {cert,key} → HTTPS (memoritzat, estable).
      https: resolveDevHttps(env),
      watch: {
        usePolling: true, // imprescindible per a HMR en bind mounts Docker/Mac
        interval: 300,
        // Amorteeix reinicis espuris del config per glitches de mtime del volum
        // muntat: espera que el fitxer s'estabilitzi abans d'emetre l'event.
        awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
      },
      proxy: {
        "/api": {
          target: `http://${env.VITE_BACKEND_HOST || "127.0.0.1"}:${backendPort}`,
          changeOrigin: true,
          // ws:true reenvia l'upgrade WebSocket del canal de col·laboració
          // (/api/vault/collab/{id}) al backend en dev. Sense això la
          // connexió WS quedaria penjada al dev server de Vite.
          ws: true,
        },
      },
    },
  };
});
