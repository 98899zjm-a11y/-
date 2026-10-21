import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root:fileURLToPath(new URL(".",import.meta.url)), base:"/print-test/",
  publicDir:fileURLToPath(new URL("../../public",import.meta.url)), plugins:[react()],
  resolve:{alias:{"@":fileURLToPath(new URL("../..",import.meta.url))}},
  css:{postcss:fileURLToPath(new URL("../..",import.meta.url))},
  build:{outDir:"E:/codex/2026-10-10/ce/work/warranty-template/preview",emptyOutDir:true,rollupOptions:{input:fileURLToPath(new URL("./warranty-fixture.html",import.meta.url))}},
});
