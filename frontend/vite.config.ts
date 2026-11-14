import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      // Editor/agent temp folders can be locked briefly on Windows and would
      // otherwise crash the watcher with EBUSY.
      ignored: ["**/*.tmpdir/**", "**/.*.tmpdir/**"],
    },
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
