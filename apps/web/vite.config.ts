import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../../packages/shared/src")
    }
  },
  server: {
    port: 4173,
    proxy: {
      "/session": "http://localhost:4318",
      "/wan": "http://localhost:4318"
    },
    fs: {
      allow: [path.resolve(__dirname, "../../")]
    }
  },
  build: {
    outDir: "./dist",
    emptyOutDir: true
  }
});
