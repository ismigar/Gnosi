import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const backendPort = env.VITE_BACKEND_PORT || "5002";
  const frontendPort = env.VITE_FRONTEND_PORT || "5173";
  return {
    plugins: [react()],
    base: env.VITE_BASE_PATH || "./",
    server: {
      watch: {
        usePolling: true,
      },
      host: true, // Ensure it listens on 0.0.0.0
      port: Number(frontendPort),
      proxy: {
        "/api": {
          target: `http://${env.VITE_BACKEND_HOST || "localhost"}:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
