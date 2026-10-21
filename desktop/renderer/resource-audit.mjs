import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { imageSchema, homeImageSchema, defaultSettings } from "../../lib/domain.ts";

const renderer = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(renderer, "../..");
const built = path.resolve(renderer, "../renderer-dist");
const read = filename => fs.readFileSync(filename, "utf8");
const files = fs.readdirSync(path.join(built, "assets")).map(name => path.join(built, "assets", name));
const html = read(path.join(built, "index.html"));
const styles = files.filter(name => name.endsWith(".css")).map(read).join("\n");
const script = files.filter(name => name.endsWith(".js")).map(read).join("\n");

const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
for (const reference of references) {
  assert.ok(reference.startsWith("/") && !reference.startsWith("//"), `HTML引用须为本机路径：${reference}`);
  assert.ok(fs.existsSync(path.join(built, reference.slice(1))), `缺少打包资源：${reference}`);
}
for (const image of [defaultSettings.home.image, "/ring.jpg", "/favicon.svg"]) {
  assert.ok(image.startsWith("/"), "默认图片须为本机资源");
  assert.ok(fs.statSync(path.join(built, image.slice(1))).size > 0, `默认图片未打包：${image}`);
}
assert.equal(fs.readFileSync(path.join(built, "home-necklace.png")).subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "首页图应是有效PNG");
assert.equal(fs.readFileSync(path.join(built, "ring.jpg")).subarray(0, 3).toString("hex"), "ffd8ff", "默认珠宝图应是JPEG");
assert.ok(!/@import\s+(?:url\()?['"]?https?:/i.test(styles), "CSS不得远程加载");
assert.ok(!/url\(\s*['"]?(?:https?:)?\/\//i.test(styles), "CSS图片和字体不得依赖网络");
assert.ok(!styles.includes("@font-face"), "界面应使用本机系统字体");
assert.ok(styles.includes("aspect-ratio:9/16"), "9:16报价图样式须打包");
assert.ok(/@page\s*\{[^}]*size:A4/i.test(styles), "A4打印纸张样式须打包");
assert.ok(styles.includes(".a4-print-root") && styles.includes(".quote-paper"), "两套报价版式均须打包");

const sourceNames = ["workspace.tsx", "main.tsx", "a4-quotation.tsx", "bridge.ts"];
const source = sourceNames.map(name => read(path.join(renderer, name))).join("\n");
assert.ok(!/\bfetch\s*\(|new\s+(?:XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(source), "桌面业务不得发起网络请求");
assert.ok(!/signin-with-chatgpt|signout-with-chatgpt|type="email"|登录邮箱/.test(source), "桌面不得展示在线登录入口");
for (const section of ["home", "sales", "custom", "tradein", "recycling", "repairs", "gallery", "customers", "history", "settings"]) assert.ok(script.includes(section), `缺少业务页面：${section}`);
assert.ok(script.includes("1080") && script.includes("1920"), "报价图片应保留1080×1920绘制");
assert.ok(script.includes("jewelryDesktop"), "桌面业务应通过本机桥调用");

for (const url of ["https://example.com/jewel.jpg", "http://example.com/font.woff2", "//example.com/jewel.jpg"]) {
  assert.equal(imageSchema.safeParse(url).success, false, "报价图片不得接受互联网链接");
  assert.equal(homeImageSchema.safeParse(url).success, false, "首页图片不得接受互联网链接");
}
assert.equal(homeImageSchema.safeParse("/home-necklace.png").success, true);
assert.equal(imageSchema.safeParse("/api/images/00000000-0000-0000-0000-000000000000").success, true);

const shared = ["components/home-studio.tsx", "components/media-gallery.tsx", "components/quote-card.tsx", "components/a4-quotation.tsx", "lib/quote-image.ts", "app/globals.css", "components/quote-paper.css", "components/studio-sections.css", "components/a4-quotation.css"];
for (const name of shared) {
  assert.ok(!/https?:\/\/|\bfetch\s*\(|@font-face/.test(read(path.join(project, name))), `共享界面不应依赖网络：${name}`);
}

const externalLiterals = [...new Set([...script.matchAll(/https?:\/\/[^\s"'`<>\\]+/g)].map(match => match[0]))];
const allowed = /^(?:https?:\/\/(?:www\.)?w3\.org\/|https:\/\/react\.dev\/errors\/)/;
for (const literal of externalLiterals) assert.ok(allowed.test(literal), `发现待审核的外部字符串：${literal}`);

process.stdout.write(JSON.stringify({
  result: "PASS", htmlResources: references, localImages: ["home-necklace.png", "ring.jpg"],
  businessPages: 10, imageSize: "1080x1920", printSize: "A4", networkRequests: 0,
  remoteFonts: 0, nonRequestNamespaceOrDiagnostics: externalLiterals,
}, null, 2) + "\n");
