'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function readJson(filename) {
  try { return JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return {}; }
}

class ChatStore {
  constructor(dataDirectory) {
    this.dataDirectory = path.resolve(dataDirectory);
    // 直接读取原始记录，不导入 AionsHome 模块，也不触发它的启动、迁移或写入。
    // readOnly 在连接层禁止写入，query_only 额外防止后续查询代码误写。
    this.db = new DatabaseSync(path.join(this.dataDirectory, 'chat.db'), { readOnly: true });
    this.db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;');
  }

  names() {
    const worldbook = readJson(path.join(this.dataDirectory, 'worldbook.json'));
    const config = readJson(path.join(this.dataDirectory, 'chatroom_config.json'));
    return { user: worldbook.user_name || '你', aion: worldbook.ai_name || 'Aion', connor: config.connor_name || 'Connor' };
  }

  info() {
    return {
      names: this.names(),
      counts: {
        aion: this.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,
        room: this.db.prepare('SELECT COUNT(*) AS n FROM chatroom_messages').get().n,
      },
    };
  }

  conversations() {
    return this.db.prepare(`
      SELECT c.id AS id, 'aion' AS source, 'aion' AS kind, c.title AS title,
        COUNT(m.id) AS count, MIN(m.created_at) AS first_at, MAX(m.created_at) AS last_at
      FROM conversations c JOIN messages m ON m.conv_id = c.id GROUP BY c.id
      UNION ALL
      SELECT r.id AS id, 'room' AS source,
        CASE WHEN r.type = 'connor_1v1' THEN 'connor' ELSE 'group' END AS kind, r.title,
        COUNT(m.id) AS count, MIN(m.created_at) AS first_at, MAX(m.created_at) AS last_at
      FROM chatroom_rooms r JOIN chatroom_messages m ON m.room_id = r.id GROUP BY r.id
      ORDER BY last_at DESC, id DESC
    `).all();
  }

  table(source) {
    if (source === 'aion') return { table: 'messages', parent: 'conv_id', speaker: 'role' };
    if (source === 'room') return { table: 'chatroom_messages', parent: 'room_id', speaker: 'sender' };
    throw new Error('请选择有效的聊天会话');
  }

  serialize(row) {
    let attachments = [];
    try { attachments = JSON.parse(row.attachments || '[]'); } catch {}
    return {
      id: row.id, speaker: row.speaker, content: row.content || '', created_at: row.created_at,
      attachments: Array.isArray(attachments) ? attachments : [],
      reasoning_content: row.reasoning_content || '',
    };
  }

  messages({ source, id, anchor, direction, cursor, position = 'latest', limit = 80 }) {
    const { table, parent, speaker } = this.table(source);
    const select = `SELECT *, ${speaker} AS speaker FROM ${table} WHERE ${parent} = ?`;
    const metadata = this.db.prepare(`SELECT COUNT(*) AS count, MIN(created_at) AS first_at, MAX(created_at) AS last_at FROM ${table} WHERE ${parent} = ?`).get(id);
    let rows;
    if (anchor) {
      // 搜索定位单独取出目标，再加载两侧；即使多条消息时间完全相同也包含原话。
      const target = this.db.prepare(`${select} AND id = ?`).get(id, anchor);
      if (!target) throw new Error('这条消息已不存在，请重新搜索');
      const half = Math.floor(limit / 2);
      const older = this.db.prepare(`${select} AND (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?`).all(id, target.created_at, target.id, half);
      const newer = this.db.prepare(`${select} AND (created_at, id) > (?, ?) ORDER BY created_at ASC, id ASC LIMIT ?`).all(id, target.created_at, target.id, half);
      rows = [...older.reverse(), target, ...newer];
    } else if (cursor && (direction === 'older' || direction === 'newer')) {
      // 必须使用 (时间, ID) 复合游标。只按时间翻页会遗漏同一时间的其他消息。
      if (!Array.isArray(cursor) || cursor.length !== 2 || !Number.isFinite(cursor[0]) || typeof cursor[1] !== 'string') throw new Error('无效的翻页位置');
      const older = direction === 'older';
      const operator = older ? '<' : '>';
      const order = older ? 'DESC' : 'ASC';
      rows = this.db.prepare(`${select} AND (created_at, id) ${operator} (?, ?) ORDER BY created_at ${order}, id ${order} LIMIT ?`).all(id, cursor[0], cursor[1], limit);
      if (older) rows.reverse();
    } else {
      const order = position === 'first' ? 'ASC' : 'DESC';
      rows = this.db.prepare(`${select} ORDER BY created_at ${order}, id ${order} LIMIT ?`).all(id, limit);
      if (order === 'DESC') rows.reverse();
    }
    const first = rows[0];
    const last = rows.at(-1);
    const exists = (operator, row) => !!row && !!this.db.prepare(`SELECT 1 FROM ${table} WHERE ${parent} = ? AND (created_at, id) ${operator} (?, ?) LIMIT 1`).get(id, row.created_at, row.id);
    return {
      items: rows.map(row => this.serialize(row)), metadata, anchor: anchor || null,
      hasOlder: exists('<', first), hasNewer: exists('>', last),
      firstCursor: first ? [first.created_at, first.id] : null,
      lastCursor: last ? [last.created_at, last.id] : null,
    };
  }

  search({ query, source, id, kind, cursor, limit = 50 }) {
    query = String(query || '').trim();
    if (!query) return { items: [], hasMore: false, nextCursor: null };
    if (query.length > 500) throw new Error('搜索文字请控制在 500 字以内');
    const like = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
    const conditions = [];
    const parameters = [like, like];
    if (source && id) {
      this.table(source);
      conditions.push('source = ? AND conversation_id = ?');
      parameters.push(source, id);
    }
    if (['aion', 'connor', 'group'].includes(kind)) {
      conditions.push('kind = ?');
      parameters.push(kind);
    }
    if (cursor) {
      if (!Array.isArray(cursor) || cursor.length !== 3 || !Number.isFinite(cursor[0]) || typeof cursor[1] !== 'string' || typeof cursor[2] !== 'string') throw new Error('无效的搜索位置');
      conditions.push('(created_at, source, id) < (?, ?, ?)');
      parameters.push(...cursor);
    }
    const where = conditions.length ? 'WHERE ' + conditions.map(c => `(${c})`).join(' AND ') : '';
    // 将两类消息统一搜索，保留来源及会话 ID，搜索结果能准确打开原始对话。
    // 结果按游标继续翻页，limit 只限制单批大小，不限制全部搜索结果数量。
    const rows = this.db.prepare(`
      WITH hits AS (
        SELECT m.id, 'aion' AS source, 'aion' AS kind, m.conv_id AS conversation_id,
          m.role AS speaker, m.content, m.created_at, c.title
        FROM messages m LEFT JOIN conversations c ON c.id = m.conv_id
        WHERE COALESCE(m.content, '') LIKE ? ESCAPE '\\'
        UNION ALL
        SELECT m.id, 'room' AS source,
          CASE WHEN r.type = 'connor_1v1' THEN 'connor' ELSE 'group' END AS kind,
          m.room_id AS conversation_id, m.sender AS speaker, m.content, m.created_at, r.title
        FROM chatroom_messages m LEFT JOIN chatroom_rooms r ON r.id = m.room_id
        WHERE COALESCE(m.content, '') LIKE ? ESCAPE '\\'
      )
      SELECT * FROM hits ${where}
      ORDER BY created_at DESC, source DESC, id DESC LIMIT ?
    `).all(...parameters, limit + 1);
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return { items, hasMore: rows.length > limit, nextCursor: last ? [last.created_at, last.source, last.id] : null };
  }

  close() { this.db.close(); }
}

module.exports = { ChatStore, readJson };
