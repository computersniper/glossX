import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The built SPA is served by the FastAPI backend from ../backend (frontend/dist).
// In dev, proxy API + PDF file routes to the backend on :8010.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8010", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
