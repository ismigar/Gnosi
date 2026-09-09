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
function installHttpRedirect(server, https, port) {
  const httpServer = server.httpServer;
  if (!httpServer || !https) return;

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
      const host = hostHeader || `localhost:${port}`;
      socket.end(
        "HTTP/1.1 307 Temporary Redirect\r\n" +
          `Location: https://${host}${requestPath}\r\n` +
          "Connection: close\r\n" +
          "Content-Length: 0\r\n\r\n",
      );
    };
    sniff();
  });
}

function httpToHttpsRedirectPlugin() {
  return {
    name: "gnosi:http-to-https-redirect",
    apply: "serve",
    configureServer(server) {
      installHttpRedirect(server, server.config.server.https, server.config.server.port);
    },
    configurePreviewServer(server) {
      installHttpRedirect(server, server.config.preview.https ?? server.config.server.https,
        server.config.preview.port);
    },
  };
}

const IMMUTABLE_ASSET_CACHE = "public, max-age=31536000, immutable";

// The shell needs these small icons together. Keep the remaining Lucide
// catalogue lazy instead of grouping every module under the package path.
const SHELL_LUCIDE_ICONS = new Set([
  "book-open", "bot", "briefcase", "calendar", "calendar-range", "chevron-down",
  "circle-question-mark", "clock", "command", "database", "download", "file-text",
  "folder", "gauge", "hash", "image", "inbox", "layout-panel-left", "library-big",
  "list-tree", "loader", "loader-circle", "log-in", "log-out", "mail", "menu",
  "message-circle", "message-square", "monitor", "moon", "network", "notebook-tabs",
  "panel-bottom-close", "panel-top-open", "pen-tool", "plus", "presentation",
  "puzzle", "refresh-cw", "search", "settings", "share-2", "shield", "sparkles",
  "star", "sun", "upload", "user", "user-plus", "users", "vault",
]);

function isShellLucideIcon(id) {
  const match = /\/lucide-react\/dist\/esm\/icons\/([^/]+)\.m?js$/u.exec(
    id.replaceAll("\\", "/"),
  );
  return Boolean(match && SHELL_LUCIDE_ICONS.has(match[1]));
}

function compiledAssetsFromManifest(directory, manifest, assetsDir) {
  const files = new Set();
  if (!manifest) return files;
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(path.join(directory,
      typeof manifest === "string" ? manifest : ".vite/manifest.json"), "utf8"));
  } catch {
    // Older builds remain usable with Vite's normal revalidation policy.
    return files;
  }
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return files;
  for (const entry of Object.values(entries)) {
    if (!entry || typeof entry !== "object") continue;
    const candidates = [entry.file,
      ...(Array.isArray(entry.css) ? entry.css : []),
      ...(Array.isArray(entry.assets) ? entry.assets : [])];
    for (const file of candidates) {
      // Membership in the compiler manifest is required: a public file or a
      // missing URL that merely resembles a hashed chunk must not qualify.
      if (typeof file !== "string" || !file.startsWith(`${assetsDir}/`)
          || file.includes("\\") || file.includes("\0")
          || file.split("/").some(part => part === "." || part === "..")
          || !/-[\w-]{8,}\.(?:m?js|css|wasm|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf)$/.test(file)) continue;
      files.add(`/${file}`);
    }
  }
  return files;
}

function immutablePreviewAssetsPlugin() {
  return {
    name: "gnosi:immutable-preview-assets",
    configurePreviewServer(server) {
      const build = server.config.environments.client.build;
      const directory = path.resolve(server.config.root, build.outDir);
      const assets = compiledAssetsFromManifest(directory, build.manifest, build.assetsDir);
      const base = new URL(server.config.base, "http://preview.invalid").pathname;
      const prefix = base === "/" ? "" : base.replace(/\/$/, "");
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const requestPath = (req.url || "").split("?", 1)[0];
        if (prefix && !requestPath.startsWith(`${prefix}/`)) return next();
        const assetPath = requestPath.slice(prefix.length);
        if (!assets.has(assetPath)) return next();
        try {
          // A removed build entry must follow the usual 404/HTML fallback path.
          if (!fs.lstatSync(path.join(directory, assetPath)).isFile()) return next();
        } catch {
          return next();
        }
        // sirv's dev mode honors a preceding header on 200, and its 304 branch
        // bypasses setHeaders entirely. Install this before either branch.
        res.setHeader("Cache-Control", IMMUTABLE_ASSET_CACHE);
        const writeHead = res.writeHead.bind(res);
        res.writeHead = (status, ...args) => {
          const servedPath = (req.url || "").split("?", 1)[0];
          if (![200, 206, 304].includes(status) || servedPath !== assetPath) {
            if (res.getHeader("Cache-Control") === IMMUTABLE_ASSET_CACHE) {
              res.removeHeader("Cache-Control");
            }
            // sirv may already have copied the header into writeHead's inline
            // headers. Remove our value there too, preserving unrelated fields
            // and both Node overloads (including alternating name/value arrays).
            const headersIndex = typeof args[0] === "string" ? 1 : 0;
            const headers = args[headersIndex];
            if (Array.isArray(headers)) {
              const retained = [];
              for (let index = 0; index < headers.length; index += 2) {
                if (String(headers[index]).toLowerCase() === "cache-control"
                    && headers[index + 1] === IMMUTABLE_ASSET_CACHE) continue;
                retained.push(headers[index], headers[index + 1]);
              }
              args[headersIndex] = retained;
            } else if (headers && typeof headers === "object") {
              args[headersIndex] = Object.fromEntries(Object.entries(headers).filter(
                ([name, value]) => name.toLowerCase() !== "cache-control"
                  || value !== IMMUTABLE_ASSET_CACHE,
              ));
            }
          }
          return writeHead(status, ...args);
        };
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };

  const backendPort = env.VITE_BACKEND_PORT || "5002";
  const frontendPort = env.VITE_FRONTEND_PORT || "5173";

  return {
    plugins: [react(), httpToHttpsRedirectPlugin(), immutablePreviewAssetsPlugin()],
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
      // Identifies actual compiler outputs for immutable preview asset caching.
      manifest: true,
      // Heavy screens are route-local dynamic chunks. Some remain intentionally
      // large (editor and drawing), so this warning threshold stays focused on
      // exceptional growth. check-bundle-size.ts separately enforces the whole
      // static startup graph, including modulepreload dependencies.
      chunkSizeWarningLimit: 1500,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [{
              name: "shell-icons",
              test: isShellLucideIcon,
              // React and the shared icon factory retain automatic placement.
              includeDependenciesRecursively: false,
            }],
          },
        },
      },
      // Automatic route-local chunks avoid cycles between shared runtimes and
      // manually grouped lazy vendors. Those cycles made heavy feature-only
      // libraries part of the startup graph.
    },
    // `vite preview` (served build) reuses the same /api → backend proxy,
    // so visual tests against the build work without CORS.
    preview: {
      host: "127.0.0.1",
      port: Number(frontendPort),
      strictPort: true,
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
      warmup: {
        // Prepare the shell and the two main entry screens before a browser
        // requests their long chains of source modules. Other screens stay lazy.
        clientFiles: [
          "./src/app/main.tsx",
          "./src/features/vault/VaultDashboard.tsx",
          "./src/features/control-center/Dashboard.tsx",
        ],
      },
      watch: {
        // Native macOS uses filesystem events. Docker/bind mounts can opt in
        // with CHOKIDAR_USEPOLLING=true instead of continuously scanning files.
        usePolling: ["true", "1"].includes(
          String(env.CHOKIDAR_USEPOLLING ?? "").trim().toLowerCase(),
        ),
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
