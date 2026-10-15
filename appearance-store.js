'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalize } = require('./public/appearance-config');
const { writePreferences } = require('./preferences');

function saveAppearancePreferences(filename, config, settings) {
  const normalized = normalize(settings);
  // 与现有设置共用原子保存，保留数据目录、访问码、存档选项等其他配置。
  writePreferences(filename, config, { appearanceSettings: normalized });
  return normalized;
}

function imageExtension(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return 'gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (bytes.subarray(4, 8).toString('ascii') === 'ftyp' && /avif|avis/.test(bytes.subarray(8, 32).toString('ascii'))) return 'avif';
  throw new Error('请选择 PNG、JPG、WebP、GIF 或 AVIF 图片');
}

function saveBackground(root, bytes) {
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('背景图片请选择 20 MB 以内的文件');
  const extension = imageExtension(bytes);
  // 背景属于查看器自己的用户数据；按内容命名，同一张图片不会重复占空间。
  const name = crypto.createHash('sha256').update(bytes).digest('hex') + '.' + extension;
  const directory = path.join(root, 'user-data', 'backgrounds');
  fs.mkdirSync(directory, { recursive: true });
  try { fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return '/api/appearance/background/' + name;
}

function backgroundFile(root, pathname) {
  const match = /^\/api\/appearance\/background\/([a-f0-9]{64}\.(?:png|jpg|webp|gif|avif))$/.exec(pathname);
  if (!match) throw new Error('背景图片地址无效');
  return path.join(root, 'user-data', 'backgrounds', match[1]);
}

module.exports = { saveAppearancePreferences, saveBackground, backgroundFile, imageExtension };
