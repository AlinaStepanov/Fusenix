import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// All paths that should be forwarded to the FastAPI backend (localhost:8000).
// Add new top-level route prefixes here as the API grows.
const API_PATHS = [
  "/timeline",
  "/analyze",
  "/sources",
  "/health",
  "/audit",
  "/services",
  "/oncall",
  "/incidents",
  "/discover",
  "/github",
];

const proxyTarget = process.env.VITE_BACKEND_URL || "http://localhost:8000";

const proxyEntries = Object.fromEntries(
  API_PATHS.map((path) => [
    path,
    {
      target: proxyTarget,
      changeOrigin: true,
      secure: false,
    },
  ])
);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: proxyEntries,
  },
});
