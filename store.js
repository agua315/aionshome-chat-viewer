'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { normalizeBackupPreferences } = require('./preferences');
const { SYSTEM_SPEAKERS, isSystemMessage } = require('./public/message-display');
const { theaterSql } = require('./theater');
const systemSpeakersSql = SYSTEM_SPEAKERS.map(speaker => "'" + speaker + "'").join(', ');

function readJson(filename) {
  try { return JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return {}; }
}

class ChatStore {
  constructor(dataDirectory, { backupDirectory = '', backupEnabled = true } = {}) {
    this.dataDirectory = path.resolve(dataDirectory);
    this.databasePath = path.join(this.dataDirectory, 'chat.db');
    this.setBackupSettings({ enabled: backupEnabled, directory: backupDirectory });
    // 浏览始终使用只读连接；只有显式保存编辑时才临时打开写入连接。
    // 不导入 AionsHome 模块，不依赖它的启动、迁移或消息生成逻辑。
    this.db = new DatabaseSync(this.databasePath, { readOnly: true });
    this.db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;');
  }

  names() {
    const worldbook = readJson(path.join(this.dataDirectory, 'worldbook.json'));
    const config = readJson(path.join(this.dataDirectory, 'chatroom_config.json'));
    return { user: worldbook.user_name || '你', aion: worldbook.ai_name || 'Aion', connor: config.connor_name || 'Connor' };
  }

  backupSettings() { return { enabled: this.backupEnabled, directory: this.backupDirectory }; }

  setBackupSettings(settings) {
    const normalized = normalizeBackupPreferences(settings);
    this.backupEnabled = normalized.enabled;
    this.backupDirectory = normalized.directory;
    return normalized;
  }

  info() {
    const theater = theaterSql(this.db);
    // 直接读取本地头像文件，不依赖 AionsHome 服务在线；缺失时前端使用名字首字。
    const publicDirectory = path.resolve(this.dataDirectory, '../../public');
    const avatarFiles = { user: 'UserIcon.png', aion: 'AIIcon.png', groupAion: 'gropicon1.png', connor: 'codexicon.png' };
    return {
      names: this.names(),
      avatars: Object.fromEntries(Object.entries(avatarFiles).map(([role, filename]) => [role, fs.existsSync(path.join(publicDirectory, filename)) ? '/public/' + filename : null])),
      counts: {
        aion: this.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,
        room: this.db.prepare('SELECT COUNT(*) AS n FROM chatroom_messages').get().n,
        theater: theater ? this.db.prepare(`SELECT COUNT(*) AS n FROM (${theater})`).get().n : 0,
      },
    };
  }

  conversations() {
    const theater = theaterSql(this.db);
    return this.db.prepare(`
      SELECT c.id AS id, 'aion' AS source, 'aion' AS kind, c.title AS title,
        COUNT(m.id) AS count, MIN(m.created_at) AS first_at, MAX(m.created_at) AS last_at
      FROM conversations c JOIN messages m ON m.conv_id = c.id GROUP BY c.id
      UNION ALL
      SELECT r.id AS id, 'room' AS source,
        CASE WHEN r.type = 'connor_1v1' THEN 'connor' ELSE 'group' END AS kind, r.title,
        COUNT(m.id) AS count, MIN(m.created_at) AS first_at, MAX(m.created_at) AS last_at
      FROM chatroom_rooms r JOIN chatroom_messages m ON m.room_id = r.id GROUP BY r.id
      ${theater ? `UNION ALL
        SELECT t.conversation_id, 'theater', 'theater', t.title,
          COUNT(*), MIN(t.created_at), MAX(t.activity_at)
        FROM (${theater}) t GROUP BY t.conversation_id` : ''}
      ORDER BY last_at DESC, id DESC
    `).all();
  }

  table(source) {
    if (source === 'aion') return { table: 'messages', parent: 'conv_id', speaker: 'role' };
    if (source === 'room') return { table: 'chatroom_messages', parent: 'room_id', speaker: 'sender' };
    if (source === 'theater') {
      const theater = theaterSql(this.db);
      if (theater) return { table: `(${theater})`, parent: 'conversation_id', speaker: 'speaker', orderColumn: 'chapter_number' };
    }
    throw new Error('请选择有效的聊天会话');
  }

  serialize(row) {
    let attachments = [];
    try { attachments = JSON.parse(row.attachments || '[]'); } catch {}
    const message = {
      id: row.id, speaker: row.speaker, content: row.content || '', created_at: row.created_at,
      attachments: Array.isArray(attachments) ? attachments : [],
      reasoning_content: row.reasoning_content || '',
    };
    if (row.read_only) {
      let images = [];
      try { images = JSON.parse(row.illustrations || '[]'); } catch {}
      Object.assign(message, {
        readOnly: true, chapter_number: row.chapter_number, chapter_title: row.chapter_title,
        illustrations: Array.isArray(images) ? images.filter(image => image && image.status === 'ready' && typeof image.url === 'string' && image.url).map(image => ({ url: image.url, after: image.after })) : [],
      });
    }
    return message;
  }

  messages({ source, id, anchor, direction, cursor, position = 'latest', limit = 80, hideSystemMessages = false }) {
    const { table, parent, speaker, orderColumn = 'created_at' } = this.table(source);
    if (source === 'theater') limit = Math.min(limit, 10);
    // 在翻页前过滤系统记录，避免整批都是隐藏消息时出现空白页面或漏掉正常对话。
    const where = `${parent} = ?` + (hideSystemMessages ? ` AND ${speaker} NOT IN (${systemSpeakersSql})` : '');
    const select = `SELECT *, ${speaker} AS speaker FROM ${table} WHERE ${where}`;
    const metadata = this.db.prepare(`SELECT COUNT(*) AS count, MIN(created_at) AS first_at, MAX(created_at) AS last_at FROM ${table} WHERE ${where}`).get(id);
    // 目录覆盖整本故事，不受正文分页限制；只返回章节名称和 ID，不复制正文或大纲。
    if (source === 'theater') metadata.chapters = this.db.prepare(`SELECT id, chapter_number, chapter_title FROM ${table} WHERE ${parent} = ? ORDER BY chapter_number, id`).all(id);
    let rows;
    if (anchor) {
      // 搜索定位单独取出目标，再加载两侧；即使多条消息时间完全相同也包含原话。
      // 切换过滤时，原先正在看的系统消息可作为时间锚点，但不会作为正文返回。
      const target = this.db.prepare(`SELECT *, ${speaker} AS speaker FROM ${table} WHERE ${parent} = ? AND id = ?`).get(id, anchor);
      if (!target) throw new Error('这条消息已不存在，请重新搜索');
      const half = Math.floor(limit / 2);
      const older = this.db.prepare(`${select} AND (${orderColumn}, id) < (?, ?) ORDER BY ${orderColumn} DESC, id DESC LIMIT ?`).all(id, target[orderColumn], target.id, half);
      const newer = this.db.prepare(`${select} AND (${orderColumn}, id) > (?, ?) ORDER BY ${orderColumn} ASC, id ASC LIMIT ?`).all(id, target[orderColumn], target.id, half);
      rows = [...older.reverse(), ...(hideSystemMessages && isSystemMessage(target) ? [] : [target]), ...newer];
    } else if (cursor && (direction === 'older' || direction === 'newer')) {
      // 必须使用 (时间, ID) 复合游标。只按时间翻页会遗漏同一时间的其他消息。
      if (!Array.isArray(cursor) || cursor.length !== 2 || !Number.isFinite(cursor[0]) || typeof cursor[1] !== 'string') throw new Error('无效的翻页位置');
      const older = direction === 'older';
      const operator = older ? '<' : '>';
      const order = older ? 'DESC' : 'ASC';
      rows = this.db.prepare(`${select} AND (${orderColumn}, id) ${operator} (?, ?) ORDER BY ${orderColumn} ${order}, id ${order} LIMIT ?`).all(id, cursor[0], cursor[1], limit);
      if (older) rows.reverse();
    } else {
      const order = position === 'first' ? 'ASC' : 'DESC';
      rows = this.db.prepare(`${select} ORDER BY ${orderColumn} ${order}, id ${order} LIMIT ?`).all(id, limit);
      if (order === 'DESC') rows.reverse();
    }
    const first = rows[0];
    const last = rows.at(-1);
    const exists = (operator, row) => !!row && !!this.db.prepare(`SELECT 1 FROM ${table} WHERE ${where} AND (${orderColumn}, id) ${operator} (?, ?) LIMIT 1`).get(id, row[orderColumn], row.id);
    return {
      items: rows.map(row => this.serialize(row)), metadata, anchor: anchor || null,
      hasOlder: exists('<', first), hasNewer: exists('>', last),
      firstCursor: first ? [first[orderColumn], first.id] : null,
      lastCursor: last ? [last[orderColumn], last.id] : null,
    };
  }

  search({ query, source, id, kind, cursor, limit = 50, hideSystemMessages = false }) {
    query = String(query || '').trim();
    if (!query) return { items: [], hasMore: false, nextCursor: null };
    if (query.length > 500) throw new Error('搜索文字请控制在 500 字以内');
    const like = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
    const theater = theaterSql(this.db);
    const conditions = [];
    const parameters = theater ? [like, like, like] : [like, like];
    if (hideSystemMessages) conditions.push(`speaker NOT IN (${systemSpeakersSql})`);
    if (source && id) {
      this.table(source);
      conditions.push('source = ? AND conversation_id = ?');
      parameters.push(source, id);
    }
    if (['aion', 'connor', 'group', 'theater'].includes(kind)) {
      conditions.push('kind = ?');
      parameters.push(kind);
    }
    if (cursor) {
      if (!Array.isArray(cursor) || cursor.length !== 3 || !Number.isFinite(cursor[0]) || typeof cursor[1] !== 'string' || typeof cursor[2] !== 'string') throw new Error('无效的搜索位置');
      conditions.push('(created_at, source, id) < (?, ?, ?)');
      parameters.push(...cursor);
    }
    const where = conditions.length ? 'WHERE ' + conditions.map(c => `(${c})`).join(' AND ') : '';
    // 聊天与小剧场成稿统一搜索，保留来源及会话 ID；只搜索章节 content 字段。
    // 结果按游标继续翻页，limit 只限制单批大小，不限制全部搜索结果数量。
    const rows = this.db.prepare(`
      WITH hits AS (
        SELECT m.id, 'aion' AS source, 'aion' AS kind, m.conv_id AS conversation_id,
          m.role AS speaker, m.content, m.created_at, c.title, NULL AS chapter_number, NULL AS chapter_title
        FROM messages m LEFT JOIN conversations c ON c.id = m.conv_id
        WHERE COALESCE(m.content, '') LIKE ? ESCAPE '\\'
        UNION ALL
        SELECT m.id, 'room' AS source,
          CASE WHEN r.type = 'connor_1v1' THEN 'connor' ELSE 'group' END AS kind,
          m.room_id AS conversation_id, m.sender AS speaker, m.content, m.created_at, r.title, NULL AS chapter_number, NULL AS chapter_title
        FROM chatroom_messages m LEFT JOIN chatroom_rooms r ON r.id = m.room_id
        WHERE COALESCE(m.content, '') LIKE ? ESCAPE '\\'
        ${theater ? `UNION ALL
          SELECT t.id, 'theater', 'theater', t.conversation_id,
            t.speaker, t.content, t.created_at, t.title, t.chapter_number, t.chapter_title
          FROM (${theater}) t WHERE t.content LIKE ? ESCAPE '\\'` : ''}
      )
      SELECT * FROM hits ${where}
      ORDER BY created_at DESC, source DESC, id DESC LIMIT ?
    `).all(...parameters, limit + 1);
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return { items, hasMore: rows.length > limit, nextCursor: last ? [last.created_at, last.source, last.id] : null };
  }

  updateMessage({ source, id, messageId, content, originalContent }) {
    // 章节含版本、完成状态和插图索引，查看器仅阅读，不借用聊天编辑写入它。
    if (source === 'theater') throw new Error('小剧场正文目前仅供阅读，请在 AionsHome 中修改章节');
    const { table, parent, speaker } = this.table(source);
    if (typeof id !== 'string' || !id || typeof messageId !== 'string' || !messageId) throw new Error('请选择要编辑的那条消息');
    if (typeof content !== 'string' || !content.trim()) throw new Error('消息正文不能为空');
    if (typeof originalContent !== 'string') throw new Error('缺少原文，请重新打开编辑窗口');
    const writer = new DatabaseSync(this.databasePath);
    let transaction = false;
    try {
      writer.exec('PRAGMA busy_timeout = 3000; BEGIN IMMEDIATE;');
      transaction = true;
      const before = writer.prepare(`SELECT *, ${speaker} AS speaker FROM ${table} WHERE ${parent} = ? AND id = ?`).get(id, messageId);
      if (!before) throw new Error('这条消息已不存在，请刷新记录');
      // 对比打开编辑窗口时的原文，避免与 AionsHome 或另一个查看器的修改相互覆盖。
      if ((before.content || '') !== originalContent) {
        const conflict = new Error('这条消息已被别处修改。请先复制你的修改，取消后重新打开这条消息再编辑。');
        conflict.status = 409;
        throw conflict;
      }
      if (content === originalContent) {
        writer.exec('ROLLBACK;');
        transaction = false;
        return { message: this.serialize(before), changed: false };
      }

      // 一次备份一条完整原记录，避免每次编辑都复制整个聊天数据库。
      // 备份先成功落盘，再更新正文；目录不可用时绝不写入原记录。
      let backupFile = null;
      if (this.backupEnabled) try {
        fs.mkdirSync(this.backupDirectory, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        backupFile = path.join(this.backupDirectory, `message-${stamp}-${source}-${crypto.randomUUID()}.json`);
        fs.writeFileSync(backupFile, JSON.stringify({
          version: 1, savedAt: new Date().toISOString(), databasePath: this.databasePath,
          source, conversationId: id, messageId, originalRecord: before,
        }, null, 2), { encoding: 'utf8', flag: 'wx' });
      } catch {
        throw new Error('原文存档失败，消息没有修改。请在“存档设置”中更换目录，或关闭编辑前存档后再保存。');
      }
      // 只修改这一条消息的正文，不改时间、身份、附件、思考内容或会话顺序。
      writer.prepare(`UPDATE ${table} SET content = ? WHERE ${parent} = ? AND id = ?`).run(content, id, messageId);
      // AionsHome 在线时，聊天页通过现有同步接口发现外部编辑。
      // 这里只记录消息位置，手机再读取最新原文，避免旧通知覆盖后续修改。
      // 同步表不存在的旧版数据库仍可独立编辑，不创建或迁移 AionsHome 的表。
      let syncSeq = null;
      if (writer.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_events'").get()) {
        const sync = writer.prepare('INSERT INTO sync_events (event_type, entity_type, entity_id, payload, created_at) VALUES (?, ?, ?, ?, ?)')
          .run('viewer_message_edited', source === 'aion' ? 'message' : 'chatroom_message', messageId,
            JSON.stringify({ source, conversationId: id, messageId }), Date.now() / 1000);
        syncSeq = Number(sync.lastInsertRowid);
      }
      writer.exec('COMMIT;');
      transaction = false;
      return { message: this.serialize({ ...before, content }), changed: true, backupFile, syncSeq };
    } catch (error) {
      if (/database is locked|database is busy/i.test(error.message)) throw new Error('聊天数据库暂时正忙，请稍后再保存');
      throw error;
    } finally {
      if (transaction) { try { writer.exec('ROLLBACK;'); } catch {} }
      writer.close();
    }
  }

  close() { this.db.close(); }
}

module.exports = { ChatStore, readJson };
