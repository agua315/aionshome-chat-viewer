'use strict';

// 轻量检查成稿筛选、章节顺序、搜索定位；所有数据均为临时虚构记录。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { ChatStore } = require('./store');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-theater-check-'));
const filename = path.join(directory, 'chat.db');
const fixture = new DatabaseSync(filename);
fixture.exec(`
  CREATE TABLE conversations(id TEXT PRIMARY KEY, title TEXT);
  CREATE TABLE messages(id TEXT PRIMARY KEY, conv_id TEXT, role TEXT, content TEXT, created_at REAL, attachments TEXT, reasoning_content TEXT);
  CREATE TABLE chatroom_rooms(id TEXT PRIMARY KEY, title TEXT, type TEXT);
  CREATE TABLE chatroom_messages(id TEXT PRIMARY KEY, room_id TEXT, sender TEXT, content TEXT, created_at REAL, attachments TEXT, reasoning_content TEXT);
  CREATE TABLE theater_conversations(id TEXT PRIMARY KEY, title TEXT, created_at REAL, updated_at REAL);
  CREATE TABLE theater_studio(id TEXT PRIMARY KEY, kind TEXT, conv_id TEXT, data TEXT);
  INSERT INTO conversations VALUES ('chat', '测试聊天');
  INSERT INTO messages VALUES ('chat-message', 'chat', 'assistant', '正文关键词', 1000, '[]', '');
  INSERT INTO theater_conversations VALUES ('story', '测试故事', 1000, 2000), ('outline-only', '尚未写作的故事', 1000, 2000);
`);
const insert = fixture.prepare('INSERT INTO theater_studio VALUES (?, ?, ?, ?)');
for (let number = 1; number <= 12; number++) {
  insert.run('chapter-' + String(20 - number).padStart(2, '0'), 'chapter', 'story', JSON.stringify({
    number, title: '测试章节' + number, status: number % 2 ? 'ready' : 'draft',
    content: '正文关键词，100%_；第' + number + '章。', plan: '只在大纲出现的词', summary: '只在摘要出现的词',
    images: [{ status: 'ready', url: '/uploads/test.png', after: 3 }, { status: 'pending', url: '/uploads/pending.png' }],
    versions: [{ content: '只在旧版出现的词' }],
  }));
}
for (const status of ['planned', 'writing', 'interrupted']) {
  insert.run(status, 'chapter', 'story', JSON.stringify({ number: 13, title: '未完成', status, content: '未完成关键词' }));
}
insert.run('empty', 'chapter', 'story', JSON.stringify({ number: 14, status: 'ready', content: '  ' }));
insert.run('broken', 'chapter', 'story', '{');
insert.run('book', 'book', 'story', JSON.stringify({ outline: '只在大纲出现的词', content: '非章节关键词' }));
insert.run('discussion', 'discussion', 'story', JSON.stringify({ content: '非章节关键词' }));
insert.run('outline-only', 'chapter', 'outline-only', JSON.stringify({ number: 1, status: 'planned', plan: '大纲' }));
fixture.close();
const store = new ChatStore(directory, { backupEnabled: false });
try {
  assert.equal(store.info().counts.theater, 12);
  const stories = store.conversations().filter(c => c.kind === 'theater');
  assert.equal(stories.length, 1);
  assert.equal(stories[0].count, 12);
  let page = store.messages({ source: 'theater', id: 'story', position: 'first', limit: 3, hideSystemMessages: true });
  // 仅加载前三章正文时，目录仍包含所有十二章，并且不复制大纲或正文。
  assert.deepEqual(page.metadata.chapters.map(chapter => chapter.chapter_number), Array.from({ length: 12 }, (_, i) => i + 1));
  assert(page.metadata.chapters.every(chapter => Object.keys(chapter).sort().join(',') === 'chapter_number,chapter_title,id'));
  const chosen = page.metadata.chapters[10];
  const chosenPage = store.messages({ source: 'theater', id: 'story', anchor: chosen.id, limit: 3 });
  assert(chosenPage.items.some(chapter => chapter.id === chosen.id && chapter.chapter_number === 11));
  assert.deepEqual(store.messages({ source: 'theater', id: 'outline-only' }).metadata.chapters, []);
  const numbers = [];
  for (;;) {
    numbers.push(...page.items.map(item => item.chapter_number));
    if (!page.hasNewer) break;
    page = store.messages({ source: 'theater', id: 'story', direction: 'newer', cursor: page.lastCursor, limit: 3 });
  }
  assert.deepEqual(numbers, Array.from({ length: 12 }, (_, i) => i + 1));
  page = store.messages({ source: 'theater', id: 'story', position: 'latest', limit: 3 });
  assert.deepEqual(page.items.map(item => item.chapter_number), [10, 11, 12]);
  page = store.messages({ source: 'theater', id: 'story', direction: 'older', cursor: page.firstCursor, limit: 3 });
  assert.deepEqual(page.items.map(item => item.chapter_number), [7, 8, 9]);
  const anchor = store.messages({ source: 'theater', id: 'story', anchor: 'chapter-14', limit: 4 });
  assert.deepEqual(anchor.items.map(item => item.chapter_number), [4, 5, 6, 7, 8]);
  assert.equal(anchor.items[2].readOnly, true);
  assert.deepEqual(anchor.items[2].illustrations, [{ url: '/uploads/test.png', after: 3 }]);
  let cursor = null;
  const hits = [];
  do {
    const result = store.search({ query: '%_', kind: 'theater', limit: 4, cursor, hideSystemMessages: true });
    hits.push(...result.items);
    cursor = result.hasMore ? result.nextCursor : null;
  } while (cursor);
  assert.equal(hits.length, 12);
  assert.equal(new Set(hits.map(item => item.id)).size, 12);
  assert.equal(store.search({ query: '正文关键词', source: 'theater', id: 'story' }).items.length, 12);
  assert.equal(store.search({ query: '正文关键词' }).items.length, 13);
  for (const query of ['只在大纲出现的词', '只在摘要出现的词', '只在旧版出现的词', '非章节关键词', '未完成关键词']) {
    assert.equal(store.search({ query }).items.length, 0);
  }
  assert.throws(() => store.updateMessage({ source: 'theater', id: 'story', messageId: 'chapter-14', content: '不写入', originalContent: anchor.items[2].content }), /仅供阅读/);
  console.log('小剧场检查通过：完整章节目录、选章定位、仅成稿、章节排序与翻页、正文搜索与定位、插图、只读。');
} finally {
  store.close();
  // 删除本次明确创建的单个测试数据库，再删除空目录，不递归删除其他路径。
  fs.unlinkSync(filename);
  fs.rmdirSync(directory);
}
