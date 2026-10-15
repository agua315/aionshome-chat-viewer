'use strict';

const $ = id => document.getElementById(id);
const state = {
  names: { user: '你', aion: 'Aion', connor: 'Connor' }, conversations: [], kind: 'all', selected: null,
  items: [], hasOlder: false, hasNewer: false, firstCursor: null, lastCursor: null, target: null,
  searchMode: false, query: '', hits: [], searchCursor: null, searchMore: false, searchSource: null, searchId: null, searchKind: null,
  messageEpoch: 0, searchEpoch: 0, messageBusy: false, searchBusy: false,
  editToken: null, edit: null, editBusy: false,
  backupSettings: { enabled: true, directory: '' }, archiveBusy: false,
  displaySettings: { mode: 'plain', userSide: 'right', showUserName: true, showUserAvatar: true, showCharacterAvatar: true, hideSystemMessages: false, collapseMonitorScreenshots: true }, displayBusy: false, avatars: {},
  localClient: true,
  chapters: [], currentChapterId: null,
};
const displayToggles = ['showUserName', 'showUserAvatar', 'showCharacterAvatar', 'hideSystemMessages', 'collapseMonitorScreenshots'];
const dateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const date = ts => dateFormat.format(new Date(ts * 1000));
const time = ts => timeFormat.format(new Date(ts * 1000));
const key = conversation => `${conversation.source}:${conversation.id}`;
const kindName = kind => kind === 'theater' ? '小剧场' : kind === 'group' ? '群聊' : `${state.names[kind] || kind} 私聊`;
const chapterName = message => `第 ${message.chapter_number} 章${message.chapter_title ? ' · ' + message.chapter_title : ''}`;
const speakerName = speaker => ({ user: state.names.user, assistant: state.names.aion, aion: state.names.aion, connor: state.names.connor, system: '系统' })[speaker] || speaker;
const mobileScreen = window.matchMedia('(max-width: 700px)');

function setSidebarOpen(open) {
  if (open && mobileScreen.matches) { setToolbarOpen(false); setMobileSearchOpen(false); }
  document.body.classList.toggle('sidebar-open', open && mobileScreen.matches);
  $('sidebarBtn').setAttribute('aria-expanded', String(open && mobileScreen.matches));
  $('sidebarShade').hidden = !open || !mobileScreen.matches;
}

// 手机的展开状态只留在当前页面；不写入全局外观配置，避免影响电脑端。
function setToolbarOpen(open) {
  const expanded = open && mobileScreen.matches;
  if (expanded) { setSidebarOpen(false); setMobileSearchOpen(false); }
  document.body.classList.toggle('toolbar-open', expanded);
  $('toolbarMenuBtn').setAttribute('aria-expanded', String(expanded));
}

function setMobileSearchOpen(open) {
  const expanded = open && mobileScreen.matches;
  if (expanded) { setToolbarOpen(false); setSidebarOpen(false); }
  document.body.classList.toggle('mobile-search-open', expanded);
  $('mobileSearchBtn').setAttribute('aria-expanded', String(expanded));
  if (open) $('searchInput').focus();
  else if (document.activeElement === $('searchInput')) $('searchInput').blur();
}

function setReaderDetailsOpen(open) {
  const expanded = open && mobileScreen.matches;
  document.body.classList.toggle('reader-details-open', expanded);
  $('readerDetailsBtn').setAttribute('aria-expanded', String(expanded));
  $('readerDetailsBtn').textContent = expanded ? '收起' : '详情';
}

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

async function api(endpoint, values = {}, options = {}) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) params.set(name, Array.isArray(value) ? JSON.stringify(value) : value);
  }
  const response = await fetch(endpoint + (params.size ? '?' + params : ''), { cache: 'no-store', signal: AbortSignal.timeout(20000), ...options });
  const result = await response.json();
  if (response.status === 401 && result.loginRequired) { location.replace('/'); throw new Error('请重新输入访问码'); }
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
    metadata.append(node('span', '', date(conversation.last_at)), node('span', '', `${conversation.count.toLocaleString()} ${conversation.kind === 'theater' ? '章正文' : '条'}`));
    button.append(metadata);
    button.addEventListener('click', () => openConversation(conversation));
    fragment.append(button);
  }
  if (!items.length) fragment.append(node('div', 'empty', state.kind === 'theater' ? '还没有已写完的小剧场正文。大纲和未写完的章节不在这里显示。' : '这里还没有聊天记录'));
  $('conversationList').replaceChildren(fragment);
}

function setSearchMode(enabled) {
  state.searchMode = enabled;
  $('conversationHead').hidden = enabled;
  $('conversationList').hidden = enabled;
  $('searchHead').hidden = !enabled;
  $('searchResults').hidden = !enabled;
  $('sidebarBtn').setAttribute('aria-label', enabled ? '打开搜索结果' : '打开会话列表');
}

function snippet(text) {
  const position = text.toLowerCase().indexOf(state.query.toLowerCase());
  const start = Math.max(0, position - 65);
  const end = Math.min(text.length, start + Math.max(230, state.query.length + 100));
  return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

function renderSearch() {
  const fragment = document.createDocumentFragment();
  const hits = state.hits.filter(hit => !state.displaySettings.hideSystemMessages || !MessageDisplay.isSystemMessage(hit));
  for (const hit of hits) {
    const active = state.selected && state.selected.source === hit.source && state.selected.id === hit.conversation_id && state.target === hit.id;
    const button = node('button', 'result' + (active ? ' active' : ''));
    button.append(node('div', 'who', hit.kind === 'theater' ? chapterName(hit) : speakerName(hit.speaker)));
    const content = node('div', 'excerpt');
    content.append(highlighted(snippet(hit.content)));
    button.append(content, node('div', 'meta', `${date(hit.created_at)} ${time(hit.created_at)}\n${kindName(hit.kind)} · ${hit.title || '历史会话'}`));
    button.addEventListener('click', () => {
      const conversation = state.conversations.find(c => c.source === hit.source && c.id === hit.conversation_id) || { source: hit.source, id: hit.conversation_id, kind: hit.kind, title: hit.title || '历史会话' };
      openConversation(conversation, { anchor: hit.id });
    });
    fragment.append(button);
  }
  if (state.searchBusy && !hits.length) fragment.append(node('div', 'loading', '正在搜索聊天记录…'));
  else if (!hits.length) fragment.append(node('div', 'empty', '没有找到匹配的原话。可以换一个短一点的关键词。'));
  if (state.searchMore) {
    const more = node('button', 'more-results', state.searchBusy ? '正在加载…' : '继续加载搜索结果');
    more.disabled = state.searchBusy;
    more.addEventListener('click', () => search(true));
    fragment.append(more);
  }
  $('searchResults').replaceChildren(fragment);
  $('searchLabel').textContent = state.searchBusy ? '正在搜索…' : `搜索结果 · 已显示 ${hits.length} 条`;
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
    state.searchKind = $('searchScope').value === 'theater' ? 'theater' : null;
    state.hits = [];
    state.searchCursor = null;
    state.searchMore = false;
    setSearchMode(true);
    setSidebarOpen(true);
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
    const result = await api('/api/search', { q: state.query, source: state.searchSource, id: state.searchId, kind: state.searchKind, cursor: more ? state.searchCursor : null, hideSystemMessages: state.displaySettings.hideSystemMessages });
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

function displayImage(raw, alt = '聊天图片', attachment = null, speaker = '') {
  const url = mediaUrl(raw);
  if (!url) return null;
  if (!state.displaySettings.collapseMonitorScreenshots || !MessageDisplay.isMonitorScreenshot(raw, attachment, speaker)) return image(url, alt);
  const details = node('details', 'monitor-screenshot');
  const summary = node('summary', '', '监控截图 · 点击展开');
  const frame = node('div', 'monitor-screenshot-frame');
  details.append(summary, frame);
  let loaded = false;
  // 折叠时没有 img 或图片请求；只有用户主动展开才创建图片，也支持再次收起。
  details.addEventListener('toggle', () => {
    summary.textContent = details.open ? '监控截图 · 点击收起' : '监控截图 · 点击展开';
    if (details.open && !loaded) { frame.append(image(url, '监控截图')); loaded = true; }
  });
  return details;
}

function eventIcon(kind) {
  const paths = {
    thought: '<path d="M6 16.5a7.5 6 0 1 1 3 1.1L5 20l1-3.5Z"/><circle cx="9" cy="11" r=".7"/><circle cx="13" cy="11" r=".7"/><circle cx="17" cy="11" r=".7"/>',
    watch: '<rect x="6" y="6" width="12" height="12" rx="4"/><path d="m9 6 .6-4h4.8l.6 4m-6 12 .6 4h4.8l.6-4M12 9v3l2 1"/>',
    pat: '<path d="M8 13V7a1.5 1.5 0 0 1 3 0v5-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v6c0 4-2.5 6-6 6h-1c-2 0-3.5-1-4.8-2.8L5 14.5a1.5 1.5 0 0 1 2.3-1.9L10 15"/><path d="M3 5 2 4m3-1V1"/>',
  };
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.classList.add('event-icon');
  // 图标为本程序的固定矢量图形，不将聊天原文放入 SVG 或 HTML。
  icon.innerHTML = paths[kind] || paths.thought;
  return icon;
}

function renderThought(text, message) {
  const thought = node('span', 'inner-thought');
  const label = node('span', 'thought-label');
  label.append(eventIcon('thought'), highlighted('心里嘀咕'));
  const content = node('span', 'thought-text');
  if (state.displaySettings.mode === 'plain') content.classList.add('raw-thought');
  content.append(state.displaySettings.mode === 'plain' ? highlighted(text) : markdownContent(text, message, { thoughts: false, inline: true }));
  thought.append(label, content);
  return thought;
}

function renderEventNote(kind, title, text) {
  const note = node('div', 'event-note ' + kind + '-note');
  const icon = node('span', 'event-icon-wrap');
  icon.append(eventIcon(kind));
  const body = node('div', 'event-note-body');
  body.append(node('span', 'event-note-label', title));
  const content = node('div', 'event-note-text');
  content.append(highlighted(text));
  body.append(content);
  note.append(icon, body);
  return note;
}

function prepareContent(text, thoughts = true) {
  const items = [];
  const prefix = 'CHATVIEWEREVENT' + Date.now().toString(36) + Math.random().toString(36).slice(2) + 'TOKEN';
  const token = item => { const value = prefix + items.length + 'END'; items.push(item); return value; };
  // 先用占位符保留特殊内容，再一次解析完整 Markdown，不切断列表、引用和段落。
  let source = thoughts ? MessageDisplay.replaceInnerThoughts(text, (text, original) => token({ kind: 'thought', text, original })) : String(text);
  source = source.replace(/\[\[image:([^\]]+)\]\]/g, (original, raw) => token({ kind: 'image', raw, original }));
  return { source, prefix, items };
}

function restoreContent(text, prepared, message) {
  const fragment = document.createDocumentFragment();
  const pattern = new RegExp(prepared.prefix + '(\\d+)END', 'g');
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    fragment.append(highlighted(text.slice(end, match.index)));
    const item = prepared.items[Number(match[1])];
    fragment.append(item.kind === 'thought' ? renderThought(item.text, message) : displayImage(item.raw, '聊天图片', null, message?.speaker) || highlighted(item.original));
    end = match.index + match[0].length;
  }
  fragment.append(highlighted(text.slice(end)));
  return fragment;
}

function messageContent(text, message) {
  if (state.displaySettings.mode !== 'plain') return markdownContent(text, message);
  const prepared = prepareContent(text);
  return restoreContent(prepared.source, prepared, message);
}

function markdownContent(text, message, { thoughts = true, inline = false } = {}) {
  const container = node('div');
  const prepared = prepareContent(text, thoughts);
  // 与 AionsHome 共用解析规则：原始 HTML 作为文字，Markdown 格式正常显示。
  container.innerHTML = inline ? ChatroomMarkdown.renderInline(prepared.source) : ChatroomMarkdown.render(prepared.source);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const textNode of texts) {
    // 只高亮渲染后的文字，避免关键词破坏 Markdown 标签和链接属性。
    textNode.replaceWith(restoreContent(textNode.textContent, prepared, message));
  }
  for (const link of container.querySelectorAll('a')) {
    const url = mediaUrl(link.getAttribute('href'));
    if (url) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    else link.replaceWith(...link.childNodes);
  }
  const fragment = document.createDocumentFragment();
  fragment.append(...container.childNodes);
  return fragment;
}

function renderAttachment(attachment, message) {
  if (!attachment || typeof attachment !== 'object') return null;
  const band = MessageDisplay.bandNote(attachment);
  if (band) return renderEventNote('watch', band.title, band.text);
  // 拍一拍已在消息正文位置显示，附件仅提供事件标记，避免重复显示两次。
  if (attachment.type === 'pat') return null;
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
    if (type.startsWith('image') || type === 'monitor_camera_snapshot' || /\.(png|jpe?g|webp|gif|avif)$/.test(extension)) container.append(displayImage(raw, attachment.name || '聊天图片', attachment, message?.speaker));
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

function renderChapter(message) {
  const row = node('article', 'message theater-chapter' + (message.id === state.target ? ' target' : ''));
  row.dataset.messageId = message.id;
  row.tabIndex = -1;
  const body = node('div', 'message-body');
  body.append(node('h3', 'chapter-heading', chapterName(message)));
  const content = node('div', 'bubble');
  // AionsHome 插图位置按 Python 的字符数保存，用码点而非 UTF-16 下标还原，
  // 避免正文含 emoji 时插图偏移。完整正文只解析一次，保留跨行 Markdown。
  const characters = Array.from(message.content);
  const illustrations = (message.illustrations || []).filter(item => mediaUrl(item.url) && !item.url.includes(']'))
    .map(item => ({ ...item, after: Number.isInteger(item.after) ? Math.max(0, Math.min(characters.length, item.after)) : characters.length }))
    .sort((a, b) => a.after - b.after);
  let start = 0, text = '';
  for (const illustration of illustrations) {
    text += characters.slice(start, illustration.after).join('') + `\n\n[[image:${illustration.url}]]\n\n`;
    start = illustration.after;
  }
  text += characters.slice(start).join('');
  content.append(messageContent(text, message));
  body.append(content);
  row.append(body);
  ViewerExport.decorate(row, message, state.selected);
  ViewerCards.decorate(row, message, state.selected);
  return row;
}

function renderMessage(message) {
  if (message.readOnly && message.speaker === 'chapter') return renderChapter(message);
  const pat = MessageDisplay.isPatMessage(message);
  const role = message.speaker === 'assistant' ? 'aion' : message.speaker;
  const row = node('article', 'message ' + role + (role === 'user' ? ' user-' + state.displaySettings.userSide : '') + (message.id === state.target ? ' target' : ''));
  row.dataset.messageId = message.id;
  if (pat) row.classList.add('pat-event');
  row.tabIndex = -1;
  const name = speakerName(message.speaker);
  const showAvatar = role === 'user' ? state.displaySettings.showUserAvatar : state.displaySettings.showCharacterAvatar;
  if (showAvatar) {
    const avatar = node('div', 'avatar', Array.from(name)[0]);
    const raw = state.avatars[role === 'aion' && state.selected?.source === 'room' ? 'groupAion' : role];
    const url = mediaUrl(raw);
    if (url) {
      const photo = node('img'); photo.src = url; photo.alt = name + '的头像'; photo.loading = 'lazy';
      photo.addEventListener('error', () => { avatar.replaceChildren(document.createTextNode(Array.from(name)[0])); }, { once: true });
      avatar.replaceChildren(photo);
    }
    row.append(avatar);
  }
  const body = node('div', 'message-body');
  const metadata = node('div', 'message-meta');
  if (role !== 'user' || state.displaySettings.showUserName) metadata.append(node('strong', 'speaker-name', name));
  metadata.append(node('span', '', time(message.created_at)));
  const editButton = node('button', 'edit-message', '编辑');
  editButton.type = 'button';
  editButton.setAttribute('aria-label', `编辑${name}的这条消息`);
  editButton.addEventListener('click', () => openEdit(message));
  metadata.append(editButton);
  const bubble = node('div', 'bubble');
  if (pat) {
    const attachment = message.attachments.find(item => item?.type === 'pat');
    const text = message.content || `${speakerName(attachment.actor || 'system')} ${attachment.action || '拍了拍'} ${speakerName(attachment.target || '')}${attachment.suffix || ''}`;
    bubble.append(renderEventNote('pat', '拍一拍', text));
  } else bubble.append(messageContent(message.content, message));
  body.append(metadata, bubble);
  for (const attachment of message.attachments) { const element = renderAttachment(attachment, message); if (element) body.append(element); }
  if (message.reasoning_content) {
    const details = node('details', 'reasoning');
    const text = node('pre'); text.append(highlighted(message.reasoning_content));
    details.append(node('summary', '', '查看思考内容'), text);
    body.append(details);
  }
  if (!pat && !message.content && body.children.length === 2 && !message.reasoning_content) bubble.append(node('span', 'subtle', '这条记录没有文字或可显示的附件'));
  row.append(body);
  ViewerExport.decorate(row, message, state.selected);
  ViewerCards.decorate(row, message, state.selected);
  return row;
}

function openEdit(message) {
  if (!state.selected || state.editBusy) return;
  // 保留当前原文用于保存时的冲突检查，输入框始终编辑完整原始正文。
  state.edit = { source: state.selected.source, id: state.selected.id, messageId: message.id, originalContent: message.content };
  $('editMeta').textContent = `${speakerName(message.speaker)} · ${date(message.created_at)} ${time(message.created_at)}`;
  $('editContent').value = message.content;
  $('editArchiveNote').textContent = state.backupSettings.enabled ? '保存后更新原聊天记录；修改前的原文会先存档。' : '保存后更新原聊天记录；当前已关闭原文存档。';
  $('editError').hidden = true;
  $('editDialog').showModal();
  $('editContent').focus();
  $('editContent').setSelectionRange(0, 0);
}

function closeEdit() {
  if (!state.editBusy) $('editDialog').close();
}

async function saveEdit() {
  if (!state.edit || state.editBusy) return;
  const edit = { ...state.edit, content: $('editContent').value };
  state.editBusy = true;
  $('editError').hidden = true;
  for (const id of ['saveEditBtn', 'cancelEditBtn', 'closeEditBtn']) $(id).disabled = true;
  $('saveEditBtn').textContent = '正在保存…';
  try {
    const result = await api('/api/messages/edit', {}, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': state.editToken || '' },
      body: JSON.stringify(edit),
    });
    if (state.selected?.source === edit.source && state.selected?.id === edit.id) {
      state.items = state.items.map(message => message.id === edit.messageId ? result.message : message);
      const scroll = $('messages').scrollTop;
      renderMessages();
      $('messages').scrollTop = scroll;
      const row = Array.from($('messages').querySelectorAll('.message')).find(message => message.dataset.messageId === edit.messageId);
      row?.scrollIntoView({ block: 'nearest' });
    }
    if (state.searchMode) {
      const scroll = $('searchResults').scrollTop;
      // 已显示的搜索结果同步正文；删掉不再包含关键词的结果，避免显示过期原话。
      state.hits = state.hits.map(hit => hit.source === edit.source && hit.conversation_id === edit.id && hit.id === edit.messageId ? { ...hit, content: result.message.content } : hit)
        .filter(hit => hit.content.toLowerCase().includes(state.query.toLowerCase()));
      renderSearch();
      $('searchResults').scrollTop = scroll;
    }
    $('editDialog').close();
    toast(result.changed ? (result.backupFile ? '已保存，修改前的原文已存档' : '已保存（未存档原文）') : '内容没有变化');
  } catch (error) {
    // 失败时保留输入的草稿，方便复制或继续调整。
    $('editError').textContent = error.message;
    $('editError').hidden = false;
  } finally {
    state.editBusy = false;
    for (const id of ['saveEditBtn', 'cancelEditBtn', 'closeEditBtn']) $(id).disabled = false;
    $('saveEditBtn').textContent = '保存修改';
  }
}

function archiveControls() {
  const disabled = state.archiveBusy || !$('archiveEnabled').checked;
  $('archiveDirectory').disabled = disabled;
  $('chooseArchiveFolderBtn').disabled = disabled;
  for (const id of ['archiveEnabled', 'saveArchiveBtn', 'cancelArchiveBtn', 'closeArchiveBtn']) $(id).disabled = state.archiveBusy;
}

async function openArchiveSettings() {
  $('archiveError').hidden = true;
  try {
    // 从当前实例读取，另一个窗口改过的设置也能立即显示。
    const info = await api('/api/info');
    state.editToken = info.editToken;
    state.backupSettings = info.backupSettings;
    $('archiveEnabled').checked = state.backupSettings.enabled;
    $('archiveDirectory').value = state.backupSettings.directory;
    $('chooseArchiveFolderBtn').hidden = !state.localClient;
    $('archiveDirectory').placeholder = state.localClient ? '留空使用自己的文档目录' : '这是电脑上的存档文件夹';
    archiveControls();
    $('archiveDialog').showModal();
  } catch (error) { toast('无法读取存档设置：' + error.message); }
}

async function chooseArchiveFolder() {
  if (state.archiveBusy) return;
  state.archiveBusy = true;
  $('archiveError').hidden = true;
  $('chooseArchiveFolderBtn').textContent = '正在选择…';
  archiveControls();
  try {
    const result = await api('/api/settings/choose-folder', {}, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': state.editToken },
      body: JSON.stringify({ directory: $('archiveDirectory').value }), signal: AbortSignal.timeout(310000),
    });
    if (result.directory) $('archiveDirectory').value = result.directory;
  } catch (error) { $('archiveError').textContent = error.message; $('archiveError').hidden = false; }
  finally { state.archiveBusy = false; $('chooseArchiveFolderBtn').textContent = '选择文件夹'; archiveControls(); }
}

async function saveArchiveSettings() {
  if (state.archiveBusy) return;
  state.archiveBusy = true;
  $('archiveError').hidden = true;
  archiveControls();
  try {
    const result = await api('/api/settings/backup', {}, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': state.editToken },
      body: JSON.stringify({ enabled: $('archiveEnabled').checked, directory: $('archiveDirectory').value }),
    });
    state.backupSettings = result.backupSettings;
    $('archiveDialog').close();
    toast(state.backupSettings.enabled ? '存档设置已保存' : '已关闭编辑前存档');
  } catch (error) { $('archiveError').textContent = error.message; $('archiveError').hidden = false; }
  finally { state.archiveBusy = false; archiveControls(); }
}

function displayControls() {
  for (const id of ['displayMode', 'userSide', ...displayToggles, 'saveDisplayBtn', 'cancelDisplayBtn', 'closeDisplayBtn']) $(id).disabled = state.displayBusy;
}

async function openDisplaySettings() {
  $('displayError').hidden = true;
  try {
    const info = await api('/api/info');
    state.editToken = info.editToken;
    state.displaySettings = info.displaySettings;
    $('displayMode').value = state.displaySettings.mode;
    $('userSide').value = state.displaySettings.userSide;
    for (const id of displayToggles) $(id).checked = state.displaySettings[id];
    displayControls();
    $('displayDialog').showModal();
  } catch (error) { toast('无法读取显示设置：' + error.message); }
}

async function saveDisplaySettings() {
  if (state.displayBusy) return;
  state.displayBusy = true;
  $('displayError').hidden = true;
  displayControls();
  try {
    const result = await api('/api/settings/display', {}, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': state.editToken },
      body: JSON.stringify({ mode: $('displayMode').value, userSide: $('userSide').value, ...Object.fromEntries(displayToggles.map(id => [id, $(id).checked])) }),
    });
    const filterChanged = state.displaySettings.hideSystemMessages !== result.displaySettings.hideSystemMessages;
    state.displaySettings = result.displaySettings;
    // 切换后以当前可见消息为锚，长段落排版改变也不会跳回聊天两端。
    const scroller = $('messages');
    const top = scroller.getBoundingClientRect().top;
    const visible = Array.from(scroller.querySelectorAll('.message')).find(row => row.getBoundingClientRect().bottom > top);
    const id = visible?.dataset.messageId;
    const offset = visible ? visible.getBoundingClientRect().top - top : 0;
    if (filterChanged) {
      // 重新取得过滤后的游标和搜索结果；不沿用包含系统消息的旧批次。
      if (state.searchMode) await search();
      if (state.selected) await openConversation(state.selected, { anchor: id || state.target });
      requestAnimationFrame(() => {
        const replacement = Array.from(scroller.querySelectorAll('.message')).find(row => row.dataset.messageId === id);
        if (replacement) scroller.scrollTop += replacement.getBoundingClientRect().top - top - offset;
      });
    } else if (!state.messageBusy) {
      renderMessages();
      const replacement = Array.from(scroller.querySelectorAll('.message')).find(row => row.dataset.messageId === id);
      if (replacement) scroller.scrollTop += replacement.getBoundingClientRect().top - top - offset;
    }
    $('displayDialog').close();
    toast('显示设置已保存');
  } catch (error) { $('displayError').textContent = error.message; $('displayError').hidden = false; }
  finally { state.displayBusy = false; displayControls(); }
}

async function copyPhoneValue(value) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      // 本机 HTTP 页面可使用选中复制，手机端则也能长按地址手动复制。
      const input = node('textarea'); input.value = value; input.className = 'copy-helper';
      $('phoneDialog').append(input); input.select();
      const copied = document.execCommand('copy'); input.remove();
      if (!copied) throw new Error('无法自动复制');
    }
    toast('已复制');
  } catch { toast('请选中地址或访问码，手动复制'); }
}

async function openPhoneAccess() {
  try {
    const info = await api('/api/phone-access');
    for (const [id, addresses, empty] of [['wifiAddresses', info.wifi, '未找到 Wi-Fi 地址，请确认电脑已连接网络'], ['tailscaleAddresses', info.tailscale, '未找到 Tailscale 地址，请先连接 Tailscale']]) {
      const fragment = document.createDocumentFragment();
      for (const item of addresses) {
        const row = node('div', 'phone-address-row');
        const link = node('a', '', item.url); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        const copy = node('button', '', '复制地址'); copy.type = 'button'; copy.addEventListener('click', () => copyPhoneValue(item.url));
        row.append(link, copy); fragment.append(row);
      }
      if (!addresses.length) fragment.append(node('p', 'subtle', empty));
      $(id).replaceChildren(fragment);
    }
    $('phoneCode').value = info.code;
    $('phoneDialog').showModal();
  } catch (error) { toast('无法读取手机连接信息：' + error.message); }
}

function renderMessages() {
  const theater = state.selected?.kind === 'theater';
  // 小剧场采用连续章节的小说排版；聊天本身的显示偏好无需改变。
  $('messages').dataset.mode = theater ? 'novel' : state.displaySettings.mode;
  if (!state.selected) return;
  const inner = node('div', 'messages-inner');
  const older = node('div', 'boundary');
  if (state.hasOlder) {
    const button = node('button', 'load-more', state.messageBusy ? '正在加载…' : '↑ 加载更早的记录');
    button.disabled = state.messageBusy; button.addEventListener('click', () => loadMore('older')); older.append(button);
  } else older.textContent = theater ? '— 故事正文开始 —' : '— 这个会话的最早记录 —';
  inner.append(older);
  let day = '';
  const visibleItems = state.items.filter(message => !state.displaySettings.hideSystemMessages || !MessageDisplay.isSystemMessage(message));
  for (const message of visibleItems) {
    const messageDay = date(message.created_at);
    if (!theater && messageDay !== day) { inner.append(node('div', 'day', messageDay)); day = messageDay; }
    inner.append(renderMessage(message));
  }
  if (!visibleItems.length) inner.append(node('div', 'empty', state.displaySettings.hideSystemMessages ? '这个会话中没有可显示的聊天消息（系统消息已隐藏）' : '这个会话中没有记录'));
  const newer = node('div', 'boundary bottom');
  if (state.hasNewer) {
    const button = node('button', 'load-more', state.messageBusy ? '正在加载…' : '↓ 加载更新的记录');
    button.disabled = state.messageBusy; button.addEventListener('click', () => loadMore('newer')); newer.append(button);
  } else newer.textContent = theater ? '— 已到当前正文末尾 · 刷新可读取新章节 —' : '— 已到最新记录 · 刷新可读取新消息 —';
  inner.append(newer);
  $('messages').replaceChildren(inner);
  const first = visibleItems[0], last = visibleItems.at(-1);
  $('rangeLabel').textContent = theater && first ? `已显示第 ${first.chapter_number} — ${last.chapter_number} 章 · 仅正文` : first ? `已显示 ${visibleItems.length.toLocaleString()} 条${state.displaySettings.hideSystemMessages ? '（系统消息已隐藏）' : ''} · ${date(first.created_at)} — ${date(last.created_at)}` : '没有可显示的记录';
}

function updateChapterSelection(id = state.currentChapterId) {
  state.currentChapterId = id;
  $('chapterSelect').value = id || '';
  const index = state.chapters.findIndex(chapter => chapter.id === id);
  $('chapterSelect').disabled = state.messageBusy || !state.chapters.length;
  $('previousChapterBtn').disabled = state.messageBusy || index <= 0;
  $('nextChapterBtn').disabled = state.messageBusy || index < 0 || index >= state.chapters.length - 1;
}

function renderChapterNavigation(metadata) {
  const theater = state.selected?.kind === 'theater';
  $('chapterNavigation').hidden = !theater;
  if (!theater) return;
  if (metadata?.chapters) state.chapters = metadata.chapters;
  const options = document.createDocumentFragment();
  for (const chapter of state.chapters) {
    const option = node('option', '', chapterName(chapter));
    option.value = chapter.id;
    options.append(option);
  }
  if (!state.chapters.length) options.append(node('option', '', state.messageBusy ? '正在读取目录…' : '暂无可阅读章节'));
  $('chapterSelect').replaceChildren(options);
  updateChapterSelection();
}

function syncVisibleChapter() {
  if (state.selected?.kind !== 'theater' || state.messageBusy) return;
  const top = $('messages').getBoundingClientRect().top + 12;
  const visible = Array.from($('messages').querySelectorAll('.theater-chapter')).find(row => row.getBoundingClientRect().bottom > top);
  if (visible) updateChapterSelection(visible.dataset.messageId);
}

function openChapter(id) {
  if (state.messageBusy || state.selected?.kind !== 'theater' || !state.chapters.some(chapter => chapter.id === id)) return;
  // 章节选择总是定位章首，即使搜索结果仍然高亮，也不跳到章内关键词。
  openConversation(state.selected, { anchor: id, chapterStart: true });
}

function updateReaderHead(metadata) {
  const theater = state.selected.kind === 'theater';
  $('readerTitle').textContent = state.selected.title;
  $('readerKind').textContent = kindName(state.selected.kind);
  $('readerMeta').textContent = metadata?.count ? theater ? `${metadata.count.toLocaleString()} 章正文 · 按章节顺序阅读` : `${metadata.count.toLocaleString()} 条${state.displaySettings.hideSystemMessages ? '聊天消息（已隐藏系统消息）' : '原始消息'} · ${date(metadata.first_at)} — ${date(metadata.last_at)}` : '';
  $('firstBtn').textContent = theater ? '首章' : '最早';
  $('latestBtn').textContent = theater ? '末章' : '最新';
  $('firstBtn').disabled = state.messageBusy;
  $('latestBtn').disabled = state.messageBusy;
  renderChapterNavigation(metadata);
}

// 点击搜索结果必须先加载包含目标的记录，再定位 DOM；不用跳回 AionsHome 页面。
async function openConversation(conversation, { anchor = null, position = conversation.kind === 'theater' ? 'first' : 'latest', chapterStart = false } = {}) {
  setSidebarOpen(false);
  const epoch = ++state.messageEpoch;
  if (!state.selected || key(state.selected) !== key(conversation)) state.chapters = [];
  state.selected = conversation;
  state.currentChapterId = conversation.kind === 'theater' ? anchor : null;
  state.target = anchor;
  state.messageBusy = true;
  state.items = [];
  $('messages').setAttribute('aria-busy', 'true');
  $('messages').replaceChildren(node('div', 'loading', anchor ? '正在加载原话和前后对话…' : '正在读取聊天记录…'));
  updateReaderHead();
  renderConversations();
  if (state.searchMode) renderSearch();
  try {
    const result = await api('/api/messages', { source: conversation.source, id: conversation.id, anchor, position, hideSystemMessages: state.displaySettings.hideSystemMessages });
    if (epoch !== state.messageEpoch) return;
    state.items = result.items;
    if (anchor && !state.items.some(message => message.id === anchor)) state.target = null;
    state.hasOlder = result.hasOlder;
    state.hasNewer = result.hasNewer;
    state.firstCursor = result.firstCursor;
    state.lastCursor = result.lastCursor;
    if (conversation.kind === 'theater') state.currentChapterId = anchor || (position === 'first' ? state.items[0]?.id : state.items.at(-1)?.id);
    state.messageBusy = false;
    renderMessages();
    updateReaderHead(result.metadata);
    // renderMessages 是同步的；下一帧元素已经挂载，目标一定可见后才滚动。
    requestAnimationFrame(() => {
      if (epoch !== state.messageEpoch) return;
      if (state.target) {
        const target = Array.from($('messages').querySelectorAll('[data-message-id]')).find(row => row.dataset.messageId === anchor);
        if (!target) { toast('原话加载失败，请再次点击搜索结果'); return; }
        // 长回复中的命中词可能在中间；直接定位高亮词，打开即可看到搜到的原话。
        const mark = chapterStart ? null : target.querySelector('mark');
        const focusPoint = mark || target;
        focusPoint.scrollIntoView({ block: mark ? 'center' : 'start' });
        target.focus({ preventScroll: true });
      } else $('messages').scrollTop = position === 'first' ? 0 : $('messages').scrollHeight;
      syncVisibleChapter();
    });
  } catch (error) {
    if (epoch === state.messageEpoch) { toast('读取失败：' + error.message); $('messages').replaceChildren(node('div', 'empty', error.message + '。请重新选择会话或刷新。')); }
  } finally {
    if (epoch === state.messageEpoch) { state.messageBusy = false; $('messages').setAttribute('aria-busy', 'false'); $('firstBtn').disabled = false; $('latestBtn').disabled = false; updateChapterSelection(); }
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
  updateChapterSelection();
  scroller.querySelectorAll('.load-more').forEach(button => { button.disabled = true; button.textContent = '正在加载…'; });
  try {
    const result = await api('/api/messages', { source: selected.source, id: selected.id, direction, cursor, hideSystemMessages: state.displaySettings.hideSystemMessages });
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
    syncVisibleChapter();
  } catch (error) { if (epoch === state.messageEpoch) toast('加载失败：' + error.message); }
  finally {
    if (epoch === state.messageEpoch) {
      state.messageBusy = false;
      updateChapterSelection();
      scroller.querySelectorAll('.load-more').forEach(button => { button.disabled = false; button.textContent = button.closest('.bottom') ? '↓ 加载更新的记录' : '↑ 加载更早的记录'; });
    }
  }
}

async function refresh(initial = false) {
  $('refreshBtn').disabled = true;
  try {
    const [info, conversations] = await Promise.all([api('/api/info'), api('/api/conversations')]);
    state.names = info.names;
    state.localClient = info.localClient;
    $('phoneAccessBtn').hidden = !info.localClient || !info.phoneEnabled;
    $('logoutBtn').hidden = info.localClient;
    state.editToken = info.editToken;
    state.backupSettings = info.backupSettings;
    state.displaySettings = info.displaySettings;
    ViewerAppearance.receive(info.appearanceSettings, info.editToken);
    state.avatars = info.avatars;
    state.conversations = conversations.items;
    $('totalLabel').textContent = `${(info.counts.aion + info.counts.room).toLocaleString()} 条消息${info.counts.theater ? ' · ' + info.counts.theater + ' 章正文' : ''}`;
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
$('chapterSelect').addEventListener('change', event => openChapter(event.target.value));
for (const [button, step] of [['previousChapterBtn', -1], ['nextChapterBtn', 1]]) {
  $(button).addEventListener('click', () => {
    const index = state.chapters.findIndex(chapter => chapter.id === state.currentChapterId);
    const chapter = state.chapters[index + step];
    if (index >= 0 && chapter) openChapter(chapter.id);
  });
}
// 连续往下阅读时，目录也跟随当前章；每帧最多更新一次，避免频繁测量布局。
let chapterScrollFrame = null;
$('messages').addEventListener('scroll', () => {
  if (chapterScrollFrame !== null || state.selected?.kind !== 'theater') return;
  chapterScrollFrame = requestAnimationFrame(() => { chapterScrollFrame = null; syncVisibleChapter(); });
}, { passive: true });
$('refreshBtn').addEventListener('click', () => refresh());
$('sidebarBtn').addEventListener('click', () => setSidebarOpen(!document.body.classList.contains('sidebar-open')));
for (const id of ['sidebarShade', 'closeSidebarBtn']) $(id).addEventListener('click', () => setSidebarOpen(false));
mobileScreen.addEventListener('change', () => { setSidebarOpen(false); setToolbarOpen(false); setMobileSearchOpen(false); setReaderDetailsOpen(false); });
$('toolbarMenuBtn').addEventListener('click', () => setToolbarOpen(!document.body.classList.contains('toolbar-open')));
$('mobileSearchBtn').addEventListener('click', () => setMobileSearchOpen(!document.body.classList.contains('mobile-search-open')));
$('readerDetailsBtn').addEventListener('click', () => setReaderDetailsOpen(!document.body.classList.contains('reader-details-open')));
$('toolbarActions').addEventListener('click', event => { if (event.target.closest('button')) setToolbarOpen(false); });
document.addEventListener('pointerdown', event => {
  if (document.body.classList.contains('toolbar-open') && !event.target.closest('#toolbarActions, #toolbarMenuBtn')) setToolbarOpen(false);
});
$('phoneAccessBtn').addEventListener('click', openPhoneAccess);
$('closePhoneBtn').addEventListener('click', () => $('phoneDialog').close());
$('copyPhoneCodeBtn').addEventListener('click', () => copyPhoneValue($('phoneCode').value));
$('logoutBtn').addEventListener('click', async () => {
  try { await api('/api/logout', {}, { method: 'POST' }); location.replace('/'); }
  catch (error) { toast('退出失败：' + error.message); }
});
$('closeImageBtn').addEventListener('click', () => $('imageDialog').close());
$('imageDialog').addEventListener('click', event => { if (event.target === $('imageDialog')) $('imageDialog').close(); });
$('editForm').addEventListener('submit', event => { event.preventDefault(); saveEdit(); });
$('cancelEditBtn').addEventListener('click', closeEdit);
$('closeEditBtn').addEventListener('click', closeEdit);
$('editDialog').addEventListener('cancel', event => { if (state.editBusy) event.preventDefault(); });
$('editDialog').addEventListener('close', () => { state.edit = null; $('editContent').value = ''; $('editError').hidden = true; });
$('editContent').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); $('editForm').requestSubmit(); } });
$('archiveSettingsBtn').addEventListener('click', openArchiveSettings);
$('archiveEnabled').addEventListener('change', archiveControls);
$('chooseArchiveFolderBtn').addEventListener('click', chooseArchiveFolder);
$('archiveForm').addEventListener('submit', event => { event.preventDefault(); saveArchiveSettings(); });
for (const id of ['cancelArchiveBtn', 'closeArchiveBtn']) $(id).addEventListener('click', () => { if (!state.archiveBusy) $('archiveDialog').close(); });
$('archiveDialog').addEventListener('cancel', event => { if (state.archiveBusy) event.preventDefault(); });
$('displaySettingsBtn').addEventListener('click', openDisplaySettings);
$('displayForm').addEventListener('submit', event => { event.preventDefault(); saveDisplaySettings(); });
for (const id of ['cancelDisplayBtn', 'closeDisplayBtn']) $(id).addEventListener('click', () => { if (!state.displayBusy) $('displayDialog').close(); });
$('displayDialog').addEventListener('cancel', event => { if (state.displayBusy) event.preventDefault(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { setSidebarOpen(false); setToolbarOpen(false); setMobileSearchOpen(false); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); setMobileSearchOpen(true); $('searchInput').select(); }
});
ViewerAppearance.init({ api, toast });
ViewerExport.init({ api, toast, getState: () => state, renderMessages });
ViewerCards.init({ api, toast, getState: () => state, getSelections: ViewerExport.getSelections, beginSelection: ViewerExport.beginSelection });
refresh(true);
