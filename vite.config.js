import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// All top-level paths that should be forwarded to the FastAPI backend.
// Add new route prefixes here as the API grows.
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

// Override with VITE_BACKEND_URL env var if the backend runs on a different port.
const proxyTarget = process.env.VITE_BACKEND_URL || "http://localhost:8000";

export default defineConfig({
  root: "frontend",
  plugins: [react()],
  server: {
    port: 3000,
    proxy: Object.fromEntries(
      API_PATHS.map((path) => [
        path,
        { target: proxyTarget, changeOrigin: true, secure: false },
      ])
    ),
  },
});
