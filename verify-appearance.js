'use strict';

// 外观保存只检查独立临时配置和一张小图片，不接触真实聊天记录或本机外观。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const appearance = require('./public/appearance-config');
const { saveAppearancePreferences, saveBackground, backgroundFile } = require('./appearance-store');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-appearance-check-'));
const filename = path.join(directory, 'config.json');
const config = { dataDirectory: 'keep-chat-directory', phoneAccess: { secret: 'test-only-secret' }, backupEnabled: false };
let imageFile;
try {
  const settings = appearance.defaults();
  assert.equal(appearance.themes.length, 5);
  assert(settings.presets[0].css.includes('09｜角色气泡'));
  assert(settings.presets[0].css.includes('17｜手机排版'));
  settings.presets.push({ id: 'custom', name: '我的气泡', css: '.bubble { border-radius: 25px; }' });
  settings.theme = 'mist'; settings.customCssEnabled = true; settings.activePresetId = 'custom';
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1x8AAAAASUVORK5CYII=', 'base64');
  const imageUrl = saveBackground(directory, image);
  imageFile = backgroundFile(directory, imageUrl);
  assert.equal(saveBackground(directory, image), imageUrl);
  assert.equal(fs.readdirSync(path.dirname(imageFile)).length, 1);
  settings.background = { image: imageUrl, name: '测试图片.png', fit: 'contain', opacity: 60 };
  const result = saveAppearancePreferences(filename, config, settings);
  const persisted = JSON.parse(fs.readFileSync(filename, 'utf8'));
  assert.deepEqual(persisted.appearanceSettings, result);
  assert.equal(result.presets.length, 2);
  assert.equal(result.activePresetId, 'custom');
  assert.equal(result.background.image, imageUrl);
  assert.equal(persisted.phoneAccess.secret, 'test-only-secret');
  assert.equal(persisted.dataDirectory, 'keep-chat-directory');
  assert.equal(persisted.backupEnabled, false);
  result.customCssEnabled = false;
  saveAppearancePreferences(filename, config, result);
  assert.equal(config.appearanceSettings.presets[1].css, '.bubble { border-radius: 25px; }');
  assert.throws(() => appearance.normalize({ ...settings, presets: [settings.presets[0], settings.presets[0]] }), /重复/);
  assert.throws(() => saveBackground(directory, Buffer.from('not an image')), /图片/);
  assert.throws(() => backgroundFile(directory, '/api/appearance/background/../config.json'), /无效/);
  console.log('通过：五套主题、注释模板、多份 CSS 保存与切换、背景上传去重、原有配置保留。');
} finally {
  if (fs.existsSync(filename)) fs.unlinkSync(filename);
  if (imageFile && fs.existsSync(imageFile)) {
    fs.unlinkSync(imageFile); fs.rmdirSync(path.dirname(imageFile)); fs.rmdirSync(path.join(directory, 'user-data'));
  }
  fs.rmdirSync(directory);
}
