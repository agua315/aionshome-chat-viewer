/* 独立查看器的外部编辑同步：仅更新当前页已加载的消息，不重载页面或丢弃历史。 */
(() => {
  'use strict';
  if (window.ChatViewerEditSync) return;
  const storageKey = 'chat_viewer_edit_cursor_v1:' + location.pathname;
  let cursor = Number(localStorage.getItem(storageKey) || 0);
  let initialized = cursor > 0;
  let busy = false;
  const pending = new Map();

  function visible() {
    if (document.visibilityState === 'hidden') return false;
    try { if (window.frameElement && !window.frameElement.getClientRects().length) return false; } catch {}
    return true;
  }

  function editingOrReplying() {
    return (typeof sending !== 'undefined' && sending)
      || (typeof streamingAiId !== 'undefined' && streamingAiId)
      || (typeof isSending !== 'undefined' && isSending)
      || (typeof isAiChatting !== 'undefined' && isAiChatting)
      || (typeof isReplyOnce !== 'undefined' && isReplyOnce)
      || !!document.querySelector('.ai-text-editing');
  }

  async function read(url) {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('sync HTTP ' + response.status);
    return response.json();
  }

  async function apply(edit) {
    if (!visible() || editingOrReplying()) return false;
    if (edit.source === 'aion') {
      if (typeof currentConvId === 'undefined' || currentConvId !== edit.conversationId
          || typeof currentMessages === 'undefined') return true;
      const previous = currentMessages.find(message => message.id === edit.messageId);
      if (!previous) return true;
      const previousContent = previous.content;
      const messages = await read(`/api/conversations/${encodeURIComponent(edit.conversationId)}/messages-around/${encodeURIComponent(edit.messageId)}?limit=100`);
      const fresh = messages.find(message => message.id === edit.messageId);
      if (!fresh) return false;
      if (!visible() || editingOrReplying()) return false;
      if (currentConvId !== edit.conversationId) return true;
      const index = currentMessages.findIndex(message => message.id === edit.messageId);
      if (index < 0) return true;
      // 等待 HTTP 时可能收到实时回复；先重读，不能用旧快照把它覆盖。
      if (currentMessages[index].content !== previousContent && currentMessages[index].content !== fresh.content) return false;
      const panel = document.getElementById('messages');
      const scroll = panel?.scrollTop || 0;
      currentMessages[index] = fresh;
      renderMessages();
      if (panel) panel.scrollTop = scroll;
      return true;
    }
    if (edit.source === 'room') {
      if (typeof currentRoom === 'undefined' || currentRoom?.id !== edit.conversationId
          || typeof crMessagesById === 'undefined') return true;
      const previous = crMessagesById[edit.messageId];
      if (!previous) return true;
      const previousContent = previous.content;
      const result = await read(`/api/chatroom/rooms/${encodeURIComponent(edit.conversationId)}/messages/around/${encodeURIComponent(edit.messageId)}?before_count=10&after_count=0`);
      const fresh = (result.messages || []).find(message => message.id === edit.messageId);
      if (!fresh) return false;
      if (!visible() || editingOrReplying()) return false;
      if (currentRoom?.id !== edit.conversationId) return true;
      if (!crMessagesById[edit.messageId]) return true;
      if (crMessagesById[edit.messageId].content !== previousContent && crMessagesById[edit.messageId].content !== fresh.content) return false;
      const panel = document.getElementById('messages');
      const row = Array.from(panel?.querySelectorAll('[data-msg-id]') || []).find(element => element.dataset.msgId === edit.messageId);
      if (!row) return true;
      const scroll = panel.scrollTop;
      const nextMessage = row.nextElementSibling?.dataset?.msgId ? crMessagesById[row.nextElementSibling.dataset.msgId] : undefined;
      crMessagesById[edit.messageId] = fresh;
      crMessageRevision++;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = msgHTML(fresh, nextMessage);
      row.replaceWith(wrapper.firstElementChild);
      panel.scrollTop = scroll;
      return true;
    }
    return true;
  }

  async function poll() {
    if (busy || !visible()) return;
    busy = true;
    try {
      // 使用单独游标：正常 WebSocket 消息的序号前进，不会跳过查看器的外部编辑。
      if (!initialized) {
        const baseline = await read('/api/sync/changes?after=0&limit=1');
        cursor = Number(baseline.latest_seq || 0);
        initialized = true;
      } else {
        for (let batch = 0; batch < 10; batch++) {
          const result = await read(`/api/sync/changes?after=${cursor}&limit=200`);
          if (result.reset_required) { cursor = Number(result.latest_seq || 0); break; }
          for (const event of result.events || []) {
            if (event.type === 'viewer_message_edited' && event.data?.messageId) {
              const edit = event.data;
              pending.set(`${edit.source}:${edit.conversationId}:${edit.messageId}`, edit);
            }
            cursor = Math.max(cursor, Number(event.sync_seq || 0));
          }
          if (!result.has_more) break;
        }
      }
      localStorage.setItem(storageKey, String(cursor));
      for (const [key, edit] of pending) {
        if (!visible() || editingOrReplying()) break;
        if (await apply(edit)) pending.delete(key);
      }
    } catch (error) {
      // 网络不可用时保留待更新消息，下次前台轮询再读取，不影响发送或浏览。
      console.debug('[viewer edit sync]', error.message);
    } finally { busy = false; }
  }

  window.ChatViewerEditSync = { poll };
  setInterval(poll, 2000);
  document.addEventListener('visibilitychange', () => { if (visible()) poll(); });
  window.addEventListener('pageshow', poll);
  window.addEventListener('focus', poll);
  poll();
})();
