import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const proxy = { "/api": "http://127.0.0.1:3001" };
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5174, strictPort: true, proxy },
  preview: { port: 4174, strictPort: true, proxy },
});
