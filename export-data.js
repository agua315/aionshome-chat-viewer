'use strict';

const { isSystemMessage } = require('./public/message-display');

const conversationKey = item => `${item.source}:${item.id}`;
const messageKey = item => `${item.source}:${item.conversationId}:${item.messageId}`;

// 导出始终重新从只读数据库取完整正文，不使用网页摘要或当前加载的分页。
function collectExport(store, input = {}) {
  const scopes = ['conversation', 'selected', 'search', 'searchConversations', 'theater'];
  if (!scopes.includes(input.scope)) throw new Error('请选择导出范围');
  const options = {
    includeSystem: input.includeSystem === true,
    includeImages: input.includeImages !== false,
    includeMonitor: input.includeMonitor === true,
    includeReasoning: input.includeReasoning === true,
    includeTime: input.includeTime !== false,
  };
  const conversations = store.conversations();
  const byKey = new Map(conversations.map(item => [conversationKey(item), item]));
  const groups = new Map();
  function groupFor(source, id) {
    const key = `${source}:${id}`;
    const conversation = byKey.get(key);
    if (!conversation) throw new Error('所选会话已不存在，请刷新后重新选择');
    if (!groups.has(key)) groups.set(key, { ...conversation, messages: [] });
    return groups.get(key);
  }
  function addRows(source, id, ids = null, explicitSelection = false) {
    const group = groupFor(source, id);
    const { table, parent, speaker, orderColumn = 'created_at' } = store.table(source);
    let rows;
    if (ids) {
      const statement = store.db.prepare(`SELECT *, ${speaker} AS speaker FROM ${table} WHERE ${parent} = ? AND id = ?`);
      rows = [...new Set(ids)].map(messageId => {
        const row = statement.get(id, messageId);
        if (!row) throw new Error('有一条所选消息或章节已不存在，请重新选择');
        return row;
      }).sort((a, b) => a[orderColumn] - b[orderColumn] || String(a.id).localeCompare(String(b.id)));
    } else rows = store.db.prepare(`SELECT *, ${speaker} AS speaker FROM ${table} WHERE ${parent} = ? ORDER BY ${orderColumn}, id`).all(id);
    // 手动勾选的消息准确导出所选项；完整会话和搜索则应用“包含系统消息”。
    group.messages = rows.map(row => store.serialize(row)).filter(message => explicitSelection || options.includeSystem || !isSystemMessage(message));
  }
  if (input.scope === 'conversation' || input.scope === 'theater') {
    const { source, id } = input.conversation || {};
    if (input.scope === 'theater' && source !== 'theater') throw new Error('请选择一本小剧场');
    const chapterIds = input.scope === 'theater' && input.selectedChapters === true ? input.chapterIds : null;
    if (chapterIds && (!Array.isArray(chapterIds) || !chapterIds.length || chapterIds.some(id => typeof id !== 'string'))) throw new Error('请至少选择一章正文');
    if (input.selectedChapters === true && !chapterIds) throw new Error('请选择要导出的章节');
    addRows(source, id, chapterIds);
  } else if (input.scope === 'selected') {
    if (!Array.isArray(input.selections) || !input.selections.length) throw new Error('请先在聊天内容旁勾选消息或章节');
    const selections = new Map();
    for (const item of input.selections) {
      if (!item || !['aion', 'room', 'theater'].includes(item.source) || typeof item.conversationId !== 'string' || typeof item.messageId !== 'string') throw new Error('选择记录的格式不正确');
      selections.set(messageKey(item), item);
    }
    const grouped = new Map();
    for (const item of selections.values()) {
      const key = `${item.source}:${item.conversationId}`;
      if (!grouped.has(key)) grouped.set(key, { source: item.source, id: item.conversationId, ids: [] });
      grouped.get(key).ids.push(item.messageId);
    }
    for (const item of grouped.values()) addRows(item.source, item.id, item.ids, true);
  } else {
    const search = input.search || {};
    const query = String(search.query || '').trim();
    if (!query) throw new Error('请先搜索关键词，再导出搜索结果');
    let cursor = null;
    const matches = new Map();
    do {
      const batch = store.search({ query, source: search.source, id: search.id, kind: search.kind, cursor, limit: 500, hideSystemMessages: !options.includeSystem });
      for (const hit of batch.items) {
        const key = `${hit.source}:${hit.conversation_id}`;
        if (!matches.has(key)) matches.set(key, { source: hit.source, id: hit.conversation_id, ids: [] });
        matches.get(key).ids.push(hit.id);
      }
      cursor = batch.hasMore ? batch.nextCursor : null;
    } while (cursor);
    for (const item of matches.values()) addRows(item.source, item.id, input.scope === 'search' ? item.ids : null);
  }
  const result = [...groups.values()].filter(group => group.messages.length);
  if (!result.length) throw new Error('这个范围中没有可导出的记录，请调整范围或系统消息选项');
  const query = String(input.search?.query || '').trim();
  const title = result.length === 1 ? result[0].title || '聊天记录' : input.scope.startsWith('search') ? `搜索记录：${query}` : '所选聊天记录';
  return { title, scope: input.scope, query: input.scope.startsWith('search') ? query : '', names: store.names(), options, groups: result, createdAt: new Date().toISOString() };
}

function summarizeExport(document) {
  const chapters = document.groups.filter(group => group.source === 'theater').reduce((n, group) => n + group.messages.length, 0);
  const count = document.groups.reduce((n, group) => n + group.messages.length, 0);
  return { title: document.title, count, chapters, conversations: document.groups.length, characters: document.groups.reduce((n, group) => n + group.messages.reduce((sum, message) => sum + Array.from(message.content).length, 0), 0) };
}

module.exports = { collectExport, summarizeExport };
