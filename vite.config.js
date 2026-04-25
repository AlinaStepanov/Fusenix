import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "frontend",
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/timeline": "http://localhost:8003",
      "/analyze":  "http://localhost:8003",
      "/sources":  "http://localhost:8003",
      "/health":   "http://localhost:8003",
      "/audit":    "http://localhost:8003",
    },
  },
});