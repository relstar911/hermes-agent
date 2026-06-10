import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const BACKEND = "http://127.0.0.1:9119";

export default defineConfig({
  plugins: [react()],
  base: "/eden/",
  build: { outDir: "../hermes_cli/eden_dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": { target: BACKEND, ws: true },
    },
  },
  test: { environment: "jsdom" },
});
