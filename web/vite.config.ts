import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

// SharedArrayBuffer requires cross-origin isolation. Vite dev server
// honors these headers when serving locally; production deployment
// relies on `public/_headers` for Cloudflare Pages.
const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  // basic-ssl serves a self-signed certificate so LAN devices (Android,
  // iPad) can reach the dev server over HTTPS — required because
  // `crossOriginIsolated` (and therefore SharedArrayBuffer) only
  // unlocks inside a secure context, and `localhost` doesn't help when
  // browsing from another machine.
  plugins: [react(), basicSsl()],
  server: {
    host: "0.0.0.0",
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    host: "0.0.0.0",
    headers: crossOriginIsolationHeaders,
  },
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  optimizeDeps: {
    exclude: ["pyodide"],
  },
});
