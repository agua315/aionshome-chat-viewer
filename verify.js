'use strict';

// 轻量回归：翻页、搜索、正文编辑、原文备份和冲突检查。
// 测试数据只写入系统临时目录，不接触真实聊天数据库。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { ChatStore } = require('./store');
const { defaultBackupDirectory, normalizeBackupPreferences, saveBackupPreferences, normalizeDisplayPreferences, saveDisplayPreferences } = require('./preferences');
const { render: renderMarkdown } = require('./public/markdown');
const { isSystemMessage, isMonitorScreenshot } = require('./public/message-display');
const { buildFolderPickerScript } = require('./folder-picker');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-viewer-check-'));
const filename = path.join(directory, 'chat.db');
const fixture = new DatabaseSync(filename);
fixture.exec(`
  CREATE TABLE conversations(id TEXT PRIMARY KEY, title TEXT);
  CREATE TABLE messages(id TEXT PRIMARY KEY, conv_id TEXT, role TEXT, content TEXT, created_at REAL, attachments TEXT, reasoning_content TEXT);
  CREATE TABLE chatroom_rooms(id TEXT PRIMARY KEY, title TEXT, type TEXT);
  CREATE TABLE chatroom_messages(id TEXT PRIMARY KEY, room_id TEXT, sender TEXT, content TEXT, created_at REAL, attachments TEXT, reasoning_content TEXT);
  CREATE TABLE sync_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT, entity_type TEXT, entity_id TEXT, payload TEXT, created_at REAL);
  INSERT INTO conversations VALUES ('private', '私聊');
  INSERT INTO chatroom_rooms VALUES ('room', '群聊', 'group');
`);
for (let i = 0; i < 205; i++) {
  // 同时间的 100 条记录跨过每批 80 条边界，可复现旧式时间游标的遗漏。
  const id = 'm' + String(i).padStart(3, '0');
  fixture.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, 'private', 'user', i === 100 ? '原话包含 100%_ 和 [字符]' : '搜索关键词', 1000 + Math.floor(i / 100), '[]', '');
}
fixture.prepare('INSERT INTO chatroom_messages VALUES (?, ?, ?, ?, ?, ?, ?)').run('m100', 'room', 'connor', '搜索关键词', 1001, '[]', '');
fixture.close();
// 本机测试产生的原文备份也放 E 盘。其他电脑可通过环境变量指定测试目录。
const backupRoot = process.env.VIEWER_TEST_BACKUP_ROOT || (fs.existsSync('E:/codex备份') ? 'E:/codex备份' : os.tmpdir());
const backupDirectory = fs.mkdtempSync(path.join(backupRoot, 'chat-viewer-edit-check-'));
const store = new ChatStore(directory, { backupDirectory });
try {
  assert.equal(store.conversations().length, 2);
  const seen = new Set();
  let page = store.messages({ source: 'aion', id: 'private', position: 'first' });
  for (;;) {
    for (const message of page.items) { assert(!seen.has(message.id)); seen.add(message.id); }
    if (!page.hasNewer) break;
    page = store.messages({ source: 'aion', id: 'private', direction: 'newer', cursor: page.lastCursor });
  }
  assert.equal(seen.size, 205);
  seen.clear();
  page = store.messages({ source: 'aion', id: 'private' });
  for (;;) {
    for (const message of page.items) { assert(!seen.has(message.id)); seen.add(message.id); }
    if (!page.hasOlder) break;
    page = store.messages({ source: 'aion', id: 'private', direction: 'older', cursor: page.firstCursor });
  }
  assert.equal(seen.size, 205);
  const around = store.messages({ source: 'aion', id: 'private', anchor: 'm100' });
  assert(around.items.some(m => m.id === 'm100'));
  assert(around.hasOlder && around.hasNewer);
  assert(around.items.some(m => m.id === 'm099') && around.items.some(m => m.id === 'm101'));
  let cursor = null;
  let count = 0;
  const hits = new Set();
  for (;;) {
    const result = store.search({ query: '搜索关键词', cursor });
    for (const item of result.items) { const id = `${item.source}:${item.id}`; assert(!hits.has(id)); hits.add(id); count++; }
    if (!result.hasMore) break;
    cursor = result.nextCursor;
  }
  assert.equal(count, 205);
  assert.equal(store.search({ query: '%_' }).items.length, 1);
  assert.equal(store.search({ query: '[字符]' }).items[0].id, 'm100');
  assert.equal(store.search({ query: '搜索关键词', source: 'room', id: 'room' }).items.length, 1);
  assert.throws(() => store.db.exec('DELETE FROM messages'), /readonly|read-only/i);
  const before = { ...store.db.prepare('SELECT * FROM messages WHERE id = ?').get('m100') };
  const updated = store.updateMessage({ source: 'aion', id: 'private', messageId: 'm100', originalContent: before.content, content: '修改后的原话\n保留换行和空格  ' });
  assert(updated.changed);
  const after = { ...store.db.prepare('SELECT * FROM messages WHERE id = ?').get('m100') };
  assert.deepEqual(after, { ...before, content: updated.message.content });
  assert.equal(JSON.parse(fs.readFileSync(updated.backupFile, 'utf8')).originalRecord.content, before.content);
  const notice = store.db.prepare('SELECT * FROM sync_events WHERE seq = ?').get(updated.syncSeq);
  assert.equal(notice.event_type, 'viewer_message_edited');
  assert.deepEqual(JSON.parse(notice.payload), { source: 'aion', conversationId: 'private', messageId: 'm100' });
  assert.equal(store.search({ query: '修改后的原话' }).items[0].id, 'm100');
  assert.throws(() => store.updateMessage({ source: 'aion', id: 'private', messageId: 'm100', originalContent: before.content, content: '不应覆盖的冲突修改' }), error => error.status === 409);
  assert.equal(store.db.prepare('SELECT content FROM messages WHERE id = ?').get('m100').content, after.content);
  const filesBeforeNoOp = fs.readdirSync(backupDirectory).length;
  assert.equal(store.updateMessage({ source: 'aion', id: 'private', messageId: 'm100', originalContent: after.content, content: after.content }).changed, false);
  assert.equal(fs.readdirSync(backupDirectory).length, filesBeforeNoOp);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM sync_events').get().n, 1);
  // 两张表可以有相同消息 ID；编辑群聊必须只修改群聊中的那条。
  const roomUpdate = store.updateMessage({ source: 'room', id: 'room', messageId: 'm100', originalContent: '搜索关键词', content: '修改群聊正文' });
  assert.equal(roomUpdate.message.content, '修改群聊正文');
  assert.equal(JSON.parse(store.db.prepare('SELECT payload FROM sync_events WHERE seq = ?').get(roomUpdate.syncSeq).payload).source, 'room');
  assert.equal(store.db.prepare('SELECT content FROM messages WHERE id = ?').get('m100').content, after.content);
  assert.throws(() => store.updateMessage({ source: 'aion', id: '错误会话', messageId: 'm100', originalContent: after.content, content: '不能跨会话修改' }));
  const blockedDirectory = path.join(backupDirectory, 'not-a-directory');
  fs.writeFileSync(blockedDirectory, '测试不可用的备份目录');
  const blockedStore = new ChatStore(directory, { backupDirectory: blockedDirectory });
  try {
    assert.throws(() => blockedStore.updateMessage({ source: 'aion', id: 'private', messageId: 'm100', originalContent: after.content, content: '备份失败时不能写入' }), /存档失败/);
    assert.equal(store.db.prepare('SELECT content FROM messages WHERE id = ?').get('m100').content, after.content);
  } finally { blockedStore.close(); }
  const noArchiveStore = new ChatStore(directory, { backupDirectory: blockedDirectory, backupEnabled: false });
  try {
    const fileCount = fs.readdirSync(backupDirectory).length;
    const withoutArchive = noArchiveStore.updateMessage({ source: 'aion', id: 'private', messageId: 'm101', originalContent: '搜索关键词', content: '关闭存档仍能保存' });
    assert.equal(withoutArchive.backupFile, null);
    assert.equal(withoutArchive.message.content, '关闭存档仍能保存');
    assert.equal(fs.readdirSync(backupDirectory).length, fileCount);
    noArchiveStore.setBackupSettings({ enabled: true, directory: backupDirectory });
    const withArchive = noArchiveStore.updateMessage({ source: 'aion', id: 'private', messageId: 'm101', originalContent: withoutArchive.message.content, content: '改到选定目录存档' });
    assert(withArchive.backupFile.startsWith(backupDirectory + path.sep));
    assert(fs.existsSync(withArchive.backupFile));
  } finally { noArchiveStore.close(); }
  const preferenceFile = path.join(directory, 'config.json');
  const preferenceConfig = { dataDirectory: directory, port: 4328 };
  saveBackupPreferences(preferenceFile, preferenceConfig, { enabled: false, directory: backupDirectory });
  assert.equal(JSON.parse(fs.readFileSync(preferenceFile, 'utf8')).backupEnabled, false);
  assert.equal(preferenceConfig.port, 4328);
  // 两种设置交替保存应互不覆盖；重启时仍能读取原来的阅读偏好。
  const display = { mode: 'novel', userSide: 'left', showUserName: false, showUserAvatar: false, showCharacterAvatar: false, hideSystemMessages: true, collapseMonitorScreenshots: true };
  saveDisplayPreferences(preferenceFile, preferenceConfig, display);
  saveBackupPreferences(preferenceFile, preferenceConfig, { enabled: true, directory: backupDirectory });
  const persisted = JSON.parse(fs.readFileSync(preferenceFile, 'utf8'));
  assert.deepEqual(normalizeDisplayPreferences(persisted.displaySettings), display);
  assert.equal(persisted.backupDirectory, backupDirectory);
  assert.equal(persisted.dataDirectory, directory);
  assert.throws(() => normalizeDisplayPreferences({ mode: 'unknown' }), /阅读样式/);
  assert.equal(normalizeDisplayPreferences({ mode: 'novel' }).collapseMonitorScreenshots, true);
  assert.equal(normalizeDisplayPreferences({ mode: 'novel' }).hideSystemMessages, false);
  assert(isSystemMessage({ speaker: 'cam_trigger' }));
  assert(!isSystemMessage({ speaker: 'assistant', content: '我查看了监控' }));
  assert(isMonitorScreenshot('/screenshots/cam_check_123.jpg'));
  assert(isMonitorScreenshot('/uploads/monitor_camera_phone_123.jpg'));
  assert(isMonitorScreenshot('/uploads/old.jpg', null, 'system'));
  assert(isMonitorScreenshot('/uploads/photo.jpg', { type: 'monitor_camera_snapshot' }));
  assert(!isMonitorScreenshot('/uploads/photo.jpg', { type: 'image' }, 'user'));
  const markdown = '# 标题\n\n**粗体**和*斜体*\n\n> 引用\n\n- 第一项\n- 第二项\n\n```js\nconst a = 1;\n```';
  const rendered = renderMarkdown(markdown);
  assert(rendered.includes('<h1>标题</h1>') && rendered.includes('<strong>粗体</strong>') && rendered.includes('<em>斜体</em>'));
  assert(rendered.includes('<blockquote>') && rendered.includes('<ul>') && rendered.includes('<pre><code'));
  assert(renderMarkdown('<img src=x onerror=alert(1)>').includes('&lt;img'));
  assert(!renderMarkdown('[链接](javascript:alert(1))').includes('href='));
  assert.equal(normalizeBackupPreferences({ directory: '' }).directory, defaultBackupDirectory());
  assert(!defaultBackupDirectory().startsWith('E:'));
  assert(buildFolderPickerScript("E:/codex备份/Aion's folder").includes("Aion''s folder"));
  const legacyWriter = new DatabaseSync(filename);
  // 连续大量系统消息跨过整页，过滤后的翻页和搜索仍应完整包含正常对话。
  for (let index = 0; index < 150; index++) {
    legacyWriter.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)').run('system-' + index, 'private', index % 2 ? 'system' : 'cam_trigger', '过滤测试词：系统提示', 4000, '[]', '');
  }
  legacyWriter.prepare('INSERT INTO chatroom_messages VALUES (?, ?, ?, ?, ?, ?, ?)').run('system-room', 'room', 'system', '过滤测试词：系统提示', 4000, '[]', '');
  legacyWriter.prepare('UPDATE messages SET content = ? WHERE id = ?').run('过滤测试词：普通发言提到查看监控', 'm102');
  assert(store.messages({ source: 'aion', id: 'private' }).items.every(isSystemMessage));
  const visibleIds = new Set();
  let filteredPage = store.messages({ source: 'aion', id: 'private', hideSystemMessages: true });
  assert.equal(filteredPage.metadata.count, 205);
  assert.equal(filteredPage.hasNewer, false);
  for (;;) {
    for (const message of filteredPage.items) { assert(!isSystemMessage(message)); assert(!visibleIds.has(message.id)); visibleIds.add(message.id); }
    if (!filteredPage.hasOlder) break;
    filteredPage = store.messages({ source: 'aion', id: 'private', hideSystemMessages: true, direction: 'older', cursor: filteredPage.firstCursor });
  }
  assert.equal(visibleIds.size, 205);
  const hiddenAnchor = store.messages({ source: 'aion', id: 'private', hideSystemMessages: true, anchor: 'system-75' });
  assert(hiddenAnchor.items.length && hiddenAnchor.items.every(message => !isSystemMessage(message)));
  assert.equal(store.messages({ source: 'room', id: 'room', hideSystemMessages: true }).items.length, 1);
  assert.equal(store.search({ query: '过滤测试词', hideSystemMessages: true }).items.length, 1);
  assert.equal(store.search({ query: '过滤测试词', hideSystemMessages: true }).items[0].speaker, 'user');
  assert.equal(store.search({ query: '过滤测试词', hideSystemMessages: false }).hasMore, true);
  legacyWriter.exec('DROP TABLE sync_events');
  legacyWriter.close();
  const independentEdit = store.updateMessage({ source: 'aion', id: 'private', messageId: 'm100', originalContent: after.content, content: '没有同步表也能独立保存' });
  assert(independentEdit.changed);
  assert.equal(independentEdit.syncSeq, null);
  console.log('通过：浏览、搜索、编辑及同步；存档与阅读偏好；系统消息过滤和翻页；监控截图识别；Markdown；冲突保护。');
} finally {
  store.close();
  // 精确删除本次创建的临时文件，不使用递归删除。
  fs.unlinkSync(filename);
  if (fs.existsSync(path.join(directory, 'config.json'))) fs.unlinkSync(path.join(directory, 'config.json'));
  fs.rmdirSync(directory);
  // 这里只删除本测试目录中创建的模拟记录备份，不接触任何真实备份。
  for (const file of fs.readdirSync(backupDirectory)) fs.unlinkSync(path.join(backupDirectory, file));
  fs.rmdirSync(backupDirectory);
}
