import { execFileSync } from "node:child_process";
import { buildInfoFromGit } from "../shared/buildInfo";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// When this version was published (shown beside the version, see shared/buildInfo.ts). Render gives its commit.
const build = buildInfoFromGit((args) => execFileSync("git", args, { encoding: "utf8" }), process.env.RENDER_GIT_COMMIT);

const proxy = { "/api": "http://127.0.0.1:3001" };
export default defineConfig({
  base: process.env.CYP_PUBLIC_DEMO === "true" ? "/collector/" : "/",
  resolve: { dedupe: ["react", "react-dom"] },
  plugins: [react(), tailwindcss()],
  define: { __CYP_BUILD__: JSON.stringify(build) },
  server: { host: "127.0.0.1", port: 5174, strictPort: true, proxy },
  preview: { port: 4174, strictPort: true, proxy },
});
