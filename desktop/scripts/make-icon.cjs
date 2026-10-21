'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require(path.resolve(__dirname, '../../node_modules/sharp'));

async function makeIcon() {
  const desktopRoot = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.resolve(desktopRoot, '../public/favicon.svg'));
  const assets = path.join(desktopRoot, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of sizes) {
    images.push(await sharp(source, { density: 576 }).resize(size, size).ensureAlpha().png({ compressionLevel: 9 }).toBuffer());
  }
  // Windows ICO can contain PNG frames. The zero dimension byte represents 256px.
  const directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  for (let index = 0; index < sizes.length; index++) {
    const entry = 6 + index * 16;
    directory[entry] = sizes[index] === 256 ? 0 : sizes[index];
    directory[entry + 1] = directory[entry];
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(images[index].length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  }
  const ico = Buffer.concat([directory, ...images]);
  if (ico.length !== offset || ico.readUInt16LE(2) !== 1) throw new Error('ICO目录封装失败');
  const icoPath = path.join(assets, 'icon.ico');
  const pngPath = path.join(assets, 'icon.png');
  fs.writeFileSync(icoPath, ico);
  fs.writeFileSync(pngPath, images.at(-1));
  const metadata = await sharp(pngPath).metadata();
  if (metadata.width !== 256 || metadata.height !== 256 || !metadata.hasAlpha) throw new Error('PNG图标校验失败');
  process.stdout.write(JSON.stringify({ ico: icoPath, png: pngPath, sizes, icoBytes: ico.length, pngBytes: images.at(-1).length }) + '\n');
}

makeIcon().catch(error => { console.error(error); process.exitCode = 1; });
