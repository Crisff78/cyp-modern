import { defineConfig, mergeConfig } from "vite";
import baseConfig from "./vite.config.ts";

const demoApi = "http://127.0.0.1:3012";

export default mergeConfig(baseConfig, defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5384,
    strictPort: true,
    proxy: { "/api": demoApi },
  },
  preview: {
    host: "127.0.0.1",
    port: 5384,
    strictPort: true,
    proxy: { "/api": demoApi },
  },
}));
