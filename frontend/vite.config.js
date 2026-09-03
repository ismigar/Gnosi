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
// frontend/certs/ is in .gitignore). Generate the certs with scripts/runtime/setup-https-dev.sh
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
        // Fail loudly instead of silently falling back to HTTP, which caused
        // redirect flickering. Keep the message actionable.
        throw new Error(
          `[vite] VITE_DEV_HTTPS=true but certificates could not be read from ` +
            `${path.join(rootDir, "certs")} (${err.code || err.message}). ` +
            `Generate them with scripts/runtime/setup-https-dev.sh or set VITE_DEV_HTTPS=false.`,
          { cause: err },
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

// ── HTTP → HTTPS redirect on the same port ─────────────────────────────────
// When the dev server runs in HTTPS, a plain-HTTP request (http://localhost:5173)
// dies during the TLS handshake BEFORE reaching any middleware — the browser
// shows "Empty reply". The only way to redirect is to sniff the protocol at the
// socket level: a TLS ClientHello always starts with byte 0x16; anything else
// is plain HTTP, so we answer a 307 redirect directly on the raw socket.
// (Same technique as the `httpolyglot` package.)
function httpToHttpsRedirectPlugin() {
  return {
    name: "gnosi:http-to-https-redirect",
    apply: "serve",
    configureServer(server) {
      const httpServer = server.httpServer;
      // Only relevant when Vite actually created an HTTPS server.
      if (!httpServer || !server.config.server.https) return;

      // Take over the raw TCP 'connection' listeners installed by tls.Server
      // so we can peek at the first byte before the TLS machinery does.
      const tlsListeners = httpServer.listeners("connection").slice();
      httpServer.removeAllListeners("connection");
      httpServer.on("connection", (socket) => {
        // Peek in PAUSED mode (read()/'readable', never 'data'): flowing mode
        // would detach the data from the native handle and the TLS wrap — which
        // reads from the handle, not the JS stream buffer — would lose the
        // ClientHello and the handshake would hang forever.
        const sniff = () => {
          const chunk = socket.read();
          if (chunk === null) {
            socket.once("readable", sniff);
            return;
          }
          if (chunk[0] === 0x16) {
            // TLS handshake → put the bytes back and hand off to the TLS server.
            socket.unshift(chunk);
            for (const listener of tlsListeners) listener.call(httpServer, socket);
            return;
          }
          // Plain HTTP → minimal parse of the request line + Host header,
          // then redirect to the same URL over HTTPS.
          const head = chunk.toString("latin1");
          const requestPath = head.split("\r\n")[0]?.split(" ")[1] || "/";
          const hostHeader = head.match(/\r\nhost:\s*([^\r\n]+)/i)?.[1]?.trim();
          const host = hostHeader || `localhost:${server.config.server.port}`;
          socket.end(
            "HTTP/1.1 307 Temporary Redirect\r\n" +
              `Location: https://${host}${requestPath}\r\n` +
              "Connection: close\r\n" +
              "Content-Length: 0\r\n\r\n",
          );
        };
        sniff();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };

  const backendPort = env.VITE_BACKEND_PORT || "5002";
  const frontendPort = env.VITE_FRONTEND_PORT || "5173";

  return {
    plugins: [react(), httpToHttpsRedirectPlugin()],
    // Web and packaged app://gnosi both serve from the origin root. Relative
    // assets break direct BrowserRouter entries and reloads below nested paths.
    base: env.VITE_BASE_PATH || "/",
    resolve: {
      alias: {
        "@": path.join(rootDir, "src"),
      },
      // Collaboration reaches Yjs through the app, BlockNote and y-protocols.
      // Keep one constructor identity even if pnpm exposes another peer path.
      dedupe: ["yjs"],
    },
    // App version injected into the UI (shown in the Control Center). Source
    // single source: frontend/package.json → see src/features/control-center/releases/version.ts and
    // scripts/bump-version.sh. It's read here (not above) to pick up the
    // most recent value on every (re)build with no memory between processes.
    define: {
      __APP_VERSION__: JSON.stringify(
        JSON.parse(
          fs.readFileSync(path.join(rootDir, "package.json"), "utf-8"),
        ).version,
      ),
    },
    optimizeDeps: {
      // Gnosi has one application entry. Without this boundary Vite scans HTML
      // fixtures inside the vendored Zotero Reader and tries to resolve the
      // PDF.js build-only aliases as application dependencies.
      entries: [path.join(rootDir, "index.html")],
      // Keep Lucide's per-icon dynamic imports visible to Vite. If esbuild
      // prebundles this entry, opening any stored custom icon makes the dev
      // browser request the complete icon catalogue instead of one module.
      exclude: ["lucide-react/dynamic"],
    },
    build: {
      // We separate large vendors into their own chunks because (1) the chunk
      // main doesn't grow unchecked and trigger the 500 kB warning, and
      // (2) each library is cached independently across deployments.
      // Heavy routes are already loaded with React.lazy (see src/app/routes.tsx);
      // these groups ensure that dependencies shared between routes
      // (p.ex. blocknote a Vault i a MailComposer) no es dupliquin.
      // Chunks that still exceed 500 kB (editor-vendor ~1.4 MB,
      // tldraw-vendor ~1.1 MB) are heavy vendors loaded ONLY on demand
      // (Vault editor / tldraw drawing), not at startup. We raise the threshold
      // so the warning remains focused on exceptional lazy chunks. Exact entry,
      // route and vendor growth limits are enforced by check-bundle-size.ts;
      // the initial index has already dropped from ~7 MB to ~1.3 MB.
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
