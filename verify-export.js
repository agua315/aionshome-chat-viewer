'use strict';

// 只用虚构记录检查导出范围与格式，不修改或导出真实聊天数据。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { ChatStore } = require('./store');
const { collectExport, summarizeExport } = require('./export-data');
const { createExport, prepareDocument, paginate } = require('./export-files');
const JSZip = require('./vendor/jszip.cjs');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-export-check-'));
  const databasePath = path.join(directory, 'chat.db');
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE conversations(id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE messages(id TEXT PRIMARY KEY, conv_id TEXT, role TEXT, content TEXT, created_at REAL, attachments TEXT, reasoning_content TEXT);
    CREATE TABLE chatroom_rooms(id TEXT PRIMARY KEY, title TEXT, type TEXT);
    CREATE TABLE chatroom_messages(id TEXT PRIMARY KEY, room_id TEXT, sender TEXT, content TEXT, created_at REAL, attachments TEXT, reasoning_content TEXT);
    CREATE TABLE theater_conversations(id TEXT PRIMARY KEY, title TEXT, created_at REAL, updated_at REAL);
    CREATE TABLE theater_studio(id TEXT PRIMARY KEY, kind TEXT, conv_id TEXT, data TEXT);
    INSERT INTO conversations VALUES ('chat', '留在书页里的对话'), ('other', '另一个会话');
    INSERT INTO chatroom_rooms VALUES ('room', '群聊记录', 'group');
    INSERT INTO theater_conversations VALUES ('story', '雨后的书店', 1000, 2000);
  `);
  const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (let index = 0; index < 650; index++) insert.run(`m${String(index).padStart(4, '0')}`, 'chat', index % 2 ? 'user' : 'assistant', index < 603 ? `共同关键词 · 第 ${index} 条完整原文` : `普通对话 ${index}`, 1000 + Math.floor(index / 2), '[]', index === 0 ? '测试思考内容' : '');
  insert.run('system', 'chat', 'system', '共同关键词 · 查看监控', 1001, JSON.stringify([{ type: 'monitor_camera_snapshot', url: '/screenshots/test.png' }]), '');
  insert.run('other', 'other', 'assistant', '共同关键词 · 另一个窗口', 1001, '[]', '');
  db.prepare('INSERT INTO chatroom_messages VALUES (?, ?, ?, ?, ?, ?, ?)').run('m0000', 'room', 'connor', '共同关键词 · 群聊同名 ID', 1001, '[]', '');
  const chapter = db.prepare('INSERT INTO theater_studio VALUES (?, ?, ?, ?)');
  for (let index = 1; index <= 12; index++) chapter.run(`chapter${index}`, 'chapter', 'story', JSON.stringify({ status: index % 2 ? 'ready' : 'draft', number: index, title: `第 ${index} 次相遇`, content: `**共同关键词**\n\n雨落在窗边，书页还留着余温。\n\n“下次一起把这本书看完吧。”\n\n第 ${index} 章的最后一句。`, images: index === 2 ? [{ status: 'ready', url: '/uploads/test.png', after: 20 }] : [] }));
  chapter.run('outline', 'outline', 'story', JSON.stringify({ content: '大纲不导出', status: 'ready' }));
  chapter.run('writing', 'chapter', 'story', JSON.stringify({ content: '正在生成不导出', status: 'writing', number: 13 }));
  db.close();
  const store = new ChatStore(directory);
  try {
    const all = collectExport(store, { scope: 'conversation', conversation: { source: 'aion', id: 'chat' } });
    assert.equal(summarizeExport(all).count, 650, '不受消息分页 80 条限制');
    assert.equal(collectExport(store, { scope: 'conversation', conversation: { source: 'aion', id: 'chat' }, includeSystem: true }).groups[0].messages.length, 651);
    const search = collectExport(store, { scope: 'search', search: { query: '共同关键词' } });
    assert.equal(summarizeExport(search).count, 617, '搜索超过 500 条也必须取完整，跨来源同名 ID 不丢失');
    assert.equal(summarizeExport(collectExport(store, { scope: 'searchConversations', search: { query: '共同关键词' } })).count, 664);
    assert.throws(() => collectExport(store, { scope: 'search', search: { query: '%_' } }), /没有可导出/);
    const selected = collectExport(store, { scope: 'selected', selections: [{ source: 'aion', conversationId: 'chat', messageId: 'system' }, { source: 'room', conversationId: 'room', messageId: 'm0000' }, { source: 'room', conversationId: 'room', messageId: 'm0000' }] });
    assert.equal(summarizeExport(selected).count, 2, '精确选择包含所选系统消息，重复勾选不重复导出');
    const hiddenMonitor = prepareDocument(selected, () => { throw new Error('不应读取截图'); });
    assert.equal(hiddenMonitor.images.length, 0);
    assert.match(hiddenMonitor.groups[0].entries[0].blocks[1].text, /监控截图未导出/);
    const book = collectExport(store, { scope: 'theater', conversation: { source: 'theater', id: 'story' } });
    assert.equal(summarizeExport(book).chapters, 12, '整本导出不受小剧场分页 10 章限制');
    const excerpt = collectExport(store, { scope: 'theater', conversation: { source: 'theater', id: 'story' }, selectedChapters: true, chapterIds: ['chapter12', 'chapter2'] });
    assert.deepEqual(excerpt.groups[0].messages.map(message => message.chapter_number), [2, 12]);
    assert.throws(() => collectExport(store, { scope: 'theater', conversation: { source: 'theater', id: 'story' }, selectedChapters: true, chapterIds: [] }), /至少选择/);
    assert.throws(() => collectExport(store, { scope: 'selected', selections: [{ source: 'aion', conversationId: 'chat', messageId: 'missing' }] }), /不存在/);
    const longText = '中文和 English，完整保留。🙂'.repeat(300);
    assert.equal(paginate(longText).join('').replace(/\n/g, ''), longText);

    const imageFile = path.join(directory, 'test.png');
    fs.writeFileSync(imageFile, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
    const output = path.join(__dirname, 'runtime', 'export-check');
    fs.mkdirSync(output, { recursive: true });
    for (const format of ['txt', 'docx', 'pptx', 'epub', ...(process.argv.includes('--pdf') ? ['pdf'] : [])]) {
      const file = await createExport(excerpt, format, { resolveMedia: () => imageFile });
      assert.ok(file.data.length > 100);
      fs.writeFileSync(path.join(output, `sample.${format}`), file.data);
      if (format === 'txt') {
        assert.ok(file.data.toString('utf8').includes('第 12 章的最后一句。'));
        assert.ok(!file.data.toString('utf8').includes('大纲不导出'));
      } else if (format === 'pdf') assert.equal(file.data.toString('ascii', 0, 5), '%PDF-');
      else {
        const zip = await JSZip.loadAsync(file.data);
        if (format === 'docx') {
          const xml = await zip.file('word/document.xml').async('string');
          assert.match(xml, /第 12 章的最后一句/);
          assert.ok(Object.keys(zip.files).some(name => name.startsWith('word/media/') && !zip.files[name].dir));
        } else if (format === 'pptx') {
          const slides = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
          const xml = (await Promise.all(slides.map(name => zip.file(name).async('string')))).join('');
          assert.match(xml, /第 12 章的最后一句/);
          assert.ok(slides.length >= 3);
        } else {
          assert.equal(await zip.file('mimetype').async('string'), 'application/epub+zip');
          assert.equal(Object.keys(zip.files)[0], 'mimetype');
          const nav = await zip.file('OEBPS/nav.xhtml').async('string');
          assert.match(nav, /第 2 章/); assert.match(nav, /第 12 章/);
          assert.ok(!nav.includes('第 1 章'));
          assert.equal(Object.keys(zip.files).filter(name => /^OEBPS\/chapter-\d+\.xhtml$/.test(name)).length, 2);
        }
      }
      console.log(`${format.toUpperCase()} 格式检查通过 (${file.data.length.toLocaleString()} bytes)`);
    }
    console.log('导出范围、全部搜索分页、选择去重、监控过滤、小剧场选章检查通过。');
    fs.unlinkSync(imageFile);
  } finally {
    store.close();
    fs.unlinkSync(databasePath); fs.rmdirSync(directory);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
