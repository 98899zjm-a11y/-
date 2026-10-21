'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require(path.resolve(__dirname, '../../node_modules/sharp'));

const mobileRoot = path.resolve(__dirname, '..');
const assetsRoot = path.join(mobileRoot, 'assets');
const sourcePath = path.resolve(mobileRoot, '../public/favicon.svg');
const source = fs.readFileSync(sourcePath, 'utf8');
const diamondPath = source.match(/<path[^>]+d="([^"]+)"/)[1];
const gold = '#8a7655';
const white = '#ffffff';
const records = [];

function write(relative, contents) {
  const target = path.join(assetsRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

function diamondSvg(size, adaptive = false) {
  const viewport = adaptive ? 108 : 40;
  const diamond = `<path d="${diamondPath}" fill="none" stroke="${gold}" stroke-width="1.2"/>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${viewport} ${viewport}">${adaptive ? `<g transform="translate(14 14) scale(2)">${diamond}</g>` : `<rect width="40" height="40" fill="${white}"/>${diamond}`}</svg>`);
}

async function png(relative, svg, width, height, opaque = true) {
  let pipeline = sharp(svg).resize(width, height);
  pipeline = opaque ? pipeline.flatten({ background: white }).removeAlpha() : pipeline.ensureAlpha();
  const buffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  const target = write(relative, buffer);
  const metadata = await sharp(buffer).metadata();
  if (metadata.width !== width || metadata.height !== height || (opaque && metadata.hasAlpha)) {
    throw new Error(`Invalid mobile brand PNG: ${relative}`);
  }
  records.push({ file: relative, width, height, opaque, bytes: buffer.length });
  return target;
}

function splashSvg(width, height) {
  const unit = Math.min(width, height);
  const iconSize = unit * 0.24;
  const iconLeft = (width - iconSize) / 2;
  const iconTop = height / 2 - iconSize * 0.84;
  const fontSize = Math.round(unit * 0.07);
  const labelY = height / 2 + iconSize * 0.69;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${white}"/><g transform="translate(${iconLeft} ${iconTop}) scale(${iconSize / 40})"><path d="${diamondPath}" fill="none" stroke="${gold}" stroke-width="1.2"/></g><text x="${width / 2}" y="${labelY}" text-anchor="middle" font-family="SimSun, Noto Serif CJK SC, serif" font-size="${fontSize}" letter-spacing="${fontSize * 0.12}" fill="${gold}">鑫金源</text></svg>`);
}

function copyTree(sourceDir, destinationDir) {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const from = path.join(sourceDir, entry.name);
    const to = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyTree(from, to);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}

async function main() {
  await png('icon-192.png', diamondSvg(192), 192, 192);
  await png('icon-512.png', diamondSvg(512), 512, 512);
  await png('android/adaptive-foreground-192.png', diamondSvg(192, true), 192, 192, false);
  await png('android/adaptive-foreground-512.png', diamondSvg(512, true), 512, 512, false);
  await png('android/adaptive-background-512.png', Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="${white}"/></svg>`), 512, 512);

  const densities = [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]];
  for (const [density, size, foregroundSize] of densities) {
    const regular = await png(`android/res/mipmap-${density}/ic_launcher.png`, diamondSvg(size), size, size);
    write(`android/res/mipmap-${density}/ic_launcher_round.png`, fs.readFileSync(regular));
    await png(`android/res/mipmap-${density}/ic_launcher_foreground.png`, diamondSvg(foregroundSize, true), foregroundSize, foregroundSize, false);
  }
  write('android/res/values/ic_launcher_background.xml', `<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">${white}</color></resources>\n`);
  const vector = `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108"><group android:translateX="14" android:translateY="14" android:scaleX="2" android:scaleY="2"><path android:pathData="${diamondPath}" android:fillColor="#00000000" android:strokeColor="${gold}" android:strokeWidth="1.2"/></group></vector>\n`;
  write('android/res/drawable/ic_launcher_foreground.xml', vector);
  // The stock template includes this qualified file, so replace its glyph too.
  write('android/res/drawable-v24/ic_launcher_foreground.xml', vector);
  write('android/res/drawable/ic_launcher_monochrome.xml', vector.replace(gold, '#000000'));
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    write(`android/res/mipmap-anydpi-v26/${name}.xml`, `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@drawable/ic_launcher_foreground"/></adaptive-icon>\n`);
    write(`android/res/mipmap-anydpi-v33/${name}.xml`, `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@drawable/ic_launcher_foreground"/><monochrome android:drawable="@drawable/ic_launcher_monochrome"/></adaptive-icon>\n`);
  }

  await png('splash-1080x1920.png', splashSvg(1080, 1920), 1080, 1920);
  await png('android/res/drawable/splash.png', splashSvg(1080, 1920), 1080, 1920);
  const splashes = [['mdpi', 320, 480], ['hdpi', 480, 800], ['xhdpi', 720, 1280], ['xxhdpi', 960, 1600], ['xxxhdpi', 1280, 1920]];
  for (const [density, width, height] of splashes) {
    await png(`android/res/drawable-port-${density}/splash.png`, splashSvg(width, height), width, height);
    await png(`android/res/drawable-land-${density}/splash.png`, splashSvg(height, width), height, width);
  }

  const icons = [
    ['iphone', 20, 2], ['iphone', 20, 3], ['iphone', 29, 2], ['iphone', 29, 3],
    ['iphone', 40, 2], ['iphone', 40, 3], ['iphone', 60, 2], ['iphone', 60, 3],
    ['ipad', 20, 1], ['ipad', 20, 2], ['ipad', 29, 1], ['ipad', 29, 2],
    ['ipad', 40, 1], ['ipad', 40, 2], ['ipad', 76, 1], ['ipad', 76, 2],
    ['ipad', 83.5, 2], ['ios-marketing', 1024, 1],
  ];
  const iconImages = [];
  for (const [idiom, points, scale] of icons) {
    const size = Math.round(points * scale);
    const filename = `AppIcon-${idiom}-${points}@${scale}x.png`;
    await png(`ios/AppIcon.appiconset/${filename}`, diamondSvg(size), size, size);
    iconImages.push({ idiom, size: `${points}x${points}`, scale: `${scale}x`, filename });
  }
  write('ios/AppIcon.appiconset/Contents.json', JSON.stringify({ images: iconImages, info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
  const iosSplash = await png('ios/Splash.imageset/splash-2732x2732.png', splashSvg(2732, 2732), 2732, 2732);
  for (const scale of [2, 3]) write(`ios/Splash.imageset/splash-2732x2732-${scale}.png`, fs.readFileSync(iosSplash));
  write('ios/Splash.imageset/Contents.json', JSON.stringify({ images: [1, 2, 3].map(scale => ({ idiom: 'universal', filename: scale === 1 ? 'splash-2732x2732.png' : `splash-2732x2732-${scale}.png`, scale: `${scale}x` })), info: { author: 'xcode', version: 1 } }, null, 2) + '\n');

  const copied = [];
  if (process.argv.includes('--copy-native')) {
    const androidResources = path.join(mobileRoot, 'android/app/src/main/res');
    if (fs.existsSync(androidResources)) {
      copyTree(path.join(assetsRoot, 'android/res'), androidResources);
      copied.push(androidResources);
    }
    const iosCatalog = path.join(mobileRoot, 'ios/App/App/Assets.xcassets');
    if (fs.existsSync(iosCatalog)) {
      copyTree(path.join(assetsRoot, 'ios'), iosCatalog);
      copied.push(iosCatalog);
    }
  }
  write('asset-manifest.json', JSON.stringify({ source: 'public/favicon.svg', label: '鑫金源', colors: { background: white, diamond: gold }, generated: records, nativeCopies: copied }, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ assets: assetsRoot, pngsValidated: records.length, copied }) + '\n');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
