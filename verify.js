'use strict';

// 轻量回归：复合游标、搜索上下文、搜索超过单批上限、以及只读连接。
// 测试数据只写入系统临时目录，不接触真实聊天数据库。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { ChatStore } = require('./store');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-viewer-check-'));
const filename = path.join(directory, 'chat.db');
const fixture = new DatabaseSync(filename);
fixture.exec(`
  CREATE TABLE conversations(id TEXT PRIMARY KEY, title TEXT);
  CREATE TABLE messages(id TEXT PRIMARY KEY, conv_id TEXT, role TEXT, content TEXT, created_at REAL, attachments TEXT, reasoning_content TEXT);
  CREATE TABLE chatroom_rooms(id TEXT PRIMARY KEY, title TEXT, type TEXT);
  CREATE TABLE chatroom_messages(id TEXT PRIMARY KEY, room_id TEXT, sender TEXT, content TEXT, created_at REAL, attachments TEXT, reasoning_content TEXT);
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
const store = new ChatStore(directory);
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
  console.log('通过：两个方向翻页无遗漏；同时间搜索定位及上下文正确；搜索可超过 50 条；特殊字符匹配；数据库只读。');
} finally {
  store.close();
  // 精确删除本次创建的临时文件，不使用递归删除。
  fs.unlinkSync(filename);
  fs.rmdirSync(directory);
}
