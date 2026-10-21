import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./renderer", import.meta.url)),
  base: "/",
  publicDir: fileURLToPath(new URL("../public", import.meta.url)),
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("..", import.meta.url)) } },
  css: { postcss: fileURLToPath(new URL("..", import.meta.url)) },
  build: { outDir: fileURLToPath(new URL("./renderer-dist", import.meta.url)), emptyOutDir: true },
});
