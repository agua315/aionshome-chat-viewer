'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function defaultBackupDirectory() {
  // 使用每台电脑自己的用户目录，不依赖特定盘符或开发者电脑的目录。
  return path.join(os.homedir(), 'Documents', 'AionsHome聊天记录存档');
}

function normalizeBackupPreferences({ enabled = true, directory = '' } = {}) {
  if (typeof enabled !== 'boolean') throw new Error('请选择是否在编辑前存档');
  if (typeof directory !== 'string') throw new Error('存档目录格式不正确');
  const selected = directory.trim();
  if (selected && !path.isAbsolute(selected)) throw new Error('请输入完整的绝对路径，或点击“选择文件夹”');
  return { enabled, directory: selected ? path.resolve(selected) : defaultBackupDirectory() };
}

function writePreferences(filename, config, changes) {
  const next = { ...config, ...changes };
  // 先完整写入临时文件再替换，避免中途关闭留下半截配置；保留其他配置字段。
  const temporary = filename + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', 'utf8');
    fs.renameSync(temporary, filename);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw new Error('设置保存失败，请检查程序目录是否可以写入', { cause: error });
  }
  Object.assign(config, next);
}

function saveBackupPreferences(filename, config, settings) {
  const normalized = normalizeBackupPreferences(settings);
  writePreferences(filename, config, { backupEnabled: normalized.enabled, backupDirectory: normalized.directory });
  return normalized;
}

function normalizeDisplayPreferences({ mode = 'plain', userSide = 'right', showUserName = true, showUserAvatar = true, showCharacterAvatar = true, hideSystemMessages = false, collapseMonitorScreenshots = true } = {}) {
  if (!['plain', 'markdown', 'novel'].includes(mode)) throw new Error('请选择有效的阅读样式');
  if (!['left', 'right'].includes(userSide)) throw new Error('请选择你的发言位置');
  if ([showUserName, showUserAvatar, showCharacterAvatar, hideSystemMessages, collapseMonitorScreenshots].some(value => typeof value !== 'boolean')) throw new Error('请选择有效的显示选项');
  // 仅保存显示选项，切换阅读样式不会改写数据库中的原始 Markdown。
  return { mode, userSide, showUserName, showUserAvatar, showCharacterAvatar, hideSystemMessages, collapseMonitorScreenshots };
}

function saveDisplayPreferences(filename, config, settings) {
  const normalized = normalizeDisplayPreferences(settings);
  writePreferences(filename, config, { displaySettings: normalized });
  return normalized;
}

module.exports = { defaultBackupDirectory, normalizeBackupPreferences, saveBackupPreferences, normalizeDisplayPreferences, saveDisplayPreferences, writePreferences };
