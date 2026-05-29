import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Directori d'aquest fitxer (ESM no té __dirname).
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };

  const backendPort = env.VITE_BACKEND_PORT || "5002";
  const frontendPort = env.VITE_FRONTEND_PORT || "5173";

  // HTTPS local opcional. Els Office Add-ins (Word/Excel) exigeixen que el
  // taskpane es carregui per HTTPS; un autofirmat no de confiança el rebutja
  // el WebView. Genera certs de confiança amb mkcert (sh/setup-https-dev.sh)
  // a `frontend/certs/`. Si no hi són, el dev server segueix en HTTP (per
  // defecte) i no es trenca res — Docker inclòs.
  const certFile = path.join(rootDir, "certs", "localhost.pem");
  const keyFile = path.join(rootDir, "certs", "localhost-key.pem");
  const https =
    fs.existsSync(certFile) && fs.existsSync(keyFile)
      ? { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }
      : undefined;

  return {
    plugins: [react()],
    base: env.VITE_BASE_PATH || "./",
    server: {
      watch: {
        usePolling: true,
      },
      host: true, // Ensure it listens on 0.0.0.0
      port: Number(frontendPort),
      strictPort: true,
      // undefined → HTTP (per defecte); {cert,key} → HTTPS (vegeu a dalt).
      https,
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
