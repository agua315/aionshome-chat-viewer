'use strict';

const $ = id => document.getElementById(id);
const state = {
  names: { user: '你', aion: 'Aion', connor: 'Connor' }, conversations: [], kind: 'all', selected: null,
  items: [], hasOlder: false, hasNewer: false, firstCursor: null, lastCursor: null, target: null,
  searchMode: false, query: '', hits: [], searchCursor: null, searchMore: false, searchSource: null, searchId: null,
  messageEpoch: 0, searchEpoch: 0, messageBusy: false, searchBusy: false,
};
const dateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const date = ts => dateFormat.format(new Date(ts * 1000));
const time = ts => timeFormat.format(new Date(ts * 1000));
const key = conversation => `${conversation.source}:${conversation.id}`;
const kindName = kind => kind === 'group' ? '群聊' : `${state.names[kind] || kind} 私聊`;
const speakerName = speaker => ({ user: state.names.user, assistant: state.names.aion, aion: state.names.aion, connor: state.names.connor, system: '系统' })[speaker] || speaker;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

let toastTimer;
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200);
}

async function api(endpoint, values = {}) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) params.set(name, Array.isArray(value) ? JSON.stringify(value) : value);
  }
  const response = await fetch(endpoint + (params.size ? '?' + params : ''), { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '读取失败');
  return result;
}

// 用文本节点高亮原话；消息中的 HTML 保持为原始文字，不执行聊天内容。
function highlighted(text, query = state.searchMode ? state.query : '') {
  const fragment = document.createDocumentFragment();
  if (!query) { fragment.append(document.createTextNode(text)); return fragment; }
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    fragment.append(document.createTextNode(text.slice(end, match.index)), node('mark', '', match[0]));
    end = match.index + match[0].length;
  }
  fragment.append(document.createTextNode(text.slice(end)));
  return fragment;
}

function renderConversations() {
  const items = state.conversations.filter(c => state.kind === 'all' || c.kind === state.kind);
  $('conversationCount').textContent = items.length;
  const fragment = document.createDocumentFragment();
  for (const conversation of items) {
    const button = node('button', 'conversation' + (state.selected && key(conversation) === key(state.selected) ? ' active' : ''));
    button.append(node('span', 'tag', kindName(conversation.kind)), node('div', 'conversation-title', conversation.title));
    const metadata = node('div', 'meta');
    metadata.append(node('span', '', date(conversation.last_at)), node('span', '', `${conversation.count.toLocaleString()} 条`));
    button.append(metadata);
    button.addEventListener('click', () => openConversation(conversation));
    fragment.append(button);
  }
  if (!items.length) fragment.append(node('div', 'empty', '这里还没有聊天记录'));
  $('conversationList').replaceChildren(fragment);
}

function setSearchMode(enabled) {
  state.searchMode = enabled;
  $('conversationHead').hidden = enabled;
  $('conversationList').hidden = enabled;
  $('searchHead').hidden = !enabled;
  $('searchResults').hidden = !enabled;
}

function snippet(text) {
  const position = text.toLowerCase().indexOf(state.query.toLowerCase());
  const start = Math.max(0, position - 65);
  const end = Math.min(text.length, start + Math.max(230, state.query.length + 100));
  return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

function renderSearch() {
  const fragment = document.createDocumentFragment();
  for (const hit of state.hits) {
    const active = state.selected && state.selected.source === hit.source && state.selected.id === hit.conversation_id && state.target === hit.id;
    const button = node('button', 'result' + (active ? ' active' : ''));
    button.append(node('div', 'who', speakerName(hit.speaker)));
    const content = node('div', 'excerpt');
    content.append(highlighted(snippet(hit.content)));
    button.append(content, node('div', 'meta', `${date(hit.created_at)} ${time(hit.created_at)}\n${kindName(hit.kind)} · ${hit.title || '历史会话'}`));
    button.addEventListener('click', () => {
      const conversation = state.conversations.find(c => c.source === hit.source && c.id === hit.conversation_id) || { source: hit.source, id: hit.conversation_id, kind: hit.kind, title: hit.title || '历史会话' };
      openConversation(conversation, { anchor: hit.id });
    });
    fragment.append(button);
  }
  if (state.searchBusy && !state.hits.length) fragment.append(node('div', 'loading', '正在搜索全部原始记录…'));
  else if (!state.hits.length) fragment.append(node('div', 'empty', '没有找到匹配的原话。可以换一个短一点的关键词。'));
  if (state.searchMore) {
    const more = node('button', 'more-results', state.searchBusy ? '正在加载…' : '继续加载搜索结果');
    more.disabled = state.searchBusy;
    more.addEventListener('click', () => search(true));
    fragment.append(more);
  }
  $('searchResults').replaceChildren(fragment);
  $('searchLabel').textContent = state.searchBusy ? '正在搜索…' : `搜索结果 · 已显示 ${state.hits.length} 条`;
}

// 搜索范围在开始搜索时固定；点中别的会话后，后续翻页仍沿用原搜索范围。
async function search(more = false) {
  if (state.searchBusy && more) return;
  const query = $('searchInput').value.trim();
  if (!query) { toast('先输入一句话或关键词'); $('searchInput').focus(); return; }
  if (!more) {
    if ($('searchScope').value === 'current' && !state.selected) { toast('先选择一个会话'); return; }
    state.query = query;
    state.searchSource = $('searchScope').value === 'current' ? state.selected.source : null;
    state.searchId = $('searchScope').value === 'current' ? state.selected.id : null;
    state.hits = [];
    state.searchCursor = null;
    state.searchMore = false;
    setSearchMode(true);
    // 当前已经打开的内容也同步显示关键词高亮。
    const scroll = $('messages').scrollTop;
    renderMessages();
    $('messages').scrollTop = scroll;
  }
  const epoch = ++state.searchEpoch;
  state.searchBusy = true;
  const oldScroll = $('searchResults').scrollTop;
  renderSearch();
  if (!more) $('searchResults').scrollTop = 0;
  try {
    const result = await api('/api/search', { q: state.query, source: state.searchSource, id: state.searchId, cursor: more ? state.searchCursor : null });
    if (epoch !== state.searchEpoch) return;
    state.hits = more ? [...state.hits, ...result.items] : result.items;
    state.searchCursor = result.nextCursor;
    state.searchMore = result.hasMore;
  } catch (error) {
    if (epoch === state.searchEpoch) {
      toast('搜索失败：' + error.message);
      $('searchResults').replaceChildren(node('div', 'empty', '读取失败，请再次点击搜索。'));
    }
  } finally {
    if (epoch === state.searchEpoch) {
      state.searchBusy = false;
      renderSearch();
      $('searchResults').scrollTop = more ? oldScroll : 0;
    }
  }
}

function mediaUrl(raw) {
  if (!raw) return null;
  try {
    const url = new URL(String(raw), location.origin);
    const local = url.origin === location.origin || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (local && /^\/(uploads\/|screenshots\/|songs\/|cr-uploads\/|public\/|api\/chatroom\/images\/|chatroom_images\/|data\/uploads\/)/.test(url.pathname)) return '/api/media?url=' + encodeURIComponent(url.pathname);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch { return null; }
}

function image(url, alt = '聊天图片') {
  const element = node('img', 'inline-image');
  element.src = url;
  element.alt = alt;
  element.loading = 'lazy';
  // 图片成功或失败均保留固定预览空间，异步加载不会把已定位的原话推走。
  element.addEventListener('error', () => { element.alt = '图片文件已不存在或暂时无法读取'; element.classList.add('image-error'); });
  element.addEventListener('click', () => { $('largeImage').src = url; $('imageDialog').showModal(); });
  return element;
}

function messageContent(text) {
  const fragment = document.createDocumentFragment();
  let end = 0;
  for (const match of text.matchAll(/\[\[image:([^\]]+)\]\]/g)) {
    fragment.append(highlighted(text.slice(end, match.index)));
    const url = mediaUrl(match[1]);
    fragment.append(url ? image(url) : highlighted(match[0]));
    end = match.index + match[0].length;
  }
  fragment.append(highlighted(text.slice(end)));
  return fragment;
}

function renderAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') return null;
  const raw = attachment.url || attachment.path || attachment.image_url || attachment.audio_url || attachment.video_url;
  const url = mediaUrl(raw);
  let text = attachment.transcript || attachment.transcription || attachment.text || attachment.note || attachment.label || attachment.summary;
  // 拍一拍、点歌等事件有时只有附件，没有正文；以可读文字保留这些记录。
  if (!text && attachment.type === 'pat') text = `${speakerName(attachment.actor || 'system')} ${attachment.action || '拍了拍'} ${speakerName(attachment.target || '')}${attachment.suffix || ''}`;
  if (!text && attachment.type === 'music') text = `🎵 ${attachment.name || '音乐'}${attachment.artist ? ' · ' + attachment.artist : ''}`;
  if (!url && !text) return null;
  const container = node('div', 'attachment');
  if (attachment.type === 'sticker' || attachment.sticker_id) container.classList.add('sticker');
  if (url) {
    const type = String(attachment.type || attachment.mime_type || attachment.mime || '').toLowerCase();
    const extension = String(raw).split(/[?#]/)[0].toLowerCase();
    if (type.startsWith('image') || /\.(png|jpe?g|webp|gif|avif)$/.test(extension)) container.append(image(url, attachment.name || '聊天图片'));
    else if (type.startsWith('audio') || /\.(mp3|wav|ogg|m4a)$/.test(extension) || type === 'voice') {
      const audio = node('audio'); audio.controls = true; audio.preload = 'none'; audio.src = url; container.append(audio);
    } else if (type.startsWith('video') || /\.(mp4|webm|mov)$/.test(extension)) {
      const video = node('video'); video.controls = true; video.preload = 'metadata'; video.src = url; container.append(video);
    } else {
      const link = node('a', '', attachment.title || attachment.name || '打开附件'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; container.append(link);
    }
  }
  if (text) { const note = node('div', 'subtle'); note.append(highlighted(String(text))); container.append(note); }
  return container;
}

function renderMessage(message) {
  const role = message.speaker === 'assistant' ? 'aion' : message.speaker;
  const row = node('article', 'message ' + role + (message.id === state.target ? ' target' : ''));
  row.dataset.messageId = message.id;
  row.tabIndex = -1;
  const name = speakerName(message.speaker);
  row.append(node('div', 'avatar', Array.from(name)[0]));
  const body = node('div', 'message-body');
  const metadata = node('div', 'message-meta');
  metadata.append(node('strong', '', name), node('span', '', time(message.created_at)));
  const bubble = node('div', 'bubble');
  bubble.append(messageContent(message.content));
  body.append(metadata, bubble);
  for (const attachment of message.attachments) { const element = renderAttachment(attachment); if (element) body.append(element); }
  if (message.reasoning_content) {
    const details = node('details', 'reasoning');
    const text = node('pre'); text.append(highlighted(message.reasoning_content));
    details.append(node('summary', '', '查看思考内容'), text);
    body.append(details);
  }
  if (!message.content && body.children.length === 2 && !message.reasoning_content) bubble.append(node('span', 'subtle', '这条记录没有文字或可显示的附件'));
  row.append(body);
  return row;
}

function renderMessages() {
  if (!state.selected) return;
  const inner = node('div', 'messages-inner');
  const older = node('div', 'boundary');
  if (state.hasOlder) {
    const button = node('button', 'load-more', state.messageBusy ? '正在加载…' : '↑ 加载更早的记录');
    button.disabled = state.messageBusy; button.addEventListener('click', () => loadMore('older')); older.append(button);
  } else older.textContent = '— 这个会话的最早记录 —';
  inner.append(older);
  let day = '';
  for (const message of state.items) {
    const messageDay = date(message.created_at);
    if (messageDay !== day) { inner.append(node('div', 'day', messageDay)); day = messageDay; }
    inner.append(renderMessage(message));
  }
  if (!state.items.length) inner.append(node('div', 'empty', '这个会话中没有记录'));
  const newer = node('div', 'boundary bottom');
  if (state.hasNewer) {
    const button = node('button', 'load-more', state.messageBusy ? '正在加载…' : '↓ 加载更新的记录');
    button.disabled = state.messageBusy; button.addEventListener('click', () => loadMore('newer')); newer.append(button);
  } else newer.textContent = '— 已到最新记录 · 刷新可读取新消息 —';
  inner.append(newer);
  $('messages').replaceChildren(inner);
  const first = state.items[0], last = state.items.at(-1);
  $('rangeLabel').textContent = first ? `已加载 ${state.items.length.toLocaleString()} 条 · ${date(first.created_at)} — ${date(last.created_at)}` : '没有记录';
}

function updateReaderHead(metadata) {
  $('readerTitle').textContent = state.selected.title;
  $('readerKind').textContent = kindName(state.selected.kind);
  $('readerMeta').textContent = metadata?.count ? `${metadata.count.toLocaleString()} 条原始消息 · ${date(metadata.first_at)} — ${date(metadata.last_at)}` : '';
  $('firstBtn').disabled = state.messageBusy;
  $('latestBtn').disabled = state.messageBusy;
}

// 点击搜索结果必须先加载包含目标的记录，再定位 DOM；不用跳回 AionsHome 页面。
async function openConversation(conversation, { anchor = null, position = 'latest' } = {}) {
  const epoch = ++state.messageEpoch;
  state.selected = conversation;
  state.target = anchor;
  state.messageBusy = true;
  state.items = [];
  $('messages').setAttribute('aria-busy', 'true');
  $('messages').replaceChildren(node('div', 'loading', anchor ? '正在加载原话和前后对话…' : '正在读取聊天记录…'));
  updateReaderHead();
  renderConversations();
  if (state.searchMode) renderSearch();
  try {
    const result = await api('/api/messages', { source: conversation.source, id: conversation.id, anchor, position });
    if (epoch !== state.messageEpoch) return;
    state.items = result.items;
    state.hasOlder = result.hasOlder;
    state.hasNewer = result.hasNewer;
    state.firstCursor = result.firstCursor;
    state.lastCursor = result.lastCursor;
    state.messageBusy = false;
    renderMessages();
    updateReaderHead(result.metadata);
    // renderMessages 是同步的；下一帧元素已经挂载，目标一定可见后才滚动。
    requestAnimationFrame(() => {
      if (epoch !== state.messageEpoch) return;
      if (anchor) {
        const target = Array.from($('messages').querySelectorAll('[data-message-id]')).find(row => row.dataset.messageId === anchor);
        if (!target) { toast('原话加载失败，请再次点击搜索结果'); return; }
        // 长回复中的命中词可能在中间；直接定位高亮词，打开即可看到搜到的原话。
        const focusPoint = target.querySelector('mark') || target;
        focusPoint.scrollIntoView({ block: target.querySelector('mark') ? 'center' : 'start' });
        target.focus({ preventScroll: true });
      } else $('messages').scrollTop = position === 'first' ? 0 : $('messages').scrollHeight;
    });
  } catch (error) {
    if (epoch === state.messageEpoch) { toast('读取失败：' + error.message); $('messages').replaceChildren(node('div', 'empty', error.message + '。请重新选择会话或刷新。')); }
  } finally {
    if (epoch === state.messageEpoch) { state.messageBusy = false; $('messages').setAttribute('aria-busy', 'false'); $('firstBtn').disabled = false; $('latestBtn').disabled = false; }
  }
}

async function loadMore(direction) {
  if (state.messageBusy || !state.selected) return;
  const epoch = state.messageEpoch;
  const cursor = direction === 'older' ? state.firstCursor : state.lastCursor;
  const selected = state.selected;
  const scroller = $('messages');
  // 保存当前可见消息作为视觉锚点；加载更早的记录后，阅读位置不会跳走。
  const frameTop = scroller.getBoundingClientRect().top;
  const visible = Array.from(scroller.querySelectorAll('.message')).find(row => row.getBoundingClientRect().bottom > frameTop);
  const visibleId = visible?.dataset.messageId;
  const visibleOffset = visible ? visible.getBoundingClientRect().top - frameTop : 0;
  const oldScroll = scroller.scrollTop;
  state.messageBusy = true;
  scroller.querySelectorAll('.load-more').forEach(button => { button.disabled = true; button.textContent = '正在加载…'; });
  try {
    const result = await api('/api/messages', { source: selected.source, id: selected.id, direction, cursor });
    if (epoch !== state.messageEpoch) return;
    // 同时间消息使用时间和 ID 的复合游标，既不遗漏，也不重复。
    const known = new Set(state.items.map(m => m.id));
    const additions = result.items.filter(m => !known.has(m.id));
    state.items = direction === 'older' ? [...additions, ...state.items] : [...state.items, ...additions];
    if (direction === 'older') { state.hasOlder = result.hasOlder; if (result.firstCursor) state.firstCursor = result.firstCursor; }
    else { state.hasNewer = result.hasNewer; if (result.lastCursor) state.lastCursor = result.lastCursor; }
    state.messageBusy = false;
    renderMessages();
    updateReaderHead(result.metadata);
    const replacement = Array.from(scroller.querySelectorAll('.message')).find(row => row.dataset.messageId === visibleId);
    if (replacement) scroller.scrollTop += replacement.getBoundingClientRect().top - frameTop - visibleOffset;
    else scroller.scrollTop = oldScroll;
  } catch (error) { if (epoch === state.messageEpoch) toast('加载失败：' + error.message); }
  finally {
    if (epoch === state.messageEpoch) {
      state.messageBusy = false;
      scroller.querySelectorAll('.load-more').forEach(button => { button.disabled = false; button.textContent = button.closest('.bottom') ? '↓ 加载更新的记录' : '↑ 加载更早的记录'; });
    }
  }
}

async function refresh(initial = false) {
  $('refreshBtn').disabled = true;
  try {
    const [info, conversations] = await Promise.all([api('/api/info'), api('/api/conversations')]);
    state.names = info.names;
    state.conversations = conversations.items;
    $('totalLabel').textContent = `${(info.counts.aion + info.counts.room).toLocaleString()} 条原始消息`;
    $('kindTabs').querySelector('[data-kind="aion"]').textContent = info.names.aion;
    $('kindTabs').querySelector('[data-kind="connor"]').textContent = info.names.connor;
    renderConversations();
    if (initial && state.conversations.length) await openConversation(state.conversations[0]);
    else if (!initial) {
      if (state.searchMode) await search();
      if (state.selected) {
        const selected = state.conversations.find(c => key(c) === key(state.selected)) || state.selected;
        const top = $('messages').getBoundingClientRect().top;
        const visible = Array.from($('messages').querySelectorAll('.message')).find(row => row.getBoundingClientRect().bottom > top);
        await openConversation(selected, { anchor: state.target || visible?.dataset.messageId });
      }
      toast('已读取最新记录');
    }
  } catch (error) {
    $('totalLabel').textContent = '读取失败';
    toast('无法读取记录：' + error.message);
    if (initial) $('conversationList').replaceChildren(node('div', 'empty', '无法连接查看器，请双击启动程序后重试。'));
  } finally { $('refreshBtn').disabled = false; }
}

$('kindTabs').addEventListener('click', event => {
  const button = event.target.closest('[data-kind]'); if (!button) return;
  state.kind = button.dataset.kind;
  $('kindTabs').querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
  renderConversations();
});
$('searchForm').addEventListener('submit', event => { event.preventDefault(); search(); });
$('backBtn').addEventListener('click', () => {
  state.searchEpoch++;
  state.searchBusy = false;
  setSearchMode(false);
  state.target = null;
  const scroll = $('messages').scrollTop;
  renderMessages();
  $('messages').scrollTop = scroll;
  renderConversations();
});
$('firstBtn').addEventListener('click', () => { if (state.selected) openConversation(state.selected, { position: 'first' }); });
$('latestBtn').addEventListener('click', () => { if (state.selected) openConversation(state.selected, { position: 'latest' }); });
$('refreshBtn').addEventListener('click', () => refresh());
$('closeImageBtn').addEventListener('click', () => $('imageDialog').close());
$('imageDialog').addEventListener('click', event => { if (event.target === $('imageDialog')) $('imageDialog').close(); });
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); $('searchInput').focus(); $('searchInput').select(); }
});
refresh(true);
