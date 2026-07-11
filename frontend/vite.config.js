import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Directory of this file (ESM doesn't have __dirname).
const rootDir = path.dirname(fileURLToPath(import.meta.url));

// ── Local HTTPS for dev (optional, required by Office Add-ins) ─────────────
// Resolves the HTTPS config ONCE and caches it in process.env.
//
// Why the memory: Vite restarts the dev server WITHIN THE SAME process when
// it thinks vite.config.js has changed. On Docker/Mac bind mounts with polling
// (usePolling + CHOKIDAR_USEPOLLING), mtime glitches trigger restarts
// spurious; if we reread the FS on every restart, fs.existsSync(certs)
// would flicker false↔true (the volume was still settling) and the server would skip
// HTTP↔HTTPS → the frontend "wasn't responding" (an HTTP client against a server
// HTTPS gets "Empty reply"). By memoizing the result, all subsequent restarts
// reuse the same protocol: zero flicker.
//
// The decision, in order:
//   VITE_DEV_HTTPS = true|1  → requires HTTPS (fails clearly if certs are missing)
//                    false|0 → forces HTTP
//                    (undefined) → auto: HTTPS if certs exist, otherwise HTTP
// IMPORTANT: set VITE_DEV_HTTPS only in a LOCAL .env, never in docker-compose
// (it's synced via git and would break the other Mac, which doesn't have certs —
// frontend/certs/ is in .gitignore). Generate the certs with sh/setup-https-dev.sh
// (mkcert). Remember: after generating or deleting certs, restart the
// container (docker restart gnosi_frontend) so the memory refreshes.
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
        // Fail LOUDLY instead of silently falling back to HTTP (this was the
        // that caused the flickering). Actionable message.
        throw new Error(
          `[vite] VITE_DEV_HTTPS=true però no s'han pogut llegir els certs a ` +
            `${path.join(rootDir, "certs")} (${err.code || err.message}). ` +
            `Genera'ls amb sh/setup-https-dev.sh o posa VITE_DEV_HTTPS=false.`,
        );
      }
      https = undefined; // auto without certs → HTTP (normal case on the other Mac)
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
    // App version injected into the UI (shown in the Control Center). Source
    // single source: frontend/package.json → see src/lib/version.js and
    // scripts/bump-version.sh. It's read here (not above) to pick up the
    // most recent value on every (re)build with no memory between processes.
    define: {
      __APP_VERSION__: JSON.stringify(
        JSON.parse(
          fs.readFileSync(path.join(rootDir, "package.json"), "utf-8"),
        ).version,
      ),
    },
    build: {
      // We separate large vendors into their own chunks because (1) the chunk
      // main doesn't grow unchecked and trigger the 500 kB warning, and
      // (2) each library is cached independently across deployments.
      // Heavy routes are already loaded with React.lazy (see src/App.jsx);
      // these groups ensure that dependencies shared between routes
      // (p.ex. blocknote a Vault i a MailComposer) no es dupliquin.
      // Chunks that still exceed 500 kB (editor-vendor ~1.4 MB,
      // tldraw-vendor ~1.1 MB) are heavy vendors loaded ONLY on demand
      // (Vault editor / tldraw drawing), not at startup. We raise the threshold
      // so the warning doesn't create noise over the expected lazy chunks; the chunk
      // initial (index) has already dropped from ~7 MB to ~1 MB.
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          // NOTE: we leave React (react/react-dom/router) in the main chunk on
          // purpose. Extracting it to its own chunk created cycles
          // (react-vendor ↔ editor-vendor) because the vendors that depend on it
          // reference it again; the cycle would force the editor chunk into the
          // initial load. We only isolate heavy "leaf" libraries that are ONLY
          // reached via lazy routes, so they don't get bundled at startup.
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            // Rich text editor + its Mantine bridge (only used by blocknote):
            // is the heaviest group besides mermaid and tldraw.
            if (
              /[\\/]node_modules[\\/](@blocknote|@tiptap|prosemirror-|@mantine)/.test(id)
            ) {
              return "editor-vendor";
            }
            if (/[\\/]node_modules[\\/]tldraw[\\/]/.test(id)) return "tldraw-vendor";
            if (/[\\/]node_modules[\\/]@fullcalendar[\\/]/.test(id)) return "calendar-vendor";
            if (/[\\/]node_modules[\\/](sigma|graphology)/.test(id)) return "graph-vendor";
            if (/[\\/]node_modules[\\/](react-pdf|pdfjs-dist)[\\/]/.test(id)) return "pdf-vendor";
            return undefined;
          },
        },
      },
    },
    // `vite preview` (served build) reuses the same /api → backend proxy,
    // so visual tests against the build work without CORS.
    preview: {
      proxy: {
        "/api": {
          target: `http://${env.VITE_BACKEND_HOST || "127.0.0.1"}:${backendPort}`,
          changeOrigin: true,
          ws: true,
        },
      },
    },
    server: {
      host: true, // Ensure it listens on 0.0.0.0
      port: Number(frontendPort),
      strictPort: true,
      // undefined → HTTP (default); {cert,key} → HTTPS (cached, stable).
      https: resolveDevHttps(env),
      watch: {
        usePolling: true, // essential for HMR in Docker/Mac bind mounts
        interval: 300,
        // Dampens spurious config restarts caused by volume mtime glitches
        // mounted: wait for the file to stabilize before emitting the event.
        awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
      },
      proxy: {
        "/api": {
          target: `http://${env.VITE_BACKEND_HOST || "127.0.0.1"}:${backendPort}`,
          changeOrigin: true,
          // ws:true forwards the WebSocket upgrade for the collaboration channel
          // (/api/vault/collab/{id}) to the backend in dev. Without this the
          // WS connection would be left hanging on Vite's dev server.
          ws: true,
        },
      },
    },
  };
});
