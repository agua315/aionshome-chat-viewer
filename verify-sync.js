'use strict';

// 使用小型页面模拟验证同步，不修改真实聊天记录，不连接手机或 AionsHome 后端。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(require('node:path').join(__dirname, 'integrations/aionshome/external-chat-edits.js'), 'utf8');
async function settle() { for (let i = 0; i < 25; i++) await Promise.resolve(); }

async function verify(source) {
  const storage = new Map([['aion_sync_seq_v1:chat', '99999']]);
  const panel = { scrollTop: 420, querySelectorAll: () => [row] };
  const row = { dataset: { msgId: 'edited' }, nextElementSibling: null, replaceWith(value) { this.replacement = value; } };
  let batch = [];
  let sequence = 10;
  let latest = '修改后的正文';
  let renders = 0;
  const requests = [];
  const context = {
    location: { pathname: source === 'aion' ? '/chat' : '/chatroom' },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    document: {
      visibilityState: 'visible', querySelector: () => null, getElementById: () => panel,
      addEventListener() {}, createElement() { return { firstElementChild: { updatedRow: true } }; },
    },
    window: { addEventListener() {} }, setInterval() {}, AbortSignal, console,
    currentConvId: source === 'aion' ? 'conversation' : null,
    currentMessages: [{ id: 'older', content: '已加载的更早记录' }, { id: 'edited', content: '原始正文' }],
    currentRoom: source === 'room' ? { id: 'conversation' } : null,
    crMessagesById: { older: { id: 'older', content: '已加载的更早记录' }, edited: { id: 'edited', content: '原始正文' } },
    crMessageRevision: 0, sending: false, isSending: false,
    renderMessages() { renders++; panel.scrollTop = 0; }, msgHTML: () => '<div>修改后的消息</div>',
    async fetch(url) {
      requests.push(url);
      let body;
      if (url.includes('/api/sync/changes')) {
        body = { latest_seq: sequence, events: batch, has_more: false };
        batch = [];
      } else {
        const message = { id: 'edited', content: latest, conv_id: 'conversation', room_id: 'conversation' };
        body = source === 'aion' ? [message] : { messages: [message] };
      }
      return { ok: true, json: async () => body };
    },
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  await settle();
  sequence = 12;
  batch = [
    { type: 'msg_created', data: {}, sync_seq: 11 },
    { type: 'viewer_message_edited', data: { source, conversationId: 'conversation', messageId: 'edited' }, sync_seq: 12 },
  ];
  await context.window.ChatViewerEditSync.poll();
  const displayed = source === 'aion' ? context.currentMessages[1] : context.crMessagesById.edited;
  assert.equal(displayed.content, latest);
  assert.equal(panel.scrollTop, 420);
  assert.equal(source === 'aion' ? context.currentMessages[0].content : context.crMessagesById.older.content, '已加载的更早记录');
  assert(requests.some(url => url.includes('after=10&limit=200')));
  assert(source === 'aion' ? renders === 1 : !!row.replacement);

  // 正在生成回复时先保留通知；结束后再读取并应用，避免中断流式界面。
  context.sending = true;
  context.isSending = true;
  sequence = 13;
  batch = [{ type: 'viewer_message_edited', data: { source, conversationId: 'conversation', messageId: 'edited' }, sync_seq: 13 }];
  latest = '回复结束后更新的正文';
  await context.window.ChatViewerEditSync.poll();
  assert.equal((source === 'aion' ? context.currentMessages[1] : context.crMessagesById.edited).content, '修改后的正文');
  context.sending = false;
  context.isSending = false;
  await context.window.ChatViewerEditSync.poll();
  assert.equal((source === 'aion' ? context.currentMessages[1] : context.crMessagesById.edited).content, latest);

  const beforeHidden = requests.length;
  context.document.visibilityState = 'hidden';
  await context.window.ChatViewerEditSync.poll();
  assert.equal(requests.length, beforeHidden);
}

(async () => {
  await verify('aion');
  await verify('room');
  console.log('通过：私聊和群聊外部编辑自动更新；保留历史与滚动位置；独立游标不漏通知；回复期间延后；后台停止轮询。');
})().catch(error => { console.error(error); process.exitCode = 1; });
