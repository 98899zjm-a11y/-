import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL("./renderer", import.meta.url)),
  base: "/",
  publicDir: fileURLToPath(new URL("../public", import.meta.url)),
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("..", import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss({ base: fileURLToPath(new URL("..", import.meta.url)) })] } },
  build: { target: ["chrome108", "safari15.4"], outDir: fileURLToPath(new URL("./dist", import.meta.url)), emptyOutDir: true },
});
